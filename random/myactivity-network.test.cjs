// Offline protocol and concurrency checks; no requests to Google.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { bootstrap, decodeBatch, readCalls, describe, parseResponse, probes, pool, sanitized, compareReference } = require('./myactivity-network.js');
const payload = [['YouTube Music', 'https://music.youtube.com/watch?v=3Yb2-CWjrME', '1733544460123456']];
const framed = JSON.stringify([['wrb.fr', 'y3VFHd', JSON.stringify(payload), null]]);

test('extracts bootstrap data without evaluating scripts or confusing text with object members', () => {
  const data = [['data: [not a member]', { text: "brackets ] } and escaped quote \"" }], ...payload];
  const html = `<html><script>AF_initDataCallback({key:'ds:1',hash:'2',data:${JSON.stringify(data)},sideChannel:{}});</script></html>`;
  const result = bootstrap(html);
  assert.equal(result.blocks[0].key, 'ds:1');
  assert.deepEqual(result.blocks[0].data, data);
  assert.equal(result.errors.length, 0);
  assert.equal(bootstrap('<script>AF_initDataCallback({key:"ds:0",data:stealCookies()});</script>').blocks.length, 0);
});

test('decodes XSSI-prefixed, framed and plain batch responses, including Unicode', () => {
  const frame2 = JSON.stringify([['wrb.fr', 'y3VFHd', JSON.stringify(['Música 🎵'])]]);
  assert.deepEqual(decodeBatch(")]}'\n" + framed).payloads, [payload]);
  assert.deepEqual(decodeBatch(")]}'\n" + framed.length + '\n' + framed + '\n' + frame2.length + '\n' + frame2).payloads, [payload, ['Música 🎵']]);
  assert.equal(parseResponse(")]}'\n" + framed, 'application/json', 1733544000000, 1733546400000).format, 'batch');
  assert.throws(() => decodeBatch(")]}'\n[[\"truncated\""));
});

test('read replay rejects mutations, mixed batches, GET-like malformed bodies and arbitrary RPCs', () => {
  const form = calls => new URLSearchParams({ 'f.req': JSON.stringify([calls]), at: 'private-session-token' }).toString();
  assert.equal(readCalls(form([['y3VFHd', '[]', null, 'generic']])).calls.length, 1);
  assert.equal(readCalls(form([['TmdDAd', '[]', null, 'generic']])), null);
  assert.equal(readCalls(form([['y3VFHd', '[]'], ['TmdDAd', '[]']])), null);
  assert.equal(readCalls(''), null);
  assert.equal(readCalls(form([['other', '[]']])), null);
});

test('timestamp candidates retain paths and raw values without asserting an event schema', () => {
  const result = describe(payload, 1733544000000, 1733546400000);
  assert.equal(result.videoURLs[0].videoId, '3Yb2-CWjrME');
  assert.equal(result.timestampCandidates[0].possibleUnit, 'microseconds');
  assert.equal(result.timestampCandidates[0].value, '1733544460123456');
  assert.equal(result.timestampCandidates[0].path, '$[0][2]');
});

test('probe matrix preserves account/product filters and includes legacy and current transports', () => {
  const items = probes('https://myactivity.google.com/product/youtube?restrict=youtube&authuser=1&max=old');
  assert.equal(items.length, 9);
  assert.equal(items.filter(p => new URL(p.url).pathname === '/item').length, 3);
  for (const item of items) {
    const u = new URL(item.url);
    assert.equal(u.searchParams.get('authuser'), '1');
    assert.equal(u.searchParams.get('restrict'), 'youtube');
    assert.equal(u.searchParams.get('min'), (BigInt(item.lo) * 1000n).toString());
    assert.equal(u.searchParams.get('max'), (BigInt(item.hi) * 1000n - 1n).toString());
  }
});

test('worker pool bounds concurrency and processes each item exactly once', async () => {
  let active = 0, peak = 0;
  const seen = [];
  await pool([0, 1, 2, 3, 4, 5], 2, async item => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 2));
    seen.push(item); active--;
  });
  assert.equal(peak, 2);
  assert.deepEqual(seen.sort(), [0, 1, 2, 3, 4, 5]);
  await assert.rejects(pool([1], 0, async () => {}), /positive integer/);
});

test('worker failure and cancellation stop dispatch without retries', async () => {
  let calls = 0;
  await assert.rejects(pool([1, 2, 3], 1, async () => { calls++; throw Error('HTTP 429'); }), /429/);
  assert.equal(calls, 1);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(pool([1], 2, async () => { throw Error('should not run'); }, controller.signal), /Stopped/);
});

test('export redacts credential keys and known session-token strings', () => {
  const secret = 'private-session-token';
  const result = sanitized({ at: secret, Cookie: 'SID=secret', Authorization: 'Bearer secret',
    payload: [`embedded ${secret}`, { safe: 'history data' }] }, [secret]);
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(result.at, undefined);
  assert.equal(result.Cookie, undefined);
  assert.equal(result.Authorization, undefined);
  assert.equal(result.payload[1].safe, 'history data');
});

test('reference validation checks half-open event intervals and the actual probe window', () => {
  const events = [
    { videoId: 'first', timeIntervalUTC: { start: '2024-12-07T04:02:03.750Z', endExclusive: '2024-12-07T04:02:04.687Z' } },
    { videoId: 'last', timeIntervalUTC: { start: '2024-12-07T04:36:40.312Z', endExclusive: '2024-12-07T04:36:41.250Z' } },
  ];
  const candidates = [
    { path: '$[0][0]', utc: '2024-12-07T04:02:04.299Z' },
    { path: '$[0][1]', utc: '2024-12-07T04:36:40.589Z' },
    { path: '$[0][2]', utc: '2024-12-07T04:02:04.687Z' },
  ];
  const all = compareReference(candidates, events);
  assert.equal(all.expectedIntervals, 2);
  assert.equal(all.intervalsWithTimestampCandidates, 2);
  assert.equal(all.matches[0].timestampCandidates.length, 1);
  const early = compareReference(candidates, events, { lo: Date.parse('2024-12-07T04:00Z'), hi: Date.parse('2024-12-07T04:10Z') });
  assert.equal(early.expectedIntervals, 1);
  assert.equal(early.matches[0].videoId, 'first');
  assert.equal(compareReference([], events).intervalsWithTimestampCandidates, 0);
});

const pilot = path.resolve(__dirname, '../media/myactivity-extract-3c25205c-2491-43ae-8720-1f7bdc3eb20c.json');
test('completed Radioactive pilot supplies 12 reference events, with 3 in each narrow probe', { skip: !fs.existsSync(pilot) }, () => {
  const events = JSON.parse(fs.readFileSync(pilot, 'utf8')).events;
  assert.equal(events.length, 12);
  const knownExportTimestamps = [
    { path: '$[0]', utc: '2024-12-07T04:02:04.299Z' },
    { path: '$[1]', utc: '2024-12-07T04:36:40.589Z' },
  ];
  const result = compareReference(knownExportTimestamps, events);
  assert.equal(result.expectedIntervals, 12);
  assert.equal(result.intervalsWithTimestampCandidates, 2);
  const early = compareReference(knownExportTimestamps, events, { lo: Date.parse('2024-12-07T04:00Z'), hi: Date.parse('2024-12-07T04:10Z') });
  assert.equal(early.expectedIntervals, 3);
  assert.equal(early.intervalsWithTimestampCandidates, 1);
  const middle = compareReference(knownExportTimestamps, events, { lo: Date.parse('2024-12-07T04:10Z'), hi: Date.parse('2024-12-07T04:20Z') });
  assert.equal(middle.expectedIntervals, 3);
});
