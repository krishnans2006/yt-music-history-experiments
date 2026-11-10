# My Activity website pilot: results

**Decision: worthwhile as a complementary historical recovery source.** The supplied website text contains three Music occurrences absent from both `media/MyActivity.json` and `media/watch-history.html`. It also contains Music occurrences omitted from the My Activity Takeout export that the YouTube HTML export already retained. This establishes incremental value, but does not establish completeness or recovery of every repeat-one play.

The Music entries were manually transcribed from the user's paste into `media/myactivity-website-test/music-sample.tsv`; comparison details are in the adjacent `comparison.json`. Match key: video ID plus local date/minute, using America/Chicago. This timezone aligns the shared records throughout the sample. The paste has minute precision, so no seconds were invented. Ordinary YouTube rows were excluded. All sample dates precede the oldest Music record in `watch-history.json`, so that shorter export cannot cross-check these dates.

| Website local date | Music rows pasted | Found in MyActivity JSON | Found in watch-history HTML | Found in either |
|---|---:|---:|---:|---:|
| 2023-08-25 | 1 | 0 | 1 | 1 |
| 2024-10-12 | 62 | 50 | 62 | 62 |
| 2024-10-13 | 65 | 42 | 65 | 65 |
| 2024-10-14 | 49 | 29 | 49 | 49 |
| 2024-10-15 | 8 | 8 | 8 | 8 |
| 2024-11-12 | 1 | 1 | 1 | 1 |
| 2024-12-07 | 6 | 4 | 4 | 4 |
| 2025-05-04 | 159 | 119 | 156 | 158 |
| **Total** | **351** | **253** | **346** | **348** |

These counts describe the supplied text, not independently verified whole-day website totals. Within the compared local dates, no Music row in either primary export lacked a matching video/local-minute in the supplied website sample. That is encouraging for coverage, but does not imply the same relationship across the entire account history.

**The three additional occurrences.** Titles below were resolved from the same video IDs elsewhere in the exports; the pasted website provides URLs rather than titles.

| Track / video ID | Website local minute | UTC minute | Comparison |
|---|---|---|---|
| Riptide / `En_6WWOWh8E` | 2024-12-07 23:23 CST | 2024-12-08 05:23 UTC | Neither export has this occurrence; both have the same video later that UTC day at 09:14:21 UTC |
| BIRDS OF A FEATHER / `WKZO-CWeOVA` | 2024-12-07 22:04 CST | 2024-12-08 04:04 UTC | Neither export has this occurrence; both have the same video later that UTC day at 23:07:21 UTC |
| Diamonds / `4mVo93E9wpU` | 2025-05-04 04:15 CDT | 2025-05-04 09:15 UTC | Neither export has a Music occurrence of this video that day |

For May 4 specifically, the website contains all 156 HTML records plus three more. Two of the extras are already in MyActivity JSON: `Sunroof` at 04:41 local (`eZCWyFNV_ZM`) and `The Best` at 03:51 (`Wv53ATAPp70`). The third is `Diamonds`, absent from both. Thus the website gains one record over the combined primary exports that day, not three.

For October 12–15, the website's 184 Music rows match HTML's 184; MyActivity JSON contains only 129 of them. The 55 additional website rows confirm that omissions from Takeout's My Activity export do not establish absence from the live My Activity service. August 25 independently establishes this too: the old iOS Music record remains visible online and exists in HTML, while MyActivity JSON omits it.

**Repeated rows need UTC interpretation.** The pasted website contains repeated IDs on the same local day, but the three examples below cross UTC midnight; some are already fully represented in the exports:

- `FiqoZyauhdA` (Florida!!!), October 15 at 18:04 and 21:13 CDT: October 15 23:04 UTC and October 16 02:13 UTC.
- `jg51kFe7CWU` (Somebody That I Used To Know), October 13 at 18:24 and 19:58 CDT: October 13 23:24 UTC and October 14 00:58 UTC.
- `WKZO-CWeOVA` (BIRDS OF A FEATHER), December 7 at 17:57 and 22:04 CST: December 7 23:57 UTC and December 8 04:04 UTC. The earlier one exists in both exports; the later one is newly observed in the website sample.

Same-local-day duplication alone therefore does not disprove UTC-day consolidation or demonstrate repeat-one preservation. The stronger observation is that the website supplies early Riptide and BIRDS occurrences while Takeout supplies later occurrences on those same UTC days. We should retain all these observations rather than assume either timestamp supersedes the other.

The website sample does not include December 8 local time, where those later exported occurrences fall. Whether the live website also shows them, and whether date filtering changes which occurrence is returned, remains untested. Query-dependent selection is a hypothesis to test, not a finding.

**Two original pilot dates were supplied in UTC and need local-date correction.** My earlier directions should have explicitly converted them to local calendar dates:

- Renegades at November 12, 2024 04:24:45 / 04:28:03 UTC is **November 11 at 22:24 / 22:28 CST**. The supplied November 12 page does not test that pair.
- Radioactive at December 7, 2024 04:02:04 / 04:36:40 UTC is **December 6 at 22:02 / 22:36 CST**. The supplied December 7 page does not test that pair.

Thus these particular immediate-repeat and extra-occurrence questions remain open; the absence of those tracks in the pasted next-day pages is not a negative recovery result.

**Practical next investigation.** Capture My Activity's read/list/detail network responses for November 11, December 6, and December 7–8. Compare the same interval as an individual day versus a wider date window. Check whether distinct timestamps and stable event identifiers survive, whether a wider query changes which same-video occurrence is returned, and whether item Details supplies seconds. Archive the raw responses before crawling the rest. The 2023 Details example also shows explicit Music provenance and an iOS device field; that is useful enrichment, but one example cannot establish an iOS-specific omission mechanism.

This pilot justifies a historical scrape. It does not justify discarding Takeout, projecting a recovery rate from this selected sample, or asserting that every historical loop is recoverable. The website may improve timestamp coverage while offering worse title/artist metadata, so HTML remains useful for enrichment.

**Follow-up: corrected replay dates and a wider December sample.**

The user's next paste includes November 10–11 and December 5–8. Music entries were transcribed into `media/myactivity-website-test/music-followup.tsv`, with comparisons in `followup-comparison.json`. The three named Renegades rows omit their links in the paste; their video ID was inferred from the title/artist and matching export recording, rather than independently copied from the website.

All 26 Music rows in the follow-up match HTML at title/ID and local-minute precision. MyActivity JSON differs in two important respects: it has Renegades at November 11 22:24 rather than the website/HTML's 22:28, and an extra Radioactive occurrence at December 6 22:02 absent from both the new website paste and HTML. Therefore the website is not a demonstrated superset of the combined exports. Keep the earlier JSON observations.

| Test | Website follow-up | MyActivity JSON | HTML |
|---|---|---|---|
| Renegades, Nov 11 local | 17:34 and 22:28 | 17:34 and 22:24 | 17:34 and 22:28 |
| Radioactive, Dec 6 local | 22:36 | 22:02 and 22:36 | 22:36 |

The Renegades website observations are hours apart and cross UTC midnight. They do not show both occurrences in the disputed 22:24–22:28 replay interval. Radioactive supplies a direct counterexample to treating this website view as a complete event list: an earlier exported occurrence is not in the supplied view.

The December overlap supplies the most useful new clue:

| Track | Earlier website sample for Dec 7 | New Dec 5–8 sample |
|---|---|---|
| Riptide | Dec 7 23:23 CST (Dec 8 05:23 UTC) | Earlier occurrence not shown; Dec 8 03:14 CST (09:14 UTC) shown |
| BIRDS OF A FEATHER | Dec 7 22:04 CST (Dec 8 04:04 UTC) | Earlier occurrence not shown; Dec 8 17:07 CST (23:07 UTC) shown |

Both replacements are later occurrences of the same video on the same UTC day, and both are the occurrences retained in the large exports. If the first sample used a Dec 7-only date filter and the second widened it through Dec 8, this is strong evidence for query-dependent selection/consolidation: a filtered view can expose an earlier occurrence that a wider query suppresses. Exact filter settings, complete loading and raw responses were not supplied, so selection by date range remains a hypothesis rather than a proven server algorithm. Copying or loading differences and state changes remain alternatives.

Consequently, a single all-time scroll is not a sufficient recovery strategy. The next experiment should compare the same video with identical identity/timezone and controlled nested ranges, saving the actual list/detail responses. First verify that excluding the later Dec 8 event restores the earlier Dec 7 event. If read requests support finer time bounds, test a bound before Renegades 22:28 and before Radioactive 22:36 to see whether 22:24 and 22:02 become visible. No finer-bound parameter or capability has yet been verified. If earlier occurrences reappear, progressively narrower historical queries could be a recovery method; if they do not, the apparent consolidation cannot simply be inverted by scraping.

The recommendation remains to pursue My Activity, but specifically as a query-dependent supplementary source to investigate, not an authoritative full replay ledger. The original three website-only observations remain evidence even though two are not repeated in the later paste. Do not replace the cumulative archive with the newest view.

**Controlled end-date comparison supplied next.**

The user explicitly supplied two queries labelled “Everything before December 7th” and “Everything before December 8th.” Their results include December 7 and December 8 respectively, so the exact inclusive/exclusive request semantics must be taken from the network payload rather than inferred from those labels.

With the earlier cutoff, December 7 contains Riptide at 23:23 and BIRDS OF A FEATHER at 22:04. With the later cutoff, both rows disappear from the displayed December 7 results, while Riptide on December 8 at 03:14 and BIRDS on December 8 at 17:07 are present. The BIRDS occurrence on December 7 at 17:57 remains in both queries.

This establishes end-date-dependent presentation for the supplied paired queries. It is consistent with retaining the latest qualifying occurrence per video per UTC day inside the requested interval: the disappearing and replacing pairs are all on December 8 UTC, while the unchanged BIRDS occurrence is on December 7 UTC. The exact grouping stage and stored-event schema remain unverified; this is not a universal implementation claim.

The practical significance is stronger than finding a different snapshot: earlier timestamps are still retrievable by changing the cutoff. A scrape should accumulate records from overlapping end-bounded queries. Daily local cutoffs demonstrably help, but do not establish complete replay recovery: repeated plays inside one local/UTC-day segment may still be consolidated. The highest-value next technical test is whether the observed read request accepts a sub-day upper bound and, if so, whether cutting off before Renegades 22:28 or Radioactive 22:36 exposes the earlier known occurrence. Treat time resolution and exclusive/inclusive boundary handling as measured properties, and avoid creating new timestamps by inference.

**Sub-day URL experiment succeeded, November 10, 2026.** The user ran the browser collector and supplied `media/myactivity-time-probes.json`. All eight probes finished with one stable snapshot each. Requested and final URLs match, including the exact numeric bounds. Seven pages show the explicit end-of-results marker; the remaining page explicitly says "No results." The results demonstrate effective sub-day filtering, rather than merely changed filter labels. The evidence establishes behavior at minute-scale boundaries, not yet second/microsecond precision.

| Recording / Chicago date | Requested interval, UTC | Displayed local result |
|---|---|---|
| Renegades / Nov 11, 2024 | Nov 12 04:20–04:30 | 22:28 |
| Renegades / Nov 11, 2024 | Nov 12 04:20–04:26 | **22:24** |
| Renegades / Nov 11, 2024 | Nov 12 04:26–04:30 | 22:28 |
| Renegades / Nov 11, 2024 | Nov 12 04:26–04:27 | **No results** |
| Radioactive / Dec 6, 2024 | Dec 7 04:00–04:40 | 22:36 |
| Radioactive / Dec 6, 2024 | Dec 7 04:00–04:10 | **22:08** |
| Radioactive / Dec 6, 2024 | Dec 7 04:30–04:40 | 22:36 |
| Radioactive / Dec 6, 2024 | Dec 7 04:10–04:20 | **22:17** |

For Renegades (`5JhZdu4O2w0`), the narrower upper bound restores the 22:24 occurrence from MyActivity JSON, while the wider result retains 22:28 from HTML. Both source observations remain retrievable from the live service. The negative control returns no results, supporting actual time filtering. This resolves the previous concern that the earlier timestamp might simply have been overwritten and become unretrievable, though it does not establish whether the observations represent completed plays.

For Radioactive (`3Yb2-CWjrME`), 22:08 and 22:17 are **absent from both primary exports** at video/local-minute precision. They are also absent from the shorter watch-history JSON, whose coverage starts later. The nominal control only excluded the two previously known timestamps, 22:02 and 22:36; its 22:17 result is additional in-range activity, not evidence of a failed filter. The early window returns 22:08 instead of the previously expected 22:02, consistent with hiding the earlier occurrence behind a later one inside that window. Testing 22:00–22:04 is a useful next bounded check for the 22:02 observation, but it has not yet been run.

Combining the supplied probes with the source exports now gives at least four distinct Radioactive activity observations in the 22:00–22:40 local interval: 22:02 (JSON), 22:08 (website), 22:17 (website), and 22:36 (JSON/HTML/website). The web-only observations have minute precision; do not assign them invented seconds. The 22:17 card contains two watch anchors for the same video (title and duration), but is **one activity card**, not two listens. Its `3:07` duration is track metadata, not a measured playback duration.

The five distinct Music video/minute observations from the eight probes, their query provenance, and their source-export matches are saved in `media/myactivity-time-probes-analysis.json`. Two of those five observations are additions to all three supplied exports. Neither those five observations nor the four-source-observation Radioactive union is a verified completed-play count.

This elevates My Activity from a speculative supplementary route to the primary technical recovery route to implement. Arbitrary time selection already works through URL parameters for these tests, so request interception is not required merely to supply sub-day bounds. The next phase should automatically enumerate a small known repeat interval using progressively earlier bounds, obtain exact timestamps/event identifiers from Details or underlying responses where available, then scale up with checkpointing and explicit unresolved gaps. Do not advance by a whole minute when only the UI minute is known: that could skip additional events within that minute. Complete repeat-one coverage still requires checking what individual playback events were retained; these pages alone cannot establish loop mode or completed playback.
