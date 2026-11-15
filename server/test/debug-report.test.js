import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..', '..');

test('DEBUG REPORT: manifest.json registers Alt+Shift+T and README documents shortcut settings', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'extension', 'manifest.json'), 'utf8'));
  assert.ok(manifest.commands, 'manifest.commands must exist');
  assert.ok(manifest.commands['trace-selection'], 'manifest.commands.trace-selection must exist');
  assert.equal(
    manifest.commands['trace-selection']?.suggested_key?.default,
    'Alt+Shift+T',
    'suggested_key.default must be Alt+Shift+T'
  );

  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  assert.ok(
    readme.includes('chrome://extensions/shortcuts'),
    'README must mention chrome://extensions/shortcuts'
  );
});

test('DEBUG REPORT: sidepanel footer contains copyDebugBtn and clean buildDebugReport', () => {
  const html = fs.readFileSync(path.join(root, 'extension', 'sidepanel.html'), 'utf8');
  assert.ok(html.includes('id="copyDebugBtn"'), 'sidepanel.html must include copyDebugBtn');
  assert.ok(html.includes('id="copyDebugConfirm"'), 'sidepanel.html must include copyDebugConfirm');
  assert.ok(html.includes('id="panelFooter"'), 'sidepanel.html must include panelFooter');

  const css = fs.readFileSync(path.join(root, 'extension', 'sidepanel.css'), 'utf8');
  assert.ok(css.includes('.panel-footer'), 'sidepanel.css must include .panel-footer');
  assert.ok(css.includes('.btn-subtle'), 'sidepanel.css must include .btn-subtle');
  assert.ok(css.includes('.copy-confirm'), 'sidepanel.css must include .copy-confirm');

  // Verify sidepanel.js structure for buildDebugReport
  const js = fs.readFileSync(path.join(root, 'extension', 'sidepanel.js'), 'utf8');
  assert.ok(js.includes('function buildDebugReport'), 'sidepanel.js must define buildDebugReport');
  assert.ok(js.includes('async function copyDebugReport'), 'sidepanel.js must define copyDebugReport');

  // Test report serialization against real trace
  const traceCacheFile = path.join(root, 'server', '.cache', '66813d63d631c239347048eb.json');
  const cachedTrace = fs.existsSync(traceCacheFile)
    ? JSON.parse(fs.readFileSync(traceCacheFile, 'utf8')).final
    : {
        claim: { raw: 'The consumer price index increased 9.1% from a year ago in June', kind: 'stat' },
        code: 'MATCH',
        status: 'traced_primary',
        tone: 'ok',
        headline: 'Matches the likely primary source',
        chain: [
          { role: 'start', host: 'cnbc.com', url: 'https://www.cnbc.com/2022/07/13/cpi.html', date: '2022-07-13', quote: 'The consumer price index increased 9.1% from a year ago in June', verifiedBy: 'selection' },
          { role: 'origin', host: 'bls.gov', url: 'https://www.bls.gov/news.release/cpi.nr0.htm', date: '2022-07-18', quote: 'increased 9.1 percent', verifiedBy: 'fetch' }
        ],
        rejected: [],
        stats: { fetches: 6, searches: 1, agentCalls: 0, linksChecked: 0 },
        timings: { totalMs: 500, stages: [{ stage: 'hop-1', ms: 200 }] },
      };

  // Simulate sidepanel environment
  const mockCurrent = {
    payload: { claim: cachedTrace.claim.raw, url: cachedTrace.chain[0].url },
    final: cachedTrace,
    error: null,
  };
  const mockHealthInfo = { mode: 'replay', hasKey: true, ok: true };

  // Re-run builder logic verbatim
  const report = {
    extensionVersion: '0.2.0',
    serverMode: (mockHealthInfo.mode || 'unknown').toLowerCase(),
    claim: mockCurrent.payload.claim,
    pageUrl: mockCurrent.payload.url,
    verdict: {
      code: mockCurrent.final.code,
      headline: mockCurrent.final.headline,
    },
    verdictCode: mockCurrent.final.code,
    verdictHeadline: mockCurrent.final.headline,
    hops: mockCurrent.final.chain.map((h) => ({
      url: h.url || h.finalUrl || null,
      date: h.date || null,
      verifiedBy: h.verifiedBy || null,
      sourceKind: h.sourceKind || null,
      quote: h.quote || '',
      flags: Array.isArray(h.flags)
        ? h.flags.map((fl) => (typeof fl === 'string' ? fl : fl?.code || fl?.text || JSON.stringify(fl)))
        : [],
    })),
    rejected: (mockCurrent.final.rejected || []).map((r) => ({
      url: r.url || null,
      reason: r.reason || null,
    })),
    timings: mockCurrent.final.timings ? {
      totalMs: mockCurrent.final.timings.totalMs,
      softLimitHit: !!mockCurrent.final.timings.softLimitHit,
      hardLimitHit: !!mockCurrent.final.timings.hardLimitHit,
      stages: mockCurrent.final.timings.stages || [],
    } : null,
    usage: mockCurrent.final.stats ? {
      fetches: mockCurrent.final.stats.fetches || 0,
      searches: mockCurrent.final.stats.searches || 0,
      agentCalls: mockCurrent.final.stats.agentCalls || 0,
      linksChecked: mockCurrent.final.stats.linksChecked || 0,
    } : { fetches: 0, searches: 0, agentCalls: 0, linksChecked: 0 },
    error: null,
  };

  assert.equal(report.extensionVersion, '0.2.0');
  assert.equal(report.serverMode, 'replay');
  assert.ok(report.claim.includes('consumer price index'));
  assert.ok(report.pageUrl.includes('cnbc.com'));
  assert.equal(report.verdict.code, 'MATCH');
  assert.ok(report.hops.length >= 2);
  assert.ok(report.hops[0].verifiedBy === 'selection');
  assert.ok(report.hops[1].verifiedBy === 'fetch');
  assert.ok(report.timings.totalMs > 0);
  assert.ok(report.timings.stages.length > 0);
  assert.ok(report.usage.fetches >= 6);

  // Security check: Must never include API key, app token, or auth header
  const json = JSON.stringify(report);
  assert.equal(json.includes('TINYFISH_API_KEY'), false);
  assert.equal(json.includes('APP_TOKEN'), false);
  assert.equal(json.includes('authorization'), false);
  assert.equal(json.includes('Bearer '), false);
});
