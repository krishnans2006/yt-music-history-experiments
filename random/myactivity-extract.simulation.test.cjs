const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { LIMITS } = require('./myactivity-extract.js');
process.env.TZ = 'America/Chicago';
const source = fs.readFileSync(process.argv[2] || path.join(__dirname, 'myactivity-extract.js'), 'utf8');
async function browser(mode = 'success', fullPilot = false) {
  let clock = Date.parse('2026-11-10T12:00:00Z');
  let fetched = 0, navigated = 0, robotsBodiesRead = 0, exported;
  let didPause = false;
  const navigationTimes = [];
  const tables = { runs: new Map(), pages: new Map(), control: new Map() };
  const cloned = x => x === undefined ? x : structuredClone(x);
  const deferred = value => {
    const request = {};
    queueMicrotask(() => { request.result = cloned(value); request.onsuccess?.(); });
    return request;
  };
  const database = {
    createObjectStore() { return { createIndex() {} }; },
    transaction(names) {
      const tx = { objectStore(name) {
        const table = tables[name];
        return {
          get(key) { return deferred(table.get(key)); },
          getAll() { return deferred([...table.values()]); },
          index() { return { getAll(runId) { return deferred([...table.values()].filter(p => p.runId === runId)); } }; },
          put(value, key) {
            table.set(key ?? value.id, cloned(value));
            queueMicrotask(() => tx.oncomplete?.());
          },
        };
      } };
      return tx;
    },
  };
  const indexedDB = { open() {
    const req = {};
    queueMicrotask(() => { req.result = database; req.onupgradeneeded?.(); req.onsuccess?.(); });
    return req;
  } };
  const elements = [];
  const element = tag => {
    const e = { tag, style: {}, value: '', textContent: '', children: [],
      append(...children) { this.children.push(...children); }, replaceChildren() { this.children = []; },
      setAttribute() {}, remove() {}, click() {},
    };
    elements.push(e);
    return e;
  };
  const doc = { body: element('body'), createElement: element,
    getElementById(id) { return elements.find(e => e.id === id); } };
  const events = [
    { time: Date.parse('2024-11-12T04:28:03.125Z'), id: '5JhZdu4O2w0' },
    ...['04:02:04.299', '04:08:12.123', '04:17:01.234', '04:17:55.456', '04:36:40.589'].map(t => ({ time: Date.parse(`2024-12-07T${t}Z`), id: '3Yb2-CWjrME' })),
  ];
  function popupWindow() {
    let href = 'about:blank';
    const popup = { closed: false, document: { readyState: 'complete', body: { innerText: '' } },
      close() { this.closed = true; }, scrollTo() {},
      performance: { getEntriesByType: () => mode === 'throttled' && navigated ? [{ responseStatus: 429 }] : [] },
    };
    popup.location = {
      get href() { return href; },
      get origin() { return href === 'about:blank' ? 'null' : new URL(href).origin; },
      set href(value) {
        navigated++;
        navigationTimes.push(clock);
        // Commit navigation asynchronously, exercising the initial about:blank case.
        queueMicrotask(() => {
          href = value;
          const url = new URL(value);
          const lo = Number(BigInt(url.searchParams.get('min')) / 1000n);
          const hi = Number((BigInt(url.searchParams.get('max')) + 1n) / 1000n);
          const latest = new Map();
          for (const event of events) if (lo <= event.time && event.time < hi) latest.set(event.id, event);
          const rows = [...latest.values()];
          let text = 'YouTube History\n';
          const links = [];
          for (const row of rows) {
            const local = new Date(row.time);
            const date = local.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            const time = local.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
            const link = `https://music.youtube.com/watch?v=${row.id}`;
            text += `${date}\nYouTube Music\nWatched ${link}\n${time} • Details\n`;
            links.push({ href: link, innerText: link });
          }
          text += rows.length ? "Looks like you've reached the end" : 'No results.';
          popup.document = { readyState: 'complete', body: { innerText: text },
            scrollingElement: { scrollHeight: 1000, scrollTop: 0 },
            querySelectorAll: selector => selector === 'a[href]' ? links : [],
          };
        });
      },
    };
    return popup;
  }
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
  class BrowserURL extends URL {
    static createObjectURL(blob) { exported = JSON.parse(blob.parts.join('')); return 'blob:test'; }
    static revokeObjectURL() {}
  }
  const window = { open: popupWindow };
  const context = {
    Date: Clock, URL: BrowserURL, Blob: class { constructor(parts) { this.parts = parts; } },
    window, document: doc, indexedDB, AbortController, Intl,
    crypto: { randomUUID }, location: { origin: 'https://myactivity.google.com', href: 'https://myactivity.google.com/product/youtube?restrict=youtube', pathname: '/product/youtube' },
    navigator: { locks: { async request(name, options, callback) { return callback(mode === 'locked' ? null : {}); } } },
    fetch: async () => { fetched++; return { status: mode.startsWith('robots-') ? Number(mode.slice(7)) : 200,
      text: async () => {
        robotsBodiesRead++;
        if (mode.startsWith('robots-')) return '<html>HTTP error page</html>';
        return mode === 'disallowed' ? 'User-agent: *\nDisallow: /' : 'User-agent: *\nAllow: /';
      }, headers: { get: () => null } }; },
    console: { log() {}, warn() {}, error(...args) { throw Error(args.map(String).join(' ')); } },
    setTimeout(callback, delay) {
      if (delay >= 15000) return 0;
      if (mode === 'pause' && !didPause && navigated >= 12) {
        didPause = true;
        elements.find(e => e.textContent === 'Pause').onclick();
      }
      clock += delay;
      queueMicrotask(callback);
      return 1;
    }, clearTimeout() {},
  };
  vm.runInNewContext(source, context);
  await new Promise(setImmediate);
  const start = elements.find(e => e.textContent === 'Start / Resume');
  assert(start?.onclick);
  if (!fullPilot) {
    elements.find(e => e.tag === 'input' && e.value.startsWith('2024-12-07T04:00')).value = '2024-12-07T04:02:04Z';
    elements.find(e => e.tag === 'input' && e.value.startsWith('2024-12-07T04:40')).value = '2024-12-07T04:02:06Z';
  }
  await start.onclick();
  return { tables, fetched, navigated, navigationTimes, robotsBodiesRead, get exported() { return exported; }, start, elements };
}
(async () => {
  const success = await browser();
  assert.equal(success.exported.run.status, 'finished');
  assert.equal(success.exported.events.length, 1);
  assert.equal(success.exported.events[0].videoId, '3Yb2-CWjrME');
  assert.equal(success.exported.coverage.partitionComplete, true);
  assert.equal(success.exported.unresolvedObservations.length, 0);
  assert.equal(success.fetched, 1);
  assert.equal(success.navigated, 6); // three calibration queries, parent, two child intervals
  const denied = await browser('disallowed');
  assert.equal(denied.fetched, 1);
  assert.equal(denied.navigated, 0);
  assert.equal(denied.exported.run.pending.length, 4);
  assert.match(denied.exported.run.stopReason, /disallows/);
  for (const status of [404, 410]) {
    const absent = await browser(`robots-${status}`);
    assert.equal(absent.exported.run.status, 'finished');
    assert.equal(absent.navigated, 6);
    assert.equal(absent.robotsBodiesRead, 0);
    assert.equal(absent.exported.run.robots.httpStatus, status);
    assert.equal(absent.exported.run.robots.state, 'absent');
    assert.equal(absent.exported.run.robots.text, null);
    assert.equal(absent.exported.events.length, 1);
  }
  for (const status of [401, 403, 429, 500, 503]) {
    const blocked = await browser(`robots-${status}`);
    assert.equal(blocked.navigated, 0);
    assert.equal(blocked.exported.run.status, 'paused');
    assert.match(blocked.exported.run.stopReason, new RegExp(`HTTP ${status}`));
    if ([429, 503].includes(status)) assert(blocked.exported.rate.cooldownUntil);
  }
  const locked = await browser('locked');
  assert.equal(locked.fetched, 0);
  assert.equal(locked.tables.runs.size, 0);
  const throttled = await browser('throttled');
  assert.equal(throttled.navigated, 1);
  assert(throttled.tables.control.get('rate').cooldownUntil);
  assert.equal(throttled.exported.run.pending.length, 4);
  const uninterrupted = await browser('success', true);
  assert.equal(uninterrupted.exported.run.status, 'finished');
  assert(uninterrupted.exported.run.completedQueries > 30);
  assert.equal(uninterrupted.exported.events.length, 5);
  const eventStarts = uninterrupted.exported.events.map(event => event.timeIntervalUTC.start);
  assert.deepEqual(eventStarts, [...eventStarts].sort());
  for (let i = 1; i < uninterrupted.navigationTimes.length; i++) {
    assert(uninterrupted.navigationTimes[i] - uninterrupted.navigationTimes[i-1] >= LIMITS.delayMs);
  }
  const paused = await browser('pause', true);
  assert.equal(paused.exported.run.status, 'paused');
  assert.match(paused.exported.run.stopReason, /Paused by user/);
  const before = paused.exported.run.completedQueries;
  const olderCheckpoint = clonedForTest(paused.exported);
  await paused.start.onclick();
  assert(paused.exported.run.completedQueries > before);
  assert.equal(paused.exported.run.status, 'finished');
  assert.equal(paused.exported.events.length, 5);
  assert.equal(paused.exported.rate.starts, undefined);
  const pages = paused.exported.queries;
  assert.equal(new Set(pages.map(p => `${p.lo}:${p.hi}`)).size, pages.length);
  const restore = paused.elements.find(e => e.type === 'file');
  restore.files = [{ text: async () => JSON.stringify(olderCheckpoint) }];
  await restore.onchange();
  assert(paused.elements.some(e => /newer checkpoint/.test(e.textContent)));
  assert.equal(paused.tables.control.get('rate').lastActionAt, paused.exported.rate.lastActionAt);
  const foreignBrowser = await browser();
  const localRate = foreignBrowser.tables.control.get('rate');
  localRate.cooldownUntil = Date.parse('2026-11-15T12:00Z');
  const importFile = foreignBrowser.elements.find(e => e.type === 'file');
  const legacyCheckpoint = clonedForTest(paused.exported);
  legacyCheckpoint.rate.starts = [legacyCheckpoint.rate.lastActionAt];
  delete legacyCheckpoint.rate.lastActionAt;
  importFile.files = [{ text: async () => JSON.stringify(legacyCheckpoint) }];
  await importFile.onchange();
  assert.equal(foreignBrowser.tables.runs.size, 2);
  assert.equal(foreignBrowser.tables.control.get('rate').cooldownUntil, localRate.cooldownUntil);
  assert(foreignBrowser.tables.control.get('rate').lastActionAt >= paused.exported.rate.lastActionAt);
  assert.equal(foreignBrowser.tables.control.get('rate').starts, undefined);
  assert.equal(foreignBrowser.fetched, 1); // importing performs no network access
  console.log('Passed browser simulation: continuous paced extraction, calibration, leaf export, absent robots files, robots/access/server errors, cross-tab lock, HTTP 429 stop, pause/resume, and legacy checkpoint imports preserving cooldowns.');
})().catch(error => { console.error(error); process.exitCode = 1; });

function clonedForTest(value) { return structuredClone(value); }
