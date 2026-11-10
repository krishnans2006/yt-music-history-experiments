// Paste into the console on your logged-in English My Activity YouTube page.
// Start with the default Radioactive pilot. No traffic starts until you click Start.
(() => {
  'use strict';
  const LIMITS = Object.freeze({ delayMs: 10000,
    cooldownMs: 86400000, pageTimeoutMs: 90000, maxScrolls: 3, resolutionMs: 1000 });
  const iso = ms => new Date(ms).toISOString();
  const normalize = s => s.replace(/\s+/g, ' ').trim();

  function queryURL(base, lo, hi) {
    if (!Number.isSafeInteger(lo) || !Number.isSafeInteger(hi) || lo >= hi) throw Error('Invalid interval.');
    const url = new URL(base);
    if (url.origin !== 'https://myactivity.google.com') throw Error('Only My Activity is supported.');
    url.searchParams.set('min', (BigInt(lo) * 1000n).toString());
    url.searchParams.set('max', (BigInt(hi) * 1000n - 1n).toString());
    return url.href;
  }

  function robotsPolicy(text, agent = 'ytmusichistory') {
    if (/<(?:!doctype|html|form)\b/i.test(text)) throw Error('robots.txt returned HTML; automatic access disabled.');
    const groups = [];
    let group;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.split('#')[0].trim();
      if (!line) continue;
      const match = line.match(/^([\w-]+)\s*:\s*(.*)$/);
      if (!match) throw Error('Unrecognized robots.txt syntax; automatic access disabled.');
      const [, field, value] = match;
      const key = field.toLowerCase();
      if (key === 'user-agent') {
        if (!group || group.hasDirectives) { group = { agents: [], rules: [], delay: 0, hasDirectives: false }; groups.push(group); }
        group.agents.push(value.toLowerCase());
      } else if (group && ['allow', 'disallow', 'crawl-delay', 'request-rate'].includes(key)) {
        group.hasDirectives = true;
        if (key === 'request-rate') throw Error('Request-rate directive requires manual review; automatic access disabled.');
        if (key === 'crawl-delay') {
          if (!/^\d+(?:\.\d+)?$/.test(value)) throw Error('Invalid crawl-delay.');
          group.delay = Math.max(group.delay, Number(value) * 1000);
        } else if (value) {
          if (!value.startsWith('/')) throw Error('Unrecognized robots path.');
          const anchored = value.endsWith('$');
          const path = anchored ? value.slice(0, -1) : value;
          const pattern = path.split('*').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
          group.rules.push({ allow: key === 'allow', length: path.replaceAll('*', '').length,
            pattern: new RegExp('^' + pattern + (anchored ? '$' : '')) });
        }
      }
    }
    // Conservatively honor wildcard AND matching specific groups.
    const applicable = groups.filter(g => g.agents.some(a => a === '*' || agent.toLowerCase().includes(a)));
    return {
      delayMs: Math.max(LIMITS.delayMs, ...applicable.map(g => g.delay)),
      allows(url) {
        const u = new URL(url);
        return applicable.every(g => {
          const matches = g.rules.filter(r => r.pattern.test(u.pathname + u.search))
            .sort((a, b) => b.length - a.length || Number(b.allow) - Number(a.allow));
          return !matches.length || matches[0].allow;
        });
      },
    };
  }

  function minuteCandidates(date, clock) {
    const match = clock.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AP]M)/i);
    if (!match) throw Error('Unrecognized activity time.');
    const hour = Number(match[1]) % 12 + (match[3].toUpperCase() === 'PM' ? 12 : 0);
    const local = new Date(`${date} ${String(hour).padStart(2, '0')}:${match[2]}:00`);
    if (!Number.isFinite(+local)) throw Error('Unrecognized activity date. Use the English interface.');
    // A repeated clock minute during the DST fall-back can have two UTC values.
    return [-7200000, -3600000, 0, 3600000, 7200000].map(offset => +local + offset)
      .filter(ms => new Date(ms).toString() === local.toString() ||
        (new Date(ms).toDateString() === local.toDateString() && new Date(ms).getHours() === hour && new Date(ms).getMinutes() === Number(match[2])));
  }

  function parseSnapshot(snapshot, lo, hi) {
    const lines = snapshot.text.split('\n').map(normalize).filter(Boolean);
    const rows = [];
    let date = null;
    let app = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/.test(line)) { date = line; app = null; }
      if (line === 'Today' || line === 'Yesterday') {
        const day = new Date(snapshot.capturedAt);
        if (line === 'Yesterday') day.setDate(day.getDate() - 1);
        date = day.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        app = null;
      }
      if (line === 'YouTube' || line === 'YouTube Music') app = line;
      if (!line.startsWith('Watched ')) continue;
      if (!date || !app) throw Error('An activity card could not be classified; leaving the interval pending.');
      const title = line.slice(8);
      let j = i + 1;
      while (j < lines.length && !/\bDetails$/.test(lines[j]) && !lines[j].startsWith('Watched ') && !['YouTube', 'YouTube Music'].includes(lines[j])) j++;
      const clock = lines[j]?.match(/^(\d{1,2}:\d{2}(?::\d{2})?\s*[AP]M)\s*[•·]\s*Details$/i)?.[1];
      if (!clock) throw Error('An activity timestamp could not be parsed; leaving the interval pending.');
      const candidates = minuteCandidates(date, clock).filter(ms => ms < hi && ms + 60000 > lo);
      if (!candidates.length) throw Error('An activity is outside the requested interval; time bounds may have been ignored.');
      if (app !== 'YouTube Music') continue;
      const matching = snapshot.watchLinks.filter(link => normalize(link.label) === title || link.url === title);
      const ids = [...new Set(matching.map(link => link.videoId))];
      if (ids.length !== 1) throw Error('A Music card has an ambiguous video ID; leaving the interval pending.');
      rows.push({ videoId: ids[0], app, title, artists: lines.slice(i + 1, j), displayDate: date,
        displayTime: clock, minuteCandidatesUTC: candidates.map(iso) });
    }
    const watched = lines.filter(line => line.startsWith('Watched ')).length;
    const empty = lines.includes('No results.') || lines.includes('No activity.');
    const terminal = lines.includes("Looks like you've reached the end") || empty;
    if (empty && watched) throw Error('Conflicting empty and activity states; leaving the interval pending.');
    if (!watched && !empty && terminal) throw Error('Unknown empty page; leaving the interval pending.');
    return { music: rows, terminal, empty, watched };
  }

  function nextTasks(task, musicCount, terminal, resolutionMs = LIMITS.resolutionMs, observations = []) {
    if (task.kind === 'calibration') return [];
    if (terminal && !musicCount) return [];
    if (task.hi - task.lo <= resolutionMs) {
      if (!terminal) throw Error('Pagination did not finish inside a leaf interval.');
      return [];
    }
    const midpoint = task.lo + Math.floor((task.hi - task.lo) / 2);
    // Isolate observed minutes before searching within them. Both sides still get
    // queried: an apparently empty gap may conceal an earlier repeat.
    const boundaries = observations.flatMap(row => (row.minuteCandidatesUTC || []).flatMap(value => {
      const minute = Date.parse(value);
      return [minute, minute + 60000];
    })).filter(value => Number.isSafeInteger(value) && value > task.lo && value < task.hi);
    const mid = boundaries.length ? boundaries.reduce((best, value) =>
      Math.abs(value - midpoint) < Math.abs(best - midpoint) ? value : best) : midpoint;
    // Stack order: examine more recent activity first. Neither half is discarded.
    return [{ lo: task.lo, hi: mid }, { lo: mid, hi: task.hi }];
  }

  function retryAfter(value, now) {
    if (!value) return 0;
    if (/^\d+$/.test(value.trim())) return now + Number(value) * 1000;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? Math.max(now, parsed) : 0;
  }

  function lastActionAt(rate = {}) {
    // Read older checkpoints without retaining their session/day action history.
    return Math.max(rate.lastActionAt || 0, (rate.starts || []).reduce((latest, time) => Math.max(latest, time), 0));
  }

  function rateDecision(rate, now, delayMs = LIMITS.delayMs) {
    if (rate.cooldownUntil > now) return { stop: `Cooldown until ${iso(rate.cooldownUntil)}.` };
    return { waitMs: Math.max(0, lastActionAt(rate) + delayMs - now) };
  }

  const core = { LIMITS, queryURL, robotsPolicy, minuteCandidates, parseSnapshot, nextTasks, retryAfter, lastActionAt, rateDecision };
  if (typeof module === 'object' && module.exports) { module.exports = core; return; }
  if (location.origin !== 'https://myactivity.google.com') throw Error('Run this on My Activity.');
  if (!location.pathname.startsWith('/product/youtube')) throw Error('Open the My Activity YouTube History page first.');
  if (document.getElementById('myactivity-extractor')) throw Error('Use the existing extractor panel.');

  async function mount() {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('yt-music-history-extractor-v1', 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('runs', { keyPath: 'id' });
        const pages = req.result.createObjectStore('pages', { keyPath: 'id' });
        pages.createIndex('runId', 'runId');
        req.result.createObjectStore('control');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const read = (store, key) => new Promise((resolve, reject) => {
      const req = db.transaction(store).objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const all = (store, runId) => new Promise((resolve, reject) => {
      const object = db.transaction(store).objectStore(store);
      const req = runId ? object.index('runId').getAll(runId) : object.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const write = (store, value, key) => new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      if (key === undefined) tx.objectStore(store).put(value);
      else tx.objectStore(store).put(value, key);
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error || Error('Checkpoint transaction aborted.'));
      tx.onerror = () => {};
    });
    // Results and pending work commit together: interrupted intervals are never lost.
    const commit = (run, page) => new Promise((resolve, reject) => {
      const tx = db.transaction(['runs', 'pages'], 'readwrite');
      tx.objectStore('runs').put(run);
      tx.objectStore('pages').put(page);
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error || Error('Checkpoint transaction aborted.'));
      tx.onerror = () => {};
    });

    const panel = document.createElement('div');
    panel.id = 'myactivity-extractor';
    panel.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:2147483647;padding:16px;background:white;color:black;border:2px solid #555;font:14px sans-serif;max-width:400px;';
    const add = (tag, text) => { const e = document.createElement(tag); if (text) e.textContent = text; panel.append(e); return e; };
    add('strong', 'YouTube Music history export');
    add('p', 'UTC range. Default: the 40-minute Radioactive pilot.');
    const from = add('input'); from.value = '2024-12-07T04:00:00Z'; from.setAttribute('aria-label', 'Start UTC');
    const until = add('input'); until.value = '2024-12-07T04:40:00Z'; until.setAttribute('aria-label', 'End UTC (exclusive)');
    const saved = add('select'); saved.setAttribute('aria-label', 'Saved runs');
    const start = add('button', 'Start / Resume');
    const pause = add('button', 'Pause'); pause.disabled = true;
    const save = add('button', 'Download JSON');
    const restore = add('input'); restore.type = 'file'; restore.accept = '.json,application/json'; restore.setAttribute('aria-label', 'Restore an exported checkpoint');
    const status = add('p', `Ready. ${LIMITS.delayMs / 1000} seconds between actions; no session or daily action caps.`);
    document.body.append(panel);
    let stopped = false;
    let run;
    let unsavedPage = null;
    const sleep = async ms => {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        if (stopped) throw Error('Paused by user.');
        await new Promise(resolve => setTimeout(resolve, Math.min(500, deadline - Date.now())));
      }
      if (stopped) throw Error('Paused by user.');
    };
    const refreshRuns = async () => {
      const runs = (await all('runs')).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      saved.replaceChildren();
      const blank = document.createElement('option'); blank.value = ''; blank.textContent = 'New range / select a saved run'; saved.append(blank);
      for (const r of runs) {
        const option = document.createElement('option'); option.value = r.id;
        option.textContent = `${iso(r.lo)} – ${iso(r.hi)} (${r.status})`; saved.append(option);
      }
      if (run) saved.value = run.id;
    };
    saved.onchange = async () => {
      run = saved.value ? await read('runs', saved.value) : null;
      if (run) { from.value = iso(run.lo); until.value = iso(run.hi); }
    };
    pause.onclick = () => { stopped = true; status.textContent = 'Pausing; the current interval stays pending.'; };

    async function download() {
      if (!run) throw Error('Select a saved run first.');
      const pages = await all('pages', run.id);
      const events = pages.filter(p => p.leaf && p.terminal).flatMap(p => p.music.map((row, cardIndex) => ({
        ...row, queryId: p.id, cardIndex, timeIntervalUTC: { start: iso(p.lo), endExclusive: iso(p.hi) },
        timestampPrecision: 'interval; not an invented exact timestamp',
      })));
      const observationKey = row => JSON.stringify([row.videoId, row.displayDate, row.displayTime]);
      const resolved = new Set(events.map(observationKey));
      const unresolved = new Map();
      for (const page of pages.filter(p => !p.kind)) for (const row of page.music) {
        if (!resolved.has(observationKey(row))) unresolved.set(observationKey(row), row);
      }
      const report = { schemaVersion: 1, exportedAt: iso(Date.now()), run, limits: LIMITS,
        unresolvedObservations: [...unresolved.values()],
        rate: await read('control', 'rate'), events, queries: pages, unsavedPage,
        coverage: { partitionComplete: run.pending.length === 0, resolutionMs: LIMITS.resolutionMs,
          physicalPlayCompleteness: 'unknown', note: 'Distinct repeated Music observations in different leaf intervals survive. Multiple same-video plays within a leaf may remain consolidated. Broad-query observations are retained in queries, not added again to events.' } };
      window.myActivityExtractorReport = report;
      const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = `myactivity-extract-${run.id}.json`;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
    save.onclick = () => download().catch(error => { status.textContent = String(error); });
    restore.onchange = async () => {
      try {
        const file = restore.files[0];
        if (!file) return;
        const report = JSON.parse(await file.text());
        const imported = report.run;
        if (report.schemaVersion !== 1 || !imported || typeof imported.id !== 'string' || imported.resolutionMs !== LIMITS.resolutionMs || !Array.isArray(imported.pending) || !Array.isArray(report.queries)) throw Error('Unsupported checkpoint.');
        if (report.rate && ((report.rate.starts !== undefined && (!Array.isArray(report.rate.starts) || report.rate.starts.some(t => typeof t !== 'number' || !Number.isFinite(t)))) ||
          (report.rate.lastActionAt !== undefined && (typeof report.rate.lastActionAt !== 'number' || !Number.isFinite(report.rate.lastActionAt))) ||
          (report.rate.cooldownUntil !== undefined && (typeof report.rate.cooldownUntil !== 'number' || !Number.isFinite(report.rate.cooldownUntil))))) throw Error('Invalid checkpoint action history.');
        queryURL(imported.baseURL, imported.lo, imported.hi);
        for (const task of imported.pending) {
          queryURL(imported.baseURL, task.lo, task.hi);
          if (task.hi > Date.now() || (task.kind && task.kind !== 'calibration')) throw Error('Invalid checkpoint task.');
        }
        if (!navigator.locks) throw Error('Browser Web Locks support is required.');
        await navigator.locks.request('yt-music-history-extractor', { ifAvailable: true }, async lock => {
          if (!lock) throw Error('Pause the active extractor before restoring a checkpoint.');
          const existing = await read('runs', imported.id);
          if (existing && existing.completedQueries > imported.completedQueries) throw Error('This browser has a newer checkpoint; select its saved run instead.');
          for (const page of report.queries) {
            if (page.runId !== imported.id || typeof page.id !== 'string') throw Error('Invalid checkpoint query.');
          }
          const rate = await read('control', 'rate') || {};
          // A restored file cannot erase the latest action time or a real throttle cooldown.
          rate.lastActionAt = Math.max(lastActionAt(rate), lastActionAt(report.rate));
          delete rate.starts;
          rate.cooldownUntil = Math.max(rate.cooldownUntil || 0, report.rate?.cooldownUntil || 0);
          await write('control', rate, 'rate');
          await new Promise((resolve, reject) => {
            const tx = db.transaction(['runs', 'pages'], 'readwrite');
            tx.objectStore('runs').put(imported);
            for (const page of report.queries) tx.objectStore('pages').put(page);
            tx.oncomplete = resolve;
            tx.onabort = () => reject(tx.error || Error('Restore transaction aborted.'));
            tx.onerror = () => {};
          });
          run = imported; from.value = iso(run.lo); until.value = iso(run.hi);
          await refreshRuns();
          status.textContent = 'Checkpoint restored. Start / Resume continues its pending intervals.';
        });
      } catch (error) { status.textContent = String(error); }
      finally { restore.value = ''; }
    };

    start.onclick = async () => {
      if (!navigator.locks) { status.textContent = 'Browser Web Locks support is required to prevent concurrent runs.'; return; }
      const popup = window.open('about:blank', '_blank', 'popup,width=1100,height=850');
      if (!popup) { status.textContent = 'Allow this page to open the collection window, then click again.'; return; }
      start.disabled = true; pause.disabled = false; saved.disabled = true; restore.disabled = true; from.disabled = true; until.disabled = true;
      stopped = false;
      let policy;
      const cooldown = async (message, retry = 0) => {
        const rate = await read('control', 'rate') || {};
        rate.cooldownUntil = Math.max(rate.cooldownUntil || 0, Date.now() + LIMITS.cooldownMs, retry);
        rate.reason = message;
        await write('control', rate, 'rate');
      };
      const action = async kind => {
        while (true) {
          const rate = await read('control', 'rate') || {};
          const decision = rateDecision(rate, Date.now(), policy?.delayMs);
          if (decision.stop) throw Error(decision.stop);
          if (!decision.waitMs) {
            if (stopped) throw Error('Paused by user.');
            rate.lastActionAt = Date.now();
            delete rate.starts;
            await write('control', rate, 'rate');
            return;
          }
          status.textContent = `Waiting ${Math.ceil(decision.waitMs / 1000)}s before ${kind}. ${run?.completedQueries || 0} queries saved.`;
          await sleep(Math.min(decision.waitMs, 1000));
        }
      };
      const inspect = async (allowBlank = false) => {
        if (popup.closed) throw Error('Collection window closed.');
        let doc;
        try {
          doc = popup.document;
          if (popup.location.origin !== location.origin && !(allowBlank && popup.location.href === 'about:blank')) throw Error('Sign-in or verification redirect.');
        } catch { throw Error('Sign-in or verification required. Stopped without retrying.'); }
        const text = doc.body?.innerText || '';
        const statuses = ['navigation', 'resource'].flatMap(type => popup.performance.getEntriesByType(type))
          .map(entry => entry.responseStatus).filter(Boolean);
        if (statuses.some(code => [429, 503].includes(code)) || /too many requests|unusual traffic|automated queries|rate limit/i.test(text)) {
          await cooldown('Throttling or traffic warning detected.');
          throw Error('Traffic warning detected. Stopped with at least a 24-hour cooldown; no automatic retry.');
        }
        if (statuses.some(code => [401, 403].includes(code)) || /verify (?:your identity|it.s you|you are human)|not a robot|access denied|temporarily blocked|captcha/i.test(text)) {
          throw Error('Access restriction or verification detected. Stopped without retrying.');
        }
        if (/something went wrong|please try again later|couldn.t load|unable to load|My Activity verification|^Verify$/im.test(text)) {
          throw Error('Page error or verification detected. Stopped without retrying.');
        }
        return doc;
      };
      const snapshot = doc => ({ capturedAt: iso(Date.now()), text: doc.body.innerText,
        watchLinks: [...doc.querySelectorAll('a[href]')].flatMap(a => {
          try {
            let u = new URL(a.href);
            if (u.hostname === 'www.google.com' && u.pathname === '/url') u = new URL(u.searchParams.get('q') || u.searchParams.get('url'));
            const yt = u.hostname === 'youtube.com' || u.hostname.endsWith('.youtube.com');
            const id = yt && u.pathname === '/watch' ? u.searchParams.get('v') : u.hostname === 'youtu.be' ? u.pathname.slice(1) : null;
            return id ? [{ videoId: id, url: u.href, label: a.innerText || a.textContent || '' }] : [];
          } catch { return []; }
        }) });

      async function collect(task) {
        const requestedURL = queryURL(run.baseURL, task.lo, task.hi);
        if (!policy.allows(requestedURL)) throw Error('robots.txt disallows this URL. Automatic collection disabled.');
        const page = { id: crypto.randomUUID(), runId: run.id, ...task, requestedURL,
          startedAt: iso(Date.now()), snapshots: [], music: [], terminal: false, leaf: false, status: 'loading' };
        unsavedPage = page;
        const oldDocument = popup.document;
        await action('page navigation');
        await inspect(true);
        popup.location.href = requestedURL;
        const deadline = Date.now() + LIMITS.pageTimeoutMs;
        while (popup.document === oldDocument || popup.document.readyState !== 'complete' || !popup.document.body) {
          await inspect(true);
          if (Date.now() > deadline) throw Error('Navigation timed out. Stopped without retrying.');
          await sleep(500);
        }
        await sleep(5000);
        let previous = '';
        let quiet = 0;
        let scrolls = 0;
        let lastScroll = Date.now();
        // Track maximum simultaneous multiplicity, rather than count the same card each scroll.
        const observed = new Map();
        while (true) {
          const doc = await inspect();
          page.finalURL = popup.location.href;
          if (new URL(page.finalURL).href !== new URL(requestedURL).href || !policy.allows(page.finalURL)) {
            throw Error('The query URL changed or is disallowed. Stopped to avoid collecting the wrong interval.');
          }
          const snap = snapshot(doc);
          const signature = JSON.stringify([snap.text, snap.watchLinks]);
          if (signature !== previous) { page.snapshots.push(snap); previous = signature; quiet = 0; } else quiet++;
          const parsed = parseSnapshot(snap, task.lo, task.hi);
          const counts = new Map();
          for (const row of parsed.music) {
            const key = JSON.stringify([row.videoId, row.displayDate, row.displayTime]);
            if (!counts.has(key)) counts.set(key, []);
            counts.get(key).push(row);
          }
          for (const [key, rows] of counts) if (rows.length > (observed.get(key)?.length || 0)) observed.set(key, rows);
          page.music = [...observed.values()].flat();
          const busy = [...doc.querySelectorAll('[aria-busy="true"], [role="progressbar"]')].some(e => e.getClientRects().length);
          if (quiet >= 3 && !busy && parsed.terminal) { page.terminal = true; break; }
          if (quiet >= 3 && !busy && !parsed.watched && !observed.size) throw Error('Unrecognized activity page. Stopped without assuming it is empty.');
          if (Date.now() - lastScroll >= 10000 && quiet >= 3 && !busy) {
            if (scrolls >= LIMITS.maxScrolls) { page.status = 'pagination_limit'; break; }
            await action('pagination scroll');
            const currentDoc = await inspect();
            const scroller = currentDoc.scrollingElement || currentDoc.documentElement;
            popup.scrollTo(0, scroller.scrollHeight); scroller.scrollTop = scroller.scrollHeight;
            scrolls++; quiet = 0; lastScroll = Date.now();
          }
          if (Date.now() - lastScroll > LIMITS.pageTimeoutMs) throw Error('Page never reached a recognizable terminal state.');
          await sleep(1000);
        }
        page.finishedAt = iso(Date.now());
        page.status = page.terminal ? 'terminal' : page.status;
        page.leaf = !task.kind && page.terminal && task.hi - task.lo <= LIMITS.resolutionMs;
        return page;
      }

      try {
        await navigator.locks.request('yt-music-history-extractor', { ifAvailable: true }, async lock => {
          if (!lock) throw Error('Another extractor is running in this browser.');
          try {
            const lo = Date.parse(from.value), hi = Date.parse(until.value);
            if (!Number.isSafeInteger(lo) || !Number.isSafeInteger(hi) || lo >= hi || hi > Date.now()) throw Error('Enter a valid past UTC range.');
            const base = new URL(location.href); base.searchParams.delete('min'); base.searchParams.delete('max');
            if (!run || run.lo !== lo || run.hi !== hi) {
              run = { id: crypto.randomUUID(), baseURL: base.href, lo, hi, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                createdAt: iso(Date.now()), updatedAt: iso(Date.now()), status: 'ready', completedQueries: 0, resolutionMs: LIMITS.resolutionMs,
                pending: [{ lo, hi },
                  { kind: 'calibration', lo: Date.parse('2024-11-12T04:28:04Z'), hi: Date.parse('2024-11-12T04:28:05Z'), expected: false },
                  { kind: 'calibration', lo: Date.parse('2024-11-12T04:28:02Z'), hi: Date.parse('2024-11-12T04:28:03Z'), expected: false },
                  { kind: 'calibration', lo: Date.parse('2024-11-12T04:28:03Z'), hi: Date.parse('2024-11-12T04:28:04Z'), expected: true }] };
              await write('runs', run);
            } else if (run.baseURL !== base.href || run.timezone !== Intl.DateTimeFormat().resolvedOptions().timeZone || run.resolutionMs !== LIMITS.resolutionMs) {
              throw Error('Resume from the same account page, filters, timezone and extractor version.');
            }
            if (!run.pending.length) { status.textContent = 'This range is already finished. Use Download JSON.'; return; }
            await action('robots.txt check');
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 15000);
            let response;
            try { response = await fetch('/robots.txt', { credentials: 'omit', redirect: 'error', cache: 'no-store', signal: controller.signal }); }
            finally { clearTimeout(timeout); }
            if ([429, 503].includes(response.status)) await cooldown('robots.txt returned a traffic error.', retryAfter(response.headers.get('Retry-After'), Date.now()));
            // Missing robots files carry no rules. Do not parse a 404 HTML error
            // page as robots directives, or treat access/server errors as absence.
            const robotsAbsent = [404, 410].includes(response.status);
            if (response.status !== 200 && !robotsAbsent) throw Error(`Cannot verify robots.txt (HTTP ${response.status}); automatic collection disabled.`);
            const robotsText = robotsAbsent ? '' : await response.text();
            policy = robotsPolicy(robotsText);
            run.robots = { checkedAt: iso(Date.now()), httpStatus: response.status, state: robotsAbsent ? 'absent' : 'present',
              text: robotsAbsent ? null : robotsText, delayMs: policy.delayMs };
            if (!policy.allows(queryURL(run.baseURL, lo, hi))) throw Error('robots.txt disallows this history URL. Automatic collection disabled.');
            run.status = 'running';
            delete run.stopReason;
            await write('runs', run);
            while (run.pending.length) {
              const task = run.pending.at(-1);
              status.textContent = `${iso(task.lo)} – ${iso(task.hi)}; ${run.completedQueries} queries saved.`;
              const page = await collect(task);
              if (task.kind === 'calibration') {
                if (!page.terminal || page.music.some(row => row.videoId === '5JhZdu4O2w0') !== task.expected) {
                  throw Error('One-second boundary calibration failed. Saved observations need review before further collection.');
                }
              }
              const children = nextTasks(task, page.music.length, page.terminal, LIMITS.resolutionMs, page.music);
              const next = { ...run, pending: [...run.pending.slice(0, -1), ...children],
                completedQueries: run.completedQueries + 1, updatedAt: iso(Date.now()) };
              await commit(next, page);
              run = next;
              unsavedPage = null;
            }
            run.status = 'finished';
          } catch (error) {
            if (run) { run.status = 'paused'; run.stopReason = String(error); }
            status.textContent = String(error);
            console.warn('My Activity extractor stopped:', error);
          } finally {
            // Keep the cross-tab lock through checkpointing, including failure paths.
            if (run) {
              run.updatedAt = iso(Date.now());
              try { await write('runs', run); await refreshRuns(); await download(); }
              catch (error) { status.textContent = `Checkpoint/download error: ${error}. In-memory state is logged in the console.`; console.error(error, run, unsavedPage); }
            }
          }
        });
      } catch (error) {
        status.textContent = String(error);
        console.warn('My Activity extractor did not start:', error);
      } finally {
        if (!popup.closed) popup.close();
        start.disabled = false; pause.disabled = true; saved.disabled = false; restore.disabled = false; from.disabled = false; until.disabled = false;
        if (run?.status === 'finished') status.textContent = 'Finished at one-second resolution. JSON saved; within-second repeats remain uncertain.';
      }
    };
    await refreshRuns();
    const newest = (await all('runs')).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (newest) { run = newest; saved.value = run.id; from.value = iso(run.lo); until.value = iso(run.hi); }
  }
  mount().catch(error => console.error('Cannot start My Activity extractor:', error));
})();
