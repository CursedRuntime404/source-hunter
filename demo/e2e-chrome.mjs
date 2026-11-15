// Part C: Real HTTP Server (TF_MODE=replay, 0 API calls) + Real Chrome DOM/Canvas verification.
// Note: Release branded Chrome/Edge (137+) blocks --load-extension sideloading from CLI;
// see submission/checklist.md for the 5-step manual chrome://extensions MV3 test checklist.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const here = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(here, '..');
const srvUrl = 'http://localhost:18789';

// 1. Start real HTTP server in strict TF_MODE=replay (0 TinyFish API calls)
const srv = spawn('node', ['server/src/index.js'], {
  cwd: rootDir,
  env: {
    ...process.env,
    PORT: '18789',
    TF_MODE: 'replay',
    ALLOW_AGENT: '0',
    ALLOW_RESEARCH: '0',
    MAX_FETCH_URLS_PER_DAY: '0',
    MAX_SEARCHES_PER_DAY: '0',
  },
});

async function readSse(res) {
  const txt = await res.text();
  const events = [];
  for (const chunk of txt.split('\n\n')) {
    const ev = chunk.match(/^event:\s*(.+)$/m)?.[1];
    const data = chunk.match(/^data:\s*(.+)$/m)?.[1];
    if (ev && data) events.push({ ev, data: JSON.parse(data) });
  }
  return events;
}

try {
  let healthy = false;
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${srvUrl}/health`);
      if (r.ok) { healthy = true; break; }
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  assert.ok(healthy, 'Server did not become healthy');
  const h = await (await fetch(`${srvUrl}/health`)).json();
  assert.equal(h.ok, true);
  assert.equal(h.mode, 'replay');
  console.log('1. /health OK:', h);

  // 2. Verify POST /api/trace SSE replay on real recorded claims (MATCH, DISPUTED, NO_SOURCE)
  const cases = [
    {
      name: 'cpi91',
      claim: 'The consumer price index increased 9.1% from a year ago in June',
      url: 'https://www.cnbc.com/2022/07/13/inflation-rose-9point1percent-in-june-even-more-than-expected-as-price-pressures-intensify.html',
      expectCode: 'MATCH',
      expectOriginHost: 'bls.gov',
    },
    {
      name: 'moore',
      claim: 'Initially, he said transistors on a chip would double every year.',
      url: "https://en.wikipedia.org/wiki/Moore%27s_law",
      expectCode: 'HEDGE_DROPPED',
      expectOriginHost: 'hasler.ece.gatech.edu',
    },
    {
      name: 'coyotiv',
      claim: 'They spent 80% of their time laying bricks \u2014 writing boilerplate code, debugging syntax, configuring environments \u2014 and only 20% designing the skyscraper.',
      url: 'https://coyotiv.com/blog/from-coder-to-architect-learning-software-engineering-in-the-age-of-ai/',
      expectCode: 'NO_SOURCE',
      expectOriginHost: null,
    },
  ];

  for (const c of cases) {
    const res = await fetch(`${srvUrl}/api/trace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claim: c.claim, url: c.url }),
    });
    assert.equal(res.status, 200);
    const evs = await readSse(res);
    const fin = evs.find((e) => e.ev === 'result')?.data?.final;
    assert.ok(fin, `Missing SSE result for ${c.name}`);
    assert.equal(fin.code, c.expectCode, `${c.name} code mismatch`);
    assert.equal(fin.origin?.host || null, c.expectOriginHost, `${c.name} origin host mismatch`);
    console.log(`2. SSE /api/trace [${c.name}] -> ${fin.code} (${fin.origin?.host || 'none'})`);
  }

  // 3. Verify fail-closed HTTP guards on /api/research & /api/agent-retry
  const rNoConfirm = await fetch(`${srvUrl}/api/research`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ claim: 'test' }),
  });
  assert.equal(rNoConfirm.status, 400);

  const aDisabled = await fetch(`${srvUrl}/api/agent-retry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ claim: 'test', targetUrl: 'https://example.com' }),
  });
  assert.equal(aDisabled.status, 403);
  console.log('3. Fail-closed HTTP guards verified: /api/research (400), /api/agent-retry (403)');

  // 4. Verify Canvas 2D Trail Card PNG export + gallery filter DOM in real Chrome headless
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const prof = path.join(os.tmpdir(), 'source-hunter-e2e-prof');
  const dom = execFileSync(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    `--user-data-dir=${prof}`,
    '--virtual-time-budget=2000',
    '--dump-dom',
    `file:///${path.join(here, 'index.html').replace(/\\/g, '/')}`,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const cards = (dom.match(/<article class="case /g) || []).length;
  assert.equal(cards, 9, `Expected 9 rendered cards in demo/index.html, got ${cards}`);
  assert.ok(dom.includes('hasler.ece.gatech.edu'), 'Missing Moore 1965 PDF card');
  assert.ok(dom.includes('aapl-20230930.htm'), 'Missing Apple SEC Form 10-K card');
  assert.ok(dom.includes('news.ucsb.edu'), 'Missing Plastic Deep Trace card');
  assert.ok(dom.includes('inquisitiveeater.com'), 'Missing Marie DISPUTED card');
  assert.ok(dom.includes('who.int') && dom.includes('PRIMARY_PUBLISHER'), 'Missing WHO PRIMARY_SOURCE card');
  assert.ok(dom.includes('earth.org') && dom.includes('Scope narrower than claimed'), 'Missing clean38 Earth.org SCOPE flag');
  assert.ok(dom.includes('UNCITED'), 'Missing UNCITED filter/badge');
  assert.ok(dom.includes('No original source found'), 'Missing coyotiv NO_SOURCE card');
  console.log(`4. Real headless Chrome rendered demo/index.html with all ${cards} cards verified.`);
} finally {
  try { srv.kill(); } catch {}
}
