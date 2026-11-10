# Findings from the YouTube Music exports

This analysis compares `media/MyActivity.json` with `media/watch-history.html`, with `media/watch-history.json` as an independent cross-check. Reproduce the measurements with `python random/patterns.py`; detailed metrics and the immediately preceding/following Music entries for every discrepancy are saved in the gitignored `random/patterns-report.json`. `random/similarity-report.json` has the full initial comparison.

**The main finding:** HTML has better coverage and much better metadata, but neither primary export contains everything found in the other. More importantly, these files behave largely like one record per video per UTC day. They cannot be assumed to contain every physical play, particularly when repeat-one is involved. Differences include changed representative timestamps, genuine one-sided song-day records, early/first-observed listens, and some sessions with rapid track changes. No single rule explains all omissions.

**What was compared and checked.** Only `header == "YouTube Music"` / the equivalent HTML card heading, with a `Watched` action, counts. `products == ["YouTube"]` does not identify the app. Records are matched by video ID and UTC second, dropping JSON's fractional seconds. HTML explicitly says CST throughout, so it is converted with a fixed UTC-06:00 offset, including summer dates. Applying Chicago daylight-saving rules instead would introduce false discrepancies. Title/artist comparisons normalize whitespace and decode HTML entities. An independent extraction from the original HTML confirmed all 18,952 Music video/timestamp keys. Neither source has duplicate video-plus-second keys or Music entries missing video IDs.

| Measurement | MyActivity JSON | Watch-history HTML |
|---|---:|---:|
| Music records | 18,699 | 18,952 |
| Unique video IDs | 2,651 | 2,710 |
| Exact matches shared by both | 18,503 | 18,503 |
| Records present only here | 196 | 449 |
| Video IDs entirely absent from the other export | 16 | 75 |
| Titles represented only by URLs | 4,312 | 2 |
| Missing artist/channel name | 4,312 | 2 |

The combined exact-key union is 19,148 records, with 645 unmatched records. That is a count of observed timestamp records, not a verified count of distinct physical listens. Some pairs may describe different plays; others may be different summaries of the same repeat episode.

**1. Daily collapsing and repeat-one are real concerns.**

HTML has **zero** instances of the same video appearing twice on the same UTC day. JSON has only **five**, each with two timestamps. The older `watch-history.json` also has no same-video/UTC-day duplicates. This pattern spans thousands of records and is much stronger for UTC days than CST days: HTML has 547 duplicate video/day groups if grouped by CST calendar day instead. Thus the apparent daily boundary is UTC, regardless of the HTML display timezone.

In 34 video/day groups, the two primary exports contain the same video on the same UTC day, but at different times. JSON has the later timestamp in 24 cases; HTML has the later timestamp in 10. There is no consistent first-versus-last rule across both sources. Their time differences range from 153 seconds to 20 hours 47 minutes 42 seconds, with a median of 70 minutes 1 second.

Five further JSON-only records are extra occurrences on days already represented in HTML, where both sources also share a later timestamp:

| Track | Earlier JSON-only UTC timestamp | Later timestamp in both |
|---|---|---|
| Radioactive | 2024-12-07 04:02:04 | 2024-12-07 04:36:40 |
| Blinded By The Light | 2025-03-16 01:59:50 | 2025-03-16 22:49:24 |
| I Love You, I'm Sorry | 2025-03-20 07:00:25 | 2025-03-20 23:57:22 |
| Trust Me | 2025-08-10 03:21:57 | 2025-08-10 05:56:50 |
| God Story | 2026-03-16 12:18:58 | 2026-03-16 15:39:17 |

These observations are consistent with daily consolidation or selection of a representative watch timestamp. They do not prove Google's implementation, or identify how many plays were collapsed. A user replaying a song all afternoon could still have a single row. Neither file provides a repeat-one flag or a reliable repeated-play count.

To look specifically for immediate replays, define a repeat episode as adjacent occurrences of the same video in the combined Music timeline, no more than 30 minutes apart. There are just 22 such episodes, each containing two records. Fourteen contain a JSON-only timestamp followed by an HTML-only timestamp, or vice versa. Examples:

| Track | JSON UTC time | HTML UTC time | Separation |
|---|---|---|---:|
| Renegades, 2024-11-12 | 04:24:45 | 04:28:03 | 198 seconds |
| Love Somebody, 2024-12-09 | 22:27:05 | 22:23:38 | 207 seconds |
| Here With Me, 2025-09-06 | 06:41:14 | 06:43:52 | 158 seconds |
| Apple, 2026-10-17 | 03:31:58 | 03:34:31 | 153 seconds |

These are plausible replay episodes with different retained timestamps. They might also reflect a watch event being updated; the files do not distinguish the explanations. Fourteen pairs account for 28 of the 645 unmatched timestamp records, not most discrepancies.

Matching by video plus UTC day, rather than exact timestamp, changes the interpretation:

| Comparison at video/day level | Count |
|---|---:|
| Shared video/days | 18,537 |
| Video/days only in JSON | 157 |
| Video/days only in HTML | 415 |
| Shared days with different timestamps | 34 |
| Extra JSON timestamps on an already-shared day | 5 |

The original unmatched counts therefore break down exactly as `196 = 157 + 34 + 5` and `449 = 415 + 34`. The 157 and 415 one-sided song-days cannot be explained just by retaining a different timestamp for that song on that same day.

**2. JSON particularly misses first-observed occurrences of a video.**

For each video, identify the earliest occurrence in the combined primary data. This means first *observed in these files*, not necessarily your first-ever listen.

| Record group | First-observed occurrences | Proportion |
|---|---:|---:|
| Matched in both | 2,445 / 18,503 | 13.2% |
| Only in JSON, missing from HTML | 25 / 196 | 12.8% |
| Only in HTML, missing from JSON | 256 / 449 | 57.0% |

This is a substantial asymmetry. It persists after excluding the early-history period: among records dated 2025 onward, 166/342 HTML-only records are the first observed occurrence (48.5%), versus 1,973/17,379 matched records (11.4%). In 2026 alone, the corresponding figures are 44/93 (47.3%) and 902/5,352 (16.9%). Therefore the finding is not just an artifact of the October 2024 cluster.

Of the 449 records missing from JSON, 75 are the only observed occurrence of their video anywhere in the two files. Another 181 are the earliest occurrence of videos that appear again later. The other 193 are not first-observed occurrences. This is an association with first-observed listens, not proof of a deliberate first-play filter: thousands of first-observed listens are retained, and plenty of omissions are later listens.

HTML's omissions have approximately the normal first-observed proportion. Its 196 missing records include 16 videos absent entirely from HTML; the other 180 are occurrences of videos HTML contains at other times. JSON's 449 missing records similarly include 374 occurrences of videos it contains elsewhere. Most discrepancies are about an occurrence, not a completely missing song.

**3. JSON misses more early history, but this is not a simple age cutoff.**

HTML's earliest Music record is a Bastille video on 2023-08-25; JSON starts on 2023-12-25. However, exactly **one** HTML-only record predates JSON's Music coverage. That cannot explain the other 448 omissions. Both have the same newest Music record: 2026-11-07 11:17:38 UTC.

| Year | Combined observed records | Missing from JSON | Missing from HTML |
|---|---:|---:|---:|
| 2023 | 4 | 1 | 0 |
| 2024 | 1,235 | 106 (8.58%) | 8 (0.65%) |
| 2025 | 12,433 | 249 (2.00%) | 157 (1.26%) |
| 2026 | 5,476 | 93 (1.70%) | 31 (0.57%) |

Rates use the combined observed exact-key records as the denominator, not unknown actual plays. There are only four 2023 records, so that year is too small for a meaningful rate.

October 2024 is especially uneven: 78 HTML-only records versus one JSON-only record, with 390 shared records. JSON misses 16.6% of that month's combined records. Nevertheless, JSON retains records from December 2023 through April 2024, and omissions continue in recent months. This does not resemble a clean retention threshold. HTML misses most records in 2025 in absolute terms partly because that year has by far the most activity; its missing rate is also higher that year.

The large empty periods in both files cannot be diagnosed from these exports. They might reflect no Music activity or history that is unavailable in both sources. Agreement on absence does not establish completeness.

**4. Rapid track changes are overrepresented among JSON's omissions.**

Use the gap to the next Music record in the combined timeline as a rough proxy for track switching. This is not measured listening duration: playback can pause, overlap across devices, or be logged differently.

| Group | Next Music record within 60 seconds | Within 120 seconds |
|---|---:|---:|
| Matched | 1,531 / 18,503 (8.3%) | 1,898 / 18,503 (10.3%) |
| Missing from HTML | 12 / 196 (6.1%) | 14 / 196 (7.1%) |
| Missing from JSON | 73 / 449 (16.3%) | 128 / 449 (28.5%) |

May 4, 2025 UTC is the strongest example. There are 117 shared records, 39 HTML-only records, and two JSON-only records. Of those 39 HTML-only records, 36 are followed by another logged track within two minutes. Around 08:05 UTC, HTML records `golden hour`, `Happier`, `Out of Touch`, and `Superstition`, all absent from JSON, interleaved with songs the two sources agree on. The next-record gaps are 18, 17, 94, and 67 seconds.

This supports a skip-heavy/session-dependent omission pattern, but not a universal minimum-duration rule: both exports retain many rapid track changes. Excluding May 4 entirely still leaves 92/410 HTML-only records with a next gap of two minutes or less (22.4%), versus 1,787/18,386 matched records (9.7%). So one unusual day does not explain all enrichment. Conversely, most JSON-only records missing from HTML have ordinary two-to-five-minute gaps, much like the matched baseline.

Other clusters include October 13–15, 2024 (20, 21, and 10 HTML-only records), and August 27, 2025 (18). They mix rapid switches and normal song-length spacing. The omissions are not all short interactions.

Using a 30-minute gap to define an approximate Music session, 34 sessions are entirely absent from JSON, containing 37 records; six one-record sessions are entirely absent from HTML. The remaining unmatched records occur inside sessions with other represented entries. This does not look like losing only whole listening days or one entire device/session stream.

**5. Metadata loss is a separate, much larger JSON problem.**

MyActivity JSON has 4,312 rows (23.1%) whose title is just a watch URL and which have no artist/channel name. HTML has two. Among exact matches, HTML supplies a real title and artist for 4,270 JSON URL-only rows. Two other exact matches retain the same title but have different artist/channel labels: `Pressure` changes between `Fugitive - Topic` and `Release - Topic`; `Best To Let Go` changes between `Release - Topic` and `KAJ - Topic`.

Metadata holes are not restricted to permanently unavailable videos. For 780 video IDs, some JSON occurrences have artist/title metadata and others do not. Another 477 IDs always lack metadata in JSON; 1,394 always have it. The missing metadata spans the time range. It is consistent with metadata enrichment/resolution behaving differently across records or export paths, but these files do not expose the cause. A bare URL is not evidence that the whole listen is missing, or that the video was deleted.

There is no obvious relation between JSON metadata holes and records missing from HTML: 40/4,312 URL-only JSON records are absent from HTML (0.93%), versus 156/14,387 records with artist metadata (1.08%). Also, 430/449 HTML-only rows are Topic-channel uploads (95.8%), almost identical to the matched baseline (95.9%). The missing records are not confined to official music videos, non-Topic uploads, or a visibly separate artist/channel class.

**6. The third JSON export corroborates both sides and rules out JSON encoding itself as the problem.**

`media/watch-history.json` has 7,330 Music entries, from 2025-09-14 through 2026-10-20. It has complete title/artist metadata for every Music record. Thus the severe metadata loss in MyActivity JSON is not an inherent limitation of JSON as a format.

Within that third export's date range:

- 135 of 141 HTML-only primary records also appear exactly in the third JSON export.
- 31 of 41 MyActivity-only primary records also appear exactly in the third export.
- 7,158 of 7,212 primary records shared by both also appear exactly in the third export.

The third file additionally contains six timestamps absent from both primary exports. In all six cases, the video/day already exists in the primary data at a different timestamp. This independently supports the observation that exports can retain different times for the same song/day. It does not establish which time is the canonical one.

**What can and cannot explain the missing records.**

- **Supported:** alternate timestamps for repeated same-video/day activity explain 34 pairs, with five further extra JSON occurrences. JSON disproportionately lacks first-observed entries, early-history records, and rapid-song-change records. HTML's smaller omissions have a more ordinary timing/first-observed profile.
- **Ruled out as a complete explanation:** subsecond precision (already normalized; no unmatched same-video records are within 60 seconds of an opposite-source occurrence), wrong UTC/CST conversion, exact duplicate rows, lack of Music video IDs, an old-history cutoff, or a title/artist matching failure. Matching uses video IDs, not names.
- **Not supported by the source comparison:** Music entries merely being relabeled YouTube. No unmatched Music timestamp has a same-video/second match under another service's heading in the opposite export. This test does not exclude a label change combined with a changed timestamp.
- **Possible but unproven:** differing export snapshots, product selection/export paths, backend consolidation, indexing or metadata-resolution inconsistencies, changes or deletion between exports, offline synchronization, or device-specific logging. The records do not carry playback duration, queue mode, repeat-one settings, a stable per-play event ID, or device identity that would let us attribute the gaps to those mechanisms.

The files demonstrably cover different activity endpoints: all watched activity in MyActivity JSON reaches November 10, while HTML reaches November 7, although their newest Music event is identical. The user subsequently confirmed that MyActivity JSON came from Takeout's My Activity product, while both watch-history files came from Takeout's YouTube & YouTube Music product, with JSON generated first. These are distinct export routes and snapshots, so this is not a controlled experiment comparing only serialization format. See historical-recovery-research.md for the recovery investigation. Google also documents that Takeout may omit changes made between requesting and creating an archive, and that data being deleted is not included: [Google Takeout help](https://support.google.com/accounts/answer/3024190?hl=en). That makes snapshot effects plausible, not a demonstrated cause of these particular omissions. Google documents that activity while history is paused is not recorded: [YouTube history help](https://support.google.com/youtube/answer/95725?hl=en). Pausing alone would not explain why a specific existing record is in one export and absent from another without an additional snapshot/export difference.

**Practical implication for building the history.** Preserve both sources and their provenance. Use HTML to enrich URL-only JSON entries, retaining conflicting metadata rather than silently overwriting it. Use exact video/UTC-second matching for a conservative observed-record union, while flagging same-video/day alternatives and the 14 close consecutive replay pairs. Keep a separate video/day view for comparisons. Do not silently merge every same-day occurrence: that would discard five extra JSON rows and could erase genuine replays. Do not treat the 19,148-record union as a complete or exact physical play count. Recovering repeat-one play counts would require a source that records individual plays, or a controlled future playback experiment; these files cannot supply the missing count.
