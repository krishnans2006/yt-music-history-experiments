// Browser integration simulation. All responses are local; no account/network access.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, 'myactivity-network.js'), 'utf8');
const root = 'https://myactivity.google.com';
const rpc = root + '/_/FootprintsMyactivityUi/data/batchexecute?rpcids=y3VFHd&f.sid=private-url-session';
const secret = 'private-request-token';
const payload = [['YouTube Music', 'https://music.youtube.com/watch?v=3Yb2-CWjrME', '1733544460123456']];

function browser(mode = 'success') {
  let now = Date.parse('2026-11-10T12:00Z');
  let output, fetches = [], texts = [];
  const storage = new Map();
  const elements = [];
  const createElement = tag => {
    const e = { tag, style: {}, textContent: '', disabled: false, children: [],
      append(...children) { this.children.push(...children); }, click() {}, remove() {}, setAttribute() {} };
    elements.push(e); return e;
  };
  const document = { body: createElement('body'), createElement };
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  class BrowserURL extends URL {
    static createObjectURL(blob) { output = JSON.parse(blob.parts.join('')); return 'blob:report'; }
    static revokeObjectURL() {}
  }
  class XHR {
    constructor() { this.headers = []; this.responseType = ''; this.listeners = []; }
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader(name, value) { this.headers.push([name, value]); }
    addEventListener(event, callback) { if (event === 'loadend') this.listeners.push(callback); }
    send(body) {
      this.finished = originalFetch(new Request(this.url, { method: this.method, headers: this.headers, body })).then(async response => {
        this.status = response.status; this.responseText = await response.text();
        this.listeners.forEach(callback => callback());
      });
    }
  }
  const originalXHR = XHR.prototype.open;
  const originalFetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(new URL(input, root), init);
    if (request.signal.aborted || init?.signal?.aborted) throw Error('AbortError');
    const u = new URL(request.url);
    fetches.push({ path: u.pathname, url: u.href, method: request.method });
    if (request.method === 'POST') texts.push(await request.text());
    if (u.pathname === '/robots.txt') return new Response(mode === 'denied' ? 'User-agent: *\nDisallow: /' : '', { status: mode === 'denied' ? 200 : 404 });
    if (mode === 'throttled') return new Response('Too many requests', { status: 429 });
    if (mode.startsWith('cursor')) {
      const minimum = BigInt(u.searchParams.get('min')) * 1000n;
      const maximum = BigInt(u.searchParams.get('max')) * 1000n;
      const pairs = [[1733543940, 0], [1733544124, 299000000], [1733544502, 120717000], [1733546200, 589956000]];
      const values = pairs.map(pair => ({ pair, ns: BigInt(pair[0]) * 1000000000n + BigInt(pair[1]) }));
      let selected = values.filter(value => value.ns <= maximum && (mode === 'cursor-lower-bound-summary' || value.ns >= minimum)).at(-1);
      const latest = values.at(-1);
      if (mode === 'cursor-no-progress' && selected && maximum < latest.ns) selected = latest;
      if (mode === 'cursor-early-empty' && maximum < latest.ns) selected = null;
      const data = selected ? [[[26, 'YouTube', 2, '', selected.pair]], 1] : [[], 1];
      return new Response(`<html><script>AF_initDataCallback({key:'ds:5',data:${JSON.stringify(data)}});</script></html>`, { headers: { 'Content-Type': 'text/html' } });
    }
    if (u.pathname.includes('batchexecute')) return new Response(")]}'\n" + JSON.stringify([['wrb.fr', 'y3VFHd', JSON.stringify(payload)]]), { headers: { 'Content-Type': 'application/json' } });
    if (u.pathname === '/other') return new Response('OK');
    if (u.pathname === '/item') return new Response('<html><title>Not found</title></html>', { status: 404, headers: { 'Content-Type': 'text/html' } });
    if (u.searchParams.has('jspb')) return new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } });
    return new Response(`<html><title>YouTube History</title><script>AF_initDataCallback({key:'ds:1', data:${JSON.stringify(payload)}});</script></html>`, { headers: { 'Content-Type': 'text/html' } });
  };
  const indexedDB = { open() {
    const request = { transaction: { abort() { queueMicrotask(() => request.onerror()); } } };
    queueMicrotask(() => request.onupgradeneeded());
    return request;
  } };
  const context = {
    window: { fetch: originalFetch }, document, location: { origin: root, pathname: '/product/youtube', href: root + '/product/youtube?restrict=youtube' },
    navigator: { locks: { request: async (name, opts, callback) => callback(mode === 'locked' ? null : {}) } },
    XMLHttpRequest: XHR, Request, Response, Headers, URLSearchParams, TextEncoder, AbortController, indexedDB,
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    URL: BrowserURL, Date: Clock, Blob: class { constructor(parts) { this.parts = parts; } },
    performance: { now: () => now },
    setTimeout(callback, ms) { if (ms < 30000) { now += ms; queueMicrotask(callback); } return 1; }, clearTimeout() {},
  };
  vm.runInNewContext(source, context);
  const button = text => elements.find(e => e.textContent === text);
  return { context, originalFetch, originalXHR, XHR, fetches, texts, storage, button,
    referenceInput: elements.find(e => e.type === 'file'), get output() { return output; } };
}

(async () => {
  const b = browser();
  assert.equal(b.fetches.length, 0, 'Installing the recorder must not generate requests.');
  b.referenceInput.files = [{ name: 'reference.json', text: async () => JSON.stringify({ events: [{ videoId: '3Yb2-CWjrME',
    timeIntervalUTC: { start: '2024-12-07T04:07:40.000Z', endExclusive: '2024-12-07T04:07:41.000Z' } }] }) }];
  await b.referenceInput.onchange();
  await b.button('Probe APIs (9 reads)').onclick();
  assert.equal(b.output.probes.length, 9);
  assert(b.output.probes.every(p => p.response));
  assert.equal(b.output.probes.filter(p => p.response.format === 'json').length, 3);
  assert.equal(b.output.probes.filter(p => p.response.activityBlocks?.length).length, 3);
  assert.equal(b.output.probes.filter(p => p.status === 404).length, 3);
  assert.equal(b.output.reference.events.length, 1);
  assert(b.output.probes.some(p => p.referenceComparison.intervalsWithTimestampCandidates === 1));
  assert(b.output.probes.some(p => p.referenceComparison.expectedIntervals === 0));
  const body = new URLSearchParams({ at: secret, 'f.req': JSON.stringify([[['y3VFHd', JSON.stringify(['query', secret]), null, 'generic']]]) }).toString();
  const request = new Request(rpc, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'private-header' }, body });
  const response = await b.context.window.fetch(request);
  assert.equal(response.status, 200);
  await new Promise(setImmediate);
  assert.equal(b.button('Replay captured history read').disabled, false);
  await b.button('Replay captured history read').onclick();
  assert.equal(b.output.captures.length, 1);
  assert.equal(b.output.replays.length, 1);
  assert.equal(b.output.replays[0].response.format, 'batch');
  assert.equal(b.texts.length, 2);
  assert.equal(b.texts[0], body);
  assert.equal(b.texts[1], body);
  const xhr = new b.XHR();
  xhr.open('POST', rpc);
  xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
  xhr.send(body);
  await xhr.finished;
  await new Promise(setImmediate);
  await b.button('Replay captured history read').onclick();
  assert.equal(b.output.captures.length, 2);
  assert.equal(b.output.replays.length, 2);
  assert.equal(b.texts[3], body);
  assert.equal(JSON.stringify(b.output).includes(secret), false);
  assert.equal(JSON.stringify(b.output).includes('private-header'), false);
  assert.equal(JSON.stringify(b.output).includes('private-url-session'), false);
  await b.context.window.fetch(new Request(root + '/other', { method: 'POST', body: 'unrelated-body' }));
  assert.equal(b.texts.at(-1), 'unrelated-body');
  b.context.window.myActivityNetwork.stop();
  assert.equal(b.context.window.fetch, b.originalFetch);
  assert.equal(b.XHR.prototype.open, b.originalXHR);

  const denied = browser('denied');
  await denied.button('Probe APIs (9 reads)').onclick();
  assert.equal(denied.fetches.length, 1);
  assert(denied.output.errors.some(error => /disallows/.test(error)));
  const locked = browser('locked');
  await locked.button('Probe APIs (9 reads)').onclick();
  assert.equal(locked.fetches.length, 0);
  const current = browser();
  await current.button('Probe current route (3 reads)').onclick();
  assert.equal(current.output.probes.length, 3);
  assert(current.output.probes.every(probe => probe.status === 200));
  assert.equal(current.fetches.filter(call => call.path === '/item').length, 0);
  const reference = {
    run: { lo: Date.parse('2024-12-07T04:00Z'), hi: Date.parse('2024-12-07T04:40Z') },
    coverage: { partitionComplete: true },
    events: [
      ['2024-12-07T04:02:03.750Z', '2024-12-07T04:02:04.687Z'],
      ['2024-12-07T04:08:21.562Z', '2024-12-07T04:08:22.500Z'],
      ['2024-12-07T04:36:40.312Z', '2024-12-07T04:36:41.250Z'],
    ].map(([start, endExclusive]) => ({ videoId: '3Yb2-CWjrME', timeIntervalUTC: { start, endExclusive } })),
    queries: [{ lo: Date.parse('2024-12-07T04:00Z'), hi: Date.parse('2024-12-07T04:01Z'), terminal: true, music: [], snapshots: [{ text: 'No results.' }] }],
  };
  for (const mode of ['cursor', 'cursor-lower-bound-summary', 'cursor-no-progress', 'cursor-early-empty']) {
    const cursor = browser(mode);
    cursor.referenceInput.files = [{ name: 'pilot.json', text: async () => JSON.stringify(reference) }];
    await cursor.referenceInput.onchange();
    assert.equal(cursor.button('Recover reference interval (fast)').disabled, false);
    await cursor.button('Recover reference interval (fast)').onclick();
    const result = cursor.output.cursor;
    if (['cursor', 'cursor-lower-bound-summary'].includes(mode)) {
      assert.equal(result.complete, true);
      assert.equal(result.status, 'matched-reference');
      assert.equal(result.observations.length, 3);
      assert.equal(result.requests.length, 5);
      assert.equal(result.emptyControlVerified, mode === 'cursor' ? 'summary-absent' : 'summary-before-lower-bound');
      const maxima = result.requests.slice(1).map(request => BigInt(request.endpoint.params.max));
      for (let i = 1; i < maxima.length; i++) assert(maxima[i] < maxima[i-1]);
    } else {
      assert.equal(result.complete, false);
      assert.equal(result.status, 'stopped');
      assert.equal(result.observations.length, 1);
      assert(result.requests.length < 5);
    }
  }
  const throttled = browser('throttled');
  await throttled.button('Probe APIs (9 reads)').onclick();
  assert(throttled.fetches.length < 10);
  assert(throttled.storage.get('yt-music-history-network-cooldown'));
  assert.equal(throttled.button('Probe APIs (9 reads)').disabled, true);
  console.log('Passed network browser simulation: direct fetch matrix, native cursor recovery/termination/failure cases, passive capture, read replay, hook restoration, access rules, concurrency lock and throttle stop.');
})().catch(error => { console.error(error); process.exitCode = 1; });
