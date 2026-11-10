// Offline tests only. No Google requests or account access.
process.env.TZ = 'America/Chicago';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('./myactivity-extract.js');
const { LIMITS, queryURL, robotsPolicy, parseSnapshot, nextTasks, retryAfter, rateDecision, minuteCandidates } = core;
const ms = s => Date.parse(s);
const base = 'https://myactivity.google.com/product/youtube?restrict=youtube&authuser=1';

test('URL bounds preserve account/filter and use integer microseconds', () => {
  const url = new URL(queryURL(base, ms('2024-11-12T04:20Z'), ms('2024-11-12T04:26Z')));
  assert.equal(url.searchParams.get('min'), '1731385200000000');
  assert.equal(url.searchParams.get('max'), '1731385559999999');
  assert.equal(url.searchParams.get('authuser'), '1');
  assert.equal(url.searchParams.get('restrict'), 'youtube');
  assert.throws(() => queryURL(base, 2, 2));
  assert.throws(() => queryURL('https://www.youtube.com/', 1, 2));
});

test('robots restrictions, longest rule, wildcards, group merging and crawl delay', () => {
  assert.equal(robotsPolicy('User-agent: *\nDisallow: /').allows(base), false);
  assert.equal(robotsPolicy('User-agent: *\nDisallow: /product\nAllow: /product/youtube').allows(base), true);
  assert.equal(robotsPolicy('User-agent: *\nDisallow: /*?*restrict=youtube').allows(base), false);
  assert.equal(robotsPolicy('User-agent: *\nDisallow: /product/youtube$').allows('https://myactivity.google.com/product/youtube'), false);
  assert.equal(robotsPolicy('User-agent: *\nDisallow: /\nAllow: /').allows(base), true);
  const multiple = robotsPolicy('User-agent: *\nDisallow: /blocked\nUser-agent: *\nDisallow: /product\nCrawl-delay: 180');
  assert.equal(multiple.allows(base), false);
  assert.equal(multiple.delayMs, 180000);
  assert.equal(robotsPolicy('User-agent: AnotherBot\nDisallow: /').allows(base), true);
  assert.throws(() => robotsPolicy('<html>Sign in</html>'));
  assert.throws(() => robotsPolicy('User-agent: *\nCrawl-delay: someday'));
  assert.throws(() => robotsPolicy('User-agent: *\nRequest-rate: 1/60'));
});

const fixture = path.resolve(__dirname, '../media/myactivity-time-probes.json');
test('real pilot captures parse as seven Music cards, not eight watch anchors', { skip: !fs.existsSync(fixture) }, () => {
  const report = JSON.parse(fs.readFileSync(fixture, 'utf8'));
  const parsed = report.probes.map(p => parseSnapshot(p.snapshots[0], ms(p.startUTC), ms(p.endUTC)));
  assert.equal(parsed.reduce((sum, p) => sum + p.music.length, 0), 7);
  assert(parsed.every(p => p.terminal));
  assert.equal(parsed[3].empty, true);
  assert.equal(parsed[7].music.length, 1);
  assert.equal(parsed[7].music[0].displayTime, '10:17 PM');
  assert.equal(parsed[7].music[0].videoId, '3Yb2-CWjrME');
});

function card({ app = 'YouTube Music', id = 'abc123', time = '10:17 PM', date = 'Dec 6, 2024' } = {}) {
  return { capturedAt: '2026-11-10T07:00:00Z',
    text: `${date}\n${app}\nWatched Song\nArtist\n${time} • Details\nLooks like you've reached the end`,
    watchLinks: [{ videoId: id, url: `https://music.youtube.com/watch?v=${id}`, label: 'Song' }] };
}
test('only explicit Music cards count; unknown, ambiguous and out-of-range cards fail', () => {
  const lo = ms('2024-12-07T04:10Z'), hi = ms('2024-12-07T04:20Z');
  assert.equal(parseSnapshot(card({ app: 'YouTube' }), lo, hi).music.length, 0);
  assert.equal(parseSnapshot(card(), lo, hi).music.length, 1);
  assert.throws(() => parseSnapshot(card(), ms('2024-12-07T04:20Z'), ms('2024-12-07T04:30Z')), /outside/);
  const ambiguous = card();
  ambiguous.watchLinks.push({ videoId: 'different', url: 'https://music.youtube.com/watch?v=different', label: 'Song' });
  assert.throws(() => parseSnapshot(ambiguous, lo, hi), /ambiguous/);
  assert.throws(() => parseSnapshot({ ...card(), text: card().text.replace('10:17 PM', 'unknown') }, lo, hi), /timestamp/);
  assert.throws(() => parseSnapshot({ ...card(), text: card().text.replace('YouTube Music\n', '') }, lo, hi), /classified/);
});

test('DST repeated local minutes retain both possible UTC offsets', () => {
  assert.deepEqual(minuteCandidates('Nov 3, 2024', '1:30 AM').sort(), [ms('2024-11-03T06:30Z'), ms('2024-11-03T07:30Z')]);
});

test('adaptive splitting recovers hidden repeats including multiple plays in one minute', () => {
  // Oracle returns only the latest occurrence per video, as in the supplied probes.
  const events = [104, 3150, 12800, 17017, 17750, 36040, 39123].map((offset, i) => ({ time: offset, id: i === 2 ? 'other' : 'repeated' }));
  const pending = [{ lo: 0, hi: 40000 }], found = [], empty = [], leaves = [];
  while (pending.length) {
    const task = pending.pop();
    const latest = new Map();
    for (const e of events.filter(e => task.lo <= e.time && e.time < task.hi)) latest.set(e.id, e);
    const children = nextTasks(task, latest.size, true);
    if (!children.length) {
      leaves.push(task);
      if (latest.size) found.push(...latest.values()); else empty.push(task);
    }
    pending.push(...children);
  }
  assert.deepEqual(found.map(e => e.time).sort((a,b) => a-b), events.map(e => e.time));
  assert(leaves.every(t => t.hi > t.lo));
  const sorted = leaves.sort((a,b) => a.lo-b.lo);
  assert.equal(sorted[0].lo, 0);
  assert.equal(sorted.at(-1).hi, 40000);
  for (let i = 1; i < sorted.length; i++) assert.equal(sorted[i-1].hi, sorted[i].lo);
});

test('truncated pages split instead of declaring empty; incomplete leaves stop', () => {
  assert.equal(nextTasks({ lo: 0, hi: 10000 }, 0, false).length, 2);
  assert.throws(() => nextTasks({ lo: 0, hi: 1000 }, 0, false), /Pagination/);
  assert.deepEqual(nextTasks({ lo: 0, hi: 10000 }, 0, true), []);
});

test('observed minute boundaries reduce sparse-history queries without losing interval coverage', () => {
  const events = [10801234, 10857234, 10980234, 43217234, 43245123, 72054321]
    .map((time, i) => ({ time, id: i % 2 ? 'repeated' : 'other' }));
  function walk(guided) {
    const pending = [{ lo: 0, hi: 86400000 }], found = [], leaves = [];
    let queries = 0;
    while (pending.length) {
      const task = pending.pop();
      queries++;
      const latest = new Map();
      for (const event of events) if (task.lo <= event.time && event.time < task.hi) latest.set(event.id, event);
      const rows = [...latest.values()].map(event => ({
        minuteCandidatesUTC: [new Date(Math.floor(event.time / 60000) * 60000).toISOString()],
      }));
      const children = nextTasks(task, latest.size, true, 1000, guided ? rows : []);
      if (!children.length) { found.push(...latest.values()); leaves.push(task); }
      pending.push(...children);
    }
    leaves.sort((a, b) => a.lo - b.lo);
    assert.equal(leaves[0].lo, 0);
    assert.equal(leaves.at(-1).hi, 86400000);
    for (let i = 1; i < leaves.length; i++) assert.equal(leaves[i-1].hi, leaves[i].lo);
    return { queries, found: found.map(e => e.time).sort((a, b) => a - b) };
  }
  const baseline = walk(false), guided = walk(true);
  assert.deepEqual(guided.found, events.map(e => e.time));
  assert.deepEqual(guided.found, baseline.found);
  assert(guided.queries < baseline.queries);
});

test('pacing uses only the latest action time and real cooldowns, without action caps', () => {
  const now = ms('2026-11-10T12:00Z');
  assert.equal(rateDecision({ lastActionAt: now - 1000 }, now).waitMs, LIMITS.delayMs - 1000);
  assert.equal(rateDecision({ lastActionAt: now - 20000 }, now).waitMs, 0);
  assert.equal(rateDecision({ starts: Array(10000).fill(now - 20000) }, now).waitMs, 0);
  assert.equal(rateDecision({ starts: [now - 1000] }, now).waitMs, LIMITS.delayMs - 1000);
  assert.match(rateDecision({ cooldownUntil: now + 1000 }, now).stop, /Cooldown/);
  assert.equal(rateDecision({ lastActionAt: now - 1000 }, now, 30000).waitMs, 29000);
  assert.equal(retryAfter('120', now), now + 120000);
  assert.equal(retryAfter(new Date(now + 120000).toUTCString(), now), now + 120000);
  assert.equal(retryAfter('invalid', now), 0);
});
