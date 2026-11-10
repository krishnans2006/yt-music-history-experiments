import json

from ytmusicapi import YTMusic, setup

from secret import BROWSER_HEADERS

auth = json.loads(setup(headers_raw=BROWSER_HEADERS.strip()))
history = YTMusic(auth).get_history()

with open("youtube_music_history.json", mode="w", encoding="utf-8") as file:
    json.dump(history, file, ensure_ascii=False, indent=2)

print(f"Saved {len(history)} entries to youtube_music_history.json")
