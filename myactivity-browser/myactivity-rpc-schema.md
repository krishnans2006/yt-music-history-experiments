# Bounded history RPC provenance

The failed popup export named the current public Google frontend bundle. Reading its `w4tGXb` controller and dependencies revealed the read request schema; no downloaded JavaScript was executed.

Public source: [Google frontend controller](https://www.gstatic.com/_/mss/boq-footprints/_/js/k=boq-footprints.FootprintsMyactivityUi.en.PBJaNYuU5BA.2018.O/am=CxAAAQAgMAAAAAAC4D7x9v-L-R3fQiGYPQgBQxAIn_8rg90VFEAA8AAAgKMAMwAAAAAAAAAAAAAAAAAAAAAACnkRAAAAAAAAAAAAAAAAAAAAAAAAAAAAACDgRA/d=1/excm=_b,_tp,youtubehistoryview/ed=1/dg=0/wt=2/ujg=1/rs=AJJuxJZGJG52B-1NP6bAZw3f6cBUGpor3g/dti=1/m=w4tGXb). Source SHA-256: `03a06de3aaa2ad1c3ca8a1280acf63a08e95fd59c4836db302bded0d456714bd`.

The relevant data flow is `bD` (reads the page's `min`/`max`) → `$C` (microseconds to timestamp seconds/nanoseconds) → `aD` (sets field 4). The filter type `az` exposes that field as timestamp interval `Oy`, whose fields 1 and 2 are timestamp messages `cm`. The history descriptor names `y3VFHd`; request type `ez` carries the filter at field 1, continuation at 2 and page size at 3. Response type `dz` carries rows at field 1 and continuation at 2.

These are internal interfaces, not a published stability guarantee. The exporter begins with the requested range, compares its first available API observation with the native GET timestamp, and measures endpoint inclusion with positive boundary controls before using API-only cursors. Responses outside logical bounds, inconsistent timestamps, RPC errors and non-progressing continuations stop the run without advancing past unresolved work.

The earlier unfiltered captured arguments had no field 4. Merely following that continuation could not recover hidden repeats. The new cursor reissues the bounded query with a maximum strictly before the newest timestamp group, preserving the requirement that an older listen become the latest of that recording within the requested interval.
