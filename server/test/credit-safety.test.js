import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTinyFish, TFError } from '../src/tinyfish.js';
import { runTrace, assemble } from '../src/trace.js';
import { collectCitations } from '../src/research.js';
import { runAgentRetry } from '../src/agent-retry.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sh-tf-test-'));
}

test('replay mode throws "not recorded; rerun with TF_MODE=record" on miss with 0 network calls', async () => {
  const dir = tmpDir();
  let calls = 0;
  const tf = createTinyFish(null, {
    mode: 'replay',
    cacheDir: dir,
    fetchImpl: async () => {
      calls++;
      throw new Error('network should not be called');
    },
  });

  await assert.rejects(
    () => tf.search({ query: 'unrecorded claim' }),
    (err) => err instanceof TFError && err.code === 'NOT_RECORDED' && /not recorded; rerun with TF_MODE=record/.test(err.message)
  );
  assert.equal(calls, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('record mode saves real response with fetched_at, and replay serves it with 0 calls', async () => {
  const dir = tmpDir();
  let calls = 0;
  const fakeFetch = async () => {
    calls++;
    return {
      ok: true,
      status: 200,
      headers: new Map(),
      text: async () => JSON.stringify({ results: [{ url: 'https://example.org', title: 'Ex', snippet: 'test' }] }),
    };
  };

  const rec = createTinyFish('test-key', { mode: 'record', cacheDir: dir, fetchImpl: fakeFetch });
  const r1 = await rec.search({ query: 'solar 2025' });
  assert.equal(calls, 1);
  assert.equal(r1.results[0].url, 'https://example.org');

  // Verify cache file exists with fetched_at timestamp
  const files = fs.readdirSync(dir).filter((f) => f.startsWith('search-') && f.endsWith('.json'));
  assert.equal(files.length, 1);
  const entry = JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf8'));
  assert.ok(entry.fetched_at);
  assert.equal(entry.endpoint, 'search');

  // Second call in record mode hits cache (0 network calls)
  const r2 = await rec.search({ query: 'solar 2025' });
  assert.equal(calls, 1);
  assert.equal(r2.results[0].url, 'https://example.org');

  // Replay mode hits cache (0 network calls)
  const rep = createTinyFish(null, {
    mode: 'replay',
    cacheDir: dir,
    fetchImpl: async () => { throw new Error('must not call network'); },
  });
  const r3 = await rep.search({ query: 'solar 2025' });
  assert.equal(r3.results[0].url, 'https://example.org');
  assert.equal(rep.getSessionStats().apiCalls, 0);
  assert.equal(rep.getSessionStats().cacheHits, 1);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('budget guard enforces daily hard caps in usage.json and never retries', async () => {
  const dir = tmpDir();
  let calls = 0;
  const fakeFetch = async () => {
    calls++;
    return {
      ok: true,
      status: 200,
      headers: new Map(),
      text: async () => JSON.stringify({ results: [], errors: [] }),
    };
  };

  const tf = createTinyFish('test-key', {
    mode: 'record',
    cacheDir: dir,
    caps: { fetchUrls: 3, searches: 1, agentCalls: 1, researchRuns: 0 },
    allowAgent: false,
    allowResearch: false,
    fetchImpl: fakeFetch,
  });

  // Search cap = 1
  await tf.search({ query: 'q1' });
  assert.equal(calls, 1);
  await assert.rejects(
    () => tf.search({ query: 'q2' }),
    (err) => err instanceof TFError && err.code === 'BUDGET_CAP' && /budget cap reached/.test(err.message)
  );
  assert.equal(calls, 1); // no retry on budget cap

  // Fetch URLs cap = 3
  await tf.fetch({ urls: ['https://a.com', 'https://b.com'] });
  assert.equal(calls, 2);
  await assert.rejects(
    () => tf.fetch({ urls: ['https://c.com', 'https://d.com'] }),
    (err) => err instanceof TFError && err.code === 'BUDGET_CAP' && /budget cap reached/.test(err.message)
  );
  assert.equal(calls, 2);

  // Agent blocked when ALLOW_AGENT is false
  await assert.rejects(
    () => tf.agent({ url: 'https://a.com', goal: 'read' }),
    (err) => err instanceof TFError && err.code === 'AGENT_DISABLED'
  );

  // Research blocked when ALLOW_RESEARCH is false
  await assert.rejects(
    () => tf.researchStart({ query: 'test' }),
    (err) => err instanceof TFError && err.code === 'RESEARCH_DISABLED'
  );

  // Verify usage.json persisted
  const usage = tf.getUsage();
  assert.equal(usage.searches, 1);
  assert.equal(usage.fetchUrls, 2);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('dev-mode limits restrict record mode to 1 search query and no research_paper search', async () => {
  const searchPayloads = [];
  const fakeTf = {
    mode: 'record',
    async search(p) {
      searchPayloads.push(p);
      return { results: [] };
    },
    async fetch() { return { results: [], errors: [] }; },
  };

  for await (const _ of runTrace({ claim: '38% of global electricity is clean', url: 'https://a.com' }, fakeTf)) {}
  assert.equal(searchPayloads.length, 1);
  assert.equal(searchPayloads[0].domain_type, undefined);

  // In live mode, runs 3 search queries including research_paper
  searchPayloads.length = 0;
  fakeTf.mode = 'live';
  for await (const _ of runTrace({ claim: '38% of global electricity is clean', url: 'https://a.com' }, fakeTf)) {}
  assert.equal(searchPayloads.length, 3);
  assert.ok(searchPayloads.some((p) => p.domain_type === 'research_paper'));
});

test('collectCitations extracts Wikipedia URLs with parens from completed Research shape', () => {
  const sampleRun = {
    status: 'COMPLETED',
    deep_result: {
      result: 'Sources: [Wikipedia](https://en.wikipedia.org/wiki/Python_(programming_language)), `https://news.uga.edu/example-post/`, [CWI](https://www.cwi.nl/en/news/25-years-of-python-at-cwi/)',
      citations: [],
    },
    evidence: [],
  };
  const urls = collectCitations(sampleRun);
  assert.ok(urls.includes('https://en.wikipedia.org/wiki/Python_(programming_language)'));
  assert.ok(urls.includes('https://www.cwi.nl/en/news/25-years-of-python-at-cwi/'));
  assert.ok(urls.includes('https://news.uga.edu/example-post/'));
  assert.ok(!urls.some((u) => u.includes('%60') || u.endsWith('`')));
});

test('runAgentRetry refuses when ALLOW_AGENT is disabled and merges verified hit when enabled', async () => {
  const baseState = {
    input: { claim: 'Global spending reached $600 billion in 2024', url: 'https://blog.example.org/post' },
    chain: [{ id: 's', role: 'start', host: 'blog.example.org', url: 'https://blog.example.org/post', date: '2025-01-01', quote: 'Global spending reached $600 billion in 2024.', sourceKind: 'secondary' }],
    extras: [],
    rejected: [{ url: 'https://www.sec.gov/blocked-report', host: 'www.sec.gov', reason: 'site blocked automated fetching', citedBy: 'blog.example.org' }],
    stats: { linksChecked: 1, searches: 1, fetches: 1, agentCalls: 0 },
    visited: ['https://blog.example.org/post'],
  };

  // Blocked when allowAgent=false
  const dir = tmpDir();
  const tfDisabled = createTinyFish('test-key', { mode: 'record', cacheDir: dir, allowAgent: false });
  await assert.rejects(
    () => runAgentRetry({ state: baseState, targetUrl: 'https://www.sec.gov/blocked-report', tf: tfDisabled }),
    (err) => err instanceof TFError && err.code === 'AGENT_DISABLED'
  );

  // Enabled with fake agent response returning verified passage & date
  const fakeTfEnabled = {
    async agent() {
      return {
        result: {
          found: true,
          quote: 'Annual report filing: global spending reached $599.8 billion in fiscal year 2024.',
          published_date: '2025-01-15',
        },
      };
    },
  };
  const out = await runAgentRetry({ state: baseState, targetUrl: 'https://www.sec.gov/blocked-report', tf: fakeTfEnabled });
  assert.ok(out.hit);
  assert.equal(out.hit.verifiedBy, 'agent');
  assert.equal(out.hit.date, '2025-01-15');
  assert.equal(out.final.rejected.length, 0);
  assert.equal(out.final.origin.host, 'sec.gov');
  assert.equal(out.final.code, 'ROUNDED');

  // Timeout surfaces honest timeout message rather than pretending page lacked the sentence
  const errTf = {
    async agent() {
      const e = new Error('This operation was aborted');
      e.name = 'AbortError';
      throw e;
    },
  };
  const timeoutOut = await runAgentRetry({ state: baseState, targetUrl: 'https://www.sec.gov/blocked-report', tf: errTf });
  assert.equal(timeoutOut.hit, null);
  assert.match(timeoutOut.reason, /timed out/i);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('createTinyFish defaults TF_MODE to record when keyed and replay when unkeyed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-mode-'));
  const prevMode = process.env.TF_MODE;
  delete process.env.TF_MODE;
  try {
    const keyed = createTinyFish('test-key-present', { cacheDir: dir });
    assert.equal(keyed.mode, 'record');
    const unkeyed = createTinyFish('', { cacheDir: dir });
    assert.equal(unkeyed.mode, 'replay');
  } finally {
    if (prevMode !== undefined) process.env.TF_MODE = prevMode;
    else delete process.env.TF_MODE;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
