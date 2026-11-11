// Pure helpers shared by the standalone browser bundle and offline checks.
const protocol = require('./myactivity-fast-protocol.cjs');
const {
  bootstrap, decodeBatch, historyPage, productTimestamp,
  parseSnapshot, minuteCandidates,
} = protocol;
const iso = ms => new Date(ms).toISOString();
const normalize = s => s.replace(/\s+/g, ' ').trim();

function htmlEntities(value) {
  return value.replace(/&(#x[\da-f]+|#\d+|quot|apos|lt|gt|amp);/gi, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return { quot: '"', apos: "'", lt: '<', gt: '>', amp: '&' }[entity.toLowerCase()];
  });
}

// Wiz components can carry their model in HTML attributes instead of bootstrap
// callbacks. Decoding these is optional: the popup fallback remains available.
function embeddedHistory(html) {
  const decoded = bootstrap(html), containers = decoded.blocks.map(block => ({ path: block.key, data: block.data }));
  let attributeCount = 0, attributeErrors = 0;
  const markup = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  for (const match of markup.matchAll(/\b(data-p|data-proto)\s*=\s*(["'])(.*?)\2/gi)) {
    attributeCount++;
    let raw = htmlEntities(match[3]);
    if (raw.startsWith('%.@.')) raw = '[' + raw.slice(4);
    try { containers.push({ path: `${match[1]}[${attributeCount}]`, data: JSON.parse(raw) }); }
    catch { attributeErrors++; }
  }
  const found = new Map();
  function visit(value, path) {
    if (!Array.isArray(value)) return;
    if (Number.isSafeInteger(value[4]) && value[4] > 100000000000000 &&
        typeof value[5] === 'string' && Array.isArray(value[9]) &&
        (typeof value[7]?.[0] === 'string' || typeof value[18]?.[0] === 'string')) {
      // The live-captured record schema also validates non-Music rows.
      historyPage([[value], null]);
      found.set(`${value[4]}:${value[5]}`, { row: value, path }); return;
    }
    value.forEach((child, index) => visit(child, `${path}[${index}]`));
  }
  containers.forEach(container => visit(container.data, container.path));
  return { records: [...found.values()], inventory: { bootstrapBlocks: decoded.blocks.length,
    bootstrapErrors: decoded.errors.length, attributeCount, attributeErrors, identifiedRecords: found.size } };
}

function serverSnapshot(html) {
  // Text-only parsing: no DOM insertion, script execution, or resource loading.
  const markup = html.replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  const watchLinks = [];
  for (const anchor of markup.matchAll(/<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a\s*>/gi)) {
    try {
      let url = new URL(htmlEntities(anchor[2]), 'https://myactivity.google.com');
      if (url.hostname === 'www.google.com' && url.pathname === '/url') url = new URL(url.searchParams.get('q') || url.searchParams.get('url'));
      if (['music.youtube.com','www.youtube.com','youtube.com'].includes(url.hostname) && url.pathname === '/watch' && url.searchParams.get('v'))
        watchLinks.push({ videoId: url.searchParams.get('v'), url: url.href, label: htmlEntities(anchor[3].replace(/<[^>]*>/g, '')) });
    } catch { /* Other page links are irrelevant. */ }
  }
  const text = htmlEntities(markup.replace(/<\/?(?:div|p|section|article|header|footer|main|nav|li|h[1-6]|br|tr)\b[^>]*>/gi, '\n').replace(/<[^>]*>/g, ''));
  return { capturedAt: new Date().toISOString(), text, watchLinks };
}

function nativePage(html, minimum, maximum) {
  const decoded = bootstrap(html);
  const timestamp = productTimestamp({ activityBlocks: decoded.blocks });
  if (timestamp === null) return { empty: true, timestamp: null };
  const ns = BigInt(timestamp.epochNanoseconds);
  if (ns < BigInt(minimum) * 1000n) return { empty: true, timestamp, termination: 'before-lower-bound' };
  if (ns > BigInt(maximum) * 1000n) throw Error('Native timestamp exceeds the requested upper bound.');
  if (ns % 1000n !== 0n) throw Error('Sub-microsecond activity requires finer bounds; stopped without skipping it.');
  const microseconds = (ns / 1000n).toString();
  const embedded = embeddedHistory(html);
  const exact = embedded.records.filter(record => String(record.row[4]) === microseconds);
  return { empty: false, timestamp, microseconds, nextMaximum: (ns / 1000n - 1n).toString(),
    exactRecords: exact, inventory: embedded.inventory };
}

function yearWindows(start, end) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= end) throw Error('Invalid export range.');
  const windows = [];
  let lo = start;
  while (lo < end) {
    const next = Date.UTC(new Date(lo).getUTCFullYear() + 1, 0, 1);
    const hi = Math.min(end, next);
    windows.push({ lo: (BigInt(lo) * 1000n).toString(), hi: (BigInt(hi) * 1000n).toString(),
      max: (BigInt(hi) * 1000n - 1n).toString(), done: false, steps: 0 });
    lo = hi;
  }
  return windows.reverse();
}

function scopedURL(base, minimum, maximum) {
  const url = new URL(base);
  if (url.origin !== 'https://myactivity.google.com' || url.pathname !== '/product/youtube') throw Error('Open the My Activity YouTube History page.');
  url.searchParams.set('min', String(minimum)); url.searchParams.set('max', String(maximum));
  return url.href;
}

// Verified from Google's current public frontend: bD -> az field 4 -> Oy
// fields 1/2; $C converts epoch microseconds into seconds/nanoseconds. The
// ez request carries az at field 1, continuation at 2, and page size at 3.
function boundedHistoryArgs(minimum, maximum, continuation = null, semantics = {}) {
  const lo = BigInt(minimum), hi = BigInt(maximum);
  if (lo < 0n || hi < lo) throw Error('Invalid bounded history RPC interval.');
  const timestamp = us => {
    const remainder = (us % 1000000n + 1000000n) % 1000000n;
    return [Number((us - remainder) / 1000000n), Number(remainder) * 1000];
  };
  return [[null, ['youtube'], null, [timestamp(lo - (semantics.lowerExclusive || semantics.lowerOverscan ? 1n : 0n)),
    timestamp(hi + (semantics.upperExclusive ? 1n : 0n))]], continuation, 100];
}

function boundedHistoryPage(text, minimum, maximum, options = {}) {
  const decoded = decodeBatch(text);
  const failure = decoded.rpcResponses?.find(response => response.statusCode !== null && response.statusCode !== 0);
  if (failure) {
    const label = { 3: 'INVALID_ARGUMENT', 7: 'PERMISSION_DENIED', 8: 'RESOURCE_EXHAUSTED', 16: 'UNAUTHENTICATED' }[failure.statusCode];
    const error = Error(`History RPC failed (${label ? `${label}; ` : ''}service status ${failure.statusCode}); the result is not an empty history page.`);
    error.rpcStatus = failure.statusCode; throw error;
  }
  if (decoded.errorFrames.length || decoded.payloads.length !== 1) throw Error('History RPC returned errors or an unknown envelope.');
  const raw = decoded.payloads[0];
  if (!Array.isArray(raw)) throw Error(`History RPC returned ${raw === null ? 'a null result' : `an unexpected ${typeof raw} result`}; no history rows were decoded.`);
  // These are protobuf fields, not a fixed-length tuple. Optional trailing fields
  // must not reject otherwise valid rows and the known continuation field.
  const payload = [raw[0] ?? null, raw[1] ?? null], page = historyPage(payload), rows = payload[0] || [];
  let previous = BigInt(maximum);
  for (const row of rows) {
    const time = BigInt(row[4]);
    if (time < BigInt(minimum) || time > BigInt(maximum)) throw Error('History RPC ignored the requested time bounds.');
    if (time > previous) throw Error('History RPC rows are not ordered newest first.');
    previous = time;
  }
  if (!rows.length && page.continuation && !options.allowEmptyContinuation) throw Error('History RPC returned an empty page with a continuation; not treating it as exhausted.');
  return { rows, continuation: page.continuation };
}

function rpcNative(microseconds, rows) {
  const us = BigInt(microseconds);
  return { microseconds: us.toString(), nextMaximum: (us - 1n).toString(),
    timestamp: { value: [Number(us / 1000000n), Number(us % 1000000n) * 1000],
      epochNanoseconds: (us * 1000n).toString(), utc: new Date(Number(us / 1000n)).toISOString().replace(/\.\d{3}Z$/, `.${(us % 1000000n).toString().padStart(6, '0')}000Z`) },
    exactRecords: rows.map(row => ({ row })) };
}

function parsePointSnapshot(snapshot, microseconds) {
  const lo = Number(BigInt(microseconds)) / 1000, hi = Number(BigInt(microseconds) + 1n) / 1000;
  const text = snapshot.text;
  if (/unusual traffic|too many requests|verify (?:your identity|it.s you|you are human)|captcha|access denied|something went wrong|sign in to continue/i.test(text)) throw Error('A sign-in, access or traffic warning appeared.');
  if (/^\s*(?:Watched )/m.test(text)) return parseSnapshot(snapshot, lo, hi);
  // Non-watch YouTube activity can also be the newest product observation.
  // Validate its displayed clock before excluding it from Music watches.
  const lines = text.split('\n').map(normalize).filter(Boolean);
  let date = null, action = false, count = 0;
  for (const line of lines) {
    if (/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/.test(line)) date = line;
    if (['Today', 'Yesterday'].includes(line)) {
      const day = new Date(snapshot.capturedAt); if (line === 'Yesterday') day.setDate(day.getDate() - 1);
      date = day.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
    if (/^(?:Searched for |Viewed |Visited |Listened to |Interacted with )/.test(line)) action = true;
    const clock = line.match(/^(\d{1,2}:\d{2}(?::\d{2})?\s*[AP]M)\s*[•·]\s*Details$/i)?.[1];
    if (clock && action && date) {
      if (!minuteCandidates(date, clock).some(ms => ms < hi && ms + 60000 > lo)) throw Error('Non-watch activity is outside the point query.');
      count++; action = false;
    }
  }
  return { music: [], watched: 0, other: count, empty: lines.includes('No results.') || lines.includes('No activity.'),
    terminal: lines.includes("Looks like you've reached the end") || lines.includes('No results.') || lines.includes('No activity.') };
}

function popupEvents(parsed, native) {
  if (!parsed.terminal || parsed.empty || (!parsed.watched && !parsed.other)) throw Error('The native timestamp did not produce a complete, identified point result.');
  const us = native.microseconds;
  const timeUTC = native.timestamp.utc.replace(/000Z$/, 'Z');
  return parsed.music.map((row, index) => ({ source: 'myactivity-native-time+point-popup',
    eventKey: `${us}:popup:${row.videoId}:${index}`, timestampMicroseconds: us, timeUTC,
    videoId: row.videoId, title: row.title, artists: row.artists, app: 'YouTube Music',
    url: `https://music.youtube.com/watch?v=${row.videoId}`,
    evidence: { identity: 'bounded-point-popup', nativeTimestamp: native.timestamp.value,
      minMicroseconds: us, maxMicroseconds: us, displayDate: row.displayDate, displayTime: row.displayTime } }));
}

function recordEvents(native) {
  const page = historyPage([native.exactRecords.map(record => record.row), null]);
  return page.events.map(event => ({ ...event, eventKey: `${event.timestampMicroseconds}:${event.eventId}`,
    evidence: { identity: 'server-embedded-record', nativeTimestamp: native.timestamp.value } }));
}

function robotRules(text, delayMs = 100) {
  if (/<(?:!doctype|html|form)\b/i.test(text)) throw Error('robots.txt is not a rules file.');
  const groups = []; let group = { agents: [], rules: [], delay: 0, started: false };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split('#')[0].trim(); if (!line) continue;
    const match = line.match(/^([\w-]+)\s*:\s*(.*)$/); if (!match) throw Error('Unrecognized robots syntax.');
    const key = match[1].toLowerCase(), value = match[2];
    if (key === 'user-agent') {
      if (group.started) { groups.push(group); group = { agents: [], rules: [], delay: 0, started: false }; }
      group.agents.push(value.toLowerCase());
    } else if (group.agents.length && ['allow', 'disallow', 'crawl-delay', 'request-rate'].includes(key)) {
      group.started = true;
      if (key === 'request-rate') throw Error('Robots request-rate requires review.');
      if (key === 'crawl-delay') {
        if (!/^\d+(?:\.\d+)?$/.test(value)) throw Error('Invalid crawl-delay.');
        group.delay = Number(value) * 1000;
      } else if (value) {
        if (!value.startsWith('/')) throw Error('Invalid robots path.');
        const anchored = value.endsWith('$'), path = anchored ? value.slice(0, -1) : value;
        group.rules.push({ allow: key === 'allow', length: path.replaceAll('*', '').length,
          pattern: new RegExp('^' + path.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + (anchored ? '$' : '')) });
      }
    }
  }
  groups.push(group);
  const applicable = groups.filter(g => g.agents.some(agent => agent === '*' || 'ytmusichistory'.includes(agent)));
  return { delayMs: Math.max(delayMs, ...applicable.map(g => g.delay)),
    allows(url) {
      const u = new URL(url);
      return applicable.every(g => {
        const matches = g.rules.filter(rule => rule.pattern.test(u.pathname + u.search))
          .sort((a,b) => b.length - a.length || Number(b.allow) - Number(a.allow));
        return !matches.length || matches[0].allow;
      });
    } };
}

module.exports = { iso, normalize, ...Object.fromEntries(['balanced','member','bootstrap','decodeBatch','sanitized','historyPage','productTimestamp'].map(key => [key, protocol[key]])),
  minuteCandidates, parseSnapshot,
  htmlEntities, embeddedHistory, serverSnapshot, nativePage, yearWindows, scopedURL, boundedHistoryArgs, boundedHistoryPage, rpcNative, parsePointSnapshot, popupEvents, recordEvents, robotRules };
