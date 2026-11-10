const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
process.env.TZ = 'America/Chicago';
const core = require('./myactivity-fast.js');
const { REFERENCE, nativePage, recordEvents, validateReference, embeddedHistory, yearWindows, parsePointSnapshot, popupEvents, robotRules } = core;

function row(time, id, app = 'YouTube Music') {
  const result = Array(33).fill(null);
  result[4] = Number(time); result[5] = `${id}:${time}`; result[7] = [app]; result[18] = [app];
  result[9] = [id, null, 'Watched', `https://${app === 'YouTube Music' ? 'music' : 'www'}.youtube.com/watch?v=${id}`];
  return result;
}
function html(time, rows = [], format = 'attribute') {
  const pair = time === null ? null : [Number(BigInt(time) / 1000000n), Number(BigInt(time) % 1000000n) * 1000];
  const summary = pair ? [[[26, 'YouTube', 2, '', pair]], 1] : [[[26, 'YouTube', 1, '']], 0];
  const payload = JSON.stringify([rows, null]);
  const data = format === 'attribute'
    ? `<c-wiz data-p="${('%.@.' + payload.slice(1)).replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"></c-wiz>`
    : `<script>AF_initDataCallback({key:'ds:9',data:${payload}});</script>`;
  return `<html><script>AF_initDataCallback({key:'ds:5',data:${JSON.stringify(summary)}});</script>${data}</html>`;
}

test('finds validated records in both Wiz attributes and bootstrap without evaluating scripts', () => {
  const rows = [row(REFERENCE.times[0], '3Yb2-CWjrME')];
  for (const format of ['attribute', 'bootstrap']) {
    const parsed = embeddedHistory(html(REFERENCE.times[0], rows, format));
    assert.equal(parsed.records.length, 1); assert.equal(parsed.records[0].row[4], Number(REFERENCE.times[0]));
  }
  assert.equal(embeddedHistory('<c-wiz data-p="%.@.]">').records.length, 0);
});

test('walks every source timestamp, including YouTube activity hiding earlier Music repeats', () => {
  const start = BigInt(REFERENCE.lo);
  const events = [
    row(start + 1n, 'same'), row(start + 2n, 'same'), row(start + 3n, 'same', 'YouTube'),
    row(start + 4n, 'same'), row(start + 5n, 'video', 'YouTube'), row(start + 6n, 'other'),
    row(start + 6n, 'simultaneous'),
  ];
  let maximum = (BigInt(REFERENCE.hi) - 1n).toString(), steps = 0; const recovered = [];
  while (true) {
    const selected = events.filter(event => BigInt(event[4]) <= BigInt(maximum));
    const latestByVideo = new Map();
    selected.forEach(event => latestByVideo.set(event[9][3].split('=')[1], event));
    const native = nativePage(html(selected.length ? selected.at(-1)[4] : null, [...latestByVideo.values()]), REFERENCE.lo, maximum);
    if (native.empty) break;
    recovered.push(...recordEvents(native)); maximum = native.nextMaximum; steps++;
  }
  assert.equal(steps, 6);
  assert.equal(recovered.length, 5);
  assert.equal(recovered.filter(event => event.videoId === 'same').length, 3);
  assert.equal(new Set(recovered.map(event => event.eventKey)).size, 5);
});

test('exact native cursor rejects out-of-bounds and sub-microsecond observations', () => {
  assert.throws(() => nativePage(html(REFERENCE.times[0]), REFERENCE.lo, (BigInt(REFERENCE.times[0]) - 1n).toString()), /upper bound/);
  const bad = html(REFERENCE.times[0]).replace('299187000', '299187001');
  assert.throws(() => nativePage(bad, REFERENCE.lo, REFERENCE.hi), /Sub-microsecond/);
  assert.equal(nativePage(html(REFERENCE.times[0]), REFERENCE.times[1], REFERENCE.hi).empty, true);
});

test('point popup preserves exact timestamp and accepts only completed identified results', () => {
  const native = nativePage(html(REFERENCE.times[0]), REFERENCE.lo, REFERENCE.hi);
  const snapshot = { capturedAt: '2026-11-10T12:00:00Z', text: "History\nDec 6, 2024\nYouTube Music\nWatched Radioactive\nImagine Dragons - Topic\n10:02 PM • Details\nLooks like you've reached the end",
    watchLinks: [{ videoId: '3Yb2-CWjrME', url: 'https://music.youtube.com/watch?v=3Yb2-CWjrME', label: 'Radioactive' }] };
  const parsed = parsePointSnapshot(snapshot, native.microseconds);
  const events = popupEvents(parsed, native);
  assert.equal(events[0].timestampMicroseconds, REFERENCE.times[0]);
  assert.equal(events[0].timeUTC, '2024-12-07T04:02:04.299187Z');
  assert.throws(() => popupEvents({ ...parsed, terminal: false }, native), /complete/);
  assert.throws(() => parsePointSnapshot({ ...snapshot, text: snapshot.text.replace('10:02 PM', '11:02 PM') }, native.microseconds), /outside/);
});

test('point HTML identifies Music through Google redirect links without rendering the page', () => {
  const markup = '<html><script>throw Error("do not execute")</script><div>Dec 6, 2024</div><div>YouTube Music</div>' +
    '<div>Watched <a href="https://www.google.com/url?q=https%3A%2F%2Fmusic.youtube.com%2Fwatch%3Fv%3D3Yb2-CWjrME&amp;sa=D">Radioactive</a></div>' +
    '<div>Imagine Dragons - Topic</div><div>10:02 PM • Details</div><div>Looks like you&#39;ve reached the end</div></html>';
  const snapshot = core.serverSnapshot(markup);
  assert.equal(snapshot.watchLinks[0].videoId, REFERENCE.videoId);
  assert.equal(parsePointSnapshot(snapshot, REFERENCE.times[0]).music.length, 1);
  assert.equal(snapshot.text.includes('do not execute'), false);
});

test('non-watch activity is excluded only after its point timestamp is checked', () => {
  const snapshot = { capturedAt: '2026-11-10T12:00:00Z', text: "History\nDec 6, 2024\nYouTube\nViewed example\n10:02 PM • Details\nLooks like you've reached the end", watchLinks: [] };
  const parsed = parsePointSnapshot(snapshot, REFERENCE.times[0]);
  assert.equal(parsed.other, 1); assert.equal(parsed.music.length, 0);
  assert.throws(() => parsePointSnapshot({ ...snapshot, text: snapshot.text.replace('10:02 PM', '11:02 PM') }, REFERENCE.times[0]), /outside/);
});

test('year windows partition the entire range without skipping pre-export history', () => {
  const lo = Date.parse('1970-01-01T00:00:00Z'), hi = Date.parse('2026-11-10T00:00:00Z');
  const windows = yearWindows(lo, hi).reverse();
  assert.equal(windows[0].lo, '0'); assert.equal(windows.at(-1).hi, String(BigInt(hi) * 1000n));
  for (let i = 1; i < windows.length; i++) assert.equal(windows[i].lo, windows[i - 1].hi);
});

test('reference gate checks all twelve exact video/timestamp observations, not only their count', () => {
  const events = REFERENCE.times.map(time => ({ videoId: REFERENCE.videoId, timestampMicroseconds: time }));
  assert.equal(validateReference(events), true);
  assert.throws(() => validateReference([...events.slice(1), events[1]]), /validation failed/);
  assert.throws(() => validateReference(events.map(event => ({ ...event, videoId: 'wrong' }))), /validation failed/);
});

const report = path.resolve(__dirname, '../media/myactivity-network-report(2).json');
test('embedded reference constants match the twelve independently verified live native timestamps', { skip: !fs.existsSync(report) }, () => {
  const saved = JSON.parse(fs.readFileSync(report));
  const times = saved.cursor.observations.map(event => (BigInt(event.timestamp.epochNanoseconds) / 1000n).toString()).sort();
  assert.deepEqual([...REFERENCE.times].sort(), times);
});

test('robots rules retain the 500 ms baseline and honor applicable restrictions and delays', () => {
  assert.equal(robotRules('').delayMs, 500);
  const policy = robotRules('User-agent: *\nDisallow: /product\nAllow: /product/youtube\nCrawl-delay: 2');
  assert.equal(policy.delayMs, 2000);
  assert.equal(policy.allows('https://myactivity.google.com/product/youtube?min=1'), true);
  assert.equal(policy.allows('https://myactivity.google.com/product/other'), false);
});

module.exports = { row, html };
