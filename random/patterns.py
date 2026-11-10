"""Investigate coverage, repeats, and gaps in the Music history exports."""
import json
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

from similarity import MEDIA, compare, key, read_html, read_json

REPORT = Path(__file__).with_name("patterns-report.json")


def song_day(item):
    return item["video_id"], item["time"][:10]


def analyze(json_all, html_all, third):
    comparison = compare(json_all, html_all)
    sources = {
        "json": [x for x in json_all if x["header"] == "YouTube Music"],
        "html": [x for x in html_all if x["header"] == "YouTube Music"],
    }
    mappings = {name: {key(x): x for x in entries} for name, entries in sources.items()}
    assert all(len(mappings[name]) == len(entries) for name, entries in sources.items()), "Repeated exact keys need multiset handling"
    union = sorted({key(x): dict(x) for entries in sources.values() for x in entries}.values(), key=lambda x: x["time"])
    for item in union:
        item["status"] = ("both" if key(item) in mappings["json"] and key(item) in mappings["html"]
                          else "json_only" if key(item) in mappings["json"] else "html_only")
    days = defaultdict(list)
    for item in union:
        days[song_day(item)].append(item)
    runs, sessions = [], []
    for i, item in enumerate(union):
        item["previous_gap_seconds"] = (datetime.fromisoformat(item["time"]) - datetime.fromisoformat(union[i-1]["time"])).total_seconds() if i else None
        item["next_gap_seconds"] = (datetime.fromisoformat(union[i+1]["time"]) - datetime.fromisoformat(item["time"])).total_seconds() if i+1 < len(union) else None
        if not sessions or item["previous_gap_seconds"] > 1800:
            sessions.append([])
        sessions[-1].append(item)
        if not runs or runs[-1][-1]["video_id"] != item["video_id"] or item["previous_gap_seconds"] > 1800:
            runs.append([])
        runs[-1].append(item)
    repeat_keys = {key(item) for run in runs if len(run) > 1 for item in run}
    first_seen, last_seen = {}, {}
    frequencies = Counter(x["video_id"] for x in union)
    for x in union:
        first_seen.setdefault(x["video_id"], x["time"])
        last_seen[x["video_id"]] = x["time"]
    groups = {}
    for status in ("both", "json_only", "html_only"):
        entries = [x for x in union if x["status"] == status]
        def gap_count(field, low, high):
            return sum(x[field] is not None and low < x[field] <= high for x in entries)
        other = mappings["html" if status == "json_only" else "json"]
        other_ids = {x["video_id"] for x in other.values()}
        groups[status] = {
            "count": len(entries),
            "first_observed_for_video": sum(x["time"] == first_seen[x["video_id"]] for x in entries),
            "last_observed_for_video": sum(x["time"] == last_seen[x["video_id"]] for x in entries),
            "first_observed_for_video_since_2025": sum(x["time"] == first_seen[x["video_id"]] and x["time"] >= "2025" for x in entries),
            "entries_since_2025": sum(x["time"] >= "2025" for x in entries),
            "consecutive_repeat_episode_entries": sum(key(x) in repeat_keys for x in entries),
            "same_video_day_in_other_export": sum(any(song_day(x) == song_day(y) for y in other.values()) for x in entries) if status != "both" else len(entries),
            "video_entirely_absent_other_export": sum(x["video_id"] not in other_ids for x in entries) if status != "both" else 0,
            "previous_gap_over_30_minutes": gap_count("previous_gap_seconds", 1800, float("inf")),
            "next_gap_seconds": {label: gap_count("next_gap_seconds", low, high) for label, low, high in
                                 [("0_to_10", -1, 10), ("11_to_60", 10, 60), ("61_to_120", 60, 120),
                                  ("121_to_300", 120, 300), ("301_to_1800", 300, 1800), ("over_1800", 1800, float("inf"))]},
            "entirely_exclusive_sessions": sum(all(x["status"] == status for x in session) for session in sessions),
            "entries_in_entirely_exclusive_sessions": sum(len(session) for session in sessions if all(x["status"] == status for x in session)),
        }
    source_day_keys = {name: {song_day(x) for x in entries} for name, entries in sources.items()}
    repeat_pairs = [items for items in days.values() if {x["status"] for x in items} == {"json_only", "html_only"}]
    assert all(len(items) == 2 for items in repeat_pairs)
    source_metadata = {}
    for name, entries in sources.items():
        vids = defaultdict(list)
        for x in entries:
            vids[x["video_id"]].append(x)
        source_metadata[name] = {
            "video_metadata_states": dict(Counter("always_missing" if all(not x["artists"] for x in xs) else "always_present" if all(x["artists"] for x in xs) else "mixed" for xs in vids.values())),
            "extra_same_video_utc_day_entries": len(entries) - len(source_day_keys[name]),
        }
    third_music = [x for x in third if x["header"] == "YouTube Music"]
    third_keys = {key(x) for x in third_music}
    lo = min(x["time"] for x in third_music) if third_music else None
    hi = max(x["time"] for x in third_music) if third_music else None
    third_check = {"oldest_utc": lo, "newest_utc": hi, "listens": len(third_music)}
    for status in groups:
        xs = [x for x in union if x["status"] == status and lo and lo <= x["time"] <= hi]
        third_check[status] = {"within_range": len(xs), "also_in_third": sum(key(x) in third_keys for x in xs)}
    union_keys = {key(x) for x in union}
    union_days = set(days)
    third_check["additional_timestamps"] = [dict(x, same_video_day_in_primary_exports=song_day(x) in union_days) for x in third_music if key(x) not in union_keys]
    return {
        "method": "Music Watched entries only. Exact match = video ID + UTC second. "
                  "A repeat episode is adjacent same-video entries separated by <=30 minutes in the combined timeline; "
                  "a session ends after a gap >30 minutes. Gaps are between logged events, not watch durations. "
                  "Song-days are UTC, not the HTML display's CST calendar days. Union counts are observed records, not proven physical plays.",
        "comparison_summary": {k: v for k, v in comparison.items() if k not in ("json_only", "html_only", "metadata_differences")},
        "groups": groups,
        "source_metadata": source_metadata,
        "video_frequency_groups": {
            label: dict(Counter(x["status"] for x in union if lo <= frequencies[x["video_id"]] <= hi))
            for label, lo, hi in [("1", 1, 1), ("2_to_5", 2, 5), ("6_to_20", 6, 20), ("over_20", 21, len(union))]
        },
        "song_day_comparison": {
            "json": len(source_day_keys["json"]), "html": len(source_day_keys["html"]),
            "shared": len(source_day_keys["json"] & source_day_keys["html"]),
            "json_only": len(source_day_keys["json"] - source_day_keys["html"]),
            "html_only": len(source_day_keys["html"] - source_day_keys["json"]),
            "json_later_in_different_timestamp_pairs": sum(next(x["time"] for x in pair if x["status"] == "json_only") > next(x["time"] for x in pair if x["status"] == "html_only") for pair in repeat_pairs),
        },
        "different_timestamp_same_song_day_pairs": repeat_pairs,
        "repeat_episodes": [run for run in runs if len(run) > 1],
        "yearly_counts": {year: dict(Counter(x["status"] for x in union if x["time"].startswith(year))) for year in sorted({x["time"][:4] for x in union})},
        "third_export_check": third_check,
        "unmatched_context": [
            {"entry": x, "previous": union[i-1] if i else None, "next": union[i+1] if i+1 < len(union) else None}
            for i, x in enumerate(union) if x["status"] != "both"
        ],
    }


if __name__ == "__main__":
    report = analyze(read_json(MEDIA / "MyActivity.json"), read_html(MEDIA / "watch-history.html"),
                     read_json(MEDIA / "watch-history.json"))
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: report[k] for k in ("groups", "song_day_comparison", "source_metadata", "third_export_check")}, indent=2, ensure_ascii=False))
    print(f"Full analysis and neighboring entries: {REPORT}")
