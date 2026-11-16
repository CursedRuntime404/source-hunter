import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createTinyFish } from './tinyfish.js';
import { runTrace, assemble } from './trace.js';
import { startResearch, mergeResearch, reportText } from './research.js';
import { runAgentRetry } from './agent-retry.js';
import { normalize, cleanUrl, normalizeClaimText } from './text.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
// minimal .env loader (no dependencies)
try {
  for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}

const PORT = Number(process.env.PORT || 8787);
const APP_TOKEN = process.env.APP_TOKEN || '';
const hasKey = !!process.env.TINYFISH_API_KEY;
const TF_MODE = (process.env.TF_MODE || (hasKey ? 'record' : 'replay')).toLowerCase();
const CACHE_DIR = path.join(root, '.cache');
fs.mkdirSync(CACHE_DIR, { recursive: true });
const tf = (hasKey || TF_MODE === 'replay') ? createTinyFish(process.env.TINYFISH_API_KEY, { mode: TF_MODE }) : null;

const key = (claim, url) => crypto.createHash('sha1').update(normalize(normalizeClaimText(claim)) + '|' + (cleanUrl(url) || url)).digest('hex').slice(0, 24);
const file = (k) => path.join(CACHE_DIR, `${k}.json`);
const readCache = (k, ttlMs = 7 * 86400e3) => {
  try {
    const j = JSON.parse(fs.readFileSync(file(k), 'utf8'));
    return Date.now() - j.savedAt < ttlMs ? j : null;
  } catch {
    return null;
  }
};
const writeCache = (k, v) => fs.writeFileSync(file(k), JSON.stringify({ ...v, savedAt: Date.now() }));

function logUsage(label = 'trace') {
  if (!tf) return;
  const u = tf.getUsage();
  const s = tf.getSessionStats();
  console.log(
    `[Usage ${u.day} | mode=${tf.mode} | ${label}] fetch=${u.fetchUrls}/${tf.caps.fetchUrls} ` +
    `search=${u.searches}/${tf.caps.searches} agent=${u.agentCalls}/${tf.caps.agentCalls} ` +
    `research=${u.researchRuns}/${tf.caps.researchRuns} | session live API calls=${s.apiCalls} (cacheHits=${s.cacheHits})`
  );
}

const hits = new Map();
const limited = (ip) => {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 60000);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > 30;
};

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type,x-app-token', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
const json = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json', ...cors });
  res.end(JSON.stringify(obj));
};
const readBody = (req) =>
  new Promise((resolve, reject) => {
    let b = '';
    req.on('data', (c) => {
      b += c;
      if (b.length > 2e6) reject(new Error('body too large'));
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(b || '{}'));
      } catch (e) {
        reject(e);
      }
    });
  });
const sse = (res, type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
const friendly = (e) =>
  e.code === 'BUDGET_CAP' || e.code === 'NOT_RECORDED' || e.code === 'AGENT_DISABLED' || e.code === 'RESEARCH_DISABLED'
    ? e.message
    : e.status === 402 ? 'TinyFish free daily allowance is used up and the wallet is empty.'
    : e.status === 401 ? 'TinyFish rejected the API key. Check TINYFISH_API_KEY in server/.env.'
    : e.status === 429 ? 'TinyFish rate limit reached. Wait a moment and try again.'
    : e.message;

http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
      if (url.pathname === '/health') {
        return json(res, 200, {
          ok: true,
          hasKey,
          mode: tf?.mode || TF_MODE,
          caps: tf?.caps || null,
          allowAgent: process.env.ALLOW_AGENT === '1',
          allowResearch: process.env.ALLOW_RESEARCH === '1',
          tokenRequired: !!APP_TOKEN,
        });
      }
      if (APP_TOKEN && req.headers['x-app-token'] !== APP_TOKEN) return json(res, 401, { error: 'bad app token' });
      if (!tf) return json(res, 500, { error: 'Server has no TINYFISH_API_KEY. Copy .env.example to .env and add your key.' });
      const ip = req.socket.remoteAddress || 'x';

      if (req.method === 'GET' && url.pathname === '/api/usage') {
        return json(res, 200, {
          mode: tf.mode,
          caps: tf.caps,
          today: tf.getUsage(),
          session: tf.getSessionStats(),
        });
      }

      if (req.method === 'GET' && url.pathname === '/api/wallet') {
        const w = await tf.wallet();
        return json(res, 200, w);
      }

      if (req.method === 'POST' && url.pathname === '/api/trace') {
        const body = await readBody(req);
        if (!body.claim || String(body.claim).trim().length < 2) return json(res, 400, { error: 'claim required' });
        if (limited(ip)) return json(res, 429, { error: 'Too many traces. Wait a minute.' });
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', ...cors });
        const k = key(body.claim, body.url || '');
        const cached = !url.searchParams.get('fresh') && readCache(k);
        if (cached?.final) {
          sse(res, 'status', { msg: `Loaded from cache (mode=${tf.mode})` });
          for (const h of cached.final.chain) sse(res, 'hop', { hop: h });
          sse(res, 'result', { final: cached.final, key: k, cached: true, researchId: cached.researchId || null });
          logUsage('cache-hit');
          return res.end();
        }
        let lastTimings = null;
        try {
          for await (const ev of runTrace(body, tf)) {
            if (ev.type === 'state') {
              writeCache(k, { state: ev.state, final: assemble(ev.state) });
              continue;
            }
            if (ev.type === 'result') {
              ev.key = k;
              lastTimings = ev.final?.timings || null;
            }
            sse(res, ev.type, ev);
          }
          if (lastTimings) {
            const parts = (lastTimings.stages || []).map((s) => `${s.stage}=${s.ms}ms`).join(' ');
            console.log(`[Timings] total=${lastTimings.totalMs}ms soft=${lastTimings.softLimitHit} hard=${lastTimings.hardLimitHit}${parts ? ' | ' + parts : ''}`);
          }
          logUsage('trace-complete');
        } catch (e) {
          sse(res, 'error', { message: friendly(e), code: e.code || null });
          logUsage('trace-error');
        }
        return res.end();
      }

      if (req.method === 'POST' && url.pathname === '/api/research') {
        const body = await readBody(req);
        if (body.confirm !== true) {
          return json(res, 400, { error: 'Research run requires confirm: true in the request body.' });
        }
        if (process.env.ALLOW_RESEARCH !== '1') {
          return json(res, 403, { error: 'Research endpoint disabled (set ALLOW_RESEARCH=1 to enable).' });
        }
        const k = key(body.claim, body.url || '');
        const c = readCache(k);
        if (!c?.state) return json(res, 400, { error: 'Run a quick trace first.' });
        if (c.researchId) return json(res, 200, { id: c.researchId });
        const id = await startResearch(c.state.input, tf);
        writeCache(k, { ...c, researchId: id });
        fs.writeFileSync(file(`job-${id}`), JSON.stringify({ key: k }));
        logUsage('research-start');
        return json(res, 200, { id });
      }

      const m = url.pathname.match(/^\/api\/research\/([\w-]+)$/);
      if (req.method === 'GET' && m) {
        const id = m[1];
        const job = JSON.parse(fs.readFileSync(file(`job-${id}`), 'utf8'));
        const c = readCache(job.key);
        if (c?.merged) return json(res, 200, c.merged);
        const run = await tf.researchGet(id);
        if (run.status !== 'COMPLETED') {
          const terminal = ['FAILED', 'CANCELLED', 'TIMED_OUT'].includes(run.status);
          return json(res, 200, { status: run.status, done: terminal, error: terminal ? run.error?.message || run.status : null });
        }
        const { state, final } = await mergeResearch(c.state, run, tf);
        const merged = { status: 'COMPLETED', done: true, report: reportText(run).slice(0, 8000), final };
        writeCache(job.key, { ...c, state, final, merged });
        logUsage('research-merged');
        return json(res, 200, merged);
      }

      if (req.method === 'POST' && url.pathname === '/api/agent-retry') {
        if (process.env.ALLOW_AGENT !== '1' || !tf?.allowAgent) {
          return json(res, 403, { error: 'Browser agent retry is disabled (set ALLOW_AGENT=1 in server/.env to enable).' });
        }
        const body = await readBody(req);
        if (!body.claim || !body.targetUrl) {
          return json(res, 400, { error: 'claim and targetUrl are required.' });
        }
        const k = key(body.claim, body.url || '');
        const c = readCache(k);
        if (!c?.state) return json(res, 400, { error: 'Run a quick trace first.' });
        try {
          const out = await runAgentRetry({ state: c.state, targetUrl: body.targetUrl, tf });
          writeCache(k, { ...c, state: out.state, final: out.final });
          logUsage(out.hit ? 'agent-retry-hit' : 'agent-retry-miss');
          return json(res, 200, { hit: out.hit, reason: out.reason, final: out.final });
        } catch (e) {
          const status = e.code === 'BUDGET_CAP' ? 429 : e.code === 'AGENT_DISABLED' ? 403 : e.code === 'NOT_RECORDED' ? 400 : 500;
          logUsage('agent-retry-error');
          return json(res, status, { error: friendly(e), code: e.code || null });
        }
      }
      json(res, 404, { error: 'not found' });
    } catch (e) {
      if (!res.headersSent) json(res, e.status && e.status < 600 && e.status > 0 ? 502 : 500, { error: friendly(e) });
      else res.end();
    }
  })
  .listen(PORT, () => {
    const c = tf?.caps || {};
    console.log(
      `Source Hunter server on http://localhost:${PORT}  ` +
      `(TF_MODE=${tf?.mode || TF_MODE}, TinyFish key: ${hasKey ? 'loaded' : 'MISSING'}, ` +
      `caps=fetch:${c.fetchUrls}/search:${c.searches}/agent:${c.agentCalls}/research:${c.researchRuns})`
    );
  });
