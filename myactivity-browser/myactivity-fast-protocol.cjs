// Stable protocol and fallback parsers used by the finalized browser exporter.
const READ_RPC = 'y3VFHd';
const iso = ms => new Date(ms).toISOString();
const normalize = s => s.replace(/\s+/g, ' ').trim();

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

function member(objectSource, name) {
  let i = 1;
  while (i < objectSource.length - 1) {
    while (/[\s,]/.test(objectSource[i] || '') && i < objectSource.length) i++;
    let key;
    if (['"', "'"].includes(objectSource[i])) {
      const quote = objectSource[i++], start = i;
      while (i < objectSource.length && objectSource[i] !== quote) {
        if (objectSource[i] === '\\') i++;
        i++;
      }
      key = objectSource.slice(start, i++);
    } else {
      const match = objectSource.slice(i).match(/^[\w$]+/);
      if (!match) break;
      key = match[0];
      i += key.length;
    }
    while (/\s/.test(objectSource[i] || '') && i < objectSource.length) i++;
    if (objectSource[i++] !== ':') throw Error('Invalid bootstrap object.');
    while (/\s/.test(objectSource[i] || '') && i < objectSource.length) i++;
    const start = i;
    if ('[{('.includes(objectSource[i])) i = balanced(objectSource, i).end;
    else if (['"', "'"].includes(objectSource[i])) {
      const quote = objectSource[i++];
      while (i < objectSource.length && objectSource[i] !== quote) {
        if (objectSource[i] === '\\') i++;
        i++;
      }
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
        if (raw !== null) blocks.push({
          key: key?.slice(1, -1),
          data: JSON.parse(raw),
        });
      } catch (error) {
        errors.push(String(error));
      }
    }
  }
  return { blocks, errors };
}

function decodeBatch(body) {
  const source = body.replace(/^\s*\)\]\}'[^\n]*\n?/, '');
  const frames = [];
  let i = 0;
  while (i < source.length) {
    while (/\s/.test(source[i] || '') && i < source.length) i++;
    if (i === source.length) break;
    const length = source.slice(i).match(/^\d+\s*\r?\n/);
    if (length) {
      i += length[0].length;
      continue;
    }
    if (!'[{'.includes(source[i])) throw Error('Unrecognized batch framing.');
    const frame = balanced(source, i);
    frames.push(JSON.parse(frame.text));
    i = frame.end;
  }
  const payloads = [], errorFrames = [], rpcResponses = [];
  function visit(value) {
    if (!Array.isArray(value)) return;
    if (value[0] === 'wrb.fr' && value[1] === READ_RPC) {
      const status = value[5];
      rpcResponses.push({
        rpc: value[1],
        statusCode: Array.isArray(status) && Number.isInteger(status[0])
          ? status[0] : null,
        metadata: value.slice(3),
      });
      payloads.push(typeof value[2] === 'string'
        ? JSON.parse(value[2]) : value[2]);
    } else if (value[0] === 'er') errorFrames.push(value);
    else value.forEach(visit);
  }
  frames.forEach(visit);
  return { payloads, errorFrames, rpcResponses };
}

function sanitized(value, secrets = []) {
  if (typeof value === 'string') {
    for (const secret of secrets) {
      if (secret?.length >= 8) value = value.replaceAll(secret, '[redacted]');
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(item => sanitized(item, secrets));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) =>
        !/^(?:at|cookie|authorization|x-xsrf-token|x-csrf-token)$/i.test(key))
      .map(([key, item]) => [key, sanitized(item, secrets)]));
  }
  return value;
}

function historyPage(payload) {
  if (!Array.isArray(payload) || payload.length !== 2
      || !(payload[0] === null || Array.isArray(payload[0]))
      || !(payload[1] == null || typeof payload[1] === 'string')) {
    throw Error('Unrecognized history-page envelope.');
  }
  const events = [], excluded = [], rows = payload[0] || [];
  for (const [index, row] of rows.entries()) {
    if (!Array.isArray(row) || !Number.isSafeInteger(row[4]) || row[4] <= 0
        || typeof row[5] !== 'string' || !row[5] || !Array.isArray(row[9])) {
      throw Error(`Unrecognized history row ${index}.`);
    }
    const label = row[7]?.[0], secondaryLabel = row[18]?.[0];
    const [title, , action, url] = row[9];
    const us = BigInt(row[4]);
    const timeUTC = new Date(Number(us / 1000n)).toISOString()
      .replace(/\.\d{3}Z$/,
        `.${(us % 1000000n).toString().padStart(6, '0')}Z`);
    let videoId = null, hostname = null;
    try {
      const parsed = new URL(url);
      hostname = parsed.hostname;
      if (parsed.protocol === 'https:'
          && ['music.youtube.com', 'www.youtube.com', 'youtube.com']
            .includes(hostname)
          && parsed.pathname === '/watch') {
        videoId = parsed.searchParams.get('v');
      }
    } catch {
      // Retain explicit Music rows even if their media URL is unavailable.
    }
    const isMusic = label === 'YouTube Music'
      || secondaryLabel === 'YouTube Music'
      || hostname === 'music.youtube.com';
    if (!isMusic || action !== 'Watched') {
      excluded.push({ index, label, action });
      continue;
    }
    const videoProgressPercent = row[23]?.[2] ?? null;
    if (videoProgressPercent !== null
        && (!Number.isSafeInteger(videoProgressPercent)
          || videoProgressPercent < 0 || videoProgressPercent > 100)) {
      throw Error(`Unrecognized video progress in history row ${index}.`);
    }
    events.push({
      source: 'myactivity-y3VFHd',
      sourceRow: index,
      eventId: row[5],
      timestampMicroseconds: us.toString(),
      timeUTC,
      videoId,
      title,
      url: url || null,
      app: 'YouTube Music',
      appEvidence: { label, secondaryLabel, hostname },
      durationLabel: row[23]?.[1] || null,
      // Saved resume position, not necessarily the portion played by this event.
      videoProgressPercent,
      channels: (row[32] || []).map(channel => ({
        name: channel[1],
        url: channel[3],
      })),
      devices: (row[19] || []).map(device => device[0]),
    });
  }
  return {
    rowCount: rows.length,
    musicCount: events.length,
    events,
    excluded,
    continuation: payload[1] || null,
    exhausted: !payload[1],
  };
}

function productTimestamp(response) {
  const block = response?.activityBlocks?.find(item => item.key === 'ds:5');
  if (!block || !Array.isArray(block.data)) {
    throw Error('The filtered product-summary block is missing.');
  }
  const rows = block.data[0];
  if (rows == null) return null;
  if (!Array.isArray(rows) || rows.some(row => !Array.isArray(row))) {
    throw Error('Unrecognized product-summary structure.');
  }
  const youtube = rows.filter(row => row[0] === 26);
  if (!youtube.length) return null;
  if (youtube.length !== 1) {
    throw Error('Multiple YouTube summaries; cursor semantics need review.');
  }
  const pair = youtube[0][4];
  if (pair == null) return null;
  if (!Array.isArray(pair) || pair.length !== 2
      || !pair.every(Number.isSafeInteger)
      || pair[1] < 0 || pair[1] >= 1000000000) {
    throw Error('Unrecognized native timestamp.');
  }
  if (pair[0] === 0 && pair[1] === 0) return null;
  return {
    value: pair,
    epochNanoseconds: (
      BigInt(pair[0]) * 1000000000n + BigInt(pair[1])
    ).toString(),
    utc: new Date(pair[0] * 1000).toISOString()
      .replace('.000Z', `.${String(pair[1]).padStart(9, '0')}Z`),
  };
}

function minuteCandidates(date, clock) {
  const match = clock.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AP]M)/i);
  if (!match) throw Error('Unrecognized activity time.');
  const hour = Number(match[1]) % 12
    + (match[3].toUpperCase() === 'PM' ? 12 : 0);
  const local = new Date(
    `${date} ${String(hour).padStart(2, '0')}:${match[2]}:00`
  );
  if (!Number.isFinite(+local)) {
    throw Error('Unrecognized activity date. Use the English interface.');
  }
  // A repeated clock minute during the DST fall-back can have two UTC values.
  return [-7200000, -3600000, 0, 3600000, 7200000]
    .map(offset => +local + offset)
    .filter(ms => new Date(ms).toString() === local.toString()
      || (new Date(ms).toDateString() === local.toDateString()
        && new Date(ms).getHours() === hour
        && new Date(ms).getMinutes() === Number(match[2])));
}

function parseSnapshot(snapshot, lo, hi) {
  const lines = snapshot.text.split('\n').map(normalize).filter(Boolean);
  const rows = [];
  let date = null, app = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/.test(line)) {
      date = line;
      app = null;
    }
    if (line === 'Today' || line === 'Yesterday') {
      const day = new Date(snapshot.capturedAt);
      if (line === 'Yesterday') day.setDate(day.getDate() - 1);
      date = day.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
      app = null;
    }
    if (line === 'YouTube' || line === 'YouTube Music') app = line;
    if (!line.startsWith('Watched ')) continue;
    if (!date || !app) {
      throw Error(
        'An activity card could not be classified; leaving the interval pending.'
      );
    }
    const title = line.slice(8);
    let j = i + 1;
    while (j < lines.length && !/\bDetails$/.test(lines[j])
        && !lines[j].startsWith('Watched ')
        && !['YouTube', 'YouTube Music'].includes(lines[j])) j++;
    const clock = lines[j]?.match(
      /^(\d{1,2}:\d{2}(?::\d{2})?\s*[AP]M)\s*[•·]\s*Details$/i
    )?.[1];
    if (!clock) {
      throw Error(
        'An activity timestamp could not be parsed; leaving the interval pending.'
      );
    }
    const candidates = minuteCandidates(date, clock)
      .filter(ms => ms < hi && ms + 60000 > lo);
    if (!candidates.length) {
      throw Error(
        'An activity is outside the requested interval; time bounds may have been ignored.'
      );
    }
    if (app !== 'YouTube Music') continue;
    const matching = snapshot.watchLinks
      .filter(link => normalize(link.label) === title || link.url === title);
    const ids = [...new Set(matching.map(link => link.videoId))];
    if (ids.length !== 1) {
      throw Error(
        'A Music card has an ambiguous video ID; leaving the interval pending.'
      );
    }
    rows.push({
      videoId: ids[0],
      app,
      title,
      artists: lines.slice(i + 1, j),
      displayDate: date,
      displayTime: clock,
      minuteCandidatesUTC: candidates.map(iso),
    });
  }
  const watched = lines.filter(line => line.startsWith('Watched ')).length;
  const empty = lines.includes('No results.') || lines.includes('No activity.');
  const terminal = lines.includes("Looks like you've reached the end") || empty;
  if (empty && watched) {
    throw Error('Conflicting empty and activity states; leaving the interval pending.');
  }
  if (!watched && !empty && terminal) {
    throw Error('Unknown empty page; leaving the interval pending.');
  }
  return { music: rows, terminal, empty, watched };
}

module.exports = {
  balanced,
  member,
  bootstrap,
  decodeBatch,
  sanitized,
  historyPage,
  productTimestamp,
  minuteCandidates,
  parseSnapshot,
};
