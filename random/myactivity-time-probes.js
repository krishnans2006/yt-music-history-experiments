// Run in DevTools on your logged-in My Activity page.
// Generates links only: does not send requests, change history, or read cookies.
// Undocumented min/max parameters may be ignored or rounded by the live service.
(() => {
  if (location.hostname !== 'myactivity.google.com') {
    throw new Error('Run this on your My Activity page to preserve its filters.');
  }

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

  const links = probes.map(([test, start, end]) => {
    const url = new URL(location.href);
    const startUs = BigInt(Date.parse(start)) * 1000n;
    const endUs = BigInt(Date.parse(end)) * 1000n;
    url.searchParams.set('min', startUs.toString());
    // Express a proposed half-open [start, end) interval using an inclusive max.
    // The live service's actual boundary semantics still need verification.
    url.searchParams.set('max', (endUs - 1n).toString());
    return { test, startUTC: start, endUTC: end, url: url.href };
  });

  console.table(links);
  for (const probe of links) console.log(probe.test, '\n', probe.url);
  return links;
})();
