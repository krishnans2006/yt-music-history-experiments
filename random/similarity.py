import json
from collections import Counter, defaultdict, deque
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parents[1]
MEDIA = ROOT / "media"
REPORT = Path(__file__).with_name("similarity-report.json")
# Takeout labels every HTML date with an explicit timezone abbreviation.
OFFSETS = {"UTC": 0, "GMT": 0, "CST": -6, "CDT": -5, "EST": -5,
           "EDT": -4, "MST": -7, "MDT": -6, "PST": -8, "PDT": -7}


def normalize(text):
    return " ".join(text.split())


def entry(index, header, title, url, timestamp, artists):
    return {
        "source_index": index,
        "header": header,
        "title": normalize(title.removeprefix("Watched ")),
        "video_id": parse_qs(urlparse(url).query).get("v", [None])[0],
        "url": url,
        "time": timestamp.astimezone(timezone.utc).replace(microsecond=0).isoformat(),
        "original_time": timestamp.isoformat(),
        "artists": [normalize(name) for name in artists],
    }


def read_json(path):
    data = json.loads(path.read_text(encoding="utf-8"))
    return [
        entry(i, item.get("header", ""), item["title"], item.get("titleUrl", ""),
              datetime.fromisoformat(item["time"].replace("Z", "+00:00")),
              [artist["name"] for artist in item.get("subtitles", [])])
        for i, item in enumerate(data, 1)
        if item.get("title", "").startswith("Watched ")
    ]


class HistoryParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.divs = []
        self.entries = []
        self.index = 0
        self.header = []
        self.content = []
        self.links = []
        self.link = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "div":
            classes = attrs.get("class", "").split()
            kind = None
            if "outer-cell" in classes:
                self.index += 1
                self.header, self.content, self.links = [], [], []
                self.link = None
                kind = "entry"
            elif "header-cell" in classes:
                kind = "header"
            elif ("content-cell" in classes and "mdl-typography--body-1" in classes
                  and "mdl-typography--text-right" not in classes):
                kind = "content"
            self.divs.append(kind)
        elif tag == "br":
            self.handle_data("\n")
        elif tag == "a" and "content" in self.divs:
            self.link = {"url": attrs.get("href", ""), "text": []}

    def handle_data(self, data):
        if "header" in self.divs:
            self.header.append(data)
        elif "content" in self.divs:
            self.content.append(data)
            if self.link is not None:
                self.link["text"].append(data)

    def handle_endtag(self, tag):
        if tag == "a" and self.link is not None:
            self.links.append((self.link["url"], "".join(self.link["text"])))
            self.link = None
        if tag != "div" or not self.divs or self.divs.pop() != "entry":
            return
        lines = [normalize(line) for line in "".join(self.content).splitlines() if line.strip()]
        if not lines or not lines[0].startswith("Watched "):
            return
        date, zone = lines[-1].rsplit(" ", 1)
        timestamp = datetime.strptime(date, "%b %d, %Y, %I:%M:%S %p").replace(
            tzinfo=timezone(timedelta(hours=OFFSETS[zone]))
        )
        # The watch link is first; channel links identify the artist(s).
        url = self.links[0][0] if self.links and "watch?" in self.links[0][0] else ""
        artists = [text for href, text in self.links if "/channel/" in href]
        self.entries.append(entry(self.index, normalize("".join(self.header)),
                                  lines[0], url, timestamp, artists))


def read_html(path):
    parser = HistoryParser()
    with path.open(encoding="utf-8") as file:
        for chunk in iter(lambda: file.read(65536), ""):
            parser.feed(chunk)
    parser.close()
    return parser.entries


def key(item):
    return (item["video_id"] or item["url"] or item["title"], item["time"])


def coverage(entries):
    times = [item["time"] for item in entries]
    counts = Counter(key(item) for item in entries)
    return {
        "listens": len(entries),
        "unique_videos": len({item["video_id"] for item in entries if item["video_id"]}),
        "oldest_utc": min(times) if times else None,
        "newest_utc": max(times) if times else None,
        "repeated_video_and_second_keys": sum(n - 1 for n in counts.values()),
        "missing_video_ids": sum(item["video_id"] is None for item in entries),
        "titles_that_are_urls": sum(item["title"].startswith(("https://", "http://")) for item in entries),
        "missing_artists": sum(not item["artists"] for item in entries),
    }


def compare(json_all, html_all):
    json_music = [item for item in json_all if item["header"] == "YouTube Music"]
    html_music = [item for item in html_all if item["header"] == "YouTube Music"]
    remaining = defaultdict(deque)
    for item in html_music:
        remaining[key(item)].append(item)
    json_only, metadata_differences = [], []
    matched = 0
    for item in json_music:
        candidates = remaining[key(item)]
        if not candidates:
            json_only.append(item)
            continue
        other = candidates.popleft()
        matched += 1
        differences = [field for field in ("title", "artists", "url") if item[field] != other[field]]
        if differences:
            metadata_differences.append({"fields": differences, "json": item, "html": other})
    html_only = [item for items in remaining.values() for item in items]

    # Identify unmatched Music listens present under another service's label.
    for unmatched, opposite in ((json_only, html_all), (html_only, json_all)):
        other_headers = defaultdict(Counter)
        for item in opposite:
            if item["header"] != "YouTube Music":
                other_headers[key(item)][item["header"]] += 1
        for item in unmatched:
            item["other_export_non_music_matches"] = dict(other_headers[key(item)])

    json_months = Counter(item["time"][:7] for item in json_music)
    html_months = Counter(item["time"][:7] for item in html_music)
    json_missing_months = Counter(item["time"][:7] for item in json_only)
    html_missing_months = Counter(item["time"][:7] for item in html_only)
    json_days = Counter(item["time"][:10] for item in json_only)
    html_days = Counter(item["time"][:10] for item in html_only)
    json_ids = {item["video_id"] for item in json_music if item["video_id"]}
    html_ids = {item["video_id"] for item in html_music if item["video_id"]}
    return {
        "method": "Only YouTube Music Watched actions. Match video ID + UTC second, "
                  "discarding JSON fractional seconds to match HTML precision. Preserve "
                  "multiplicity. Missing IDs fall back to URL, then title. HTML timezone "
                  "abbreviations use fixed offsets, including CST = UTC-06:00. "
                  "Title/artist comparisons normalize whitespace. Cross-service matches "
                  "are candidates, not proof of reclassification.",
        "json": coverage(json_music),
        "html": coverage(html_music),
        "matched_listens": matched,
        "json_only_count": len(json_only),
        "html_only_count": len(html_only),
        "matched_metadata_difference_count": len(metadata_differences),
        "metadata_difference_fields": dict(Counter(
            field for difference in metadata_differences for field in difference["fields"]
        )),
        "video_ids_only_in_json": sorted(json_ids - html_ids),
        "video_ids_only_in_html": sorted(html_ids - json_ids),
        "months": [
            {"month_utc": month, "json": json_months[month], "html": html_months[month],
             "json_only": json_missing_months[month], "html_only": html_missing_months[month]}
            for month in sorted(json_months.keys() | html_months.keys())
        ],
        "json_only": sorted(json_only, key=lambda item: item["time"]),
        "days_with_unmatched_listens": [
            {"day_utc": day, "json_only": json_days[day], "html_only": html_days[day]}
            for day in sorted(json_days.keys() | html_days.keys())
        ],
        "html_only": sorted(html_only, key=lambda item: item["time"]),
        "metadata_differences": metadata_differences,
    }


if __name__ == "__main__":
    report = compare(read_json(MEDIA / "MyActivity.json"), read_html(MEDIA / "watch-history.html"))
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for source in ("json", "html"):
        stats = report[source]
        print(f"{source.upper()}: {stats['listens']:,} Music listens, {stats['unique_videos']:,} unique videos")
        print(f"  UTC range: {stats['oldest_utc']} to {stats['newest_utc']}")
        print(f"  URL-only titles: {stats['titles_that_are_urls']:,}; missing artists: {stats['missing_artists']:,}")
    print(f"Matched listens (video + UTC second): {report['matched_listens']:,}")
    print(f"Only in JSON: {report['json_only_count']:,}")
    print(f"Only in HTML: {report['html_only_count']:,}")
    print(f"Matched listens with different metadata: {report['matched_metadata_difference_count']:,}")
    print(f"  Fields: {report['metadata_difference_fields']}")
    print(f"Videos found only in JSON: {len(report['video_ids_only_in_json']):,}")
    print(f"Videos found only in HTML: {len(report['video_ids_only_in_html']):,}")
    print("\nMonths with unmatched listens (UTC):")
    print("Month      JSON   HTML   JSON-only   HTML-only")
    for month in report["months"]:
        if month["json_only"] or month["html_only"]:
            print(f"{month['month_utc']}  {month['json']:6,} {month['html']:6,}"
                  f"  {month['json_only']:10,}  {month['html_only']:10,}")
    for field in ("json_only", "html_only"):
        items = report[field]
        cross_service = sum(bool(item["other_export_non_music_matches"]) for item in items)
        print(f"\n{field}: {cross_service:,} have a same-video/second match under another service.")
        for item in items[:3]:
            print(f"  {item['time']}  {item['video_id']}  {item['title']}")
    print(f"\nFull discrepancies and metadata comparison: {REPORT}")
