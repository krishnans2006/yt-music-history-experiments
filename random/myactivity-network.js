// Paste on your logged-in My Activity YouTube page, after pausing the old extractor.
// Probe APIs fetches nine small historical queries without navigating/rendering pages.
(() => {
  'use strict';
  const READ_RPC = 'y3VFHd';
  const RPC_PATH = '/_/FootprintsMyactivityUi/data/batchexecute';
  const OPTIONS = Object.freeze({ concurrency: 2, startGapMs: 500, timeoutMs: 30000, maxCaptures: 40 });
  const origin = 'https://myactivity.google.com';

  function balanced(source, start) {
    const stack = [], pairs = { '[': ']', '{': '}', '(': ')' };
    let quote = null, escaped = false;
    for (let i = start; i < source.length; i++) {
      const char = source[i];
      if (quote) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === quote) quote = null;
      } else if (char === '"' || char === "'") quote = char;
      else if (pairs[char]) stack.push(pairs[char]);
      else if (']})'.includes(char)) {
        if (stack.pop() !== char) throw Error('Unbalanced structured response.');
        if (!stack.length) return { text: source.slice(start, i + 1), end: i + 1 };
      }
    }
    throw Error('Incomplete structured response.');
  }

  // Read a literal member without executing Google's bootstrap JavaScript.
  function member(objectSource, name) {
    let i = 1;
    while (i < objectSource.length - 1) {
      while (/[\s,]/.test(objectSource[i] || '') && i < objectSource.length) i++;
      let key;
      if (['"', "'"].includes(objectSource[i])) {
        const quote = objectSource[i++], start = i;
        while (i < objectSource.length && objectSource[i] !== quote) { if (objectSource[i] === '\\') i++; i++; }
        key = objectSource.slice(start, i++);
      } else {
        const match = objectSource.slice(i).match(/^[\w$]+/);
        if (!match) break;
        key = match[0]; i += key.length;
      }
      while (/\s/.test(objectSource[i] || '') && i < objectSource.length) i++;
      if (objectSource[i++] !== ':') throw Error('Invalid bootstrap object.');
      while (/\s/.test(objectSource[i] || '') && i < objectSource.length) i++;
      const start = i;
      if ('[{('.includes(objectSource[i])) i = balanced(objectSource, i).end;
      else if (['"', "'"].includes(objectSource[i])) {
        const quote = objectSource[i++];
        while (i < objectSource.length && objectSource[i] !== quote) { if (objectSource[i] === '\\') i++; i++; }
        i++;
      } else while (i < objectSource.length && !',}'.includes(objectSource[i])) i++;
      if (key === name) return objectSource.slice(start, i).trim();
    }
    return null;
  }

  function bootstrap(html) {
    const blocks = [], errors = [];
    const scripts = /<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi;
    for (const script of html.matchAll(scripts)) {
      const text = script[1];
      const callbacks = /AF_initDataCallback\s*\(\s*\{/g;
      let match;
      while ((match = callbacks.exec(text))) {
        try {
          const object = balanced(text, text.indexOf('{', match.index));
          callbacks.lastIndex = object.end;
          const key = member(object.text, 'key');
          const raw = member(object.text, 'data');
          if (raw !== null) blocks.push({ key: key?.slice(1, -1), data: JSON.parse(raw) });
        } catch (error) { errors.push(String(error)); }
      }
    }
    return { blocks, errors };
  }

  function decodeBatch(body) {
    let source = body.replace(/^\s*\)\]\}'[^\n]*\n?/, '');
    const frames = [];
    let i = 0;
    while (i < source.length) {
      while (/\s/.test(source[i] || '') && i < source.length) i++;
      if (i === source.length) break;
      const length = source.slice(i).match(/^\d+\s*\r?\n/);
      if (length) { i += length[0].length; continue; }
      if (!'[{'.includes(source[i])) throw Error('Unrecognized batch framing.');
      const frame = balanced(source, i);
      frames.push(JSON.parse(frame.text)); i = frame.end;
    }
    const payloads = [], errorFrames = [];
    function visit(value) {
      if (!Array.isArray(value)) return;
      if (value[0] === 'wrb.fr' && value[1] === READ_RPC) {
        payloads.push(typeof value[2] === 'string' ? JSON.parse(value[2]) : value[2]);
      } else if (value[0] === 'er') errorFrames.push(value);
      else value.forEach(visit);
    }
    frames.forEach(visit);
    return { payloads, errorFrames };
  }

  function readCalls(formBody) {
    const form = new URLSearchParams(formBody);
    const value = JSON.parse(form.get('f.req') || 'null');
    if (!Array.isArray(value) || !value.every(group => Array.isArray(group))) return null;
    const calls = value.flat();
    if (!calls.length || !calls.every(call => Array.isArray(call) && call[0] === READ_RPC && typeof call[1] === 'string')) return null;
    return { calls, at: form.get('at') };
  }

  function describe(data, lo, hi) {
    const videoURLs = [], timestampCandidates = [];
    function visit(value, path) {
      if (typeof value === 'string' && /^https:\/\/(?:music\.|www\.)?youtube\.com\/watch\?/.test(value)) {
        videoURLs.push({ path, url: value, videoId: new URL(value).searchParams.get('v') });
      }
      if ((typeof value === 'number' && Number.isSafeInteger(value)) || (typeof value === 'string' && /^\d{10,16}$/.test(value))) {
        const number = Number(value);
        for (const [unit, divisor] of [['seconds', 0.001], ['milliseconds', 1], ['microseconds', 1000]]) {
          const milliseconds = number / divisor;
          if (milliseconds >= lo && milliseconds < hi) {
            timestampCandidates.push({ path, value, possibleUnit: unit, utc: new Date(milliseconds).toISOString() });
          }
        }
      }
      if (Array.isArray(value)) value.forEach((child, index) => visit(child, `${path}[${index}]`));
      else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) visit(child, `${path}.${key}`);
    }
    visit(data, '$');
    return { videoURLs, timestampCandidates, note: 'Candidates only. Query bounds and other metadata can resemble event timestamps; no event schema or play counts inferred.' };
  }

  function parseResponse(text, type, lo, hi) {
    if (/html/i.test(type) || /^\s*(?:<!doctype|<html)/i.test(text)) {
      const decoded = bootstrap(text);
      const activity = decoded.blocks.filter(block => /youtube|y3VFHd/i.test(JSON.stringify(block.data)));
      return { format: 'html-bootstrap', title: text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1],
        bootstrapBlockCount: decoded.blocks.length, activityBlocks: activity, parseErrors: decoded.errors,
        ...describe(activity, lo, hi) };
    }
    try {
      const data = JSON.parse(text.replace(/^\s*\)\]\}'[^\n]*\n?/, ''));
      const batch = decodeBatch(text);
      if (batch.payloads.length || batch.errorFrames.length) return { format: 'batch', ...batch, ...describe(batch.payloads, lo, hi) };
      return { format: 'json', data, ...describe(data, lo, hi) };
    } catch {
      const data = decodeBatch(text);
      return { format: 'batch', ...data, ...describe(data.payloads, lo, hi) };
    }
  }

  function probes(base) {
    const windows = [
      ['broad', '2024-12-07T04:00:00Z', '2024-12-07T04:40:00Z'],
      ['early', '2024-12-07T04:00:00Z', '2024-12-07T04:10:00Z'],
      ['middle', '2024-12-07T04:10:00Z', '2024-12-07T04:20:00Z'],
    ];
    return windows.flatMap(([window, start, end]) => ['page', 'page-jspb', 'legacy-item-jspb'].map(variant => {
      const url = new URL(base);
      if (url.origin !== origin) throw Error('Only My Activity is supported.');
      url.searchParams.set('min', (BigInt(Date.parse(start)) * 1000n).toString());
      url.searchParams.set('max', (BigInt(Date.parse(end)) * 1000n - 1n).toString());
      if (variant !== 'page') url.searchParams.set('jspb', '1');
      if (variant === 'legacy-item-jspb') url.pathname = '/item';
      return { window, variant, url: url.href, lo: Date.parse(start), hi: Date.parse(end) };
    }));
  }

  async function pool(items, concurrency, work, signal) {
    if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw Error('Use a positive integer worker count.');
    let next = 0, failed;
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length && !signal?.aborted && !failed) {
        const item = items[next++];
        try { await work(item); } catch (error) { failed ||= error; }
      }
    }));
    if (failed) throw failed;
    if (signal?.aborted) throw Error('Stopped.');
  }

  function sanitized(value, secrets = []) {
    if (typeof value === 'string') {
      for (const secret of secrets) if (secret?.length >= 8) value = value.replaceAll(secret, '[redacted]');
      return value;
    }
    if (Array.isArray(value)) return value.map(v => sanitized(v, secrets));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !/^(?:at|cookie|authorization|x-xsrf-token|x-csrf-token)$/i.test(key))
      .map(([key, v]) => [key, sanitized(v, secrets)]));
    return value;
  }

  function compareReference(candidates, events, window) {
    const expected = events.filter(event => {
      const interval = event.timeIntervalUTC;
      return !window || Date.parse(interval.start) < window.hi && Date.parse(interval.endExclusive) > window.lo;
    });
    const matches = expected.map(event => ({ videoId: event.videoId, timeIntervalUTC: event.timeIntervalUTC,
      timestampCandidates: (candidates || []).filter(candidate => {
        const time = Date.parse(candidate.utc);
        return time >= Date.parse(event.timeIntervalUTC.start) && time < Date.parse(event.timeIntervalUTC.endExclusive);
      }) }));
    return { expectedIntervals: expected.length, intervalsWithTimestampCandidates: matches.filter(match => match.timestampCandidates.length).length,
      matches, note: 'Interval matches are protocol evidence, not verified event/video associations. Numeric fields can be metadata; confirm the response schema before counting listens.' };
  }

  const core = { OPTIONS, balanced, member, bootstrap, decodeBatch, readCalls, describe, parseResponse, probes, pool, sanitized, compareReference };
  if (typeof module === 'object' && module.exports) { module.exports = core; return; }
  if (location.origin !== origin) throw Error('Run this on My Activity.');
  if (window.myActivityNetwork) throw Error('The network tool is already installed.');
  const originalFetch = window.fetch;
  const xhr = { open: XMLHttpRequest.prototype.open, send: XMLHttpRequest.prototype.send, header: XMLHttpRequest.prototype.setRequestHeader };
  const metadata = new WeakMap(), pending = new Set(), secrets = new Set();
  let template = null, active = null, recording = true, halted = false;
  const report = { schemaVersion: 1, createdAt: new Date().toISOString(), page: location.origin + location.pathname,
    note: 'Transport discovery and timings, not a complete history export. Timestamp candidates are not verified listen events.',
    probes: [], captures: [], replays: [], errors: [] };
  const panel = document.createElement('div');
  panel.id = 'myactivity-network';
  panel.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;background:white;color:black;border:2px solid #555;padding:16px;font:14px sans-serif;max-width:420px;';
  const add = (tag, label) => { const e = document.createElement(tag); e.textContent = label; panel.append(e); return e; };
  add('strong', 'My Activity network benchmark');
  const probeButton = add('button', 'Probe APIs (9 reads)');
  const replayButton = add('button', 'Replay captured history read'); replayButton.disabled = true;
  const stopButton = add('button', 'Stop');
  const downloadButton = add('button', 'Download JSON');
  const referenceFile = add('input', ''); referenceFile.type = 'file'; referenceFile.accept = '.json,application/json';
  referenceFile.setAttribute('aria-label', 'Optional reference extractor export');
  const status = add('p', 'Listening for history read requests. Probes use fetch, not page navigation.');
  document.body.append(panel);
  const range = { lo: Date.parse('2024-12-07T04:00Z'), hi: Date.parse('2024-12-07T04:40Z') };

  function endpoint(url) {
    const u = new URL(url, location.href);
    const allowed = ['rpcids', 'authuser', 'source-path', 'min', 'max', 'restrict', 'jspb'];
    return { path: u.pathname, params: Object.fromEntries([...u.searchParams].filter(([key]) => allowed.includes(key))) };
  }
  function isBatch(url) { const u = new URL(url, location.href); return u.origin === origin && u.pathname === RPC_PATH; }
  function track(promise) { pending.add(promise); promise.catch(error => report.errors.push(String(error))).finally(() => pending.delete(promise)); }
  async function httpError(statusCode, retry = null) {
    if ([401, 403, 429].includes(statusCode) || statusCode >= 500) {
      halted = true; active?.abort();
      if ([429, 503].includes(statusCode)) {
        const requested = /^\d+$/.test(retry || '') ? Date.now() + Number(retry) * 1000 : Date.parse(retry);
        const until = Math.max(Date.now() + 86400000, Number.isFinite(requested) ? requested : 0);
        localStorage.setItem('yt-music-history-network-cooldown', String(until));
        await savedRate(rate => ({ ...rate, cooldownUntil: Math.max(rate.cooldownUntil || 0, until), reason: `Network benchmark HTTP ${statusCode}` }));
      }
      throw Error(`HTTP ${statusCode}; stopped without retrying. Review any verification or throttling before another run.`);
    }
  }
  async function record(request, text, statusCode, durationMs) {
    if (!recording || report.captures.length >= OPTIONS.maxCaptures) return;
    let read;
    try { read = readCalls(await request.clone().text()); } catch { /* Unknown batch: metadata only. */ }
    const record = { capturedAt: new Date().toISOString(), endpoint: endpoint(request.url), status: statusCode, durationMs };
    report.captures.push(record);
    if (read?.at) secrets.add(read.at);
    if (read && request.method === 'POST') {
      record.calls = read.calls.map(call => {
        try { return { rpc: call[0], arguments: JSON.parse(call[1]) }; }
        catch { return { rpc: call[0], arguments: call[1] }; }
      });
      try { record.response = decodeBatch(text); record.candidates = describe(record.response.payloads, range.lo, range.hi); }
      catch (error) { record.parseError = String(error); }
      if (statusCode === 200 && !halted) { template = request.clone(); replayButton.disabled = false; }
    } else record.metadataOnly = true;
    status.textContent = `${report.captures.length} batch captures; ${template ? 'history read available for replay' : 'waiting for a supported history read'}.`;
    if ([401, 403, 429].includes(statusCode) || statusCode >= 500) {
      status.textContent = `HTTP ${statusCode}; stopped.`;
      await httpError(statusCode);
    }
  }
  async function safeRecord(request, response, start) {
    if (isBatch(request.url)) await record(request, await response.clone().text(), response.status, performance.now() - start);
  }
  const fetchWrapper = function(input, init) {
    let request;
    try {
      const url = input instanceof Request ? input.url : String(input);
      if (recording && isBatch(url)) request = new Request(input instanceof Request ? input.clone() : input, init);
    } catch (error) { report.errors.push(`Capture skipped: ${error}`); }
    const start = performance.now();
    return originalFetch.call(this, input, init).then(response => {
      if (recording && request) track(safeRecord(request, response, start));
      return response;
    });
  };
  window.fetch = fetchWrapper;
  function openWrapper(method, url, ...rest) { metadata.set(this, { method, url: new URL(url, location.href).href, headers: [] }); return xhr.open.call(this, method, url, ...rest); }
  function headerWrapper(name, value) { metadata.get(this)?.headers.push([name, value]); return xhr.header.call(this, name, value); }
  function sendWrapper(body) {
    const m = metadata.get(this);
    if (recording && m && isBatch(m.url)) {
      const start = performance.now();
      try {
        const request = new Request(m.url, { method: m.method, headers: m.headers, body, credentials: 'same-origin' });
        this.addEventListener('loadend', () => {
          if (!this.responseType || this.responseType === 'text') track(record(request, this.responseText, this.status, performance.now() - start));
        }, { once: true });
      } catch (error) { report.errors.push(`Capture skipped: ${error}`); }
    }
    return xhr.send.call(this, body);
  }
  XMLHttpRequest.prototype.open = openWrapper;
  XMLHttpRequest.prototype.setRequestHeader = headerWrapper;
  XMLHttpRequest.prototype.send = sendWrapper;

  // Access-policy check for the exact paths being benchmarked, including /item.
  async function accessPolicy(paths, signal) {
    const response = await originalFetch('/robots.txt', { credentials: 'omit', redirect: 'error', signal });
    report.robotsStatus = response.status;
    await httpError(response.status, response.headers.get('Retry-After'));
    if ([404, 410].includes(response.status)) return { delay: OPTIONS.startGapMs };
    if (response.status !== 200) throw Error(`Cannot check robots.txt: HTTP ${response.status}.`);
    const text = await response.text();
    if (/<(?:!doctype|html)\b/i.test(text)) throw Error('robots.txt is not a rules file.');
    let agents = [], rules = [], groups = [], directives = false;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.split('#')[0].trim(); if (!line) continue;
      const match = line.match(/^([\w-]+)\s*:\s*(.*)$/); if (!match) throw Error('Unrecognized robots rule.');
      const key = match[1].toLowerCase(), value = match[2];
      if (key === 'user-agent') {
        if (directives) { groups.push({ agents, rules }); agents = []; rules = []; directives = false; }
        agents.push(value.toLowerCase());
      } else if (['allow', 'disallow', 'crawl-delay', 'request-rate'].includes(key)) { directives = true; rules.push({ key, value }); }
    }
    groups.push({ agents, rules });
    let delay = OPTIONS.startGapMs;
    for (const group of groups.filter(g => g.agents.some(a => a === '*' || 'ytmusichistory'.includes(a)))) {
      for (const rule of group.rules) {
        if (['allow', 'disallow'].includes(rule.key) && rule.value && !rule.value.startsWith('/')) throw Error('Invalid robots path.');
        if (rule.key === 'request-rate') throw Error('Request-rate directive needs review.');
        if (rule.key === 'crawl-delay') {
          if (!/^\d+(?:\.\d+)?$/.test(rule.value)) throw Error('Invalid crawl-delay.');
          delay = Math.max(delay, Number(rule.value) * 1000);
        }
      }
      for (const path of paths) {
        const matches = group.rules.filter(rule => ['allow', 'disallow'].includes(rule.key) && rule.value).map(rule => {
          const anchored = rule.value.endsWith('$');
          const raw = anchored ? rule.value.slice(0, -1) : rule.value;
          const regex = '^' + raw.split('*').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + (anchored ? '$' : '');
          return { ...rule, length: raw.replaceAll('*', '').length, matches: new RegExp(regex).test(path) };
        }).filter(rule => rule.matches).sort((a,b) => b.length-a.length || (a.key === 'allow' ? -1 : 1));
        if (matches[0]?.key === 'disallow') throw Error(`robots.txt disallows ${path}.`);
      }
    }
    return { delay };
  }

  async function savedRate(update) {
    return new Promise((resolve, reject) => {
      let absent = false;
      const request = indexedDB.open('yt-music-history-extractor-v1');
      request.onupgradeneeded = () => { absent = true; request.transaction.abort(); };
      request.onerror = () => absent ? resolve(null) : reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('control')) { db.close(); resolve(null); return; }
        const transaction = db.transaction('control', update ? 'readwrite' : 'readonly');
        const store = transaction.objectStore('control');
        const q = store.get('rate');
        let value;
        q.onsuccess = () => {
          value = update ? update(q.result || {}) : q.result;
          if (update) store.put(value, 'rate');
        };
        transaction.oncomplete = () => { db.close(); resolve(value); };
        transaction.onabort = () => { db.close(); reject(transaction.error); };
        q.onerror = () => { db.close(); reject(q.error); };
      };
    });
  }

  async function runReads(items, makeRequest, destination) {
    if (halted) throw Error('A previous access/throttle error stopped the tool. Do not retry until it is resolved.');
    if (active) throw Error('A benchmark is already running.');
    if (!navigator.locks) throw Error('Web Locks support is required.');
    active = new AbortController(); const signal = active.signal;
    probeButton.disabled = true; replayButton.disabled = true;
    try {
      await navigator.locks.request('yt-music-history-extractor', { ifAvailable: true }, async lock => {
        if (!lock) throw Error('Pause the old extractor first.');
        const rate = await savedRate();
        const cooldown = Math.max(rate?.cooldownUntil || 0, Number(localStorage.getItem('yt-music-history-network-cooldown')) || 0);
        if (cooldown > Date.now()) throw Error(`Existing throttle cooldown until ${new Date(cooldown).toISOString()}.`);
        const paths = items.map(item => { const u = new URL(item.url); return u.pathname + u.search; });
        const policyTimer = setTimeout(() => active?.abort(), OPTIONS.timeoutMs);
        let policy;
        try { policy = await accessPolicy(paths, signal); }
        finally { clearTimeout(policyTimer); }
        let gate = Promise.resolve(), lastStart = Date.now();
        function paced() {
          const turn = gate.then(async () => {
            const wait = Math.max(0, lastStart + policy.delay - Date.now());
            if (wait) await new Promise((resolve, reject) => {
              const abort = () => { clearTimeout(timer); reject(Error('Stopped.')); };
              const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, wait);
              signal.addEventListener('abort', abort, { once: true });
              if (signal.aborted) abort();
            });
            if (signal.aborted) throw Error('Stopped.');
            lastStart = Date.now();
            await savedRate(rate => ({ ...rate, lastActionAt: lastStart }));
          });
          gate = turn.catch(() => {}); return turn;
        }
        await pool(items, OPTIONS.concurrency, async item => {
          await paced();
          const result = { label: item.label || `${item.variant}/${item.window}`, endpoint: endpoint(item.url),
            startedAt: new Date().toISOString() };
          destination.push(result);
          const controller = new AbortController();
          const abort = () => controller.abort(); signal.addEventListener('abort', abort, { once: true });
          const timer = setTimeout(() => controller.abort(), OPTIONS.timeoutMs);
          const start = performance.now();
          try {
            const request = makeRequest(item);
            const response = await originalFetch(request, { signal: controller.signal });
            result.status = response.status;
            await httpError(response.status, response.headers.get('Retry-After'));
            const text = await response.text();
            result.durationMs = performance.now() - start;
            result.bytes = new TextEncoder().encode(text).length;
            result.response = parseResponse(text, response.headers.get('Content-Type') || '', item.lo ?? range.lo, item.hi ?? range.hi);
            status.textContent = `${destination.length}/${items.length} reads; last response ${Math.round(result.durationMs)}ms (${result.response.format}).`;
          } catch (error) {
            result.error = String(error); result.durationMs = performance.now() - start;
            // Unsupported legacy routes/undecodable responses are reported, not retried.
            if (halted || controller.signal.aborted || signal.aborted) { active?.abort(); throw error; }
          } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
        }, signal);
      });
    } finally { active = null; probeButton.disabled = halted; replayButton.disabled = halted || !template; }
  }

  async function download() {
    await Promise.allSettled([...pending]);
    if (report.reference) {
      for (const result of [...report.probes, ...report.captures, ...report.replays]) {
        const params = result.endpoint?.params || {};
        const window = params.min && params.max ? { lo: Number(BigInt(params.min)) / 1000, hi: Number(BigInt(params.max) + 1n) / 1000 } : null;
        const candidates = result.response?.timestampCandidates || result.candidates?.timestampCandidates || [];
        result.referenceComparison = compareReference(candidates, report.reference.events, window);
      }
    }
    const output = sanitized(report, [...secrets]);
    const url = URL.createObjectURL(new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'myactivity-network-report.json';
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
    window.myActivityNetworkReport = output;
  }
  probeButton.onclick = () => runReads(probes(location.href), item => new Request(item.url,
    { credentials: 'same-origin', redirect: 'error', cache: 'no-store' }), report.probes)
    .catch(error => { status.textContent = String(error); report.errors.push(String(error)); })
    .finally(download);
  replayButton.onclick = () => {
    if (!template) return;
    return runReads([{ label: 'captured-history-read', url: template.url }], () => template.clone(), report.replays)
      .catch(error => { status.textContent = String(error); report.errors.push(String(error)); }).finally(download);
  };
  downloadButton.onclick = download;
  referenceFile.onchange = async () => {
    try {
      const file = referenceFile.files[0]; if (!file) return;
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.events) || !data.events.length || !data.events.every(event =>
        typeof event.videoId === 'string' && Number.isFinite(Date.parse(event.timeIntervalUTC?.start)) &&
        Date.parse(event.timeIntervalUTC?.start) < Date.parse(event.timeIntervalUTC?.endExclusive))) throw Error('Select a valid extractor export with bounded events.');
      report.reference = { filename: file.name, events: data.events.map(event => ({ videoId: event.videoId, timeIntervalUTC: event.timeIntervalUTC })) };
      status.textContent = `Loaded ${report.reference.events.length} reference intervals. Probes/downloads will compare their timestamp candidates.`;
    } catch (error) { status.textContent = String(error); }
    finally { referenceFile.value = ''; }
  };
  stopButton.onclick = () => {
    halted = true; active?.abort(); recording = false;
    if (window.fetch === fetchWrapper) window.fetch = originalFetch;
    if (XMLHttpRequest.prototype.open === openWrapper) XMLHttpRequest.prototype.open = xhr.open;
    if (XMLHttpRequest.prototype.send === sendWrapper) XMLHttpRequest.prototype.send = xhr.send;
    if (XMLHttpRequest.prototype.setRequestHeader === headerWrapper) XMLHttpRequest.prototype.setRequestHeader = xhr.header;
    probeButton.disabled = true; replayButton.disabled = true;
    status.textContent = 'Stopped. Network hooks restored; use Download JSON to save captured data.';
  };
  window.myActivityNetwork = { download, stop: stopButton.onclick };
})();
