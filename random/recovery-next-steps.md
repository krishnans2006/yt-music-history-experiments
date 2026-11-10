# Historical replay recovery: next steps

Researched November 10, 2026. This updates the earlier [research](historical-recovery-research.md) using the controlled [website observations](myactivity-website-findings.md). Scope: past YouTube Music playback, including separate repeat-one plays. Future collection is excluded.

**Updated recommendation after the supplied probe run.** Sub-day URL filtering works in the supplied eight-test report, `media/myactivity-time-probes.json`. Narrow queries recover Renegades at 22:24 behind the wider result's 22:28, and reveal Radioactive at 22:08 and 22:17 absent from the supplied exports. See the [full results](myactivity-website-findings.md). Build a small bounded My Activity enumerator next, then scale after validating timestamp precision and progression. Request interception is no longer necessary merely to supply sub-day bounds; raw list/detail responses may still provide exact times and identifiers needed for reliable enumeration. Submit the data-access request in parallel. Data Portability and InnerTube remain secondary investigations. The implementation/test designs below were written before the successful probe run and retain the distinction between accessible activity observations and verified individual plays.

There is no verified complete historical repeat-one export in the sources examined. The critical unresolved question is whether a retained record exists for every loop, rather than whether an API accepts a timestamp-shaped value.

**What the supplied tests establish.** Changing the end date restores earlier Riptide and BIRDS OF A FEATHER timestamps which disappear when later same-video occurrences are included. This demonstrates query-dependent visibility in the supplied website results. The pairs fall on the same UTC day, consistent with latest-eligible-occurrence selection within video/day groups. It does not establish that all videos, all clients, or repeat-one loops follow that rule. The Renegades timestamp disagreement might also reflect an updated activity record rather than two completed plays; retain that distinction until raw records establish otherwise.

Day-bounded scraping can recover some additional records but does not satisfy the requirement to preserve multiple loops within a day. Repeating the same all-time scroll or using a different parser does not resolve that limit.

**Concrete My Activity transport leads.** A firsthand [September 2024 JavaScript example](https://gist.github.com/hushin/133b38e9a8a6050655143cbbe0dae269) constructs My Activity URLs with numeric `min` and `max` parameters using Unix microseconds:

```text
https://myactivity.google.com/myactivity?min=<epoch-microseconds>&max=<epoch-microseconds>
```

That example requests whole days. It establishes a real parameter convention worth testing, not proof that the current frontend/backend honors fractional-day windows or returns separate repeats. Preserve the account and Music filters from the current page instead of hardcoding a product number from an old example.

A 2026 forensic paper in the [Korean Information Security Society Honam conference proceedings, pp. 133–136](https://fliphtml5.com/ypgup/2026CSHONAM/) identifies watch/search history acquisition through:

```text
/_/FootprintsMyactivityUi/data/batchexecute
RPC identifier: y3VFHd
Observed request fields: f.req, at, authuser
```

This is stronger evidence than the older likes/dislikes extraction example: it actually concerns history. However, the paper does not document a verified sub-day timestamp argument layout or a complete per-loop ledger. Treat the identifier as a discovery lead and confirm the current session's read request. The batch endpoint can carry different operations; an endpoint URL alone does not identify a history read.

**Small experiment before implementation.** [myactivity-time-probes.js](myactivity-time-probes.js) generates eight diagnostic links when run in DevTools on an already logged-in My Activity page. It preserves the current URL's filters and account context, does not read cookies, and makes no requests itself. Review/open the generated links separately. Its numeric conversions were independently checked with Python; browser execution and authenticated Google behavior have not been tested here.

For automated collection, paste [myactivity-collect.js](myactivity-collect.js) into that page's DevTools console and click **Collect history tests**. It reuses one popup for the eight windows, captures visible text and watch links before scrolling, records requested/final URLs and collection status, and downloads `myactivity-time-probes.json`. Keep the original tab and popup open until it finishes. **Stop** saves partial results; **Download JSON** can save another copy if automatic downloading is blocked. A settled DOM is not proof of exhausted pagination, and a scroll limit is explicitly recorded. The collector has not been validated against an authenticated Google session; it captures DOM observations, not raw RPC request bodies or verified physical plays.

The windows use UTC to avoid the earlier local-date ambiguity:

| Recording | Two known source timestamps | Broad interval | Earlier-only interval | Later-only interval |
|---|---|---|---|---|
| Renegades, `5JhZdu4O2w0` | Nov 12, 2024 04:24:45 and 04:28:03 UTC | 04:20–04:30 | 04:20–04:26 | 04:26–04:30 |
| Radioactive, `3Yb2-CWjrME` | Dec 7, 2024 04:02:04 and 04:36:40 UTC | 04:00–04:40 | 04:00–04:10 | 04:30–04:40 |

These are November 11 and December 6 evening in Chicago, respectively. Extra control windows exclude both known timestamps. A control may still contain other activity, or previously unknown occurrences; its purpose is to ensure the named known records are excluded.

For example, the proposed earlier Renegades URL bounds are `min=1731385200000000` and `max=1731385559999999`. The helper expresses half-open intervals by subtracting one microsecond from the proposed inclusive maximum. Actual boundary inclusivity and time units must be measured against returned records, not assumed.

For each query, save the actual list request, raw response, and item Details response. Check exact timestamps and any stable record/session identifiers, rather than the minute-rounded UI alone. A successful test should show the known later record in the later interval, exclude it in the earlier interval, and expose the earlier record there. A UI label changing while the response stays unfiltered is not success. Different timestamps can establish separate returned activity observations; proving distinct physical plays requires stronger event semantics or corroboration.

If the URL test fails:

1. Capture the read/list requests for two ordinary date filters in DevTools Network. Diff URL parameters and the decoded `f.req` payload to locate the actual bounds and any relevant grouping or continuation fields.
2. Replay that same read request inside the authenticated browser, changing only a measured boundary to the desired sub-day value. Keep the observed account context and validation fields. Start a new continuation chain for each changed query; do not reuse a cursor from a different range.
3. Repeat the broad/early/late/control comparisons. A userscript could expose time inputs once this works. Request replay alone is enough for the proof; rewriting the whole UI is unnecessary.
4. Inspect observed item Details or group-child requests if they expose data the list omits. Do not invent field positions, an `includeRepeats` flag, or an event-list endpoint.

Frontend date rounding is something direct request replay might bypass. Backend rounding, a fixed daily aggregate, or overwritten events cannot be bypassed merely by adding more timestamp digits. If sub-day filtering works but both early known records remain absent, the method is still not validated as replay recovery; narrower probes around the demonstrated Riptide/BIRDS replacements can distinguish record-specific retention from a general failure.

**Extraction after the successful sub-day experiment.** Save raw responses before parsing and accumulate results across queries. For a video/UTC-day group, request its latest eligible event, then move the upper bound strictly before that event and repeat until the group is empty. Use a server-side video filter only if actually supported and validated. Otherwise, use sub-day windows, fully traverse each window, and recursively split intervals to reveal observations suppressed by wider queries. A time-ordered global newest-event walk is another fallback, but could be expensive and must include all relevant activity. The current DOM capture only supplies minute-rounded times: do not jump before a displayed minute and assume events within that minute have been exhausted. Obtain precise timestamps or investigate finer boundary queries first.

Do not page a broad daily summary and then jump to its oldest returned record: that can skip suppressed earlier repeats belonging to newer days. Retain query bounds, continuations, terminal status and exact timestamp precision. On progress failure, timestamp ties, errors or throttling, record an unresolved interval rather than declaring it exhausted. Distinct event IDs at an identical timestamp must survive. Without IDs, equal video/timestamp rows from overlapping requests are source observations that may be indistinguishable; automatic deduplication cannot prove the physical-play count.

Even exhaustive sub-day queries only recover the events the service retained. If repeat-one generated no separate history events, no interval-splitting strategy recovers those loops. Do not estimate counts by dividing elapsed time by track duration. Music provenance must come from Music-specific labels, URLs or corroborating source records; a song watched on ordinary YouTube is not automatically a Music-app listen.

**Data-access request: pursue in parallel.** Google's [Takeout help](https://support.google.com/accounts/answer/3024190?hl=en) directs users whose desired data is unavailable in the tools to its [data-access request form](https://support.google.com/policies/contact/sar). This gives a supported escalation for retained playback-level records, but no assurance that Google still holds or will supply every loop. Suggested text, ready to adapt to the account's dates:

> I request a machine-readable copy of retained historical YouTube Music playback/listening data associated with my account, from the earliest retained records through November 10, 2026. I need individual repeated plays of the same recording, including consecutive repeat-one playback within the same day, rather than only one latest activity entry per video/day.
>
> Please include any available per-play or playback-session records, exact timestamps and their meaning/precision, video/recording identifiers, event/session identifiers, originating app/device information, and playback start/end or duration records. Please preserve distinct repeated events where retained and identify any consolidation applied before export.
>
> Takeout's My Activity and YouTube & YouTube Music exports disagree. In the live My Activity service, changing the date cutoff also changes which occurrence is visible. Examples: Riptide (`En_6WWOWh8E`) at December 8, 2024 05:23 UTC becomes visible with an earlier cutoff but is replaced by the 09:14 UTC occurrence in a wider view. BIRDS OF A FEATHER (`WKZO-CWeOVA`) similarly changes from December 8, 2024 04:04 UTC to 23:07 UTC. Earlier times are transcribed from minute-precision UI text; exact seconds are unknown.
>
> If the ordinary exports do not include all retained playback-level records, please provide the additional records available through this request. Please clarify whether repeat-one loops are recorded separately, whether only consolidated records remain, and what timestamp or event information is no longer available. I seek records already retained, not newly generated or estimated playback events.

No request has been submitted. These questions ask Google to distinguish inaccessible records from unrecorded, overwritten or deleted events; they do not assume an entitlement to a particular internal log.

**Data Portability: a conditional, timestamp-capable alternate archive.** The [REST reference](https://developers.google.com/data-portability/reference/rest/v1/portabilityArchive/initiate) explicitly documents `startTime` and `endTime` as RFC 3339 timestamps, including fractional seconds. The [time-filter guide](https://developers.google.com/data-portability/user-guide/time-filter) lists the YouTube activity scope as supported. For an eligible account, a first controlled historical request would be:

```json
{
  "resources": ["myactivity.youtube"],
  "startTime": "2024-12-07T04:00:00Z",
  "endTime": "2024-12-07T04:10:00Z"
}
```

Submit to `POST https://dataportability.googleapis.com/v1/portabilityArchive:initiate` with separately obtained OAuth authorization for `https://www.googleapis.com/auth/dataportability.myactivity.youtube`, then poll/download the job. The [export schema](https://developers.google.com/data-portability/schema-reference/my_activity) describes activity summaries and timestamps, not a documented repeat-one event ledger. Timestamp filtering might apply before or after consolidation; the API docs do not settle that. Check whether the earlier Radioactive record survives before making this a main recovery route.

Practical limits: Google's [eligible-country list](https://support.google.com/accounts/answer/14452558?hl=en) currently includes the EU, Switzerland and UK, not the US. Check actual account eligibility; the Chicago timezone alone does not establish it. The time-filter guide describes repeated time-based archive requests at least 24 hours apart. Archive jobs are asynchronous, so this is poorly suited to thousands of per-occurrence probes. It merits a small comparison if eligible, not a production integration before that comparison.

**Why the alternatives rank lower.** General YouTube InnerTube history (`FEhistory`) supports pagination/search in the [YouTube.js implementation](https://github.com/LuanRT/YouTube.js/blob/main/src/parser/youtube/History.ts). It is a useful secondary coverage experiment, but this source does not establish a complete timestamped replay ledger or Music-app provenance. Inspect raw responses rather than assuming wrapper output contains every field. The existing `FEmusic_history`/ytmusicapi export is only 200 distinct recent items with coarse shelf labels in this account. A bigger limit or client switch has not been demonstrated to recover suppressed loops.

The [YouTube Data API revision history](https://developers.google.com/youtube/data/revision_history) documents removal of watch-history playlist access in 2016. Playback telemetry sent to Google is a different interface from retrieving old telemetry; no verified authenticated historical telemetry-download API was found. Recap totals, repeat rankings and library data cannot establish individual timestamps. Another Takeout snapshot can add observations and remains worth preserving, but it does not by itself solve same-day repeats.

Already-existing scrobbles, player databases, browser/app backups or old captures are the independent historical alternatives. They help only to the extent they recorded playback at the time. Navigation records and cached audio are not proof of individual loops. The primary deliverable should distinguish observed activity records, corroborated individual plays, and unresolved gaps rather than call every activity row a completed listen.

**Decision criteria.** The sub-day proof has succeeded for the supplied tests, so bounded My Activity enumeration is now justified. Validate exact time resolution and recovery of the earlier known Radioactive 22:02 observation before scaling; pursue the data-access request concurrently; run a small Data Portability test if eligible; use InnerTube and old local records for supplementary coverage. If some physical plays generated no surviving individual records, complete historical repeat-one recovery remains unachievable from the available evidence. That is a limit to document, not a reason to synthesize events.
