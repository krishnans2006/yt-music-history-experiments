# Recovering past YouTube Music listens

Research date: November 10, 2026. Scope: past listening only. This is a recovery investigation, not a proposal to log future playback. Public documentation and source code were researched; no authenticated Google account was queried, and no claim below implies that an undocumented endpoint was tested against this account.

**Recommendation:** preserve and reconcile every existing export, then test My Activity's live, date-filtered item/detail responses against known discrepancies. If those responses contain additional timestamps, scrape them with browser-assisted authentication and checkpointed date partitions. Try Google's official data-access request for retained per-play records absent from ordinary exports. The Data Portability API is an additional official archive route if the account is geographically eligible. YouTube's InnerTube history is a secondary discovery/metadata source, not a demonstrated recovery route for a complete historical scrobble log.

**The unresolved limit:** no documented method found guarantees recovery of every past repeat-one play. Existing data strongly suggests consolidation. A hidden endpoint can expose additional retained records, but cannot recreate records that are no longer available. Aggregate play counts are not timestamped listen events.

**Correct export provenance.**

The user confirmed:

- `media/MyActivity.json`: Takeout's **My Activity** product.
- `media/watch-history.json`: Takeout's **YouTube & YouTube Music** product, JSON format, generated first.
- `media/watch-history.html`: the same YouTube product, HTML format, generated later.
- `ytmusicapi/youtube_music_history.json`: an authenticated ytmusicapi history result.

These are distinct export routes and snapshots. The short JSON export starts much later despite being generated first; an earlier export date alone does not explain missing older listens. Conversely, two requests with different dates and formats do not isolate format as the cause. We should compare both products and both formats near the same request time, preserve request details, and test completeness empirically.

Local inspection confirmed the ytmusicapi file contains exactly **200 entries and 200 distinct video IDs**. It has relative `played` labels (`Last week` and `October 2026`), not exact per-play timestamps. The two large primary exports share 18,503 video/UTC-second records, with 196 only in MyActivity and 449 only in HTML. HTML has no duplicate video/UTC-day groups; MyActivity has only five. Another 34 groups have the same video/day but different timestamps between sources. These are account-specific observations, not documentation of a universal Google retention algorithm.

**What the methods can recover.**

| Method | Value for past recovery | Repeat-one evidence | Priority |
|---|---|---|---|
| Union of all existing Takeout files | Already proves neither primary export is complete relative to the other | Preserves existing distinct timestamps; cannot invent absent ones | Immediate |
| Fresh Takeout matrix: both products, both formats | May expose format/path/snapshot differences and improve metadata | No guarantee of separate repetitions | High, as a controlled comparison |
| My Activity item/detail scraping | Best candidate for older records visible online but omitted from exports | Must inspect item/details and underlying responses | Highest new technical investigation |
| My Activity read RPC capture/replay | More structured and checkpointable extraction of the live activity surface | Only if the response actually contains distinct events | High after a small browser pilot |
| Data Portability API, `myactivity.youtube` | Official dated archive requests, including old time windows | Published activity schema does not promise replay events | Conditional on regional eligibility |
| YouTube InnerTube `FEhistory` + continuation | Another account history view, potentially beyond Music's recent list | Often presentation-oriented; precision and consolidation must be measured | Secondary |
| YouTube Music `FEmusic_history` | Recent discovery/metadata; your result is 200 unique tracks | No exact timestamps in the existing output | Low for historical backfill |
| Google data-access request | Ask for retained records unavailable through normal tools | Can explicitly request repeated playback/session records | Worth doing in parallel |
| Already-existing scrobbles/client databases/backups | Potential independent event-level evidence | Depends on what was recorded at the time | High if such records already exist |
| Browser history, downloads, likes, Recap | Corroboration, discovery, or aggregate constraints | Usually cannot establish individual repeat events | Supporting evidence only |

**1. Takeout: retain all snapshots and compare export paths deliberately.**

The observed cutoff issue is not unique to these files. A user reported Takeout JSON stopping at April 2022, HTML reaching January 2022, and older history remaining visible in My Activity. This is a firsthand symptom report, not an official explanation or universal limit: [Google Account Community report](https://support.google.com/accounts/thread/191410174/google-takeout-youtube-music-history-data-export-is-incomplete?hl=en).

For a controlled retry, request a narrow history-only export from YouTube & YouTube Music, in each format, and a corresponding My Activity export. Save the full ZIPs and archive manifests, including every part. Record product selection, request time, completion time, account/channel identity, locale and timezone. Compare actual oldest/newest timestamps, per-month counts, and exact video/timestamp keys. Do not just compare file size or accept a tool's claim of “full history.”

Takeout itself does not currently offer arbitrary date-window export through its normal UI. Google documents that changes during archive preparation may be omitted and that archives may be split across files. These are reasons to preserve and audit results, not explanations established for this account: [Takeout help](https://support.google.com/accounts/answer/3024190?hl=en).

Use [google_takeout_parser](https://github.com/purarue/google_takeout_parser) as a parsing reference or independent parser: it recognizes both My Activity and YouTube history, including HTML and JSON. It is not an additional data source and cannot repair absent records. Tools that simply import Takeout and count rows inherit the export's limits.

**2. My Activity: the best next source to test.**

Start at [My Activity's YouTube page](https://myactivity.google.com/product/youtube). Verify the account and select the Music-specific filter when available. Keep regular YouTube activity separate rather than classifying every music-category video as a Music-app listen.

Google documents activity search/filtering and item Details, which include date/time and may include app/device information. Extra verification can be required. This is a supported user interface even though its extraction interface is undocumented: [Google's My Activity help](https://support.google.com/accounts/answer/7028918?hl=en).

The first experiment should be small and diagnostic:

1. Inspect August 25, 2023 and October 12–15, 2024, where exports have known coverage differences.
2. Inspect May 4, 2025, where HTML has 39 records absent from MyActivity JSON.
3. Inspect November 12, 2024 for `Renegades`: JSON has 04:24:45 UTC and HTML 04:28:03 UTC for the same video. Inspect both the item and Details.
4. Inspect December 7, 2024 for `Radioactive`: JSON has an extra 04:02:04 UTC record before the shared 04:36:40 record.
5. Examine any grouped/bundled items and their child/detail responses if present. A list summary is not sufficient to decide whether only one underlying event exists.

For each case record whether the live source exposes neither timestamp, one, both, an explicit repeat count, or more occurrences. Capture the raw response and the visible details together. Do not infer multiple events merely from an opaque array containing multiple numbers.

This pilot distinguishes export omissions from UI omissions and possible consolidation before investing in a full scraper. A page with the same daily summary adds no event resolution, even if it reaches further back.

**3. Browser automation versus the hidden My Activity RPC.**

There is firsthand precedent for My Activity extraction using scrolling and its `batchexecute` responses. The specific published example concerns likes/dislikes, not a current Music watch-event API: [original technical discussion](https://stackoverflow.com/questions/74935428/youtube-api-retrieve-more-than-5k-items). It establishes a technique, not an already-verified Music schema.

A browser-assisted extractor should:

- Use a logged-in local browser profile, with interactive verification if required.
- Observe Fetch/XHR traffic while scrolling, changing date filters and opening Details.
- Identify the actual read/list/detail requests from that session. Google's batch transport commonly has fields such as `rpcids` and `f.req`; capture the live payload rather than copying an unrelated RPC identifier.
- Save complete response bodies and query/continuation provenance before parsing. If the response is XSSI-prefixed or length-framed, decode that framing explicitly rather than assuming it is ordinary top-level JSON.
- Follow returned continuation tokens until the actual terminal state, distinguishing empty results, auth failures, throttling and parser failures.
- Partition by month, subdividing dense windows into days, with checkpointing and deliberate overlap at boundaries.
- Capture events as they load. Virtualized pages may remove old DOM nodes; saving the final DOM after a long scroll can lose earlier rows.

These are proposed implementation requirements, not claims about a verified current account-specific protocol. An RPC name/version, argument positions, time units, timezone, and termination behavior must be established from live read requests. Batch requests are not inherently read-only; list/detail calls must be distinguished from deletion calls. No mutation of history is needed for recovery.

Prefer response capture through the browser first. Direct cookie-authenticated replay can follow once equivalence has been demonstrated. It may be more efficient than DOM scraping, but it still exposes only what that service returns. There is no evidence that increasing a page-size parameter or inventing an “include repeats” flag unlocks an underlying event ledger.

A successful scrape should include a completeness manifest: requested date intervals, completed intervals, oldest/newest returned events, page counts, errors, source timezone, and any account/channel identity. An interruption should leave a resumable gap, not an apparently complete file.

**4. InnerTube: distinguish the recent Music feed from general YouTube history.**

[ytmusicapi's implementation](https://github.com/sigma67/ytmusicapi/blob/main/ytmusicapi/mixins/library.py) calls `browse` with `browseId: FEmusic_history`; `get_history()` has no limit argument or continuation traversal. Its `played` value comes from a shelf heading. This matches the coarse labels in the existing local export. That implementation does not establish whether every client or server variation shares a fixed 200-item cap, but adding a large `limit` argument is not a supported solution.

The general YouTube history feed is a different candidate:

```text
POST https://www.youtube.com/youtubei/v1/browse
browseId: FEhistory
then follow returned continuation requests
```

YouTube.js has a [History class with getContinuation() and search()](https://github.com/LuanRT/YouTube.js/blob/main/src/parser/youtube/History.ts). Its [authentication documentation](https://ytjs.dev/guide/authentication) currently recommends cookies for web clients and describes OAuth support as limited to the TV client. A developer-facing tool, [yt_history](https://github.com/SamuelGadiel/yt_history), implements a `FEhistory` continuation loop, but its documented watched-time fields can be day labels rather than exact timestamps. None of these sources promises a complete per-play ledger.

Use this route to find additional historical IDs, compare coverage, and inspect original response fields. Preserve raw responses: a wrapper may discard useful fields. Do not turn `Today`, `Yesterday`, or a shelf date into an invented exact listen time. Do not classify entries as Music-app listens just because their videos are music: require app provenance or corroboration from an explicitly Music-labelled source.

Changing clients (`WEB`, `WEB_REMIX`, Android or TV) is an exploratory comparison, not a proven bypass. [Kaset's API-discovery notes](https://github.com/sozercan/kaset/blob/main/docs/api-discovery.md) are useful for endpoint experiments; its Recap browse target `FEmusic_listening_review` is explicitly described as unverified for usable Recap data in the cited probe. That is not evidence of a hidden complete replay-history endpoint.

**5. Data Portability API: an official alternate archive route.**

Google explicitly documents a YouTube activity resource:

```text
OAuth scope:
https://www.googleapis.com/auth/dataportability.myactivity.youtube

Archive resource:
myactivity.youtube
```

The workflow starts an archive job, polls its state, then downloads the archive from signed URLs: [API introduction](https://developers.google.com/data-portability/user-guide/introduction). The [My Activity schema](https://developers.google.com/data-portability/schema-reference/my_activity) describes timestamped activity records with fields analogous to the existing MyActivity export. It does not document a per-loop event ID, repeat count, or completed-listen duration.

Unlike the ordinary Takeout UI, this API [supports time filters for YouTube activity](https://developers.google.com/data-portability/user-guide/time-filter). An authenticated example shape for an old window is:

```http
POST https://dataportability.googleapis.com/v1/portabilityArchive:initiate
Authorization: Bearer <authorized token>
Content-Type: application/json

{
  "resources": ["myactivity.youtube"],
  "startTime": "2023-01-01T00:00:00Z",
  "endTime": "2023-12-31T23:59:59Z"
}
```

That makes it a useful controlled test of old time windows if eligible. Do not assume it uses a richer underlying event log than Takeout; that needs comparison. Use the activity scope rather than assuming music-library or uploaded-video scopes contain listener history.

Availability is a major practical constraint. Google's current [eligible-country list](https://support.google.com/accounts/answer/14452558?hl=En) lists EU member countries, Switzerland and the UK, but not the US. Account eligibility must be checked, not inferred solely from the browser timezone or bypassed by changing an IP address. Development/test authorization is distinct from production approval; the [time-based guide](https://developers.google.com/data-portability/user-guide/time-based) documents seven-day access for apps in Testing. This route is not automatically worth building for an ineligible personal account.

**6. An explicit Google data-access request is worth trying.**

Google's own [Takeout help](https://support.google.com/accounts/answer/3024190?hl=en_Ucript) directs users to a [data-access request](https://support.google.com/policies/contact/sar) when the desired information is unavailable through its tools. It asks for the data categories, products and approximate dates. This is a supported escalation, not proof that additional raw logs will be disclosed.

A precise request would say:

> I am seeking retained historical playback/listening records for my YouTube Music activity over [date range], including separate repeated plays of the same recording, including repeat-one playback. Takeout's My Activity export and YouTube & YouTube Music exports differ in historical coverage and sometimes retain different timestamps for the same video/day. Please provide any retained per-play timestamps, playback/session identifiers, app/source identity, and playback-duration or start/end records that are available beyond the consolidated activity history. If only consolidated records are retained or exportable, please identify the available record granularity.

Attach a small discrepancy table, not account cookies. Ask about records still retained, rather than assuming Google can recover deleted events. This cannot be promised as a way to obtain all telemetry or every repeat, and it is not a legal determination of entitlement.

**7. Existing independent records may be the only source of missing repeated plays.**

Only material that already existed during the listening period can help here:

- Old Takeout ZIPs, backups, cloud copies and exports from every account/channel actually used. Keep older snapshots even when a newer file is larger.
- Existing Last.fm, ListenBrainz, Maloja or Koito histories, if any scrobbler was active at the time. Preserve actual timestamps and the originating app. They may contain repeats absent from Google's consolidated history, but may also omit short plays or mishandle loops. [ListenBrainz documents a full-history export API](https://listenbrainz.readthedocs.io/en/latest/users/api/core.html).
- Databases or backups of third-party players previously used. As a concrete example, [ytm-player distinguishes its locally recorded SQLite history from account history obtained through ytmusicapi](https://ytm-player.com/changelog/). A database created by importing Takeout is not independent evidence; one recorded from playback may be.
- Old browser visit databases and backups, saved network/HAR captures, app diagnostic logs, or local extension storage, if they survive. Browser navigation supports a timestamped visit, not proof of playback or of repeated loops without navigation.
- Official mobile app private databases and caches are speculative forensic leads, not a verified full-history store. A downloaded audio file proves availability, not when or how often it played. A file named `history.db` may contain search suggestions rather than watch history; a [firsthand Android examination](https://freeandroidforensics.blogspot.com/2015/01/) illustrates that trap. Do not invent a current YouTube Music database schema or assume rooting a phone will recover years of plays.
- Ambient-recognition histories such as Pixel Now Playing, if previously enabled, can corroborate a song heard nearby but do not establish playback in YouTube Music. They should not be counted as Music listens without separate evidence. A [forensic study of an older Pixel implementation](https://dfir.pubpub.org/pub/xbvsrjt5/release/1) demonstrates that a recognition-history database can exist; it is not documentation of a current Music play ledger.

Preserve source copies before experimenting with cache cleanup, reinstalling apps, or altering old devices. For a recovery job, originals and timestamps are the evidence.

**8. Tempting routes that do not establish past event recovery.**

- **YouTube Data API v3 / the `HL` playlist:** Google's [revision history](https://developers.google.com/youtube/data/revision_history) documents that watch-history playlist retrieval returns empty lists after September 12, 2016. More quota or different `playlistItems.list` pagination does not fix this.
- **`activities.list`:** it is not a replacement viewer watch-event ledger. Metadata lookup and history retrieval are different tasks.
- **Playback telemetry endpoints:** a [firsthand examination](https://github.com/Xosrov/YouTube-Playback-Metrics) documents outbound watch-time metrics, including playback identifiers and time ranges. These are evidence of reporting, not a user-readable historical telemetry archive. No verified endpoint was found that downloads old telemetry for this account. Sending new pings or `add_history_item()` would mutate history, not recover it.
- **Recap and “On repeat”:** [Google describes these as stats derived across YouTube services](https://support.google.com/youtubemusic/answer/13407991?hl=en). Rankings, minutes or totals can constrain an estimate, but cannot establish the individual missing timestamps or Music-app provenance. A scraped aggregate API remains aggregate data.
- **Current history polling:** repeatedly downloading a present-day recent list cannot reconstruct events already absent from that list. It adds no independent past evidence.
- **Scrobble converters and stats sites:** a script converting Takeout to a different format changes representation, not completeness. Some projects claim Takeout always has “the real count”; the supplied files do not justify that assumption.
- **Duration-based reconstruction:** spacing repeats evenly between two known events fabricates timestamps. Play counts or minutes may support an explicitly labelled estimate, never a recovered-event claim.

**9. The recovery sequence I recommend for this account.**

1. Preserve all original archives and the 200-entry API result. Record the now-confirmed Takeout product provenance. Treat the exact-timestamp union as a collection of observed records, not a physical-play count.
2. Request one controlled set of fresh exports from both Takeout products and both formats. Check all archive parts, identities and coverage; keep every differing record and metadata version.
3. Run the small My Activity pilot above. This is the highest-value next technical step because it tests both known omissions and repeat-related timestamp disagreements.
4. If the live list/detail responses improve coverage, build a date-partitioned browser/network extractor that archives raw pages/responses and documents completed intervals. If only daily summaries are exposed, do not assume a full crawl will recover hidden repeat events.
5. Test the Data Portability API only if the account is eligible. Compare selected old date windows against Takeout and the live scrape before relying on it.
6. Submit the targeted Google data-access request in parallel, with a handful of concrete discrepancies.
7. Search only already-existing device/client/service records for independent per-play evidence. Use the general YouTube InnerTube history as a secondary coverage/metadata investigation if needed.
8. Combine evidence without guessing. Store source, product, export time, original timestamp/precision, video ID, raw record, app identity, any event ID and an evidence classification. Same-song/day alternatives remain separate source observations until proven to represent one event. A Music-labelled source can enrich a matched record; a music-category video alone cannot establish a Music-app listen.

The achievable outcome is a best-supported historical archive with explicit gaps and uncertain repeats. Recovering **all** past repeat-one plays is possible only to the extent that some surviving source actually retained those individual events. This research found promising routes to test for retained data, but no verified complete historical repeat-event endpoint.

**Subsequent website pilot.** The user's supplied live My Activity text was compared with the exports at video/local-minute precision. Of 351 Music rows, 348 were already present in the combined primary exports and three were additional occurrences. The website also recovers 55 rows from October 12–15, 2024 that MyActivity JSON omitted but HTML already contained. This establishes incremental historical value for a scrape, without proving repeat-one completeness. Two original repeat test dates need correction from UTC to the previous Chicago calendar day. See [the website pilot findings](myactivity-website-findings.md) for the detailed counts, added records, and remaining tests.

**Follow-up on replay cases.** The corrected local-date samples show the website matching HTML's later Renegades timestamp and omitting JSON's earlier Radioactive occurrence. The two December website-only observations from the first sample are absent from a subsequent wider December paste, which instead shows the later same-video/UTC-day records retained by Takeout. This makes controlled query-window testing more important than a single full-history scroll; the exact filters and response payloads are not yet known. See the follow-up in [website findings](myactivity-website-findings.md).

**End-date experiment confirmed in paired website samples.** The user's explicitly labelled December 7 versus December 8 cutoff queries reproduce the two disappearing December 7 occurrences and their replacement by later same-video occurrences on December 8 UTC. End-date-dependent visibility is now supported by that controlled comparison. Latest-qualifying-occurrence selection within video/UTC-day groups remains the best-fitting interpretation for these examples, not a verified universal backend contract. Recovery should test progressively earlier upper bounds rather than rely on one all-time result; sub-day bounds are still unverified.

**Updated implementation decision after the time-picker limitation.** See [the focused next-step research](recovery-next-steps.md). Firsthand code establishes existing `min`/`max` microsecond URL parameters as a lead, and a 2026 forensic paper identifies `y3VFHd` as a My Activity history RPC. Neither source establishes complete repeat-one recovery. The next gate is a controlled sub-day filtering test, using [the browser link generator](myactivity-time-probes.js), followed by captured read-request replay if frontend date rounding interferes. A data-access request should proceed in parallel. Daily scraping alone does not meet the same-day repeat requirement; Data Portability remains conditional on eligibility and richer returned records.

**Sub-day gate passed in the user's collected results.** The eight probes in `media/myactivity-time-probes.json` confirm that URL bounds can expose earlier same-video occurrences within a day: Renegades 22:24 reappears when 22:28 is excluded. Radioactive 22:08 and 22:17 are additional in-range Music observations absent from the supplied exports. This supports implementing bounded My Activity enumeration now, with exact-timestamp/within-minute handling before a full crawl. It does not yet prove second/microsecond boundary precision, per-loop recording or completed-play counts. See [the recorded results](myactivity-website-findings.md) and [updated next steps](recovery-next-steps.md).
