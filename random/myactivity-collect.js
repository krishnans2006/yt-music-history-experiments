// Paste into DevTools on My Activity, then click "Collect history tests".
// Keeps this tab open and reads the eight test pages in one popup.
(() => {
  if (location.hostname !== 'myactivity.google.com') {
    throw new Error('Run this on your logged-in My Activity page.');
  }
  if (document.getElementById('myactivity-probe-collector')) {
    throw new Error('The collector is already on this page. Use its buttons.');
  }

  const baseURL = location.href;
  const probes = [
    ['Renegades: both known times', '2024-11-12T04:20:00Z', '2024-11-12T04:30:00Z'],
    ['Renegades: early occurrence only', '2024-11-12T04:20:00Z', '2024-11-12T04:26:00Z'],
    ['Renegades: later occurrence only', '2024-11-12T04:26:00Z', '2024-11-12T04:30:00Z'],
    ['Renegades: exclude both known times', '2024-11-12T04:26:00Z', '2024-11-12T04:27:00Z'],
    ['Radioactive: both known times', '2024-12-07T04:00:00Z', '2024-12-07T04:40:00Z'],
    ['Radioactive: early occurrence only', '2024-12-07T04:00:00Z', '2024-12-07T04:10:00Z'],
    ['Radioactive: later occurrence only', '2024-12-07T04:30:00Z', '2024-12-07T04:40:00Z'],
    ['Radioactive: exclude both known times', '2024-12-07T04:10:00Z', '2024-12-07T04:20:00Z'],
  ];
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  let stopped = false;
  let report;

  const panel = document.createElement('div');
  panel.id = 'myactivity-probe-collector';
  panel.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:2147483647;padding:16px;background:white;color:black;border:2px solid #555;font:14px sans-serif;max-width:360px;';
  const start = document.createElement('button');
  start.textContent = 'Collect history tests';
  const stop = document.createElement('button');
  stop.textContent = 'Stop';
  stop.disabled = true;
  const save = document.createElement('button');
  save.textContent = 'Download JSON';
  save.disabled = true;
  const status = document.createElement('p');
  status.textContent = 'Click to open the collection window.';
  panel.append(start, stop, save, status);
  document.body.append(panel);

  function download() {
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'myactivity-time-probes.json';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  save.onclick = download;
  stop.onclick = () => { stopped = true; status.textContent = 'Stopping; partial results will be saved.'; };

  function watchLinks(doc) {
    return [...doc.querySelectorAll('a[href]')].flatMap(anchor => {
      try {
        let url = new URL(anchor.href);
        if (url.hostname === 'www.google.com' && url.pathname === '/url') {
          url = new URL(url.searchParams.get('q') || url.searchParams.get('url'));
        }
        const youtube = url.hostname === 'youtube.com' || url.hostname.endsWith('.youtube.com');
        const videoId = youtube && url.pathname === '/watch' ? url.searchParams.get('v')
          : url.hostname === 'youtu.be' ? url.pathname.slice(1) : null;
        if (!videoId) return [];
        return [{ videoId, url: url.href, label: anchor.innerText || anchor.textContent || '' }];
      } catch { return []; }
    });
  }

  async function collect(popup, result) {
    const oldDocument = popup.document;
    popup.location.href = result.requestedURL;
    const deadline = Date.now() + 45000;
    // Reading a new Document prevents collecting the previous probe during navigation.
    while (true) {
      if (stopped) { result.status = 'stopped'; return; }
      if (popup.closed) throw new Error('The collection window was closed.');
      if (Date.now() > deadline) throw new Error('Navigation timed out; login or verification may be required.');
      try {
        if (popup.document !== oldDocument && popup.document.readyState === 'complete' && popup.document.body) break;
      } catch { /* Wait for a possible sign-in redirect to return to My Activity. */ }
      await sleep(250);
    }
    await sleep(5000);

    let previous = '';
    let stable = 0;
    for (let step = 0; step < 15; step++) {
      if (stopped) { result.status = 'stopped'; return; }
      if (popup.closed) throw new Error('The collection window was closed.');
      const doc = popup.document;
      const text = doc.body.innerText;
      const links = watchLinks(doc);
      result.finalURL = popup.location.href;
      result.pageTitle = doc.title;
      result.explicitEmptyMessage = /\b(no activity|no results|nothing to see)\b/i.test(text);
      const scroller = doc.scrollingElement || doc.documentElement;
      const signature = JSON.stringify([text, links, scroller.scrollHeight]);
      if (signature !== previous) {
        result.snapshots.push({ capturedAt: new Date().toISOString(), text, watchLinks: links });
        previous = signature;
        stable = 0;
      } else {
        stable++;
      }
      const busy = [...doc.querySelectorAll('[aria-busy="true"], [role="progressbar"]')]
        .some(element => element.getClientRects().length > 0);
      if (stable >= 3 && !busy) {
        result.status = links.length || result.explicitEmptyMessage ? 'settled_dom' : 'unrecognized_page';
        return;
      }
      // Save before scrolling so virtualized rows aren't lost.
      popup.scrollTo(0, scroller.scrollHeight);
      scroller.scrollTop = scroller.scrollHeight;
      await sleep(1000);
    }
    result.status = 'scroll_limit_reached';
  }

  start.onclick = async () => {
    // A real click lets the browser open one popup without eight popup prompts.
    const popup = window.open('about:blank', '_blank', 'popup,width=1100,height=850');
    if (!popup) {
      status.textContent = 'Popup blocked. Allow popups for My Activity, then click again.';
      return;
    }
    start.disabled = true;
    stop.disabled = false;
    save.disabled = true;
    stopped = false;
    report = {
      startedAt: new Date().toISOString(),
      baseURL,
      browserTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      browserLocale: navigator.language,
      note: 'DOM observations, not verified individual listens. settled_dom means the page stopped changing; it does not prove complete pagination or honored time bounds.',
      probes: [],
    };
    window.myActivityProbeReport = report;
    try {
      for (const [test, startUTC, endUTC] of probes) {
        if (stopped) break;
        const url = new URL(baseURL);
        url.searchParams.set('min', (BigInt(Date.parse(startUTC)) * 1000n).toString());
        url.searchParams.set('max', (BigInt(Date.parse(endUTC)) * 1000n - 1n).toString());
        const result = { test, startUTC, endUTC, requestedURL: url.href, status: 'loading', snapshots: [] };
        report.probes.push(result);
        status.textContent = `${report.probes.length}/${probes.length}: ${test}`;
        try {
          await collect(popup, result);
        } catch (error) {
          result.status = 'error';
          result.error = String(error);
          throw error;
        } finally {
          result.finishedAt = new Date().toISOString();
        }
        if (result.status === 'unrecognized_page') {
          throw new Error('The page did not show recognizable history or an explicit empty message. Partial results saved.');
        }
      }
      report.status = stopped ? 'stopped' : 'finished';
      status.textContent = stopped ? 'Stopped. Partial JSON saved.' : 'Finished. JSON saved; Download JSON saves another copy.';
    } catch (error) {
      report.status = 'error';
      report.error = String(error);
      status.textContent = `${error} Use Download JSON to save again.`;
      console.error(error);
    } finally {
      report.finishedAt = new Date().toISOString();
      start.disabled = false;
      stop.disabled = true;
      save.disabled = false;
      console.log('My Activity collection:', report);
      download();
    }
  };
})();
