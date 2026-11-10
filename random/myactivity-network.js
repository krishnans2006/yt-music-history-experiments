// Paste on your logged-in My Activity YouTube page, after pausing the old extractor.
// Probe current route fetches three historical queries without navigating/rendering.
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

  // These positions come from the captured live y3VFHd response, not a guessed API.
  function historyPage(payload) {
    if (!Array.isArray(payload) || payload.length !== 2 ||
        !(payload[0] === null || Array.isArray(payload[0])) ||
        !(payload[1] == null || typeof payload[1] === 'string')) throw Error('Unrecognized history-page envelope.');
    const events = [], excluded = [], rows = payload[0] || [];
    for (const [index, row] of rows.entries()) {
      if (!Array.isArray(row) || !Number.isSafeInteger(row[4]) || row[4] <= 0 ||
          typeof row[5] !== 'string' || !row[5] || !Array.isArray(row[9])) throw Error(`Unrecognized history row ${index}.`);
      const label = row[7]?.[0], secondaryLabel = row[18]?.[0];
      const [title, , action, url] = row[9];
      const us = BigInt(row[4]);
      const timeUTC = new Date(Number(us / 1000n)).toISOString().replace(/\.\d{3}Z$/, `.${(us % 1000000n).toString().padStart(6, '0')}Z`);
      let videoId = null, hostname = null;
      try {
        const parsed = new URL(url); hostname = parsed.hostname;
        if (parsed.protocol === 'https:' && ['music.youtube.com', 'www.youtube.com', 'youtube.com'].includes(hostname) && parsed.pathname === '/watch') videoId = parsed.searchParams.get('v');
      } catch { /* Retain explicit Music rows even if their media URL is unavailable. */ }
      const isMusic = label === 'YouTube Music' || secondaryLabel === 'YouTube Music' || hostname === 'music.youtube.com';
      if (!isMusic || action !== 'Watched') { excluded.push({ index, label, action }); continue; }
      events.push({ source: 'myactivity-y3VFHd', sourceRow: index, eventId: row[5],
        timestampMicroseconds: us.toString(), timeUTC, videoId, title, url: url || null,
        app: 'YouTube Music', appEvidence: { label, secondaryLabel, hostname },
        durationLabel: row[23]?.[1] || null,
        channels: (row[32] || []).map(channel => ({ name: channel[1], url: channel[3] })),
        devices: (row[19] || []).map(device => device[0]) });
    }
    // Do not merge by recording, day, or displayed minute: separate activity IDs survive.
    return { rowCount: rows.length, musicCount: events.length, events, excluded,
      continuation: payload[1] || null, exhausted: !payload[1] };
  }

  function auditHistoryRange(payloads, pageURL) {
    const url = new URL(pageURL);
    const minimum = url.searchParams.get('min'), maximum = url.searchParams.get('max');
    if (minimum === null || maximum === null) return { boundedPage: false };
    if (!/^\d+$/.test(minimum) || !/^\d+$/.test(maximum) || BigInt(minimum) > BigInt(maximum)) throw Error('Invalid page time bounds.');
    const pages = payloads.map(historyPage);
    const times = payloads.flatMap(payload => (payload[0] || []).map(row => BigInt(row[4])));
    const outside = times.filter(time => time < BigInt(minimum) || time > BigInt(maximum));
    return { boundedPage: true, minMicroseconds: minimum, maxMicroseconds: maximum,
      rowCount: times.length, musicCount: pages.reduce((count, page) => count + page.musicCount, 0),
      outsideRequestedRange: outside.length, allReturnedRowsInRange: outside.length === 0,
      oldestMicroseconds: times.length ? times.reduce((a,b) => a < b ? a : b).toString() : null,
      newestMicroseconds: times.length ? times.reduce((a,b) => a > b ? a : b).toString() : null,
      note: 'Checks the response against the page URL. In-range rows do not by themselves prove complete repeat recovery.' };
  }

  // Initial RPC arguments can be embedded in Google's declarative request map.
  // Decode literal arrays only; never evaluate downloaded JavaScript.
  function historyRequests(html) {
    const requests = [];
    for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
      const pattern = /\bAF_dataServiceRequests\s*=\s*\{/g;
      let match;
      while ((match = pattern.exec(script[1]))) {
        const object = balanced(script[1], script[1].indexOf('{', match.index));
        pattern.lastIndex = object.end;
        const keys = new Set([...object.text.matchAll(/["'](ds:\d+)["']\s*:/g)].map(value => value[1]));
        for (const key of keys) {
          const spec = member(object.text, key);
          if (!spec?.startsWith('{')) continue;
          const id = member(spec, 'id');
          if (!id || id.slice(1, -1) !== READ_RPC) continue;
          const raw = member(spec, 'request');
          if (!raw) throw Error('History request has no literal arguments.');
          const args = JSON.parse(raw);
          if (!Array.isArray(args)) throw Error('History request arguments are not an array.');
          requests.push({ key, rpc: READ_RPC, arguments: args });
        }
      }
    }
    return requests;
  }

  async function historyRequest(template, args) {
    const read = readCalls(await template.clone().text());
    if (!read || read.calls.length !== 1 || template.method !== 'POST') throw Error('A single captured history POST is required.');
    const form = new URLSearchParams(await template.clone().text());
    const call = [...read.calls[0]]; call[1] = JSON.stringify(args);
    form.set('f.req', JSON.stringify([[call]]));
    const headers = new Headers(template.headers); headers.delete('content-length');
    return new Request(template.url, { method: 'POST', headers, body: form.toString(), credentials: 'same-origin', redirect: 'error' });
  }

  function describe(data, lo, hi) {
    const videoURLs = [], timestampCandidates = [];
    function visit(value, path) {
      // Observed My Activity timestamps use [epoch seconds, nanoseconds]. Keep
      // the fraction: dropping it caused false negatives against narrow brackets.
      if (Array.isArray(value) && value.length === 2 && value.every(Number.isSafeInteger) && value[1] >= 0 && value[1] < 1000000000) {
        const nanoseconds = BigInt(value[0]) * 1000000000n + BigInt(value[1]);
        if (nanoseconds >= BigInt(lo) * 1000000n && nanoseconds < BigInt(hi) * 1000000n) {
          const utc = new Date(value[0] * 1000).toISOString().replace('.000Z', `.${String(value[1]).padStart(9, '0')}Z`);
          timestampCandidates.push({ path, value, possibleUnit: 'seconds+nanoseconds', utc, epochNanoseconds: nanoseconds.toString() });
          return;
        }
      }
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

  function serverWatchLinks(html) {
    const text = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
    const links = [];
    const entities = value => value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ');
    for (const match of text.matchAll(/<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>/gi)) {
      try {
        const url = new URL(entities(match[2]), origin);
        if (!['youtube.com', 'www.youtube.com', 'music.youtube.com'].includes(url.hostname) || url.pathname !== '/watch' || !url.searchParams.has('v')) continue;
        const context = entities(text.slice(Math.max(0, match.index - 700), match.index + match[0].length + 700).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
        links.push({ videoId: url.searchParams.get('v'), url: url.href, context });
      } catch { /* Not a usable watch URL. */ }
    }
    return links;
  }

  function parseResponse(text, type, lo, hi) {
    if (/html/i.test(type) || /^\s*(?:<!doctype|<html)/i.test(text)) {
      const decoded = bootstrap(text);
      const activity = decoded.blocks.filter(block => block.key === 'ds:5' || /youtube|y3VFHd/i.test(JSON.stringify(block.data)));
      return { format: 'html-bootstrap', title: text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1],
        bootstrapBlockCount: decoded.blocks.length, activityBlocks: activity, parseErrors: decoded.errors,
        bootstrapInventory: decoded.blocks.map((block, index) => ({ index, key: block.key,
          retained: activity.includes(block), ...describe(block.data, lo, hi) })),
        serverWatchLinks: serverWatchLinks(text), historyRequests: historyRequests(text), ...describe(decoded.blocks, lo, hi) };
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

  function waitFor(ms, signal) {
    return new Promise((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(Error('Stopped.')); };
      const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
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
        const time = candidate.epochNanoseconds !== undefined ? BigInt(candidate.epochNanoseconds) : BigInt(Date.parse(candidate.utc)) * 1000000n;
        return time >= BigInt(Date.parse(event.timeIntervalUTC.start)) * 1000000n && time < BigInt(Date.parse(event.timeIntervalUTC.endExclusive)) * 1000000n;
      }) }));
    return { expectedIntervals: expected.length, intervalsWithTimestampCandidates: matches.filter(match => match.timestampCandidates.length).length,
      matches, note: 'Interval matches are protocol evidence, not verified event/video associations. Numeric fields can be metadata; confirm the response schema before counting listens.' };
  }

  function productTimestamp(response) {
    const block = response?.activityBlocks?.find(block => block.key === 'ds:5');
    if (!block || !Array.isArray(block.data)) throw Error('The filtered product-summary block is missing.');
    const rows = block.data[0];
    if (rows == null) return null;
    if (!Array.isArray(rows) || rows.some(row => !Array.isArray(row))) throw Error('Unrecognized product-summary structure.');
    const youtube = rows.filter(row => row[0] === 26);
    if (!youtube.length) return null;
    if (youtube.length !== 1) throw Error('Multiple YouTube summaries; cursor semantics need review.');
    const pair = youtube[0][4];
    if (pair == null) return null;
    if (!Array.isArray(pair) || pair.length !== 2 || !pair.every(Number.isSafeInteger) || pair[1] < 0 || pair[1] >= 1000000000) throw Error('Unrecognized native timestamp.');
    if (pair[0] === 0 && pair[1] === 0) return null;
    return { value: pair, epochNanoseconds: (BigInt(pair[0]) * 1000000000n + BigInt(pair[1])).toString(),
      utc: new Date(pair[0] * 1000).toISOString().replace('.000Z', `.${String(pair[1]).padStart(9, '0')}Z`) };
  }

  function cursorStep(timestamp, minUs, maxUs, events, seen) {
    const ns = timestamp === null ? null : BigInt(timestamp.epochNanoseconds);
    if (ns === null || ns < BigInt(minUs) * 1000n) {
      if (seen.length !== events.length) throw Error(`Cursor ended after ${seen.length}/${events.length} reference intervals.`);
      return { complete: true, termination: ns === null ? 'summary-absent' : 'before-lower-bound' };
    }
    if (ns > BigInt(maxUs) * 1000n) throw Error('Summary time is outside the requested cursor bounds.');
    const matches = events.map((event, index) => ({ event, index })).filter(({ event }) =>
      ns >= BigInt(Date.parse(event.timeIntervalUTC.start)) * 1000000n && ns < BigInt(Date.parse(event.timeIntervalUTC.endExclusive)) * 1000000n);
    if (matches.length !== 1) throw Error('Timestamp does not match exactly one known reference interval.');
    const { event, index } = matches[0];
    if (seen.includes(index)) throw Error('A reference interval returned more than one timestamp; review possible finer-grained events.');
    // Largest whole-microsecond upper bound strictly below the native timestamp.
    const nextMaxUs = ((ns - 1n) / 1000n).toString();
    if (BigInt(nextMaxUs) >= BigInt(maxUs)) throw Error('Cursor did not move backward.');
    return { complete: false, referenceIndex: index, referenceVideoId: event.videoId,
      referenceInterval: event.timeIntervalUTC, nextMaxUs };
  }

  const core = { OPTIONS, balanced, member, bootstrap, decodeBatch, readCalls, historyPage, auditHistoryRange, historyRequests, historyRequest, describe, serverWatchLinks, parseResponse, probes, pool, sanitized, compareReference, productTimestamp, cursorStep };
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
  const cursorButton = add('button', 'Recover reference interval (fast)'); cursorButton.disabled = true;
  const captureButton = add('button', 'Capture live history request');
  const historyButton = add('button', 'Probe historical records');
  const currentButton = add('button', 'Probe current route (3 reads)');
  const probeButton = add('button', 'Probe APIs (9 reads)');
  const replayButton = add('button', 'Replay captured history read'); replayButton.disabled = true;
  const stopButton = add('button', 'Stop');
  const downloadButton = add('button', 'Download JSON');
  const referenceFile = add('input', ''); referenceFile.type = 'file'; referenceFile.accept = '.json,application/json';
  referenceFile.setAttribute('aria-label', 'Optional reference extractor export');
  const status = add('p', 'Listening for history read requests. Probes use fetch, not page navigation.');
  document.body.append(panel);
  const range = { lo: Date.parse('2024-12-07T04:00Z'), hi: Date.parse('2024-12-07T04:40Z') };
  function busyControls(busy) {
    referenceFile.disabled = busy;
    cursorButton.disabled = busy || halted || !report.reference?.emptyControl;
    captureButton.disabled = historyButton.disabled = currentButton.disabled = probeButton.disabled = busy || halted;
    replayButton.disabled = busy || halted || !template;
  }

  function endpoint(url) {
    const u = new URL(url, location.href);
    const allowed = ['rpcids', 'authuser', 'source-path', 'min', 'max', 'restrict', 'jspb'];
    return { path: u.pathname, params: Object.fromEntries([...u.searchParams].filter(([key]) => allowed.includes(key))) };
  }
  function isBatch(url) { const u = new URL(url, location.href); return u.origin === origin && u.pathname === RPC_PATH; }
  function track(promise) {
    let timer;
    const bounded = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(Error('History request capture timed out.')), OPTIONS.timeoutMs);
      Promise.resolve(promise).then(resolve, reject);
    });
    pending.add(bounded);
    bounded.catch(error => report.errors.push(String(error))).finally(() => { clearTimeout(timer); pending.delete(bounded); });
  }
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
  async function record(request, text, statusCode, durationMs, sourcePage) {
    if (!recording || report.captures.length >= OPTIONS.maxCaptures) return;
    let read;
    try { read = readCalls(await request.clone().text()); } catch { /* Unknown batch: metadata only. */ }
    const record = { capturedAt: new Date().toISOString(), endpoint: endpoint(request.url),
      sourcePage: endpoint(sourcePage), status: statusCode, durationMs };
    report.captures.push(record);
    if (read?.at) secrets.add(read.at);
    if (read && request.method === 'POST') {
      record.calls = read.calls.map(call => {
        try { return { rpc: call[0], arguments: JSON.parse(call[1]) }; }
        catch { return { rpc: call[0], arguments: call[1] }; }
      });
      try {
        record.response = decodeBatch(text); record.candidates = describe(record.response.payloads, range.lo, range.hi);
        try {
          record.historyPages = record.response.payloads.map(historyPage);
          record.rangeAudit = auditHistoryRange(record.response.payloads, sourcePage);
        }
        catch (error) { record.historyParseError = String(error); }
      }
      catch (error) { record.parseError = String(error); }
      if (statusCode === 200 && !halted) { template = request.clone(); replayButton.disabled = false; }
    } else record.metadataOnly = true;
    status.textContent = `${report.captures.length} batch captures; ${template ? 'history read available for replay' : 'waiting for a supported history read'}.`;
    if ([401, 403, 429].includes(statusCode) || statusCode >= 500) {
      status.textContent = `HTTP ${statusCode}; stopped.`;
      await httpError(statusCode);
    }
  }
  async function safeRecord(request, response, start, sourcePage) {
    if (isBatch(request.url)) await record(request, await response.clone().text(), response.status, performance.now() - start, sourcePage);
  }
  const fetchWrapper = function(input, init) {
    let request;
    try {
      const url = input instanceof Request ? input.url : String(input);
      if (recording && isBatch(url)) request = new Request(input instanceof Request ? input.clone() : input, init);
    } catch (error) { report.errors.push(`Capture skipped: ${error}`); }
    const start = performance.now(), sourcePage = location.href;
    const response = originalFetch.call(this, input, init);
    if (recording && request) track(response.then(result => safeRecord(request, result, start, sourcePage)));
    return response;
  };
  window.fetch = fetchWrapper;
  function openWrapper(method, url, ...rest) { metadata.set(this, { method, url: new URL(url, location.href).href, headers: [] }); return xhr.open.call(this, method, url, ...rest); }
  function headerWrapper(name, value) { metadata.get(this)?.headers.push([name, value]); return xhr.header.call(this, name, value); }
  function sendWrapper(body) {
    const m = metadata.get(this);
    if (recording && m && isBatch(m.url)) {
      const start = performance.now(), sourcePage = location.href;
      try {
        const request = new Request(m.url, { method: m.method, headers: m.headers, body, credentials: 'same-origin' });
        track(new Promise((resolve, reject) => this.addEventListener('loadend', () => {
          try {
            if (!this.responseType || this.responseType === 'text') Promise.resolve(record(request, this.responseText, this.status, performance.now() - start, sourcePage)).then(resolve, reject);
            else resolve();
          } catch (error) { reject(error); }
        }, { once: true })));
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
    if ([404, 410].includes(response.status)) return { delay: OPTIONS.startGapMs, assertAllowed() {} };
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
    const applicable = groups.filter(g => g.agents.some(a => a === '*' || 'ytmusichistory'.includes(a)));
    for (const group of applicable) {
      for (const rule of group.rules) {
        if (['allow', 'disallow'].includes(rule.key) && rule.value && !rule.value.startsWith('/')) throw Error('Invalid robots path.');
        if (rule.key === 'request-rate') throw Error('Request-rate directive needs review.');
        if (rule.key === 'crawl-delay') {
          if (!/^\d+(?:\.\d+)?$/.test(rule.value)) throw Error('Invalid crawl-delay.');
          delay = Math.max(delay, Number(rule.value) * 1000);
        }
      }
    }
    const assertAllowed = path => {
      for (const group of applicable) {
        const matches = group.rules.filter(rule => ['allow', 'disallow'].includes(rule.key) && rule.value).map(rule => {
          const anchored = rule.value.endsWith('$');
          const raw = anchored ? rule.value.slice(0, -1) : rule.value;
          const regex = '^' + raw.split('*').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + (anchored ? '$' : '');
          return { ...rule, length: raw.replaceAll('*', '').length, matches: new RegExp(regex).test(path) };
        }).filter(rule => rule.matches).sort((a,b) => b.length-a.length || (a.key === 'allow' ? -1 : 1));
        if (matches[0]?.key === 'disallow') throw Error(`robots.txt disallows ${path}.`);
      }
    };
    paths.forEach(assertAllowed);
    return { delay, assertAllowed };
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

  async function runReads(items, makeRequest, destination, afterRead) {
    if (halted) throw Error('A previous access/throttle error stopped the tool. Do not retry until it is resolved.');
    if (active) throw Error('A benchmark is already running.');
    if (!navigator.locks) throw Error('Web Locks support is required.');
    active = new AbortController(); const signal = active.signal;
    busyControls(true);
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
            if (wait) await waitFor(wait, signal);
            if (signal.aborted) throw Error('Stopped.');
            lastStart = Date.now();
            await savedRate(rate => ({ ...rate, lastActionAt: lastStart }));
          });
          gate = turn.catch(() => {}); return turn;
        }
        await pool(items, OPTIONS.concurrency, async item => {
          await paced();
          const target = new URL(item.url); policy.assertAllowed(target.pathname + target.search);
          const result = { label: item.label || `${item.variant}/${item.window}`, endpoint: endpoint(item.url),
            startedAt: new Date().toISOString() };
          destination.push(result);
          const controller = new AbortController();
          const abort = () => controller.abort(); signal.addEventListener('abort', abort, { once: true });
          const timer = setTimeout(() => controller.abort(), OPTIONS.timeoutMs);
          const start = performance.now();
          try {
            const request = await makeRequest(item);
            const response = await originalFetch(request, { signal: controller.signal });
            result.status = response.status;
            await httpError(response.status, response.headers.get('Retry-After'));
            const text = await response.text();
            result.durationMs = performance.now() - start;
            result.bytes = new TextEncoder().encode(text).length;
            result.response = parseResponse(text, response.headers.get('Content-Type') || '', item.lo ?? range.lo, item.hi ?? range.hi);
            if (afterRead) await afterRead(result, item, items);
            status.textContent = `${destination.length}/${items.length} reads; last response ${Math.round(result.durationMs)}ms (${result.response.format}).`;
          } catch (error) {
            result.error = String(error); result.durationMs = performance.now() - start;
            // Unsupported legacy routes/undecodable responses are reported, not retried.
            if (afterRead || halted || controller.signal.aborted || signal.aborted) { active?.abort(); throw error; }
          } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
        }, signal);
      });
    } finally { active = null; busyControls(false); }
  }

  async function download() {
    await Promise.allSettled([...pending]);
    if (report.reference) {
      for (const result of [...report.probes, ...report.captures, ...report.replays, ...(report.cursor?.requests || [])]) {
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
  currentButton.onclick = () => runReads(probes(location.href).filter(item => item.variant === 'page'), item => new Request(item.url,
    { credentials: 'same-origin', redirect: 'error', cache: 'no-store' }), report.probes)
    .catch(error => { status.textContent = String(error); report.errors.push(String(error)); }).finally(download);
  cursorButton.onclick = async () => {
    const reference = report.reference;
    if (!reference?.emptyControl) { status.textContent = 'Load the completed 40-minute Radioactive export first.'; return; }
    const cursor = report.cursor = { status: 'running', startedAt: new Date().toISOString(), expectedIntervals: reference.events.length,
      sourceIdentity: 'Product-level YouTube timestamp; song/app identity comes only from the loaded reference.', requests: [], observations: [], complete: false };
    const started = performance.now();
    const minUs = (BigInt(range.lo) * 1000n).toString();
    let maxUs = (BigInt(range.hi) * 1000n - 1n).toString();
    const seen = [];
    const task = (minimum, maximum, control = false) => {
      const url = new URL(location.href);
      url.searchParams.delete('jspb'); url.searchParams.set('min', minimum); url.searchParams.set('max', maximum);
      return { url: url.href, label: control ? 'cursor/empty-control' : `cursor/${seen.length + 1}`, control, minUs: minimum, maxUs: maximum,
        lo: Number(BigInt(minimum) / 1000n), hi: Number((BigInt(maximum) + 1000n) / 1000n) };
    };
    const control = reference.emptyControl;
    const items = [task((BigInt(control.lo) * 1000n).toString(), (BigInt(control.hi) * 1000n - 1n).toString(), true)];
    try {
      // One dependent task at a time. Future independent windows can run in parallel.
      await runReads(items, item => new Request(item.url, { credentials: 'same-origin', redirect: 'error', cache: 'no-store' }), cursor.requests,
        (result, item, queue) => {
          if (result.status !== 200) throw Error(`Cursor query HTTP ${result.status}.`);
          const time = productTimestamp(result.response);
          if (item.control) {
            if (time !== null && BigInt(time.epochNanoseconds) >= BigInt(item.minUs) * 1000n) throw Error('The known empty interval returned a summary at/after its lower bound. Stop to inspect empty-result semantics.');
            cursor.emptyControlVerified = time === null ? 'summary-absent' : 'summary-before-lower-bound';
            queue.push(task(minUs, maxUs)); return;
          }
          const step = cursorStep(time, item.minUs, item.maxUs, reference.events, seen);
          if (step.complete) { cursor.complete = true; cursor.status = 'matched-reference'; cursor.termination = step.termination; return; }
          seen.push(step.referenceIndex);
          cursor.observations.push({ timestamp: time, ...step });
          maxUs = step.nextMaxUs;
          if (BigInt(maxUs) < BigInt(minUs)) {
            if (seen.length !== reference.events.length) throw Error('Cursor reached the lower bound before matching every reference interval.');
            cursor.complete = true; cursor.status = 'matched-reference'; return;
          }
          queue.push(task(minUs, maxUs));
        });
      status.textContent = `Fast cursor matched ${seen.length}/${reference.events.length} intervals in ${Math.round((performance.now() - started) / 1000)}s.`;
    } catch (error) { cursor.status = 'stopped'; cursor.error = String(error); status.textContent = String(error); report.errors.push(String(error)); }
    finally { cursor.finishedAt = new Date().toISOString(); cursor.durationMs = performance.now() - started; await download(); }
  };
  replayButton.onclick = () => {
    if (!template) return;
    return runReads([{ label: 'captured-history-read', url: template.url }], () => template.clone(), report.replays)
      .catch(error => { status.textContent = String(error); report.errors.push(String(error)); }).finally(download);
  };
  downloadButton.onclick = download;
  captureButton.onclick = async (options = {}) => {
    if (active || halted) return;
    active = new AbortController(); const signal = active.signal;
    busyControls(true);
    const before = report.captures.length;
    const capture = report.liveCapture = { startedAt: new Date().toISOString(), status: 'running', scrollActions: 0 };
    try {
      if (!navigator.locks) throw Error('Web Locks support is required.');
      await navigator.locks.request('yt-music-history-extractor', { ifAvailable: true }, async lock => {
        if (!lock) throw Error('Pause the old extractor first.');
        const rate = await savedRate();
        const cooldown = Math.max(rate?.cooldownUntil || 0, Number(localStorage.getItem('yt-music-history-network-cooldown')) || 0);
        if (cooldown > Date.now()) throw Error(`Existing throttle cooldown until ${new Date(cooldown).toISOString()}.`);
        const timer = setTimeout(() => active?.abort(), OPTIONS.timeoutMs);
        let policy;
        try { policy = await accessPolicy([location.pathname + location.search, RPC_PATH], signal); }
        finally { clearTimeout(timer); }
        for (let i = 0; i < 3; i++) {
          if (signal.aborted) throw Error('Stopped.');
          const text = document.body.innerText || '';
          if (/unusual traffic|too many requests|verify (?:your identity|it.s you|you are human)|captcha|access denied|something went wrong/i.test(text)) throw Error('Page warning or verification detected. Stopped.');
          await waitFor(policy.delay, signal);
          await savedRate(rate => ({ ...rate, lastActionAt: Date.now() }));
          const scroller = document.scrollingElement || document.documentElement;
          window.scrollTo(0, scroller.scrollHeight); scroller.scrollTop = scroller.scrollHeight;
          capture.scrollActions++;
          status.textContent = `Waiting for the site's history request (${capture.scrollActions}/3 scrolls)…`;
          await waitFor(2500, signal);
          await Promise.allSettled([...pending]);
          if (report.captures.length > before && template) break;
        }
        capture.batchCapturesAdded = report.captures.length - before;
        capture.supportedHistoryReadCaptured = Boolean(template);
        capture.status = template ? 'captured-read' : 'no-supported-read';
        capture.renderedSnapshot = { text: (document.body.innerText || '').slice(0, 100000),
          watchLinks: [...document.querySelectorAll('a[href]')].flatMap(anchor => {
            try {
              const url = new URL(anchor.href);
              if (!['www.youtube.com', 'music.youtube.com', 'youtube.com'].includes(url.hostname) || url.pathname !== '/watch' || !url.searchParams.has('v')) return [];
              return [{ videoId: url.searchParams.get('v'), url: url.href, label: anchor.innerText || anchor.textContent || '' }];
            } catch { return []; }
          }) };
        status.textContent = template ? 'Captured a history read. JSON saved.' : 'No supported read observed. JSON saved for inspection.';
      });
    } catch (error) { capture.status = 'stopped'; capture.error = String(error); report.errors.push(String(error)); status.textContent = String(error); }
    finally { active = null; capture.finishedAt = new Date().toISOString(); busyControls(false); if (options.download !== false) await download(); }
  };
  historyButton.onclick = async () => {
    // A fresh capture supplies this session's private form token. No credentials are
    // loaded from a report, and the historical filter must come from the server.
    if (!template) await captureButton.onclick({ download: false });
    if (!template || halted || active) { await download(); return; }
    const probe = report.historicalRecords = { status: 'running', startedAt: new Date().toISOString(),
      rangeUTC: { start: new Date(range.lo).toISOString(), endExclusive: new Date(range.hi).toISOString() },
      expectedReferenceMusicCount: 12, requests: [] };
    const url = new URL(location.href);
    url.searchParams.delete('jspb'); url.searchParams.set('restrict', 'youtube');
    url.searchParams.set('min', (BigInt(range.lo) * 1000n).toString());
    url.searchParams.set('max', (BigInt(range.hi) * 1000n - 1n).toString());
    try {
      await runReads([{ label: 'historical/request-schema', url: url.href }],
        item => item.args ? historyRequest(template, item.args) : new Request(item.url, { credentials: 'same-origin', redirect: 'error', cache: 'no-store' }),
        probe.requests, (result, item, queue) => {
          if (result.status !== 200) throw Error(`Historical query HTTP ${result.status}.`);
          if (!item.args) {
            const specs = result.response.historyRequests || [];
            if (specs.length !== 1) throw Error(`Found ${specs.length} historical history-request specifications; no RPC arguments were guessed.`);
            const args = specs[0].arguments;
            // An unchanged unbounded filter cannot establish historical semantics.
            if (JSON.stringify(args[0]) === JSON.stringify([null, ['youtube']])) throw Error('The returned history request has no observed time filter.');
            probe.observedArguments = args;
            queue.push({ label: 'historical/history-records', url: template.url, args }); return;
          }
          const response = result.response;
          if (response.errorFrames?.length || response.payloads?.length !== 1) throw Error('The historical RPC returned errors or an unknown envelope.');
          const page = historyPage(response.payloads[0]);
          const min = BigInt(range.lo) * 1000n, max = BigInt(range.hi) * 1000n;
          if ((response.payloads[0][0] || []).some(row => BigInt(row[4]) < min || BigInt(row[4]) >= max)) throw Error('Historical RPC returned rows outside the requested time interval.');
          probe.page = page;
          probe.status = 'historical-records-received';
          probe.repeatRecoveryValidated = false;
          if (report.reference) probe.referenceComparison = compareReference(page.events.map(event => ({
            path: `row[${event.sourceRow}]`, epochNanoseconds: (BigInt(event.timestampMicroseconds) * 1000n).toString(), utc: event.timeUTC,
          })), report.reference.events, range);
        });
      status.textContent = `Historical RPC returned ${probe.page?.musicCount || 0} Music records; JSON saved. Repeat recovery still needs validation.`;
    } catch (error) { probe.status = 'stopped'; probe.error = String(error); status.textContent = String(error); report.errors.push(String(error)); }
    finally { probe.finishedAt = new Date().toISOString(); await download(); }
  };
  referenceFile.onchange = async () => {
    try {
      const file = referenceFile.files[0]; if (!file) return;
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.events) || !data.events.length || !data.events.every(event =>
        typeof event.videoId === 'string' && Number.isFinite(Date.parse(event.timeIntervalUTC?.start)) &&
        Date.parse(event.timeIntervalUTC?.start) < Date.parse(event.timeIntervalUTC?.endExclusive))) throw Error('Select a valid extractor export with bounded events.');
      report.reference = { filename: file.name, events: data.events.map(event => ({ videoId: event.videoId, timeIntervalUTC: event.timeIntervalUTC })) };
      if (data.coverage?.partitionComplete && data.run?.lo === range.lo && data.run?.hi === range.hi && data.events.every(event => event.videoId === '3Yb2-CWjrME')) {
        const empty = (data.queries || []).filter(query => !query.kind && query.terminal && !query.music?.length &&
          query.lo >= range.lo && query.hi <= range.hi && query.lo < query.hi && query.snapshots?.some(snapshot => snapshot.text.includes('No results.')))
          .sort((a,b) => (b.hi-b.lo) - (a.hi-a.lo))[0];
        if (empty) report.reference.emptyControl = { lo: empty.lo, hi: empty.hi };
      }
      cursorButton.disabled = halted || !report.reference.emptyControl;
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
    busyControls(false);
    status.textContent = 'Stopped. Network hooks restored; use Download JSON to save captured data.';
  };
  window.myActivityNetwork = { download, stop: stopButton.onclick };
})();
