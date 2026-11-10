// Browser runtime. build-myactivity-fast.cjs embeds this with the pure helpers.
module.exports = async function boot(core) {
  'use strict';
  const OPTIONS = { gapMs: 500, concurrency: 2, timeoutMs: 45000, pollMs: 200, settleMs: 400 };
  if (!Number.isInteger(OPTIONS.concurrency) || OPTIONS.concurrency < 1 || !Number.isFinite(OPTIONS.gapMs) || OPTIONS.gapMs < 0) throw Error('Invalid worker count or request delay.');
  const { REFERENCE, nativePage, scopedURL, yearWindows, parsePointSnapshot, popupEvents, recordEvents, robotRules, validateReference } = core;
  if (location.origin !== 'https://myactivity.google.com' || location.pathname !== '/product/youtube') throw Error('Open your logged-in My Activity YouTube History page.');
  if (window.myActivityFast) throw Error('The fast exporter is already installed.');
  const base = new URL(location.href);
  for (const key of [...base.searchParams.keys()]) if (!['authuser', 'hl'].includes(key)) base.searchParams.delete(key);
  base.searchParams.set('restrict', 'youtube');
  const baseURL = base.href;
  const fetchRead = window.fetch.bind(window);
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
  let policy = { allows: () => true }, gate = Promise.resolve(), popupGate = Promise.resolve();
  let commitGate = Promise.resolve(), commitFailure = null;
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
  panel.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;background:white;color:black;border:2px solid #555;padding:16px;font:14px sans-serif;max-width:440px';
  const add = (tag, text) => { const element = document.createElement(tag); element.textContent = text; panel.append(element); return element; };
  add('strong', 'Full past YouTube Music history');
  add('p', 'Includes repeated activity. First validates all 12 known Radioactive observations, then exports the range below.');
  add('label', 'Start UTC (inclusive)'); const startInput = add('input', ''); startInput.value = '1970-01-01T00:00:00.000Z';
  add('label', 'End UTC (exclusive)'); const endInput = add('input', ''); endInput.value = new Date().toISOString();
  const startButton = add('button', 'Validate & export / Resume');
  const pauseButton = add('button', 'Pause'); pauseButton.disabled = true;
  const saveButton = add('button', 'Download JSON');
  const status = add('p', 'Ready. The cutoff stays fixed on resume. Keep this tab and the fallback window open.');
  document.body.append(panel);
  const activeId = await get('control', 'active');
  if (activeId) {
    const saved = await get('states', activeId);
    if (saved?.baseURL === baseURL) { state = saved; startInput.value = state.startUTC; endInput.value = state.endUTC; }
  }
  function busy(value) { startButton.disabled = startInput.disabled = endInput.disabled = value; pauseButton.disabled = !value; }
  function progress() {
    if (!state) return;
    status.textContent = state.validation.complete
      ? `${state.musicCount} Music observations; ${state.steps} cursor steps; ${state.windows.filter(w => w.done).length}/${state.windows.length} year ranges finished. ${state.popupSteps} popup fallbacks.`
      : `Validating: ${state.validation.events.length}/12 Music observations identified.`;
  }
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
  async function read(url, signal, robots = false) {
    if (!robots && !policy.allows(url)) throw Error('robots.txt disallows the history query.');
    await pace(signal);
    const requestController = new AbortController();
    const abort = () => requestController.abort(); signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, OPTIONS.timeoutMs), started = performance.now();
    try {
      const response = await fetchRead(url, { credentials: robots ? 'omit' : 'same-origin', redirect: 'error', cache: 'no-store', signal: requestController.signal });
      await http(response);
      const text = await response.text();
      if (!robots && response.status !== 200) throw Error(`History query HTTP ${response.status}.`);
      return { status: response.status, text, durationMs: performance.now() - started, bytes: new TextEncoder().encode(text).length };
    } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
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
  function pointIdentity(native, signal, expectEmpty = false) {
    let lastSnapshot = null;
    const job = popupGate.then(async () => {
      abortCheck(signal);
      if (!popup || popup.closed) throw Error('The fallback window was closed. Resume opens it again.');
      const url = scopedURL(baseURL, native.microseconds, native.microseconds);
      if (!policy.allows(url)) throw Error('robots.txt disallows the identity query.');
      const oldDocument = popup.document;
      await pace(signal); popup.location.href = url;
      const deadline = Date.now() + OPTIONS.timeoutMs;
      let signature = '', changedAt = Date.now(), lastError = null;
      while (Date.now() < deadline) {
        abortCheck(signal);
        if (popup.closed) throw Error('The fallback window was closed.');
        let doc;
        try { doc = popup.document; } catch { throw Error('The identity window left My Activity; sign-in or verification may be required.'); }
        if (doc !== oldDocument && doc.readyState === 'complete' && doc.body) {
          if (new URL(popup.location.href).href !== url) throw Error('The point-query URL changed.');
          const snap = snapshot(doc);
          lastSnapshot = snap;
          if (/unusual traffic|too many requests/i.test(snap.text)) {
            cooldownUntil = Math.max(cooldownUntil, Date.now() + 86400000);
            localStorage.setItem(COOLDOWN, String(cooldownUntil));
            await write(tx => tx.objectStore('control').put({ lastActionAt: lastAction, cooldownUntil }, 'rate'), ['control']);
            throw Error('A traffic warning appeared; stopped with a cooldown.');
          }
          if (/verify (?:your identity|it.s you|you are human)|captcha|access denied|something went wrong|sign in to continue/i.test(snap.text)) throw Error('An access or sign-in warning appeared.');
          const nextSignature = JSON.stringify([snap.text, snap.watchLinks]);
          if (nextSignature !== signature) { signature = nextSignature; changedAt = Date.now(); }
          const loading = [...doc.querySelectorAll('[aria-busy="true"], [role="progressbar"]')].some(node => node.getClientRects().length);
          if (!loading && Date.now() - changedAt >= OPTIONS.settleMs) {
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
    const response = await read(scopedURL(baseURL, minimum, maximum), signal);
    const native = nativePage(response.text, minimum, maximum);
    const receipt = { min: minimum, max: maximum, timestamp: native.timestamp, empty: native.empty,
      durationMs: response.durationMs, responseBytes: response.bytes };
    if (native.empty) return { events: [], receipt, done: true, nextMaximum: maximum };
    state.diagnostics.lastNative = { min: minimum, max: maximum, timestamp: native.timestamp };
    if (!state.diagnostics.firstServerInventory) state.diagnostics.firstServerInventory = native.inventory;
    let identity;
    if (native.exactRecords.length) identity = { events: recordEvents(native), transport: 'server-embedded-record' };
    else {
      const markup = core.serverSnapshot(response.text);
      if (state.diagnostics.serverPointAvailable !== false && (markup.watchLinks.length || /^(?:Viewed |Searched for )/m.test(markup.text))) {
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
      if (!identity) identity = await pointIdentity(native, signal);
    }
    receipt.identity = identity.transport;
    return { events: identity.events, receipt, done: BigInt(native.nextMaximum) < BigInt(minimum), nextMaximum: native.nextMaximum };
  }
  async function validatePointControls(signal) {
    const transports = state.validation.transports || [];
    for (const offset of [-1n, 1n]) {
      const us = (BigInt(REFERENCE.times.at(-1)) + offset).toString();
      const response = await read(scopedURL(baseURL, us, us), signal);
      if (!nativePage(response.text, us, us).empty) throw Error('An adjacent-microsecond native control was not empty.');
      if (transports.includes('point-html')) {
        const parsed = parsePointSnapshot(core.serverSnapshot(response.text), us);
        if (!parsed.terminal || !parsed.empty || parsed.music.length || parsed.watched || parsed.other) throw Error('Point HTML failed an adjacent-microsecond empty control.');
      }
      if (transports.includes('point-popup')) await pointIdentity({ microseconds: us }, signal, true);
      (state.validation.controls ||= []).push({ microseconds: us, expectedEmpty: true, nativeEmpty: true, transports });
      await write(tx => tx.objectStore('states').put(structuredClone(state), state.id));
    }
    state.validation.pointControlsComplete = true;
  }
  function saveStep(window, result, validation = false) {
    // Serialize state mutation as well as IDB writes: another worker must never
    // persist a cursor from a transaction that subsequently fails.
    const commit = commitGate.then(async () => {
      if (commitFailure) throw commitFailure;
      window.max = result.nextMaximum; window.done = result.done; window.steps++;
      const number = validation ? state.validation.steps++ : state.steps++;
      if (result.receipt.identity === 'point-popup') state.popupSteps++;
      if (validation) {
        state.validation.events.push(...result.events);
        if (result.receipt.identity && !(state.validation.transports ||= []).includes(result.receipt.identity)) state.validation.transports.push(result.receipt.identity);
      }
      else state.musicCount += result.events.length;
      state.updatedAt = new Date().toISOString();
      await write(tx => {
        tx.objectStore('states').put(structuredClone(state), state.id);
        tx.objectStore('control').put(state.id, 'active');
        const key = `${state.id}:${validation ? 'validation' : 'history'}:${number}`;
        tx.objectStore('steps').put({ ...result.receipt, runId: state.id, phase: validation ? 'validation' : 'history' }, key);
        if (!validation) for (const event of result.events) tx.objectStore('events').put({ ...event, runId: state.id }, `${state.id}:${event.eventKey}`);
      });
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
    popup = window.open('about:blank', '_blank', 'popup,width=1100,height=850');
    if (!popup) throw Error('Allow the same My Activity popup used by the previous extractor, then try again.');
    controller = new AbortController(); const signal = controller.signal; busy(true);
    commitGate = Promise.resolve(); commitFailure = null;
    try {
      if (!navigator.locks) throw Error('Web Locks support is required.');
      await navigator.locks.request('yt-music-history-extractor', { ifAvailable: true }, async lock => {
        if (!lock) throw Error('Pause the other history extractor first.');
        if (!state || state.startUTC !== new Date(lo).toISOString() || state.endUTC !== new Date(hi).toISOString()) {
          state = { id: crypto.randomUUID(), baseURL, startUTC: new Date(lo).toISOString(), endUTC: new Date(hi).toISOString(),
            createdAt: new Date().toISOString(), status: 'running', windows: yearWindows(lo, hi), steps: 0, musicCount: 0, popupSteps: 0,
            validation: { complete: false, events: [], steps: 0, window: { lo: REFERENCE.lo, hi: REFERENCE.hi, max: (BigInt(REFERENCE.hi) - 1n).toString(), done: false, steps: 0 } }, diagnostics: {} };
          await write(tx => { tx.objectStore('states').put(state, state.id); tx.objectStore('control').put(state.id, 'active'); });
        }
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
            await write(tx => tx.objectStore('states').put(structuredClone(state), state.id)); break;
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
        state.status = error.message === 'Paused.' ? 'paused' : 'stopped'; state.error = String(error);
        await write(tx => tx.objectStore('states').put(structuredClone(state), state.id));
      }
      status.textContent = `${error} Committed data is saved. Resume does not repeat committed cursor steps.`;
    } finally {
      controller = null; busy(false); if (popup && !popup.closed) popup.close(); popup = null;
      await download();
    }
  }
  startButton.onclick = () => start().catch(error => { status.textContent = String(error); });
  pauseButton.onclick = () => controller?.abort(); saveButton.onclick = download;
  window.myActivityFast = { pause: () => controller?.abort(), download, exportData };
};
