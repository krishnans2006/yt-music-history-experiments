// Browser runtime. build-myactivity-fast.cjs embeds this with the pure helpers.
module.exports = async function boot(core) {
  'use strict';
  const OPTIONS = { gapMs: 500, concurrency: 5, timeoutMs: 45000, pollMs: 200, settleMs: 400 };
  if (!Number.isInteger(OPTIONS.concurrency) || OPTIONS.concurrency < 1 || !Number.isFinite(OPTIONS.gapMs) || OPTIONS.gapMs < 0) throw Error('Invalid worker count or request delay.');
  const { REFERENCE, nativePage, scopedURL, yearWindows, parsePointSnapshot, popupEvents, recordEvents, robotRules, validateReference } = core;
  if (location.origin !== 'https://myactivity.google.com' || location.pathname !== '/product/youtube') throw Error('Open your logged-in My Activity YouTube History page.');
  if (window.myActivityFast) throw Error('The fast exporter is already installed.');
  const base = new URL(location.href);
  for (const key of [...base.searchParams.keys()]) if (!['authuser', 'hl'].includes(key)) base.searchParams.delete(key);
  base.searchParams.set('restrict', 'youtube');
  const baseURL = base.href;
  const fetchRead = window.fetch.bind(window);
  // Existing session fields stay in memory; they never enter checkpoints.
  const wiz = window.WIZ_global_data;
  const rpcSession = typeof wiz?.SNlM0e === 'string' && typeof wiz?.FdrFJe === 'string'
    ? { at: wiz.SNlM0e, sid: wiz.FdrFJe, build: wiz.cfb2h } : null;
  const DB = 'yt-music-history-fast-v1', COOLDOWN = 'yt-music-history-network-cooldown';
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      for (const name of ['states', 'events', 'steps', 'control']) request.result.createObjectStore(name);
    };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  const get = (store, key) => new Promise((resolve, reject) => {
    const request = db.transaction(store).objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  async function write(callback, names = ['states', 'events', 'steps', 'control']) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(names, 'readwrite');
      transaction.oncomplete = resolve; transaction.onerror = transaction.onabort = () => reject(transaction.error || Error('Checkpoint transaction failed.'));
      try { callback(transaction); } catch (error) { transaction.abort(); reject(error); }
    });
  }
  let controller = null, popup = null, state = null, delayMs = OPTIONS.gapMs;
  let committedView = null, displayedRun = null;
  const activeRanges = new Map(), rangeRows = [];
  let policy = { allows: () => true }, gate = Promise.resolve(), popupGate = Promise.resolve();
  let commitGate = Promise.resolve(), commitFailure = null;
  let rpcBounds = {};
  let lastAction = (await get('control', 'rate'))?.lastActionAt || 0;
  let cooldownUntil = Math.max((await get('control', 'rate'))?.cooldownUntil || 0, Number(localStorage.getItem(COOLDOWN)) || 0);
  const legacy = await new Promise(resolve => {
    const request = indexedDB.open('yt-music-history-extractor-v1');
    request.onupgradeneeded = () => { request.transaction.abort(); };
    request.onerror = () => resolve(null);
    request.onsuccess = () => {
      const old = request.result;
      if (!old.objectStoreNames.contains('control')) { old.close(); resolve(null); return; }
      const q = old.transaction('control').objectStore('control').get('rate');
      q.onsuccess = () => { old.close(); resolve(q.result); }; q.onerror = () => { old.close(); resolve(null); };
    };
  });
  cooldownUntil = Math.max(cooldownUntil, legacy?.cooldownUntil || 0);
  lastAction = Math.max(lastAction, legacy?.lastActionAt || 0);
  const panel = document.createElement('div');
  panel.id = 'myactivity-fast';
  panel.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;background:white;color:black;border:2px solid #555;padding:16px;font:14px sans-serif;width:720px;max-width:calc(100vw - 68px);max-height:calc(100vh - 68px);overflow:auto';
  const add = (tag, text) => { const element = document.createElement(tag); element.textContent = text; panel.append(element); return element; };
  add('strong', 'Full past YouTube Music history');
  add('p', 'Includes repeated activity. First validates all 12 known Radioactive observations, then exports the range below.');
  add('label', 'Start UTC (inclusive)'); const startInput = add('input', ''); startInput.value = '1970-01-01T00:00:00.000Z';
  add('label', 'End UTC (exclusive)'); const endInput = add('input', ''); endInput.value = new Date().toISOString();
  const startButton = add('button', 'Validate & export / Resume');
  const pauseButton = add('button', 'Pause'); pauseButton.disabled = true;
  const saveButton = add('button', 'Download JSON');
  const status = add('p', rpcSession ? 'Ready. Bounded history API available; no popup is needed. The cutoff stays fixed on resume.'
    : 'Ready. The cutoff stays fixed on resume. Keep this tab and the fallback window open.');
  const validationStatus = add('p', 'Reference validation has not started.');
  const coverageStatus = add('p', 'Date-range progress appears when an export starts.');
  coverageStatus.style.fontSize = '12px';
  const rangeList = add('div', '');
  rangeList.style.cssText = 'max-height:280px;overflow:auto;border-top:1px solid #ddd';
  document.body.append(panel);
  const activeId = await get('control', 'active');
  if (activeId) {
    const saved = await get('states', activeId);
    if (saved?.baseURL === baseURL) {
      state = saved; startInput.value = state.startUTC; endInput.value = state.endUTC;
      // Checkpoints from before the range view have only the overall count.
      if (state.windows.some(window => window.musicCount === undefined)) {
        const events = await new Promise((resolve, reject) => {
          const request = db.transaction('events').objectStore('events').getAll();
          request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
        });
        const counts = new Map();
        for (const event of events) if (event.runId === state.id) {
          const year = new Date(Number(BigInt(event.timestampMicroseconds) / 1000n)).getUTCFullYear();
          counts.set(year, (counts.get(year) || 0) + 1);
        }
        for (const window of state.windows) window.musicCount = counts.get(new Date(Number(BigInt(window.lo) / 1000n)).getUTCFullYear()) || 0;
      }
      committedView = structuredClone(state);
    }
  }
  function utc(us) { return new Date(Number(BigInt(us) / 1000n)).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC'); }
  function rangeKey(window) { return `${window.lo}:${window.hi}`; }
  function renderRanges() {
    const view = committedView?.id === state?.id ? committedView : state;
    if (!view) return;
    const validation = view.validation;
    const checking = activeRanges.get(rangeKey(validation.window));
    validationStatus.textContent = validation.complete ? 'Reference validation: passed (12 listens and empty controls).'
      : `Reference validation: ${validation.events.length}/12 listens; ${checking?.phase || (view.status === 'stopped' ? 'stopped' : controller ? 'starting' : 'ready to resume')}${checking?.cursor ? ` at ${utc(checking.cursor)}` : ''}.`;
    if (displayedRun !== view.id) {
      displayedRun = view.id; rangeRows.length = 0; rangeList.replaceChildren();
      const table = document.createElement('table');
      table.style.cssText = 'border-collapse:collapse;width:100%;min-width:640px;font-size:12px;text-align:left';
      const head = document.createElement('thead'), headings = document.createElement('tr');
      for (const title of ['Date range (UTC)', 'Status', 'Cursor / activity (UTC)', 'Music', 'Calendar covered']) {
        const cell = document.createElement('th'); cell.textContent = title;
        cell.style.cssText = 'position:sticky;top:0;background:white;padding:6px 4px;border-bottom:1px solid #aaa'; headings.append(cell);
      }
      head.append(headings); table.append(head);
      const body = document.createElement('tbody'); table.append(body); rangeList.append(table);
      for (const [index, window] of view.windows.entries()) {
        const row = document.createElement('tr'); row.id = `myactivity-fast-range-${index}`;
        const cells = Array.from({ length: 5 }, () => { const cell = document.createElement('td'); cell.style.cssText = 'padding:6px 4px;border-bottom:1px solid #eee;vertical-align:top'; row.append(cell); return cell; });
        cells[0].textContent = `${utc(window.lo).slice(0, 10)} → ${utc(window.hi).slice(0, 10)}`;
        cells[0].title = `${utc(window.lo)} inclusive → ${utc(window.hi)} exclusive`;
        const bar = document.createElement('progress'); bar.max = 100; bar.style.cssText = 'display:block;width:105px;height:12px';
        bar.setAttribute('aria-label', `Calendar coverage ${cells[0].textContent}`);
        const percent = document.createElement('span'); cells[4].append(bar, percent);
        body.append(row); rangeRows.push({ row, status: cells[1], cursor: cells[2], count: cells[3], covered: cells[4], bar, percent });
      }
    }
    let total = 0n, covered = 0n;
    for (const [index, window] of view.windows.entries()) {
      const lo = BigInt(window.lo), hi = BigInt(window.hi);
      let next = window.done ? lo : BigInt(window.max) + 1n;
      if (next < lo) next = lo; if (next > hi) next = hi;
      const span = hi - lo, scanned = hi - next, percent = Number(scanned * 10000n / span) / 100;
      total += span; covered += scanned;
      const entry = rangeRows[index], active = activeRanges.get(rangeKey(window));
      entry.status.textContent = window.done ? 'Complete' : active ? active.phase
        : !validation.complete || !window.steps ? 'Queued' : controller && !controller.signal.aborted ? 'Queued'
        : view.status === 'stopped' ? 'Stopped' : 'Ready to resume';
      entry.row.style.background = active && !window.done ? '#eef6ff' : '';
      entry.cursor.textContent = window.done ? '—' : utc(active?.cursor || window.max);
      entry.cursor.title = `Committed next search upper bound: ${utc(window.max)}`;
      entry.count.textContent = String(window.musicCount || 0);
      entry.bar.value = percent; entry.percent.textContent = `${percent.toFixed(2)}%`;
      entry.covered.title = `Scanned: ${utc(next)} → ${utc(hi)} (end exclusive). Remaining: ${utc(lo)} → ${utc(next)} (end exclusive).`;
    }
    coverageStatus.textContent = `${view.windows.filter(window => window.done).length}/${view.windows.length} ranges complete · ${(Number(covered * 10000n / total) / 100).toFixed(2)}% of calendar time scanned. This is date coverage, not a percentage of listens.`;
  }
  function activity(window, phase, cursor = window.max) {
    activeRanges.set(rangeKey(window), { phase, cursor }); renderRanges();
  }
  function busy(value) { startButton.disabled = startInput.disabled = endInput.disabled = value; pauseButton.disabled = !value; }
  function progress() {
    if (!state) return;
    status.textContent = state.validation.complete
      ? `${state.musicCount} Music observations; ${state.steps} cursor steps; ${state.windows.filter(w => w.done).length}/${state.windows.length} year ranges finished. ${state.popupSteps} popup fallbacks.`
      : `Validating: ${state.validation.events.length}/12 Music observations identified.`;
    renderRanges();
  }
  if (state) progress();
  function abortCheck(signal) { if (signal.aborted) throw Error('Paused.'); }
  function wait(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) { reject(Error('Paused.')); return; }
      const finish = () => { signal.removeEventListener('abort', abort); resolve(); };
      const timer = setTimeout(finish, ms);
      const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(Error('Paused.')); };
      signal.addEventListener('abort', abort, { once: true });
    });
  }
  function pace(signal) {
    const next = gate.then(async () => {
      abortCheck(signal);
      if (cooldownUntil > Date.now()) throw Error(`Throttle cooldown until ${new Date(cooldownUntil).toISOString()}.`);
      const remaining = lastAction + delayMs - Date.now(); if (remaining > 0) await wait(remaining, signal);
      lastAction = Date.now();
      await write(tx => tx.objectStore('control').put({ lastActionAt: lastAction, cooldownUntil }, 'rate'), ['control']);
    });
    gate = next.catch(() => {}); return next;
  }
  async function http(response) {
    if ([429, 503].includes(response.status)) {
      const header = response.headers.get('Retry-After');
      const until = /^\d+$/.test(header || '') ? Date.now() + Number(header) * 1000 : Date.parse(header);
      cooldownUntil = Math.max(Date.now() + 86400000, Number.isFinite(until) ? until : 0);
      localStorage.setItem(COOLDOWN, String(cooldownUntil));
      await write(tx => tx.objectStore('control').put({ lastActionAt: lastAction, cooldownUntil }, 'rate'), ['control']);
    }
    if ([401, 403, 429].includes(response.status) || response.status >= 500) throw Error(`HTTP ${response.status}; stopped without retrying.`);
  }
  async function read(url, signal, robots = false, init = {}) {
    if (!robots && !policy.allows(url)) throw Error('robots.txt disallows the history query.');
    await pace(signal);
    const requestController = new AbortController();
    const abort = () => requestController.abort(); signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, OPTIONS.timeoutMs), started = performance.now();
    try {
      const response = await fetchRead(url, { ...init, credentials: robots ? 'omit' : 'same-origin', redirect: 'error', cache: 'no-store', signal: requestController.signal });
      await http(response);
      const text = await response.text();
      if (!robots && response.status !== 200) throw Error(`History query HTTP ${response.status}.`);
      return { status: response.status, text, durationMs: performance.now() - started, bytes: new TextEncoder().encode(text).length };
    } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
  }
  async function rpcLatest(minimum, maximum, signal, rawBounds = false, singlePage = false) {
    const url = new URL('/_/FootprintsMyactivityUi/data/batchexecute', baseURL);
    url.searchParams.set('rpcids', 'y3VFHd'); url.searchParams.set('source-path', '/product/youtube');
    url.searchParams.set('f.sid', rpcSession.sid); url.searchParams.set('rt', 'c');
    if (rpcSession.build) url.searchParams.set('bl', rpcSession.build);
    if (base.searchParams.has('authuser')) url.searchParams.set('authuser', base.searchParams.get('authuser'));
    url.searchParams.set('hl', base.searchParams.get('hl') || 'en');
    let continuation = null, newest = null, bytes = 0, durationMs = 0, pages = 0, emptyConfirmedByNativeGET = false;
    const seenTokens = new Set(), records = new Map();
    do {
      const semantics = rawBounds ? {} : { ...rpcBounds };
      // Some endpoints reject equal bounds even when inclusion is otherwise
      // inclusive. Extending only the lower bound cannot hide a newer listen.
      const overscan = minimum === maximum && !semantics.lowerExclusive && !semantics.upperExclusive;
      if (overscan) semantics.lowerOverscan = true;
      const args = core.boundedHistoryArgs(minimum, maximum, continuation, semantics);
      state.diagnostics.lastRPC = { minMicroseconds: minimum, maxMicroseconds: maximum,
        arguments: args, pageNumber: pages + 1, phase: state.validation.complete ? 'history' : 'validation',
        purpose: singlePage ? 'boundary-control' : 'latest-timestamp' };
      const body = new URLSearchParams({ at: rpcSession.at,
        'f.req': JSON.stringify([[['y3VFHd', JSON.stringify(args), null, 'generic']]]) });
      const response = await read(url.href, signal, false, { method: 'POST', body,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' } });
      pages++; bytes += response.bytes; durationMs += response.durationMs;
      let page;
      try {
        page = core.boundedHistoryPage(response.text, overscan && BigInt(minimum) > 0n ? (BigInt(minimum) - 1n).toString() : minimum, maximum,
          { allowEmptyContinuation: true });
      } catch (error) {
        let decoded;
        try { decoded = core.decodeBatch(response.text); } catch (decodeError) { decoded = { parseError: String(decodeError) }; }
        state.diagnostics.rpcFailure = core.sanitized({ minMicroseconds: minimum, maxMicroseconds: maximum,
          arguments: args, httpStatus: response.status, serviceStatus: error.rpcStatus ?? null,
          pageNumber: pages, responseBytes: response.bytes, error: String(error), decoded }, [rpcSession.at, rpcSession.sid]);
        if (error.rpcStatus === 8) {
          cooldownUntil = Math.max(cooldownUntil, Date.now() + 86400000);
          localStorage.setItem(COOLDOWN, String(cooldownUntil));
          await write(tx => tx.objectStore('control').put({ lastActionAt: lastAction, cooldownUntil }, 'rate'), ['control']);
        }
        throw error;
      }
      if (overscan && page.rows.some(row => BigInt(row[4]) < BigInt(minimum))) {
        page.rows = page.rows.filter(row => BigInt(row[4]) >= BigInt(minimum));
        page.continuation = null; // Sorted rows have passed the logical interval.
      }
      if (!page.rows.length) {
        if (page.continuation && !singlePage) {
          if (newest !== null) throw Error('History RPC left a timestamp group unresolved; the cursor was not advanced.');
          const check = await read(scopedURL(baseURL, minimum, maximum), signal);
          if (!nativePage(check.text, minimum, maximum).empty) throw Error('Empty history RPC page disagrees with the native summary; the cursor was not advanced.');
          emptyConfirmedByNativeGET = true;
        }
        break;
      }
      if (newest === null) newest = String(page.rows[0][4]);
      let added = 0;
      for (const row of page.rows) {
        if (BigInt(row[4]) > BigInt(newest)) throw Error('History RPC pagination moved forward in time.');
        if (String(row[4]) === newest) {
          const key = `${row[4]}:${row[5]}`;
          if (!records.has(key)) { records.set(key, row); added++; }
        }
      }
      // A presence/empty control must not page beyond its tiny interval. For
      // history, page again only if an entire full page shares the newest time;
      // older observations are retrieved by the next backward-bound query.
      if (singlePage || page.rows.length < args[2] || String(page.rows.at(-1)[4]) !== newest || !page.continuation) break;
      if (!added || seenTokens.has(page.continuation)) throw Error('History RPC continuation did not progress.');
      seenTokens.add(page.continuation); continuation = page.continuation;
    } while (continuation);
    const receipt = { min: minimum, max: maximum, identity: 'bounded-history-rpc', durationMs,
      responseBytes: bytes, rpcPages: pages, empty: newest === null, timestamp: null };
    if (emptyConfirmedByNativeGET) receipt.emptyConfirmedByNativeGET = true;
    if (newest === null) return { events: [], receipt, done: true, nextMaximum: maximum };
    const native = core.rpcNative(newest, [...records.values()]);
    receipt.timestamp = native.timestamp;
    return { native, events: recordEvents(native).map(event => ({ ...event,
      evidence: { identity: 'bounded-history-rpc', minMicroseconds: minimum, maxMicroseconds: maximum } })), receipt,
      done: BigInt(native.nextMaximum) < BigInt(minimum), nextMaximum: native.nextMaximum };
  }
  function snapshot(doc) {
    return { capturedAt: new Date().toISOString(), text: doc.body.innerText,
      watchLinks: [...doc.querySelectorAll('a[href]')].flatMap(anchor => {
        try {
          let url = new URL(anchor.href);
          if (url.hostname === 'www.google.com' && url.pathname === '/url') url = new URL(url.searchParams.get('q') || url.searchParams.get('url'));
          if (!['music.youtube.com', 'www.youtube.com', 'youtube.com'].includes(url.hostname) || url.pathname !== '/watch') return [];
          const videoId = url.searchParams.get('v');
          return videoId ? [{ videoId, url: url.href, label: anchor.innerText || anchor.textContent || '' }] : [];
        } catch { return []; }
      }) };
  }
  function pointIdentity(native, signal, expectEmpty = false, phase = () => {}) {
    let lastSnapshot = null;
    phase('Waiting for popup');
    const job = popupGate.then(async () => {
      abortCheck(signal);
      if (!popup || popup.closed) throw Error('The fallback window was closed. Resume opens it again.');
      const url = scopedURL(baseURL, native.microseconds, native.microseconds);
      if (!policy.allows(url)) throw Error('robots.txt disallows the identity query.');
      const oldDocument = popup.document;
      phase('Reading popup');
      await pace(signal); popup.location.href = url;
      const deadline = Date.now() + OPTIONS.timeoutMs;
      let signature = '', changedAt = Date.now(), lastError = null;
      while (Date.now() < deadline) {
        abortCheck(signal);
        if (popup.closed) throw Error('The fallback window was closed.');
        let doc;
        try { doc = popup.document; } catch { throw Error('The identity window left My Activity; sign-in or verification may be required.'); }
        if (doc !== oldDocument && doc.readyState !== 'loading' && doc.body) {
          if (new URL(popup.location.href).href !== url) throw Error('The point-query URL changed.');
          const snap = snapshot(doc);
          lastSnapshot = snap;
          if (/unable to load more|couldn.t load (?:more|results)|failed to load more/i.test(snap.text)) throw Error('My Activity reported "Unable to load more". Results are incomplete; stopped without clicking Retry or advancing the cursor.');
          if (/unusual traffic|too many requests/i.test(snap.text)) {
            cooldownUntil = Math.max(cooldownUntil, Date.now() + 86400000);
            localStorage.setItem(COOLDOWN, String(cooldownUntil));
            await write(tx => tx.objectStore('control').put({ lastActionAt: lastAction, cooldownUntil }, 'rate'), ['control']);
            throw Error('A traffic warning appeared; stopped with a cooldown.');
          }
          if (/verify (?:your identity|it.s you|you are human)|captcha|access denied|something went wrong|sign in to continue/i.test(snap.text)) throw Error('An access or sign-in warning appeared.');
          const nextSignature = JSON.stringify([snap.text, snap.watchLinks]);
          if (nextSignature !== signature) { signature = nextSignature; changedAt = Date.now(); }
          // A visible terminal result is stronger evidence than a global spinner,
          // which can stay mounted for unrelated UI work.
          if (Date.now() - changedAt >= OPTIONS.settleMs) {
            if (!state.diagnostics.publicScripts) state.diagnostics.publicScripts = [...doc.querySelectorAll('script[src]')]
              .map(script => script.src).filter(src => { try { return new URL(src).hostname === 'www.gstatic.com'; } catch { return false; } });
            if (!state.diagnostics.firstPopupInventory && doc.documentElement?.outerHTML) state.diagnostics.firstPopupInventory = core.embeddedHistory(doc.documentElement.outerHTML).inventory;
            try {
              const parsed = parsePointSnapshot(snap, native.microseconds);
              if (parsed.terminal) {
                if (expectEmpty) {
                  if (!parsed.empty || parsed.watched || parsed.other || parsed.music.length) throw Error('An adjacent-microsecond control was not empty; point filtering may be rounded.');
                  return { events: [], transport: 'point-popup-empty-control' };
                }
                const events = popupEvents(parsed, native);
                return { events, transport: 'point-popup', watched: parsed.watched, other: parsed.other || 0 };
              }
            } catch (error) { lastError = error; }
          }
        }
        await wait(OPTIONS.pollMs, signal);
      }
      throw lastError || Error('Point-query identity timed out; the cursor was not advanced.');
    }).catch(error => {
      if (lastSnapshot) state.diagnostics.pointFailure = { minMicroseconds: native.microseconds,
        maxMicroseconds: native.microseconds, error: String(error), text: lastSnapshot.text.slice(0, 10000), watchLinks: lastSnapshot.watchLinks.slice(0, 100) };
      throw error;
    });
    popupGate = job.catch(() => {}); return job;
  }
  async function step(window, signal) {
    const minimum = window.lo, maximum = window.max;
    activity(window, 'Fetching');
    if (rpcSession && state.validation.complete && state.validation.rpcValidated) {
      const result = await rpcLatest(minimum, maximum, signal);
      if (result.native) {
        state.diagnostics.lastNative = { min: minimum, max: maximum, timestamp: result.native.timestamp, source: 'bounded-history-rpc' };
        activity(window, 'Identifying', result.native.microseconds);
      }
      return result;
    }
    const response = await read(scopedURL(baseURL, minimum, maximum), signal);
    const native = nativePage(response.text, minimum, maximum);
    const receipt = { min: minimum, max: maximum, timestamp: native.timestamp, empty: native.empty,
      durationMs: response.durationMs, responseBytes: response.bytes };
    if (native.empty) return { events: [], receipt, done: true, nextMaximum: maximum };
    state.diagnostics.lastNative = { min: minimum, max: maximum, timestamp: native.timestamp };
    const phase = name => activity(window, name, native.microseconds);
    phase('Identifying');
    if (!state.diagnostics.firstServerInventory) state.diagnostics.firstServerInventory = native.inventory;
    if (rpcSession) {
      phase('Reading history API');
      const result = await rpcLatest(minimum, maximum, signal);
      if (!result.native || result.native.timestamp.epochNanoseconds !== native.timestamp.epochNanoseconds) throw Error('Bounded history RPC disagrees with the independently verified native timestamp.');
      if (!state.validation.rpcBounds) {
        phase('Checking API boundaries');
        const t = BigInt(native.microseconds);
        const lower = await rpcLatest(t.toString(), (t + 1n).toString(), signal, true, true);
        const upper = await rpcLatest((t - 1n).toString(), t.toString(), signal, true, true);
        for (const probe of [lower, upper]) if (probe.native && probe.native.microseconds !== native.microseconds) throw Error('Unexpected activity in an API boundary control.');
        rpcBounds = { lowerExclusive: lower.receipt.empty, upperExclusive: upper.receipt.empty };
        for (const [lo, hi] of [[t, t + 1n], [t - 1n, t]]) {
          const check = await rpcLatest(lo.toString(), hi.toString(), signal, false, true);
          if (check.native?.microseconds !== native.microseconds) throw Error('API boundary normalization did not preserve the reference observation.');
        }
        state.validation.rpcBounds = rpcBounds;
      }
      result.receipt.nativeGETDurationMs = response.durationMs;
      return result;
    }
    let identity;
    if (native.exactRecords.length) identity = { events: recordEvents(native), transport: 'server-embedded-record' };
    else {
      const markup = core.serverSnapshot(response.text);
      if (state.diagnostics.serverPointAvailable !== false && (markup.watchLinks.length || /^(?:Viewed |Searched for )/m.test(markup.text))) {
        phase('Reading HTML');
        const point = await read(scopedURL(baseURL, native.microseconds, native.microseconds), signal);
        receipt.pointHTMLDurationMs = point.durationMs;
        const check = nativePage(point.text, native.microseconds, native.microseconds);
        if (check.empty || check.microseconds !== native.microseconds) throw Error('The direct point query did not retain the native timestamp.');
        try {
          const events = popupEvents(parsePointSnapshot(core.serverSnapshot(point.text), native.microseconds), native);
          identity = { events: events.map(event => ({ ...event, source: 'myactivity-native-time+point-html',
            evidence: { ...event.evidence, identity: 'bounded-point-html' } })), transport: 'point-html' };
          state.diagnostics.serverPointAvailable = true;
        } catch (error) { state.diagnostics.serverPointAvailable = false; state.diagnostics.serverPointParseError = String(error); }
      }
      if (!identity) identity = await pointIdentity(native, signal, false, phase);
    }
    receipt.identity = identity.transport;
    return { events: identity.events, receipt, done: BigInt(native.nextMaximum) < BigInt(minimum), nextMaximum: native.nextMaximum };
  }
  async function validatePointControls(signal) {
    const transports = state.validation.transports || [];
    for (const offset of [-2n, 1n]) {
      const minimum = (BigInt(REFERENCE.times.at(-1)) + offset).toString();
      const us = (BigInt(minimum) + 1n).toString();
      activity(state.validation.window, 'Checking empty controls', us);
      const response = await read(scopedURL(baseURL, minimum, us), signal);
      if (!nativePage(response.text, minimum, us).empty) throw Error('An adjacent-microsecond native control was not empty.');
      if (transports.includes('bounded-history-rpc')) {
        const result = await rpcLatest(minimum, us, signal, false, true);
        if (!result.receipt.empty) throw Error('Bounded history RPC failed an adjacent-microsecond empty control.');
      }
      if (transports.includes('point-html')) {
        const parsed = parsePointSnapshot(core.serverSnapshot(response.text), us);
        if (!parsed.terminal || !parsed.empty || parsed.music.length || parsed.watched || parsed.other) throw Error('Point HTML failed an adjacent-microsecond empty control.');
      }
      if (transports.includes('point-popup')) await pointIdentity({ microseconds: us }, signal, true,
        phase => activity(state.validation.window, `Empty control: ${phase.toLowerCase()}`, us));
      (state.validation.controls ||= []).push({ microseconds: us, minMicroseconds: minimum, maxMicroseconds: us, expectedEmpty: true, nativeEmpty: true, transports });
      await write(tx => tx.objectStore('states').put(structuredClone(state), state.id));
    }
    state.validation.pointControlsComplete = true;
    state.validation.rpcValidated = transports.includes('bounded-history-rpc');
  }
  function saveStep(window, result, validation = false) {
    // Serialize state mutation as well as IDB writes: another worker must never
    // persist a cursor from a transaction that subsequently fails.
    const commit = commitGate.then(async () => {
      if (commitFailure) throw commitFailure;
      activity(window, 'Saving', activeRanges.get(rangeKey(window))?.cursor || window.max);
      window.max = result.nextMaximum; window.done = result.done; window.steps++;
      const number = validation ? state.validation.steps++ : state.steps++;
      if (result.receipt.identity === 'point-popup') state.popupSteps++;
      if (validation) {
        state.validation.events.push(...result.events);
        if (result.receipt.identity && !(state.validation.transports ||= []).includes(result.receipt.identity)) state.validation.transports.push(result.receipt.identity);
      }
      else { state.musicCount += result.events.length; window.musicCount = (window.musicCount || 0) + result.events.length; }
      state.updatedAt = new Date().toISOString();
      await write(tx => {
        tx.objectStore('states').put(structuredClone(state), state.id);
        tx.objectStore('control').put(state.id, 'active');
        const key = `${state.id}:${validation ? 'validation' : 'history'}:${number}`;
        tx.objectStore('steps').put({ ...result.receipt, runId: state.id, phase: validation ? 'validation' : 'history' }, key);
        if (!validation) for (const event of result.events) tx.objectStore('events').put({ ...event, runId: state.id }, `${state.id}:${event.eventKey}`);
      });
      committedView = structuredClone(state);
      if (window.done) activeRanges.delete(rangeKey(window));
      progress();
    });
    commitGate = commit.catch(error => { commitFailure = error; });
    return commit;
  }
  async function exportData() {
    if (!state) return null;
    // One readonly transaction gives a consistent state/events/receipts snapshot.
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['states', 'events', 'steps']);
      const a = tx.objectStore('states').get(state.id), b = tx.objectStore('events').getAll(), c = tx.objectStore('steps').getAll();
      tx.oncomplete = () => {
        const saved = a.result;
        resolve({ schemaVersion: 1, kind: 'myactivity-fast-export', run: saved,
          events: b.result.filter(event => event.runId === saved.id).sort((x,y) => BigInt(x.timestampMicroseconds) < BigInt(y.timestampMicroseconds) ? -1 : BigInt(x.timestampMicroseconds) > BigInt(y.timestampMicroseconds) ? 1 : x.eventKey.localeCompare(y.eventKey)),
          steps: c.result.filter(receipt => receipt.runId === saved.id),
          coverage: { complete: saved.validation.complete && saved.windows.every(window => window.done),
            method: 'Each product timestamp is identified before moving max strictly before it; no video/day deduplication.',
            physicalPlayCompleteness: 'Unknown: includes recovered Google Music watch observations, not proof of completed playback.' } });
      };
      tx.onerror = tx.onabort = () => reject(tx.error || Error('Checkpoint read failed.'));
    });
  }
  async function download() {
    const output = await exportData(); if (!output) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `myactivity-fast-${state.id}.json`;
    document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  async function start() {
    if (controller) return;
    const lo = Date.parse(startInput.value), hi = Date.parse(endInput.value);
    yearWindows(lo, hi); if (hi > Date.now()) throw Error('The cutoff must be in the past.');
    if (cooldownUntil > Date.now()) throw Error(`Throttle cooldown until ${new Date(cooldownUntil).toISOString()}.`);
    // Open synchronously under the user's click, before any awaited operation.
    if (!rpcSession) {
      popup = window.open('about:blank', '_blank', 'popup,width=1100,height=850');
      if (!popup) throw Error('Allow the same My Activity popup used by the previous extractor, then try again.');
    }
    controller = new AbortController(); const signal = controller.signal; busy(true);
    activeRanges.clear();
    commitGate = Promise.resolve(); commitFailure = null;
    try {
      if (!navigator.locks) throw Error('Web Locks support is required.');
      await navigator.locks.request('yt-music-history-extractor', { ifAvailable: true }, async lock => {
        if (!lock) throw Error('Pause the other history extractor first.');
        if (!state || state.startUTC !== new Date(lo).toISOString() || state.endUTC !== new Date(hi).toISOString()) {
          state = { id: crypto.randomUUID(), baseURL, startUTC: new Date(lo).toISOString(), endUTC: new Date(hi).toISOString(),
            createdAt: new Date().toISOString(), status: 'running', windows: yearWindows(lo, hi).map(window => ({ ...window, musicCount: 0 })), steps: 0, musicCount: 0, popupSteps: 0,
            validation: { complete: false, events: [], steps: 0, window: { lo: REFERENCE.lo, hi: REFERENCE.hi, max: (BigInt(REFERENCE.hi) - 1n).toString(), done: false, steps: 0 } }, diagnostics: {} };
          await write(tx => { tx.objectStore('states').put(state, state.id); tx.objectStore('control').put(state.id, 'active'); });
        }
        if (rpcSession && state.validation.protocol !== 'bounded-rpc-v1') {
          state.validation = { protocol: 'bounded-rpc-v1', complete: false, events: [], steps: 0,
            window: { lo: REFERENCE.lo, hi: REFERENCE.hi, max: (BigInt(REFERENCE.hi) - 1n).toString(), done: false, steps: 0 } };
        }
        rpcBounds = state.validation.rpcBounds || {};
        committedView = structuredClone(state); progress();
        const robots = await read('https://myactivity.google.com/robots.txt', signal, true);
        if ([404, 410].includes(robots.status)) policy = { allows: () => true, delayMs: OPTIONS.gapMs };
        else if (robots.status === 200) policy = robotRules(robots.text, OPTIONS.gapMs);
        else throw Error(`Cannot check robots.txt: HTTP ${robots.status}.`);
        delayMs = policy.delayMs;
        state.robotsStatus = robots.status; state.status = 'running'; state.error = null;
        if (!state.validation.pointControlsComplete) state.validation.complete = false;
        while (!state.validation.complete) {
          const window = state.validation.window;
          if (window.done) {
            validateReference(state.validation.events); await validatePointControls(signal); state.validation.complete = true;
            await write(tx => tx.objectStore('states').put(structuredClone(state), state.id));
            activeRanges.delete(rangeKey(window)); committedView = structuredClone(state); progress(); break;
          }
          await saveStep(window, await step(window, signal), true);
        }
        // Independent year ranges run concurrently; each range's cursor is sequential.
        const claimed = new Set(); let firstError = null;
        const worker = async () => {
          try {
            while (true) {
              abortCheck(signal);
              const index = state.windows.findIndex((window, i) => !window.done && !claimed.has(i));
              if (index < 0) return;
              claimed.add(index); const window = state.windows[index];
              while (!window.done) await saveStep(window, await step(window, signal));
            }
          } catch (error) { if (!firstError && !signal.aborted) firstError = error; controller.abort(); }
        };
        await Promise.allSettled(Array.from({ length: OPTIONS.concurrency }, worker));
        if (firstError) throw firstError;
        abortCheck(signal);
        state.status = 'complete';
        await write(tx => tx.objectStore('states').put(structuredClone(state), state.id));
        status.textContent = `Finished: ${state.musicCount} Music observations, including recovered repeats.`;
      });
    } catch (error) {
      // Reload the last committed cursor, including after a storage failure.
      if (state) {
        const diagnostics = state.diagnostics;
        state = await get('states', state.id) || state;
        state.diagnostics = { ...state.diagnostics, ...diagnostics };
      }
      if (state) {
        state.status = error.message === 'Paused.' ? 'paused' : 'stopped';
        state.error = core.sanitized(String(error), [rpcSession?.at, rpcSession?.sid]);
        await write(tx => tx.objectStore('states').put(structuredClone(state), state.id));
      }
      status.textContent = `${error} Committed data is saved. Resume does not repeat committed cursor steps.`;
    } finally {
      controller = null; activeRanges.clear(); committedView = state ? structuredClone(state) : null;
      renderRanges(); busy(false); if (popup && !popup.closed) popup.close(); popup = null;
      await download();
    }
  }
  startButton.onclick = () => start().catch(error => { status.textContent = String(error); });
  pauseButton.onclick = () => controller?.abort(); saveButton.onclick = download;
  window.myActivityFast = { pause: () => controller?.abort(), download, exportData };
};
