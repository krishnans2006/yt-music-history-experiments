"""Compare a complete myactivity-fast export with all three Takeout exports."""

from __future__ import annotations

import argparse
import csv
import json
from collections import Counter, defaultdict, deque
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import parse_qs, urlparse


ROOT = Path(__file__).resolve().parents[1]
MEDIA = ROOT / "media"
UTC = timezone.utc
HTML_OFFSETS = {
    "UTC": 0, "GMT": 0, "CST": -6, "CDT": -5, "EST": -5,
    "EDT": -4, "MST": -7, "MDT": -6, "PST": -8, "PDT": -7,
}


def normalize(value: str) -> str:
    return " ".join(value.split())


def video_id(url: str) -> str | None:
    return parse_qs(urlparse(url).query).get("v", [None])[0]


def parse_timestamp(value: str) -> tuple[int, str]:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)
    delta = parsed - datetime(1970, 1, 1, tzinfo=UTC)
    microseconds = ((delta.days * 86400 + delta.seconds) * 1_000_000
                    + delta.microseconds)
    return microseconds, parsed.isoformat(timespec="microseconds").replace("+00:00", "Z")


@dataclass(frozen=True)
class Listen:
    source: str
    source_index: int
    video_id: str
    timestamp_us: int
    time_utc: str
    title: str
    channels: tuple[str, ...] = ()
    devices: tuple[str, ...] = ()
    duration_label: str | None = None
    video_progress_percent: int | None = None
    event_id: str | None = None

    @property
    def second_key(self) -> tuple[str, int]:
        return self.video_id, self.timestamp_us // 1_000_000

    @property
    def day_key(self) -> tuple[str, str]:
        return self.video_id, self.time_utc[:10]

    def public_dict(self) -> dict[str, Any]:
        result = asdict(self)
        result["channels"] = list(self.channels)
        result["devices"] = list(self.devices)
        return result


def read_takeout_json(path: Path, source: str) -> list[Listen]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise ValueError(f"{path}: expected a top-level list")
    listens = []
    for index, item in enumerate(data, 1):
        if item.get("header") != "YouTube Music":
            continue
        title = item.get("title", "")
        if not title.startswith("Watched "):
            continue
        url = item.get("titleUrl", "")
        identifier = video_id(url)
        if not identifier:
            raise ValueError(f"{path}: Music row {index} has no video ID")
        timestamp_us, timestamp = parse_timestamp(item["time"])
        listens.append(Listen(
            source=source,
            source_index=index,
            video_id=identifier,
            timestamp_us=timestamp_us,
            time_utc=timestamp,
            title=normalize(title.removeprefix("Watched ")),
            channels=tuple(normalize(channel["name"])
                           for channel in item.get("subtitles", [])
                           if channel.get("name")),
        ))
    return listens


class TakeoutHTMLParser(HTMLParser):
    def __init__(self, source: str):
        super().__init__()
        self.source = source
        self.stack: list[str | None] = []
        self.listens: list[Listen] = []
        self.index = 0
        self.header: list[str] = []
        self.content: list[str] = []
        self.links: list[tuple[str, str]] = []
        self.current_link: dict[str, Any] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if tag == "div":
            classes = (attributes.get("class") or "").split()
            kind = None
            if "outer-cell" in classes:
                self.index += 1
                self.header, self.content, self.links = [], [], []
                self.current_link = None
                kind = "entry"
            elif "header-cell" in classes:
                kind = "header"
            elif ("content-cell" in classes
                  and "mdl-typography--body-1" in classes
                  and "mdl-typography--text-right" not in classes):
                kind = "content"
            self.stack.append(kind)
        elif tag == "br":
            self.handle_data("\n")
        elif tag == "a" and "content" in self.stack:
            self.current_link = {"url": attributes.get("href") or "", "text": []}

    def handle_data(self, data: str) -> None:
        if "header" in self.stack:
            self.header.append(data)
        elif "content" in self.stack:
            self.content.append(data)
            if self.current_link is not None:
                self.current_link["text"].append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self.current_link is not None:
            self.links.append((
                self.current_link["url"],
                normalize("".join(self.current_link["text"])),
            ))
            self.current_link = None
        if tag != "div" or not self.stack or self.stack.pop() != "entry":
            return
        header = normalize("".join(self.header))
        lines = [normalize(line) for line in "".join(self.content).splitlines()
                 if line.strip()]
        if header != "YouTube Music" or not lines or not lines[0].startswith("Watched "):
            return
        date, zone = lines[-1].rsplit(" ", 1)
        if zone not in HTML_OFFSETS:
            raise ValueError(f"HTML row {self.index}: unknown timezone {zone!r}")
        parsed = datetime.strptime(date, "%b %d, %Y, %I:%M:%S %p").replace(
            tzinfo=timezone(timedelta(hours=HTML_OFFSETS[zone]))
        ).astimezone(UTC)
        timestamp_us, timestamp = parse_timestamp(parsed.isoformat())
        watch_url = next((href for href, _ in self.links if "watch?" in href), "")
        identifier = video_id(watch_url)
        if not identifier:
            raise ValueError(f"HTML Music row {self.index} has no video ID")
        self.listens.append(Listen(
            source=self.source,
            source_index=self.index,
            video_id=identifier,
            timestamp_us=timestamp_us,
            time_utc=timestamp,
            title=normalize(lines[0].removeprefix("Watched ")),
            channels=tuple(text for href, text in self.links if "/channel/" in href),
        ))


def read_takeout_html(path: Path, source: str) -> list[Listen]:
    parser = TakeoutHTMLParser(source)
    with path.open(encoding="utf-8") as file:
        for chunk in iter(lambda: file.read(65536), ""):
            parser.feed(chunk)
    parser.close()
    return parser.listens


def read_browser(path: Path) -> tuple[list[Listen], dict[str, Any]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    errors = []
    if data.get("schemaVersion") != 1:
        errors.append("schemaVersion is not 1")
    if data.get("kind") != "myactivity-fast-export":
        errors.append("kind is not myactivity-fast-export")
    run = data.get("run", {})
    coverage = data.get("coverage", {})
    windows = run.get("windows", [])
    events = data.get("events", [])
    if run.get("status") != "complete":
        errors.append("run.status is not complete")
    if coverage.get("complete") is not True:
        errors.append("coverage.complete is not true")
    if run.get("validation", {}).get("complete") is not True:
        errors.append("reference validation is not complete")
    if not windows or any(window.get("done") is not True for window in windows):
        errors.append("not every range window is complete")
    if run.get("musicCount") != len(events):
        errors.append("run.musicCount differs from events length")
    if sum(window.get("musicCount", 0) for window in windows) != len(events):
        errors.append("window musicCount sum differs from events length")

    listens = []
    event_keys = set()
    event_ids = set()
    prior_us = -1
    start_us, _ = parse_timestamp(run["startUTC"])
    end_us, _ = parse_timestamp(run["endUTC"])
    for index, item in enumerate(events, 1):
        try:
            timestamp_us = int(item["timestampMicroseconds"])
            identifier = item["videoId"]
            timestamp = item["timeUTC"]
        except (KeyError, TypeError, ValueError) as error:
            raise ValueError(f"{path}: malformed browser event {index}") from error
        if not identifier:
            errors.append(f"event {index} has no video ID")
        if item.get("app") != "YouTube Music":
            errors.append(f"event {index} is not labeled YouTube Music")
        parsed_us, normalized_time = parse_timestamp(timestamp)
        if parsed_us != timestamp_us:
            errors.append(f"event {index} timestamp fields disagree")
        if timestamp_us < prior_us:
            errors.append(f"events are not ordered at event {index}")
        if not start_us <= timestamp_us < end_us:
            errors.append(f"event {index} is outside the run interval")
        prior_us = timestamp_us
        event_key = item.get("eventKey")
        event_id = item.get("eventId")
        if event_key in event_keys:
            errors.append(f"duplicate eventKey at event {index}")
        if event_id in event_ids:
            errors.append(f"duplicate eventId at event {index}")
        event_keys.add(event_key)
        event_ids.add(event_id)
        listens.append(Listen(
            source="browser",
            source_index=index,
            video_id=identifier,
            timestamp_us=timestamp_us,
            time_utc=normalized_time,
            title=normalize(item.get("title") or ""),
            channels=tuple(normalize(channel["name"])
                           for channel in item.get("channels", [])
                           if channel.get("name")),
            devices=tuple(normalize(device) for device in item.get("devices", [])),
            duration_label=item.get("durationLabel"),
            video_progress_percent=item.get("videoProgressPercent"),
            event_id=event_id,
        ))
    integrity = {
        "valid": not errors,
        "errors": errors,
        "schema_version": data.get("schemaVersion"),
        "run_id": run.get("id"),
        "run_status": run.get("status"),
        "coverage_complete": coverage.get("complete"),
        "validation_complete": run.get("validation", {}).get("complete"),
        "range_start_utc": run.get("startUTC"),
        "range_end_utc_exclusive": run.get("endUTC"),
        "window_count": len(windows),
        "completed_windows": sum(window.get("done") is True for window in windows),
        "declared_music_count": run.get("musicCount"),
        "event_count": len(events),
        "unique_event_keys": len(event_keys),
        "unique_event_ids": len(event_ids),
    }
    if errors:
        raise ValueError("Browser export integrity checks failed: " + "; ".join(errors[:10]))
    return listens, integrity


def counter_summary(values: Iterable[str], limit: int | None = None) -> dict[str, int]:
    counts = Counter(values)
    rows = counts.most_common(limit)
    return dict(rows)


def source_summary(listens: list[Listen]) -> dict[str, Any]:
    keys = Counter(item.second_key for item in listens)
    return {
        "listens": len(listens),
        "unique_videos": len({item.video_id for item in listens}),
        "oldest_utc": min((item.time_utc for item in listens), default=None),
        "newest_utc": max((item.time_utc for item in listens), default=None),
        "duplicate_video_second_rows": sum(count - 1 for count in keys.values()),
        "same_video_utc_day_extra_rows": (
            len(listens) - len({item.day_key for item in listens})
        ),
    }


def compare_source(browser: list[Listen], takeout: list[Listen]) -> dict[str, Any]:
    available: dict[tuple[str, int], deque[Listen]] = defaultdict(deque)
    for item in browser:
        available[item.second_key].append(item)
    missing = []
    matched = 0
    exact_microseconds = 0
    exact_milliseconds = 0
    for item in takeout:
        candidates = available[item.second_key]
        if not candidates:
            missing.append(item.public_dict())
            continue
        candidate_index = next(
            (i for i, candidate in enumerate(candidates)
             if candidate.timestamp_us == item.timestamp_us),
            0,
        )
        candidate = candidates[candidate_index]
        del candidates[candidate_index]
        matched += 1
        exact_microseconds += candidate.timestamp_us == item.timestamp_us
        exact_milliseconds += (
            candidate.timestamp_us // 1000 == item.timestamp_us // 1000
        )
    return {
        "takeout": source_summary(takeout),
        "matched_video_and_utc_second": matched,
        "coverage_percent": round(100 * matched / len(takeout), 6) if takeout else 100,
        "matched_exact_microsecond": exact_microseconds,
        "matched_exact_millisecond": exact_milliseconds,
        "missing_from_browser_count": len(missing),
        "missing_from_browser": missing,
        "browser_events_not_exactly_in_this_takeout": len(browser) - matched,
    }


def union_takeout(takeouts: dict[str, list[Listen]]) -> list[Listen]:
    """Return a multiset union, taking max multiplicity rather than summing sources."""
    grouped: dict[tuple[str, int], dict[str, deque[Listen]]] = defaultdict(
        lambda: defaultdict(deque)
    )
    for source, listens in takeouts.items():
        for item in listens:
            grouped[item.second_key][source].append(item)
    union = []
    for sources in grouped.values():
        multiplicity = max(map(len, sources.values()))
        preferred = max(sources.values(), key=len)
        union.extend(list(preferred)[:multiplicity])
    return sorted(union, key=lambda item: (item.timestamp_us, item.video_id))


def browser_partition(
    browser: list[Listen], takeout_union: list[Listen]
) -> tuple[list[Listen], list[Listen], list[Listen]]:
    required = Counter(item.second_key for item in takeout_union)
    matched, additional = [], []
    for item in browser:
        if required[item.second_key]:
            required[item.second_key] -= 1
            matched.append(item)
        else:
            additional.append(item)
    missing = []
    for item in takeout_union:
        if required[item.second_key]:
            required[item.second_key] -= 1
            missing.append(item)
    return matched, additional, missing


def event_context(browser: list[Listen]) -> dict[int, dict[str, Any]]:
    result = {}
    for index, item in enumerate(browser):
        previous = browser[index - 1] if index else None
        following = browser[index + 1] if index + 1 < len(browser) else None
        result[item.source_index] = {
            "previous_gap_seconds": (
                (item.timestamp_us - previous.timestamp_us) / 1_000_000
                if previous else None
            ),
            "next_gap_seconds": (
                (following.timestamp_us - item.timestamp_us) / 1_000_000
                if following else None
            ),
            "adjacent_same_video_within_30_minutes": bool(
                (previous and previous.video_id == item.video_id
                 and item.timestamp_us - previous.timestamp_us <= 1_800_000_000)
                or (following and following.video_id == item.video_id
                    and following.timestamp_us - item.timestamp_us <= 1_800_000_000)
            ),
            "previous_same_video_gap_seconds": (
                (item.timestamp_us - previous.timestamp_us) / 1_000_000
                if previous and previous.video_id == item.video_id else None
            ),
            "next_same_video_gap_seconds": (
                (following.timestamp_us - item.timestamp_us) / 1_000_000
                if following and following.video_id == item.video_id else None
            ),
        }
    return result


def detailed_additional(
    browser: list[Listen], additional: list[Listen], takeout_union: list[Listen]
) -> list[dict[str, Any]]:
    takeout_days = {item.day_key for item in takeout_union}
    takeout_videos = {item.video_id for item in takeout_union}
    browser_day_counts = Counter(item.day_key for item in browser)
    earliest_takeout_us = min(item.timestamp_us for item in takeout_union)
    latest_takeout_us = max(item.timestamp_us for item in takeout_union)
    contexts = event_context(browser)
    details = []
    for item in additional:
        context = contexts[item.source_index]
        details.append({
            **item.public_dict(),
            "before_earliest_takeout_music_event": item.timestamp_us < earliest_takeout_us,
            "after_latest_takeout_music_event": item.timestamp_us > latest_takeout_us,
            "same_video_day_in_takeout_union": item.day_key in takeout_days,
            "video_seen_in_takeout_union": item.video_id in takeout_videos,
            "browser_events_for_same_video_day": browser_day_counts[item.day_key],
            **context,
        })
    return details


def cohort_summary(rows: list[dict[str, Any]]) -> dict[str, Any]:
    def duration_seconds(label: str | None) -> int | None:
        if not label:
            return None
        parts = label.split(":")
        if len(parts) not in (2, 3) or not all(part.isdigit() for part in parts):
            return None
        total = 0
        for part in parts:
            total = total * 60 + int(part)
        return total

    comparable_next_repeats = [
        (row["next_same_video_gap_seconds"], duration_seconds(row["duration_label"]))
        for row in rows
        if row["next_same_video_gap_seconds"] is not None
        and duration_seconds(row["duration_label"]) is not None
    ]
    return {
        "count": len(rows),
        "unique_videos": len({row["video_id"] for row in rows}),
        "by_year": counter_summary(row["time_utc"][:4] for row in rows),
        "by_month": counter_summary(row["time_utc"][:7] for row in rows),
        "top_days": counter_summary((row["time_utc"][:10] for row in rows), 20),
        "top_videos": [
            {"video_id": identifier, "title": next(
                row["title"] for row in rows if row["video_id"] == identifier
            ), "count": count}
            for identifier, count in Counter(
                row["video_id"] for row in rows
            ).most_common(20)
        ],
        "devices": counter_summary(
            device or "(none)"
            for row in rows
            for device in (row["devices"] or [""])
        ),
        "device_combinations": counter_summary(
            " + ".join(row["devices"]) or "(none)" for row in rows
        ),
        "duration_label_present": sum(row["duration_label"] is not None for row in rows),
        "progress_percent_present": sum(
            row["video_progress_percent"] is not None for row in rows
        ),
        "next_event_within_60_seconds": sum(
            row["next_gap_seconds"] is not None
            and row["next_gap_seconds"] <= 60 for row in rows
        ),
        "next_event_within_120_seconds": sum(
            row["next_gap_seconds"] is not None
            and row["next_gap_seconds"] <= 120 for row in rows
        ),
        "adjacent_same_video_within_30_minutes": sum(
            row["adjacent_same_video_within_30_minutes"] for row in rows
        ),
        "immediate_next_event_is_same_video": sum(
            row["next_same_video_gap_seconds"] is not None for row in rows
        ),
        "next_same_video_gap_comparable_to_duration": len(comparable_next_repeats),
        "next_same_video_gap_within_15_seconds_of_duration": sum(
            abs(gap - duration) <= 15
            for gap, duration in comparable_next_repeats
        ),
        "next_same_video_gap_within_30_seconds_of_duration": sum(
            abs(gap - duration) <= 30
            for gap, duration in comparable_next_repeats
        ),
    }


def analyze(
    browser: list[Listen],
    integrity: dict[str, Any],
    takeouts: dict[str, list[Listen]],
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    comparisons = {
        source: compare_source(browser, listens)
        for source, listens in takeouts.items()
    }
    takeout_union = union_takeout(takeouts)
    matched, additional, union_missing = browser_partition(browser, takeout_union)
    details = detailed_additional(browser, additional, takeout_union)
    matched_details = detailed_additional(browser, matched, takeout_union)
    earliest_takeout_us = min(item.timestamp_us for item in takeout_union)
    latest_takeout_us = max(item.timestamp_us for item in takeout_union)
    within_snapshot = [
        row for row in details
        if earliest_takeout_us <= row["timestamp_us"] <= latest_takeout_us
    ]
    same_day = [row for row in within_snapshot if row["same_video_day_in_takeout_union"]]
    known_other_day = [
        row for row in within_snapshot
        if not row["same_video_day_in_takeout_union"]
        and row["video_seen_in_takeout_union"]
    ]
    absent_video = [
        row for row in within_snapshot if not row["video_seen_in_takeout_union"]
    ]
    duplicate_day_groups = Counter(item.day_key for item in browser)
    title_by_video = {item.video_id: item.title for item in browser}
    report = {
        "method": {
            "listen_filter": "YouTube Music rows whose action is Watched.",
            "exact_match": (
                "Video ID + UTC second, preserving multiplicity. Browser microseconds "
                "are floored only because Takeout HTML has second precision."
            ),
            "takeout_union": (
                "Maximum multiplicity for each exact key across the three Takeouts; "
                "overlapping copies are not added together."
            ),
            "additional": (
                "A browser event left after subtracting that multiset union. "
                "Same-video/day is classification evidence, never a match."
            ),
            "html_timezone": (
                "The explicit timezone abbreviation on every card is converted with "
                "its fixed offset (including CST = UTC-06:00)."
            ),
        },
        "browser_integrity": integrity,
        "sources": comparisons,
        "takeout_union": source_summary(takeout_union),
        "browser": source_summary(browser),
        "union_coverage": {
            "matched_takeout_union_events": len(matched),
            "missing_takeout_union_events": len(union_missing),
            "missing_takeout_union_event_details": [
                item.public_dict() for item in union_missing
            ],
            "browser_additional_events": len(additional),
            "browser_additional_within_takeout_music_snapshot": len(within_snapshot),
            "browser_additional_before_earliest_takeout_music_event": sum(
                row["before_earliest_takeout_music_event"] for row in details
            ),
            "browser_additional_after_latest_takeout_music_event": (
                sum(row["after_latest_takeout_music_event"] for row in details)
            ),
            "earliest_takeout_music_event_utc": min(
                item.time_utc for item in takeout_union
            ),
            "latest_takeout_music_event_utc": max(
                item.time_utc for item in takeout_union
            ),
        },
        "additional_classification_within_snapshot": {
            "same_video_and_utc_day_already_in_takeout": len(same_day),
            "video_in_takeout_but_not_that_utc_day": len(known_other_day),
            "video_entirely_absent_from_takeout": len(absent_video),
        },
        "browser_repeat_structure": {
            "unique_video_utc_days": len(duplicate_day_groups),
            "same_video_day_extra_rows": (
                len(browser) - len(duplicate_day_groups)
            ),
            "same_video_days_with_multiple_events": sum(
                count > 1 for count in duplicate_day_groups.values()
            ),
            "events_on_same_video_days_with_multiple_events": sum(
                count for count in duplicate_day_groups.values() if count > 1
            ),
            "largest_same_video_day_count": max(duplicate_day_groups.values()),
            "largest_same_video_day_groups": [
                {
                    "video_id": identifier,
                    "title": title_by_video[identifier],
                    "day_utc": day,
                    "events": count,
                }
                for (identifier, day), count in duplicate_day_groups.most_common(20)
            ],
        },
        "additional_cohorts": {
            "all": cohort_summary(details),
            "within_snapshot": cohort_summary(within_snapshot),
            "same_video_day_within_snapshot": cohort_summary(same_day),
            "known_video_other_day_within_snapshot": cohort_summary(known_other_day),
            "new_video_within_snapshot": cohort_summary(absent_video),
        },
        "matched_browser_cohort": cohort_summary(matched_details),
    }
    return report, details


def write_outputs(
    output: Path, report: dict[str, Any], details: list[dict[str, Any]]
) -> None:
    output.mkdir(parents=True, exist_ok=True)
    (output / "report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    with (output / "browser-only.jsonl").open("w", encoding="utf-8") as file:
        for row in details:
            file.write(json.dumps(row, ensure_ascii=False) + "\n")
    columns = [
        "time_utc", "timestamp_us", "video_id", "title", "channels", "devices",
        "duration_label", "video_progress_percent",
        "before_earliest_takeout_music_event", "after_latest_takeout_music_event",
        "same_video_day_in_takeout_union",
        "video_seen_in_takeout_union", "browser_events_for_same_video_day",
        "previous_gap_seconds", "next_gap_seconds",
        "adjacent_same_video_within_30_minutes",
        "previous_same_video_gap_seconds", "next_same_video_gap_seconds",
    ]
    with (output / "browser-only.tsv").open(
        "w", encoding="utf-8", newline=""
    ) as file:
        writer = csv.DictWriter(file, columns, delimiter="\t", extrasaction="ignore")
        writer.writeheader()
        for row in details:
            writable = dict(row)
            writable["channels"] = " | ".join(row["channels"])
            writable["devices"] = " | ".join(row["devices"])
            writer.writerow(writable)


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "browser_export",
        nargs="?",
        type=Path,
        default=MEDIA / "myactivity-fast-22f844df-877a-4efa-8fe3-882698ee0ba3(1).json",
    )
    parser.add_argument("--myactivity-json", type=Path,
                        default=MEDIA / "MyActivity.json")
    parser.add_argument("--watch-json", type=Path,
                        default=MEDIA / "watch-history.json")
    parser.add_argument("--watch-html", type=Path,
                        default=MEDIA / "watch-history.html")
    parser.add_argument("--output", type=Path,
                        default=MEDIA / "browser-export-analysis")
    return parser.parse_args()


def main() -> None:
    args = arguments()
    browser, integrity = read_browser(args.browser_export)
    takeouts = {
        "myactivity_json": read_takeout_json(
            args.myactivity_json, "myactivity_json"
        ),
        "watch_history_json": read_takeout_json(
            args.watch_json, "watch_history_json"
        ),
        "watch_history_html": read_takeout_html(
            args.watch_html, "watch_history_html"
        ),
    }
    report, details = analyze(browser, integrity, takeouts)
    write_outputs(args.output, report, details)
    print(f"Browser export: {len(browser):,} Music events")
    for source, comparison in report["sources"].items():
        print(
            f"{source}: {comparison['matched_video_and_utc_second']:,}/"
            f"{comparison['takeout']['listens']:,} exact events covered; "
            f"{comparison['missing_from_browser_count']:,} missing"
        )
    coverage = report["union_coverage"]
    print(
        f"Takeout union: {coverage['matched_takeout_union_events']:,} covered; "
        f"{coverage['missing_takeout_union_events']:,} missing"
    )
    print(
        f"Browser-only: {coverage['browser_additional_events']:,} total; "
        f"{coverage['browser_additional_within_takeout_music_snapshot']:,} "
        "within the Takeout Music time span"
    )
    print(f"Detailed outputs: {args.output}")


if __name__ == "__main__":
    main()
