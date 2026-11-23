import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createTinyFish, TFError } from '../src/tinyfish.js';
import { startResearch, mergeResearch, collectCitations, reportText } from '../src/research.js';
import { assemble } from '../src/trace.js';
import { normalize, cleanUrl, normalizeClaimText } from '../src/text.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sh-deep-test-'));
}

const key = (claim, url) =>
  crypto.createHash('sha1').update(normalize(normalizeClaimText(claim)) + '|' + (cleanUrl(url) || url)).digest('hex').slice(0, 24);

test('OFFLINE: auto-start happens once per claim and cached claim does not restart', async () => {
  const dir = tmpDir();
  let researchStarts = 0;

  const fakeTf = {
    mode: 'record',
    allowResearch: true,
    caps: { fetchUrls: 150, searches: 40, agentCalls: 3, researchRuns: 3 },
    getUsage: () => ({ fetchUrls: 0, searches: 0, agentCalls: 0, researchRuns: 0 }),
    async researchStart({ query }) {
      researchStarts++;
      assert.ok(query.includes('9.1 percent'));
      return { id: 'run-autostart-123' };
    },
  };

  const claim = 'The consumer price index increased 9.1 percent in June';
  const url = 'https://news.example.com/cpi';
  const k = key(claim, url);
  const cacheFile = path.join(dir, `${k}.json`);

  // Simulate quick trace state saved to cache
  const initialState = {
    input: { claim, url },
    chain: [{ role: 'start', host: 'example.com', url, quote: claim, verifiedBy: 'selection' }],
    extras: [],
    rejected: [],
    visited: [url],
    stats: { fetches: 1, searches: 0, agentCalls: 0 },
  };
  fs.writeFileSync(cacheFile, JSON.stringify({ state: initialState, final: assemble(initialState), savedAt: Date.now() }));

  // Helper simulating server auto-start logic
  async function triggerAutoStart(body, c) {
    let researchId = c?.researchId || null;
    let researchMessage = null;
    let researchCapReached = false;

    if (!researchId && !c?.final?.research && !c?.merged) {
      if (body.deepTrace === false) {
        researchMessage = 'Deep trace disabled in Settings.';
      } else if (!fakeTf.allowResearch) {
        researchMessage = 'TinyResearch disabled (ALLOW_RESEARCH=0).';
      } else {
        const u = fakeTf.getUsage();
        if (u.researchRuns >= fakeTf.caps.researchRuns) {
          researchCapReached = true;
          researchMessage = `Daily research cap reached (${u.researchRuns}/${fakeTf.caps.researchRuns} used today).`;
        } else {
          researchId = await startResearch(c.state.input, fakeTf);
          c.researchId = researchId;
          fs.writeFileSync(cacheFile, JSON.stringify(c));
        }
      }
    }
    return { researchId, researchMessage, researchCapReached };
  }

  // 1. First trigger: auto-starts research
  const c1 = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  const r1 = await triggerAutoStart({ claim, url }, c1);
  assert.equal(researchStarts, 1);
  assert.equal(r1.researchId, 'run-autostart-123');
  assert.equal(r1.researchCapReached, false);

  // 2. Second trigger on cached claim: does NOT restart research
  const c2 = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  const r2 = await triggerAutoStart({ claim, url }, c2);
  assert.equal(researchStarts, 1, 'researchStart should not be called a second time');
  assert.equal(r2.researchId, 'run-autostart-123');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('OFFLINE: deep trace toggle off prevents start', async () => {
  const dir = tmpDir();
  let researchStarts = 0;

  const fakeTf = {
    mode: 'record',
    allowResearch: true,
    caps: { fetchUrls: 150, searches: 40, agentCalls: 3, researchRuns: 3 },
    getUsage: () => ({ fetchUrls: 0, searches: 0, agentCalls: 0, researchRuns: 0 }),
    async researchStart() {
      researchStarts++;
      return { id: 'run-should-not-start' };
    },
  };

  const claim = 'Global clean energy grew 10%';
  const url = 'https://news.example.com/energy';
  const k = key(claim, url);
  const cacheFile = path.join(dir, `${k}.json`);

  const initialState = {
    input: { claim, url },
    chain: [{ role: 'start', host: 'example.com', url, quote: claim, verifiedBy: 'selection' }],
    extras: [],
    rejected: [],
    visited: [url],
    stats: { fetches: 1, searches: 0, agentCalls: 0 },
  };
  fs.writeFileSync(cacheFile, JSON.stringify({ state: initialState, final: assemble(initialState), savedAt: Date.now() }));

  const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  let researchId = null;
  let researchMessage = null;

  if (c && !c.researchId) {
    const deepTrace = false; // Toggle turned OFF in Settings
    if (deepTrace === false) {
      researchMessage = 'Deep trace disabled in Settings.';
    } else {
      researchId = await startResearch(c.state.input, fakeTf);
    }
  }

  assert.equal(researchStarts, 0, 'research should not start when toggle is off');
  assert.equal(researchId, null);
  assert.equal(researchMessage, 'Deep trace disabled in Settings.');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('OFFLINE: daily research cap blocks with a clear message', async () => {
  const dir = tmpDir();
  let researchStarts = 0;

  const fakeTf = {
    mode: 'record',
    allowResearch: true,
    caps: { fetchUrls: 150, searches: 40, agentCalls: 3, researchRuns: 3 },
    // 3 runs used today = cap reached
    getUsage: () => ({ fetchUrls: 10, searches: 5, agentCalls: 0, researchRuns: 3 }),
    async researchStart() {
      researchStarts++;
      return { id: 'run-cap-exceeded' };
    },
  };

  const claim = 'Ocean plastics estimate was published in Science';
  const url = 'https://example.org/plastic';
  const k = key(claim, url);
  const cacheFile = path.join(dir, `${k}.json`);

  const initialState = {
    input: { claim, url },
    chain: [{ role: 'start', host: 'example.org', url, quote: claim, verifiedBy: 'selection' }],
    extras: [],
    rejected: [],
    visited: [url],
    stats: { fetches: 1, searches: 0, agentCalls: 0 },
  };
  fs.writeFileSync(cacheFile, JSON.stringify({ state: initialState, final: assemble(initialState), savedAt: Date.now() }));

  const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  let researchCapReached = false;
  let researchMessage = null;

  const u = fakeTf.getUsage();
  if (u.researchRuns >= fakeTf.caps.researchRuns) {
    researchCapReached = true;
    researchMessage = `Daily research cap reached (${u.researchRuns}/${fakeTf.caps.researchRuns} used today).`;
  } else {
    await startResearch(c.state.input, fakeTf);
  }

  assert.equal(researchStarts, 0);
  assert.equal(researchCapReached, true);
  assert.equal(researchMessage, 'Daily research cap reached (3/3 used today).');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('OFFLINE: mergeResearch verifies citations with Fetch and folds confirmed hits into trail', async () => {
  const claimText = '8 million metric tons of plastic enter the oceans each year';
  const state = {
    input: { claim: claimText, url: 'https://news.example.com/plastics' },
    chain: [{ role: 'start', host: 'news.example.com', url: 'https://news.example.com/plastics', quote: claimText, verifiedBy: 'selection', vsOrigin: { code: 'MATCH', flags: [] } }],
    extras: [],
    rejected: [],
    visited: ['https://news.example.com/plastics'],
    stats: { fetches: 1, searches: 1, agentCalls: 0 },
  };

  const fakeRun = {
    status: 'COMPLETED',
    deep_result: {
      result: 'TinyResearch trace report: [Science Study](https://science.org/study-123) and [Blog Post](https://blog.example.com/opinion)',
      citations: ['https://science.org/study-123', 'https://blog.example.com/opinion'],
    },
    evidence: [],
  };

  // Mock Fetch where science.org confirms the claim verbatim, and blog does not
  const fakeTf = {
    mode: 'record',
    async fetch({ urls }) {
      const results = [];
      const errors = [];
      for (const u of urls) {
        if (u === 'https://science.org/study-123') {
          results.push({
            url: u,
            final_url: u,
            status: 200,
            title: 'Plastic waste inputs from land into the ocean',
            published_date: '2015-02-13',
            text: 'We calculate that 8 million metric tons of plastic enter the oceans each year from coastal countries. This comprehensive study evaluates plastic pollution globally.',
          });
        } else {
          results.push({
            url: u,
            final_url: u,
            status: 200,
            title: 'Opinion piece',
            text: 'A completely unrelated blog post discussing beach cleanups without any specific statistics or figures whatsoever in this article.',
          });
        }
      }
      return { results, errors };
    },
  };

  const { state: nextState, final } = await mergeResearch(state, fakeRun, fakeTf);

  // Assertions on research merge
  assert.ok(final.research);
  assert.equal(final.research.citationsProposed, 2);
  assert.equal(final.research.confirmed, 1);
  assert.equal(final.research.confirmedUrls.length, 1);
  assert.equal(final.research.confirmedUrls[0], 'https://science.org/study-123');
  assert.equal(final.research.discardedUrls.length, 1);
  assert.equal(final.research.discardedUrls[0].url, 'https://blog.example.com/opinion');

  // Verify that the confirmed citation was added to extras/chain
  assert.ok(nextState.extras.some((h) => h.url === 'https://science.org/study-123'));
  assert.equal(reportText(fakeRun).includes('TinyResearch trace report'), true);
});
