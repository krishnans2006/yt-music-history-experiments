import json
from pathlib import Path
from urllib.parse import parse_qs, urlparse


def parse_listens(entries):
    return [
        entry for entry in entries
        if entry.get("header") == "YouTube Music"
        and entry.get("title", "").startswith("Watched ")
    ]


if __name__ == "__main__":
    files = Path(__file__).resolve().parents[1] / "media"
    for path in sorted(files.glob("*.json")):
        listens = parse_listens(json.loads(path.read_text(encoding="utf-8")))
        video_ids = {
            video_id
            for entry in listens
            for video_id in parse_qs(urlparse(entry.get("titleUrl", "")).query).get("v", [])
        }
        print(f"{path.name}:")
        print(f"  YouTube Music listens: {len(listens):,}")
        print(f"  Unique videos with IDs: {len(video_ids):,}")
