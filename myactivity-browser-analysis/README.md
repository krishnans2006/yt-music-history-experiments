# Browser export comparison

`main.py` compares a completed `myactivity-fast` browser export with:

- `media/MyActivity.json`
- `media/watch-history.json`
- `media/watch-history.html`

It validates the browser checkpoint, parses each format independently, and
matches Music `Watched` observations by video ID plus UTC second while
preserving multiplicity. Second precision is necessary because Takeout HTML
has no fractional seconds. A same-video/day record is never treated as an
exact match; that would erase the repeats under investigation.

Run:

```sh
python browser-export-analysis/main.py
python -m unittest browser-export-analysis/test_main.py
```

The default output directory is `media/browser-export-analysis/`:

- `report.json`: integrity checks, per-source coverage, classifications, and
  aggregate trends.
- `browser-only.jsonl`: every browser-only event and its classification,
  metadata, and neighboring-event gaps.
- `browser-only.tsv`: the same event inventory in spreadsheet-friendly form.

Paths can be overridden with `--myactivity-json`, `--watch-json`,
`--watch-html`, and `--output`. The browser export can be supplied as the
positional argument.

## Result for run `22f844df-877a-4efa-8fe3-882698ee0ba3`

The browser file passes all internal checks: completed run and validation,
seven completed windows, 30,979 declared and actual events, ordered timestamps,
unique activity/event keys, and every timestamp inside the requested range.
Its observed Music range is August 25, 2023 through November 7, 2026. As the
exporter's own documentation notes, this validates enumeration of retained
Google activity, not every physical playback that may ever have occurred.

### Exact coverage

| Source | Music rows | Exact rows in browser | Missing |
|---|---:|---:|---:|
| My Activity JSON | 18,699 | 18,699 | 0 |
| Watch-history HTML | 18,952 | 18,952 | 0 |
| Watch-history JSON | 7,330 | 7,329 | 1 |
| Multiset union of all three | 19,154 | 19,153 | 1 |

The multiset union takes the largest multiplicity for each exact key instead
of adding duplicate copies from overlapping exports.

The sole exact exception is `c0dvabcWVo0`, “Take Me Home, Country Roads
(Original Version),” at `2026-09-22T14:02:42.800Z` in watch-history JSON row
991. The browser data has the same video on that UTC day at
`13:56:17.528083Z` and `13:59:29.764047Z`, but not at the Takeout timestamp.
This is consistent with the already-observed behavior where export routes
select different representative timestamps for a same-video/day episode. It
cannot safely be called the same exact event, so the report leaves it missing.

Thus the browser export fully covers My Activity JSON and HTML, but the literal
claim that it exactly covers every timestamp in all three files is false by
one watch-history JSON row. At video/day level it covers that row too.

### Exactly what the browser adds

After subtracting the 19,153 exact Takeout-union events found in the browser,
11,826 browser events remain. `browser-only.jsonl` and `browser-only.tsv`
enumerate every one with exact microsecond timestamp, video ID, title, channel,
device, duration, progress field, and timeline context.

All 11,826 occur no later than the newest Takeout Music event. Therefore none
is an artifact of the browser run having a later cutoff.

| Classification within the Takeout time span | Events |
|---|---:|
| Same video and UTC day already represented in Takeout | 11,822 |
| Video exists in Takeout, but not on that UTC day | 3 |
| Video is entirely absent from all Takeouts | 1 |

The four non-daily-repeat events are:

| UTC time | Video | Title | Classification |
|---|---|---|---|
| 2024-10-27 22:37:25.509815 | `XDjm770j3o4` | I Bet My Life | known video, new day |
| 2025-01-15 18:50:42.762290 | `Rye3l0l9hi4` | This Summer | new video |
| 2025-05-04 09:15:05.532274 | `4mVo93E9wpU` | Diamonds | known video, new day |
| 2025-06-12 15:03:06.724762 | `EXnbAKfeHW0` | Whisper | known video, new day |

“Diamonds” is followed by another event 38 seconds later and “This Summer” by
one 10 seconds later, fitting the rapid-switch pattern previously found among
Takeout omissions. “I Bet My Life” and “Whisper” have ordinary approximately
song-length neighboring gaps, so rapid switching does not explain all four.

### Why Takeout misses the other 11,822

Daily consolidation of repeated songs is overwhelmingly supported:

- 11,822 / 11,826 browser-only events (99.966%) have that same video/day
  represented in Takeout.
- Browser data has 11,866 rows beyond one row per video/UTC-day. The Takeout
  union has only 45.
- Browser data contains 2,549 video/day groups with multiple events, totaling
  14,415 events. The largest is 88 plays of “Lonely Boy” on October 16, 2025.
- 9,683 / 11,826 browser-only events (81.9%) are adjacent to the same video
  within 30 minutes.
- For 9,687 browser-only events whose immediate next event is the same video
  and has a parseable duration, 8,851 (91.4%) have a gap within 15 seconds of
  that duration. This is strong evidence of full-song repeat runs, not merely
  duplicated database rows or brief skips.
- Only 726 browser-only events (6.1%) are followed by any event within two
  minutes, versus 2,513 / 19,153 exact Takeout-matched events (13.1%). The
  additional set is not primarily enriched for quick skips.

The largest repeated video/day groups include 88 “Lonely Boy” plays, 84
“Caribbean Blue” plays, 80 “Carry You Home” plays, 76 “Renegades” plays, and
75 “Miss Independent” plays. The browser-only tracks with the most additional
events include “Snake Eater” (162), “Caribbean Blue” (160), “Riptide” (153),
“BIRDS OF A FEATHER” (144), and “Florida!!!” (140).

The additional counts are 3,123 in 2024, 5,756 in 2025, and 2,947 in 2026.
Relative to each year's browser total, the additional share is especially high
in 2024 (71.7%), then 31.6% in 2025 and 35.0% in 2026. This variation follows
the concentration of repeat-heavy days rather than an age cutoff.

Web-only observations are more common in the additional cohort (10,732 /
11,826, 90.8%) than the matched cohort (16,129 / 19,153, 84.2%). This is an
association with where the repeat sessions occurred, not evidence that Takeout
uses a device-specific exclusion rule: repeats from iOS are also recovered,
and browser events can list multiple devices.

## Interpretation

The browser endpoint's separate activity IDs and microsecond timestamps expose
repeat runs that the Takeout routes almost always reduce to one representative
video/day row. The event spacing matching track duration makes repeat-one or
manual replay the most direct explanation for nearly all additional events.
The comparison does not reveal whether Takeout performs this consolidation
deliberately, during archive generation, or in a different backing view.

The three known-video/new-day omissions and one wholly absent video show that
daily consolidation is not a complete explanation for every Takeout gap.
Rapid switching plausibly explains two of those four; the files do not carry
enough provenance to explain the other two. Conversely, the one Takeout JSON
timestamp absent from the current browser view shows that neither route should
be treated as a timeless canonical event ledger.
