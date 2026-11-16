// Thin client over the TinyFish endpoints with Record/Replay and Daily Budget Guard.
// Contracts verified against docs.tinyfish.ai (see docs/tinyfish-notes.md).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const AGENT = 'https://agent.tinyfish.ai';
const SEARCH = 'https://api.search.tinyfish.ai';
const FETCH = 'https://api.fetch.tinyfish.ai';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_TFCACHE_DIR = path.join(here, '..', '.tfcache');

export class TFError extends Error {
  constructor(message, status, code, retryAfter) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

function stableStringify(obj) {
  if (obj === null || obj === undefined) return 'null';
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(stableStringify).join(',') + ']';
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}

function cacheKey(endpoint, payload) {
  return crypto.createHash('sha256').update(endpoint + '|' + stableStringify(payload)).digest('hex').slice(0, 32);
}

function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

function numEnv(val, def) {
  if (val === undefined || val === '') return def;
  const n = Number(val);
  return Number.isFinite(n) ? n : def;
}

export function createTinyFish(apiKey, opts = {}) {
  const mode = (opts.mode || process.env.TF_MODE || (apiKey ? 'record' : 'replay')).toLowerCase();
  if (!['live', 'record', 'replay'].includes(mode)) {
    throw new Error(`Invalid TF_MODE "${mode}". Must be live, record, or replay.`);
  }
  if (!apiKey && mode !== 'replay') {
    throw new Error('TINYFISH_API_KEY is missing. Copy server/.env.example to server/.env and add your key.');
  }

  const cacheDir = opts.cacheDir || DEFAULT_TFCACHE_DIR;
  const usageFile = path.join(cacheDir, 'usage.json');
  const fetchImpl = opts.fetchImpl || globalThis.fetch;

  const caps = {
    fetchUrls: numEnv(opts.caps?.fetchUrls ?? process.env.MAX_FETCH_URLS_PER_DAY, 150),
    searches: numEnv(opts.caps?.searches ?? process.env.MAX_SEARCHES_PER_DAY, 40),
    agentCalls: numEnv(opts.caps?.agentCalls ?? process.env.MAX_AGENT_CALLS_PER_DAY, 3),
    researchRuns: numEnv(opts.caps?.researchRuns ?? process.env.MAX_RESEARCH_RUNS_PER_DAY, 0),
  };

  const allowAgent = opts.allowAgent ?? (process.env.ALLOW_AGENT === '1');
  const allowResearch = opts.allowResearch ?? (process.env.ALLOW_RESEARCH === '1');

  const sessionStats = {
    mode,
    apiCalls: 0,
    cacheHits: 0,
    fetchUrls: 0,
    searches: 0,
    agentCalls: 0,
    researchRuns: 0,
  };

  function readUsageAll() {
    try {
      return JSON.parse(fs.readFileSync(usageFile, 'utf8'));
    } catch {
      return {};
    }
  }

  function getDayUsage(day = utcDay()) {
    const all = readUsageAll();
    return {
      day,
      fetchUrls: 0,
      searches: 0,
      agentCalls: 0,
      researchRuns: 0,
      ...(all[day] || {}),
    };
  }

  function checkAndRecordUsage(metric, cost) {
    const day = utcDay();
    const all = readUsageAll();
    const cur = {
      fetchUrls: 0,
      searches: 0,
      agentCalls: 0,
      researchRuns: 0,
      ...(all[day] || {}),
    };

    if (metric === 'agentCalls' && !allowAgent) {
      throw new TFError('Agent endpoint disabled (set ALLOW_AGENT=1 to enable)', 403, 'AGENT_DISABLED');
    }
    if (metric === 'researchRuns' && !allowResearch) {
      throw new TFError('Research endpoint disabled (set ALLOW_RESEARCH=1 to enable)', 403, 'RESEARCH_DISABLED');
    }

    const cap = caps[metric];
    if (cur[metric] + cost > cap) {
      throw new TFError(
        `budget cap reached for ${metric} (${cur[metric]}/${cap} used today ${day}, requested +${cost})`,
        429,
        'BUDGET_CAP'
      );
    }

    cur[metric] += cost;
    all[day] = cur;
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(usageFile, JSON.stringify(all, null, 2));

    sessionStats.apiCalls += 1;
    sessionStats[metric] += cost;
  }

  function readCacheEntry(endpoint, payload) {
    const k = cacheKey(endpoint, payload);
    const p = path.join(cacheDir, `${endpoint}-${k}.json`);
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      if (payload?.purpose) {
        for (const altPurpose of [payload.purpose + '.', payload.purpose.replace(/[.,;:!?]+$/, '')]) {
          if (altPurpose === payload.purpose) continue;
          const altKey = cacheKey(endpoint, { ...payload, purpose: altPurpose });
          const altPath = path.join(cacheDir, `${endpoint}-${altKey}.json`);
          try {
            return JSON.parse(fs.readFileSync(altPath, 'utf8'));
          } catch {}
        }
      }
      return null;
    }
  }

  function writeCacheEntry(endpoint, payload, response) {
    const k = cacheKey(endpoint, payload);
    const p = path.join(cacheDir, `${endpoint}-${k}.json`);
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(
      p,
      JSON.stringify(
        {
          endpoint,
          request: payload,
          fetched_at: new Date().toISOString(),
          response,
        },
        null,
        2
      )
    );
  }

  async function req(url, { method = 'GET', body, timeoutMs = 45000, retries = 1 } = {}) {
    for (let attempt = 0; ; attempt++) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeoutMs);
      try {
        const res = await fetchImpl(url, {
          method,
          headers: { 'X-API-Key': apiKey, ...(body ? { 'Content-Type': 'application/json' } : {}) },
          body: body ? JSON.stringify(body) : undefined,
          signal: ctl.signal,
        });
        const text = await res.text();
        let data;
        try {
          data = text ? JSON.parse(text) : {};
        } catch {
          data = { raw: text };
        }
        if (res.ok) return data;
        const code = data?.error?.code || data?.code;
        const msg = data?.error?.message || data?.message || `HTTP ${res.status}`;
        const retryAfter = Number(res.headers.get('retry-after')) || 0;
        if ((res.status === 429 || res.status === 503) && attempt < retries) {
          await new Promise((r) => setTimeout(r, Math.min((retryAfter || 2 ** attempt * 1.5) * 1000, 15000)));
          continue;
        }
        throw new TFError(msg, res.status, code, retryAfter);
      } catch (e) {
        if (e instanceof TFError) throw e;
        if (e.name === 'AbortError') {
          throw new TFError('request timed out', 0, 'TIMEOUT');
        }
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        throw new TFError(e.message, 0, 'NETWORK');
      } finally {
        clearTimeout(timer);
      }
    }
  }

  async function withRecordReplay(endpoint, payload, metric, cost, networkFn, shouldSaveFn = () => true) {
    if (mode === 'replay') {
      const hit = readCacheEntry(endpoint, payload);
      if (!hit) {
        throw new TFError('not recorded; rerun with TF_MODE=record', 404, 'NOT_RECORDED');
      }
      sessionStats.cacheHits += 1;
      return hit.response;
    }

    if (mode === 'record') {
      const hit = readCacheEntry(endpoint, payload);
      if (hit) {
        sessionStats.cacheHits += 1;
        return hit.response;
      }
      if (metric) checkAndRecordUsage(metric, cost);
      const response = await networkFn();
      if (shouldSaveFn(response)) {
        writeCacheEntry(endpoint, payload, response);
      }
      return response;
    }

    // mode === 'live'
    if (metric) checkAndRecordUsage(metric, cost);
    return networkFn();
  }

  return {
    mode,
    caps,
    getUsage: () => getDayUsage(),
    getSessionStats: () => ({ ...sessionStats }),
    resetSessionStats: () => {
      sessionStats.apiCalls = 0;
      sessionStats.cacheHits = 0;
      sessionStats.fetchUrls = 0;
      sessionStats.searches = 0;
      sessionStats.agentCalls = 0;
      sessionStats.researchRuns = 0;
    },

    // Search API: GET https://api.search.tinyfish.ai?query=...
    async search({ query, purpose, domain_type, before_date, after_date, include_domains, exclude_domains }) {
      const payload = { query, purpose, domain_type, before_date, after_date, include_domains, exclude_domains };
      return withRecordReplay('search', payload, 'searches', 1, () => {
        const u = new URL(SEARCH);
        u.searchParams.set('query', query);
        if (purpose) u.searchParams.set('purpose', purpose.slice(0, 2000));
        if (domain_type) u.searchParams.set('domain_type', domain_type);
        if (before_date && domain_type !== 'research_paper') u.searchParams.set('before_date', before_date);
        if (after_date && domain_type !== 'research_paper') u.searchParams.set('after_date', after_date);
        if (include_domains) u.searchParams.set('include_domains', include_domains);
        if (exclude_domains) u.searchParams.set('exclude_domains', exclude_domains);
        return req(u.href, { timeoutMs: 25000, retries: 1 });
      });
    },

    // Fetch API: POST https://api.fetch.tinyfish.ai  (max 10 urls)
    async fetch({ urls, purpose, format = 'markdown' }) {
      const payload = { urls, purpose, format };
      return withRecordReplay('fetch', payload, 'fetchUrls', urls.length, () => {
        return req(FETCH, {
          method: 'POST',
          body: { urls, format, purpose, ttl: 86400, per_url_timeout_ms: 18000 },
          timeoutMs: 40000,
          retries: 0,
        });
      });
    },

    // Agent API (sync): POST /v1/automation/run  {url, goal, output_schema}
    async agent({ url, goal, output_schema }) {
      const payload = { url, goal, output_schema };
      return withRecordReplay('agent', payload, 'agentCalls', 1, () => {
        return req(`${AGENT}/v1/automation/run`, {
          method: 'POST',
          body: { url, goal, output_schema, browser_profile: 'stealth' },
          timeoutMs: 180000,
          retries: 0,
        });
      });
    },

    // Research API (async): POST /v1/automation/run-research-async -> {research_run_id}
    async researchStart({ query, mode: rMode = 'deep' }) {
      const payload = { query, mode: rMode };
      return withRecordReplay('researchStart', payload, 'researchRuns', 1, () => {
        return req(`${AGENT}/v1/automation/run-research-async`, {
          method: 'POST',
          body: { query, mode: rMode },
          timeoutMs: 25000,
          retries: 0,
        });
      });
    },

    // Research Get: GET /v1/research-run/{id} (only saves to cache if terminal status)
    async researchGet(id) {
      const payload = { id };
      return withRecordReplay(
        'researchGet',
        payload,
        null,
        0,
        () => req(`${AGENT}/v1/research-run/${encodeURIComponent(id)}`, { timeoutMs: 25000, retries: 0 }),
        (res) => ['COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT'].includes(res?.status)
      );
    },

    // Wallet API: GET /v1/wallet (read-only balance check; never loops)
    async wallet() {
      if (!apiKey) return { available: false, reason: 'no API key' };
      try {
        const data = await req(`${AGENT}/v1/wallet`, { timeoutMs: 10000, retries: 0 });
        return { available: true, ...data };
      } catch (e) {
        return { available: false, status: e.status, reason: e.message };
      }
    },
  };
}
