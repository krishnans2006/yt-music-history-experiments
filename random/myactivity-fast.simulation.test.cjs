// Runs the actual standalone bundle against local browser/IndexedDB simulations.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { REFERENCE } = require('./myactivity-fast.js');
process.env.TZ = 'America/Chicago';
const source = fs.readFileSync(path.join(__dirname, 'myactivity-fast.js'), 'utf8');
const root = 'https://myactivity.google.com';

function browser(mode = 'direct') {
  let now = Date.parse('2026-11-10T12:00:00Z'), nextTimer = 0, downloads = [], requests = [], navigations = [];
  let pausedOnce = false, storageFailed = false, context;
  const tables = Object.fromEntries(['states','events','steps','control'].map(name => [name, new Map()]));
  const timers = new Set(), elements = [], storage = new Map();
  const cloned = value => value === undefined ? value : structuredClone(value);
  function transaction(names, access) {
    const staged = []; let pending = 0, finished = false, aborting = false;
    const tx = { objectStore(name) {
      const table = tables[name];
      function request(work) {
        const q = {}; pending++;
        queueMicrotask(() => {
          if (aborting) return;
          q.result = work(); q.onsuccess?.(); pending--; finish();
        }); return q;
      }
      return {
        get: key => request(() => cloned(table.get(key))),
        getAll: () => request(() => [...table.values()].map(cloned)),
        put(value, key) { const copy = cloned(value); staged.push({ name, key, value: copy }); return request(() => key); },
      };
    }, abort() { aborting = true; queueMicrotask(() => tx.onabort?.()); } };
    function finish() {
      if (pending || finished || aborting) return;
      finished = true;
      queueMicrotask(() => {
        if (mode === 'storage-failure' && !storageFailed && staged.some(item => item.name === 'events')) {
          storageFailed = true; tx.error = Error('Simulated atomic storage failure'); tx.onabort?.(); return;
        }
        for (const item of staged) tables[item.name].set(item.key, item.value);
        tx.oncomplete?.();
        if (mode === 'pause' && !pausedOnce && staged.some(item => item.name === 'events')) {
          pausedOnce = true; context.window.myActivityFast.pause();
        }
      });
    }
    queueMicrotask(finish); return tx;
  }
  const database = { createObjectStore() {}, transaction };
  const indexedDB = { open(name) {
    const request = {};
    queueMicrotask(() => {
      if (name !== 'yt-music-history-fast-v1') {
        request.transaction = { abort() { queueMicrotask(() => request.onerror?.()); } };
        request.onupgradeneeded?.(); return;
      }
      request.result = database; request.onupgradeneeded?.(); request.onsuccess?.();
    }); return request;
  } };
  function element(tag) {
    const e = { tag, style: {}, value: '', textContent: '', disabled: false, children: [],
      append(...children) { this.children.push(...children); }, click() {}, remove() {} };
    elements.push(e); return e;
  }
  const document = { body: element('body'), createElement: element };
  const events = REFERENCE.times.map(time => ({ us: BigInt(time), id: REFERENCE.videoId, music: true }));
  events.push({ us: 1735689600000000n, id: 'same', music: true }, { us: 1735689600000001n, id: 'same', music: true }, { us: 1735689600000002n, id: 'same', music: false });
  events.sort((a,b) => a.us < b.us ? -1 : 1);
  function row(event) {
    const r = Array(33).fill(null); r[4] = Number(event.us); r[5] = `${event.id}:${event.us}`;
    r[7] = r[18] = [event.music ? 'YouTube Music' : 'YouTube'];
    r[9] = [event.id, null, 'Watched', `https://${event.music ? 'music' : 'www'}.youtube.com/watch?v=${event.id}`];
    return r;
  }
  function selection(url) {
    const u = new URL(url), lo = BigInt(u.searchParams.get('min')), hi = BigInt(u.searchParams.get('max'));
    return events.filter(event => event.us >= lo && event.us <= hi);
  }
  function serverHTML(selected) {
    const latest = selected.at(-1), byVideo = new Map(); selected.forEach(event => byVideo.set(event.id, event));
    const summary = latest ? [[[26, 'YouTube', 2, '', [Number(latest.us / 1000000n), Number(latest.us % 1000000n) * 1000]]], 1] : [[[26,'YouTube',1,'']],0];
    const attributes = mode === 'direct' || mode === 'pause' || mode === 'storage-failure'
      ? `<c-wiz data-p="${('%.@.' + JSON.stringify([[...byVideo.values()].map(row), null]).slice(1)).replaceAll('"', '&quot;')}"></c-wiz>` : '';
    let markup = '';
    if (mode === 'server-html') {
      for (const event of byVideo.values()) {
        const date = new Date(Number(event.us / 1000n));
        markup += `<div>${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>` +
          `<div>${event.music ? 'YouTube Music' : 'YouTube'}</div><div>Watched <a href="https://www.google.com/url?q=${encodeURIComponent(`https://${event.music ? 'music' : 'www'}.youtube.com/watch?v=${event.id}`)}">${event.id}</a></div>` +
          `<div>Artist</div><div>${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} • Details</div>`;
      }
      markup += selected.length ? "<div>Looks like you've reached the end</div>" : '<div>No results.</div>';
    }
    return `<html><script>AF_initDataCallback({key:'ds:5',data:${JSON.stringify(summary)}});</script>${attributes}${markup}</html>`;
  }
  function popupDocument(selected) {
    if (mode === 'ignored-point') selected = [{ us: 1793000000000000n, id: 'wrong-date', music: true }];
    let text = 'History\n'; const links = [];
    for (const event of selected) {
      const date = new Date(Number(event.us / 1000n));
      text += date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + '\n';
      text += (event.music ? 'YouTube Music' : 'YouTube') + '\nWatched ' + event.id + '\nArtist\n';
      text += date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) + ' • Details\n';
      links.push({ href: `https://${event.music ? 'music' : 'www'}.youtube.com/watch?v=${event.id}`, innerText: event.id });
    }
    text += selected.length ? "Looks like you've reached the end" : 'No results.';
    return { readyState: 'complete', body: { innerText: text }, querySelectorAll(selector) {
      if (selector === 'a[href]') return links;
      if (selector === 'script[src]') return [{ src: 'https://www.gstatic.com/public-app.js' }];
      return [];
    } };
  }
  const popups = [];
  function popupWindow() {
    const popup = { closed: false, document: { readyState: 'complete', body: { innerText: '' } }, close() { this.closed = true; } };
    let href = 'about:blank';
    popup.location = { get href() { return href; }, set href(url) {
      href = url; navigations.push(url);
      let selected = selection(url);
      if (mode === 'rounded-point') {
        const second = BigInt(new URL(url).searchParams.get('min')) / 1000000n;
        selected = events.filter(event => event.us / 1000000n === second);
      }
      popup.document = popupDocument(selected);
    } };
    popups.push(popup); return popup;
  }
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  class BrowserURL extends URL {
    static createObjectURL(blob) { downloads.push(JSON.parse(blob.parts.join(''))); return 'blob:checkpoint'; }
    static revokeObjectURL() {}
  }
  context = {
    window: { open: () => popupWindow(), fetch: async url => {
      const parsed = new URL(url); requests.push({ url, at: now }); now += 100;
      if (mode === 'throttle') return new Response('Too many requests', { status: 429 });
      if (parsed.pathname === '/robots.txt') return new Response(mode === 'denied' ? 'User-agent: *\nDisallow: /product/' : '', { status: mode === 'denied' ? 200 : 404 });
      return new Response(serverHTML(selection(url)), { headers: { 'Content-Type': 'text/html' } });
    } }, document, location: { origin: root, pathname: '/product/youtube', href: root + '/product/youtube?restrict=youtube' },
    navigator: { locks: { request: async (name, opts, fn) => fn(mode === 'locked' ? null : {}) } }, indexedDB,
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key,value) => storage.set(key,value) },
    URL: BrowserURL, Date: Clock, URLSearchParams, TextEncoder, AbortController, crypto: { randomUUID }, structuredClone,
    Blob: class { constructor(parts) { this.parts = parts; } }, console,
    performance: { now: () => now },
    setTimeout(fn, ms) { const id = ++nextTimer; timers.add(id); if (ms < 45000) queueMicrotask(() => { if (timers.delete(id)) { now += ms; fn(); } }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  vm.runInNewContext(source, context);
  const ready = async () => { for (let i = 0; i < 10; i++) { await new Promise(setImmediate); if (context.window.myActivityFast) return; } throw Error('Mount failed.'); };
  const button = text => elements.find(e => e.textContent === text);
  const run = async () => {
    await ready(); const inputs = elements.filter(e => e.tag === 'input');
    inputs[0].value = '2024-12-07T04:00:00.000Z'; inputs[1].value = '2025-01-01T00:00:01.000Z';
    await button('Validate & export / Resume').onclick();
    return downloads.at(-1);
  };
  return { context, ready, run, requests, navigations, tables, storage, popups, get output() { return downloads.at(-1); } };
}

(async () => {
  for (const mode of ['direct', 'server-html', 'fallback']) {
    const b = browser(mode), output = await b.run();
    assert.equal(output.run.status, 'complete', mode + ': ' + output.run.error);
    assert.equal(output.run.validation.complete, true);
    assert.equal(output.run.validation.pointControlsComplete, true);
    assert.equal(output.run.validation.controls.length, 2);
    assert.equal(output.coverage.complete, true);
    assert.equal(output.events.length, 14);
    assert.equal(output.events.filter(event => event.videoId === 'same').length, 2);
    assert.equal(new Set(output.events.map(event => event.eventKey)).size, 14);
    assert.equal(output.events[0].timestampMicroseconds, REFERENCE.times[0]);
    assert.equal(output.events.at(-1).timestampMicroseconds, '1735689600000001');
    assert.equal(b.navigations.length > 0, mode === 'fallback');
    assert(b.requests.every(request => new URL(request.url).pathname !== '/_/FootprintsMyactivityUi/data/batchexecute'));
    assert(b.popups.every(popup => popup.closed));
    for (let i = 1; i < b.requests.length; i++) assert(b.requests[i].at - b.requests[i - 1].at >= 500);
  }
  for (const mode of ['pause', 'storage-failure']) {
    const b = browser(mode), partial = await b.run();
    assert.equal(partial.coverage.complete, false);
    assert.equal(partial.run.status, mode === 'pause' ? 'paused' : 'stopped');
    assert(mode === 'pause' ? partial.events.length >= 1 && partial.events.length <= 2 : partial.events.length === 0);
    assert.equal(partial.run.musicCount, partial.events.length);
    const output = await b.run();
    assert.equal(output.coverage.complete, true); assert.equal(output.events.length, 14);
    assert.equal(new Set(output.events.map(event => event.eventKey)).size, 14);
  }
  const wrong = browser('ignored-point'), wrongOutput = await wrong.run();
  assert.equal(wrongOutput.coverage.complete, false); assert.equal(wrongOutput.events.length, 0);
  assert.equal(wrongOutput.run.validation.complete, false);
  assert(wrongOutput.run.windows.every(window => window.steps === 0));
  assert(wrongOutput.run.diagnostics.pointFailure);
  const rounded = browser('rounded-point'), roundedOutput = await rounded.run();
  assert.equal(roundedOutput.run.validation.events.length, 12);
  assert.equal(roundedOutput.run.validation.complete, false);
  assert.equal(roundedOutput.events.length, 0);
  assert(roundedOutput.run.error.includes('adjacent-microsecond'));
  const denied = browser('denied'), deniedOutput = await denied.run();
  assert.equal(deniedOutput.coverage.complete, false); assert.equal(denied.requests.length, 1);
  const throttle = browser('throttle'), throttleOutput = await throttle.run();
  assert.equal(throttleOutput.coverage.complete, false); assert.equal(throttle.requests.length, 1);
  assert(Number(throttle.storage.get('yt-music-history-network-cooldown')) > Date.now());
  const locked = browser('locked'); await locked.run(); assert.equal(locked.requests.length, 0);
  console.log('Passed fast-exporter browser simulation: full repeat recovery, direct and popup paths, mixed YouTube/Music, two year workers, pacing, atomic checkpoints, pause/resume, failed-write rollback, ignored bounds, access denial, throttle and lock stops.');
})().catch(error => { console.error(error); process.exitCode = 1; });
