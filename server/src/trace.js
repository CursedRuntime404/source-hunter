// Source tracing pipeline.
//  1. follow the citation links the writer put next to the claim (Fetch)
//  2. at each page, find the passage that states the claim and read ITS citations
//  3. search for earlier / primary sources the chain missed (Search)
//  4. fall back to a browser agent for pages Fetch cannot read (Agent)
//  5. TinyResearch (deep trace) proposes sources; they are verified by Fetch like any other (research.js)
// Every quote shown to the user is a substring of page text we fetched. Nothing is generated.
import {
  parseClaim, findPassage, findClosestPassage, isBotInterstitial, extractLinks, resolvePassageCitations, rankLinks, cleanUrl, hostOf,
  sourceKind, isTertiary, isBlocked, detectDispute, isSameOrg,
  normalizeDate, dateKey, findDateInText, findDateInfo, contentTokens,
} from './text.js';
import { compare, LABELS } from './compare.js';

const chunks = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const AGENT_CODES = new Set(['bot_blocked', 'empty_content', 'timeout']);
const SOURCE_KIND_LABELS = {
  'primary-likely': 'likely primary source',
  'gov-release': 'official agency news release',
  'press-release': 'institutional press release about the study',
  'journal-commentary': 'journal news or commentary (secondary)',
  secondary: 'secondary source',
  tertiary: 'tertiary: follow its citations',
};
const HUMAN = {
  page_not_found: 'page no longer exists (404)',
  login_required: 'behind a login wall',
  bot_blocked: 'blocked automated access',
  timeout: 'page timed out',
  empty_content: 'no readable text',
  target_unreachable: 'site unreachable',
  content_too_large: 'document too large to read',
  target_http_error: 'site returned an error',
};

function raceBudget(promise, ms) {
  if (!ms || ms <= 0) return Promise.reject(Object.assign(new Error('Trace hard time limit reached'), { code: 'TRACE_TIMEOUT' }));
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('Trace hard time limit reached'), { code: 'TRACE_TIMEOUT' })), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

function prepareLinks(links = [], base) {
  return links.map((l) => ({ text: l.text || '', href: l.href, inSelection: !!l.inSelection, adjacent: !!l.adjacent })).filter((l) => cleanUrl(l.href, base));
}

/** Fetch a batch of URLs; keep those whose text states the claim. */
export async function checkUrls(urls, claim, tf, cfg, stats, budget = null, opts = {}) {
  const hits = [];
  const misses = [];
  const via = opts.via || 'citation';
  for (const chunk of chunks(urls, 10)) {
    if (budget && budget.remainingMs() <= 0) {
      budget.markHard();
      break;
    }
    stats.fetches += chunk.length;
    let res;
    try {
      const call = tf.fetch({ urls: chunk, purpose: `Verify whether this page states the claim: ${claim.raw.slice(0, 300)}` });
      res = budget ? await raceBudget(call, budget.remainingMs()) : await call;
    } catch (e) {
      if (e.code === 'BUDGET_CAP' || e.code === 'NOT_RECORDED') throw e;
      if (e.code === 'TRACE_TIMEOUT') {
        budget?.markHard();
        break;
      }
      chunk.forEach((u) => misses.push({ url: u, reason: `could not fetch (${e.message})` }));
      continue;
    }
    for (const r of res.results || []) {
      const text = typeof r.text === 'string' ? r.text : '';
      const finalUrl = r.final_url || r.url;
      const title = r.title || '';
      const p = findPassage(text, claim, title);
      if (p) {
        if (compare(claim.raw, p.quote, { kind: claim.kind, originEntityMatch: !!p.headEntityMatch }).code === 'DIFFERENT_CONTEXT') {
          misses.push({ url: r.url, reason: 'page discusses a different statistic (subject or time frame mismatch)' });
          continue;
        }
        const dispute = detectDispute(text, p, title, claim);
        const dInfo = findDateInfo(text, r.published_date, finalUrl, claim);
        const hasPassageCitations = resolvePassageCitations(text, p, finalUrl, claim).length > 0;
        hits.push({
          url: r.url, finalUrl, title: r.title || null, passage: p, fullText: text, dispute, verifiedBy: 'fetch',
          date: dInfo.date,
          dateSource: dInfo.dateSource,
          dateUncertain: dInfo.dateUncertain,
          dateReason: dInfo.dateReason,
          hasPassageCitations,
          sourceKind: sourceKind(finalUrl, text),
        });
      } else {
        const isBotBlocked = isBotInterstitial(text);
        const dInfo = isBotBlocked ? { date: null, dateSource: null, dateUncertain: false, dateReason: null } : findDateInfo(text, r.published_date, finalUrl, claim);
        const closest = isBotBlocked ? null : findClosestPassage(text, claim);
        let reason = 'page does not state this claim';
        if (isBotBlocked) {
          reason = 'blocked by bot check';
        } else if (text.length < 200) {
          reason = 'page had almost no readable text';
        }
        misses.push({
          url: r.url,
          finalUrl,
          title: r.title || null,
          host: hostOf(finalUrl),
          date: dInfo.date,
          dateSource: dInfo.dateSource,
          closestPassage: closest,
          note: closest ? 'closest passage, not verified as the same claim' : null,
          isBotBlocked,
          reason,
        });
      }
    }
    for (const e of res.errors || []) {
      if (budget && budget.remainingMs() <= 0) {
        budget.markHard();
        break;
      }
      if (cfg.agentFallback && AGENT_CODES.has(e.error) && stats.agentCalls < cfg.maxAgentCalls) {
        const h = await agentCheck(e.url, claim, tf, stats);
        if (h) {
          hits.push(h);
          continue;
        }
      }
      const isBotBlocked = e.error === 'bot_challenge' || e.error === 'bot_blocked' || /cloudflare|recaptcha|bot/i.test(e.error || '');
      const reason = isBotBlocked ? 'blocked by bot check' : (HUMAN[e.error] || e.error);
      misses.push({
        url: e.url,
        finalUrl: e.url,
        host: hostOf(e.url),
        reason,
        isBotBlocked,
      });
    }
  }
  return { hits, misses };
}

/** Agent fallback: a real browser reads the page. Weaker evidence, labelled as such. */
export async function agentCheck(url, claim, tf, stats, { throwOnPolicy = false, errorOut = null } = {}) {
  stats.agentCalls++;
  try {
    const out = await tf.agent({
      url,
      goal: `Open this page. Find the sentence that states: "${(claim.sentence || claim.raw).slice(0, 400)}". Return that sentence copied exactly as written on the page, and the page's publication date. If the page does not state this claim, set found to false. Never paraphrase.`,
      output_schema: { type: 'object', properties: { found: { type: 'boolean' }, quote: { type: 'string' }, published_date: { type: 'string' } }, required: ['found'] },
    });
    const r = out?.result || out?.resultJson || out;
    if (!r?.found || !r.quote) return null;
    const p = findPassage(r.quote, claim);
    if (!p) return null;
    const dispute = detectDispute(r.quote, p, '', claim);
    const dInfo = findDateInfo(r.quote, r.published_date, url, claim);
    return {
      url, finalUrl: url, title: null, passage: { ...p, blockRaw: r.quote }, fullText: r.quote, dispute, verifiedBy: 'agent',
      date: dInfo.date, dateSource: dInfo.date ? 'agent' : null, dateUncertain: dInfo.dateUncertain, dateReason: dInfo.dateReason,
      hasPassageCitations: false, sourceKind: sourceKind(url, r.quote),
    };
  } catch (e) {
    if (throwOnPolicy && (e.code === 'BUDGET_CAP' || e.code === 'NOT_RECORDED' || e.code === 'AGENT_DISABLED')) {
      throw e;
    }
    if (errorOut) {
      errorOut.message = e.name === 'AbortError'
        ? 'Browser agent timed out before finishing.'
        : `Browser agent failed (${e.message || 'request error'}).`;
    }
    return null;
  }
}

export function buildQueries(claim) {
  const strip = /^(about|around|roughly|approximately|approx|nearly|almost|over|under|more than|less than|fewer than|at least|at most|up to|as many as|close to|just over|just under|upwards of|an estimated|estimated)\s+/i;
  const nums = claim.numbers.map((n) => n.raw.replace(strip, '')).slice(0, 2);
  const years = (claim.years || []).slice(0, 1).map(String);
  const entities = claim.entities || [];
  const otherToks = [...new Set(claim.tokens)].filter((t) => !entities.includes(t)).sort((a, b) => b.length - a.length);
  const toks = [...entities, ...otherToks].slice(0, 4);
  const base = [...nums, ...toks, ...years].join(' ');
  const isCorp = /\b(revenue|sales|filing|10-k|fiscal|earnings|quarterly|annual report)\b/i.test(claim.raw);
  const withKinds = isCorp ? `${base} "10-K" OR sec.gov OR investor` : `${base} study OR report OR survey`;
  const corpEntity = isCorp && entities.length ? entities[0].replace(/[^a-z0-9-]/gi, '') : '';
  const corpDomains = isCorp && corpEntity ? `sec.gov,investor.${corpEntity}.com` : isCorp ? 'sec.gov' : null;
  const corpQuery = isCorp
    ? [entities[0] || toks[0] || '', '"Form 10-K"', ...years, '"net sales" OR revenue'].filter(Boolean).join(' ')
    : null;
  return { base, withKinds, isCorp, corpQuery, corpDomains };
}

function scoreSearchUrl(url) {
  const h = hostOf(url);
  if (isBlocked(url)) return -10;
  let score = 0;
  if (/(^|\.)sec\.gov$/i.test(h)) score += 6;
  if (/\.(gov|edu|int|mil)(\.[a-z]{2})?$/i.test(h)) score += 4.5;
  if (/(^|\.)(doi\.org|arxiv\.org|pubmed\.ncbi\.nlm\.nih\.gov|pmc\.ncbi\.nlm\.nih\.gov|nature\.com|science\.org|pewresearch\.org|bls\.gov|census\.gov|who\.int)$/i.test(h)) score += 4;
  if (/\.pdf($|\?)/i.test(url)) score += 3.5;
  if (sourceKind(url) === 'primary-likely') score += 2;
  if (isTertiary(url)) score -= 4;
  return score;
}

async function searchPhase(claim, tf, visited, earliest, cfg, stats, budget = null) {
  if (budget && budget.remainingMs() <= 0) {
    budget.markHard();
    return { hits: [], misses: [] };
  }
  const { base, withKinds, isCorp, corpQuery, corpDomains } = buildQueries(claim);
  const purpose = `Find the original or earliest source (study, report, filing, dataset, interview) for this claim: ${claim.raw.slice(0, 300)}`;
  const before = earliest && earliest.length === 10 ? earliest : undefined;
  const jobs = isCorp && corpQuery
    ? [{ query: corpQuery, include_domains: corpDomains, purpose }]
    : [{ query: base, purpose, before_date: before }];
  if (cfg.searchQueries > 1 && !(isCorp && corpQuery)) {
    jobs.push({ query: withKinds, purpose, before_date: before });
  } else if (cfg.searchQueries > 1 && isCorp) {
    jobs.push({ query: base, purpose, before_date: before });
  }
  if (cfg.allowResearchPaperSearch && !isCorp) {
    jobs.push({ query: base, purpose, domain_type: 'research_paper' });
  }
  stats.searches += jobs.length;
  const call = Promise.allSettled(jobs.map((j) => tf.search(j)));
  let settled;
  try {
    settled = budget ? await raceBudget(call, budget.remainingMs()) : await call;
  } catch (e) {
    if (e.code === 'TRACE_TIMEOUT') {
      budget?.markHard();
      return { hits: [], misses: [] };
    }
    throw e;
  }
  const seen = new Set();
  const candidates = [];
  for (const s of settled) {
    if (s.status === 'rejected') {
      if (s.reason?.code === 'BUDGET_CAP' || s.reason?.code === 'NOT_RECORDED') throw s.reason;
      continue;
    }
    for (const r of s.value.results || []) {
      const u = cleanUrl(r.pdf_url || r.url);
      if (!u || seen.has(u) || visited.has(u)) continue;
      seen.add(u);
      candidates.push({ url: u, score: scoreSearchUrl(u) });
    }
  }
  const nonBlocked = candidates.filter((c) => c.score > -10);
  const pool = nonBlocked.length >= 2 ? nonBlocked : candidates;
  pool.sort((a, b) => b.score - a.score);
  const takeLimit = cfg.searchFetchLimit ?? (cfg.maxDepth > 3 ? 8 : 6);
  const take = pool.slice(0, takeLimit).map((c) => c.url);
  take.forEach((u) => visited.add(u));
  if (!take.length) return { hits: [], misses: [] };
  return checkUrls(take, claim, tf, cfg, stats, budget, { via: 'search' });
}

const pubHop = (h) => h;
const KIND_RANK = {
  'primary-likely': 3,
  'gov-release': 2,
  'press-release': 2,
  'journal-commentary': 1,
  secondary: 1,
  tertiary: 0,
};

function pickBestHit(hits) {
  return [...hits].sort((a, b) => {
    const scoreDiff = b.passage.score - a.passage.score;
    if (Math.abs(scoreDiff) > 0.15) return scoreDiff;
    const kr = (KIND_RANK[b.sourceKind] ?? 1) - (KIND_RANK[a.sourceKind] ?? 1);
    if (kr !== 0) return kr;
    return scoreDiff;
  })[0];
}

export async function* runTrace(input, tf, opts = {}) {
  const mode = opts.mode || tf?.mode || process.env.TF_MODE || 'replay';
  const fullLimits = mode === 'live' || process.env.TF_FULL === '1';
  const allowAgent = opts.allowAgent ?? (process.env.ALLOW_AGENT === '1');
  const now = opts.now ?? (() => Date.now());
  const softLimitMs = opts.softLimitMs ?? 20000;
  const hardLimitMs = opts.hardLimitMs ?? 40000;
  const startedAt = now();
  const cfg = {
    maxDepth: fullLimits ? 6 : 3,
    perHop: fullLimits ? 5 : 3,
    search: true,
    searchQueries: fullLimits ? 3 : 1,
    searchFetchLimit: fullLimits ? 8 : 6,
    allowResearchPaperSearch: fullLimits,
    agentFallback: !!input.agentFallback && allowAgent,
    maxAgentCalls: (!!input.agentFallback && allowAgent) ? 1 : 0,
    ...opts,
  };
  const timings = { totalMs: 0, softLimitHit: false, hardLimitHit: false, stages: [] };
  const budget = {
    remainingMs: () => Math.max(0, hardLimitMs - (now() - startedAt)),
    isSoftHit: () => (now() - startedAt) >= softLimitMs,
    markHard: () => { timings.hardLimitHit = true; },
  };
  const stats = { fetches: 0, searches: 0, agentCalls: 0, linksChecked: 0 };
  const claim = parseClaim(input.claim, { inQuote: input.inQuote, paragraph: input.paragraph });
  const base = cleanUrl(input.url) || input.url;
  const visited = new Set([base]);
  const chain = [];
  const extras = [];
  const rejected = [];

  const startHost = hostOf(input.url);
  const isStartWiki = /(?:^|\.)wikipedia\.org$/i.test(startHost) || /\/wiki\//i.test(input.url) || /(?:^|\.)wik[a-z0-9-]*\./i.test(startHost);
  const start = {
    id: 'h0', role: 'start', via: 'selection', verifiedBy: 'selection', url: input.url, host: startHost, title: input.title || null,
    date: normalizeDate(input.date), dateSource: input.date ? 'page-metadata' : null, quote: input.claim || claim.raw, sourceKind: sourceKind(input.url),
    sourceKindLabel: SOURCE_KIND_LABELS[sourceKind(input.url)] || 'source',
    relation: 'The claim as you highlighted it',
    dateUncertain: isStartWiki ? true : false,
    dateReason: isStartWiki ? 'wiki page continuously edited (living page)' : null,
  };
  chain.push(start);
  yield { type: 'hop', hop: pubHop(start) };
  yield { type: 'status', msg: `Reading the claim: ${claim.kind === 'stat' ? claim.numbers.map((n) => n.raw).join(', ') : claim.kind}` };

  let links = prepareLinks(input.links, input.url);
  if (!links.length && base && cfg.fetchStartUrl !== false && budget.remainingMs() > 0) {
    const t0 = now();
    try {
      const startCall = tf.fetch({ urls: [base], purpose: `Extract citations and references near the claim on ${hostOf(base)}` });
      const res = await raceBudget(startCall, budget.remainingMs());
      stats.fetches += 1;
      const r = (res.results || [])[0];
      if (r && typeof r.text === 'string') {
        const p = findPassage(r.text, claim, r.title || input.title || '');
        if (p) {
          start.title = start.title || r.title || null;
          const dInfo = findDateInfo(r.text, start.date || r.published_date, r.final_url || base, claim);
          start.date = start.date || dInfo.date;
          start.dateSource = start.dateSource || dInfo.dateSource;
          start.dateUncertain = isStartWiki || dInfo.dateUncertain;
          start.dateReason = isStartWiki ? 'wiki page continuously edited (living page)' : dInfo.dateReason;
          start.sourceKind = sourceKind(r.final_url || base, r.text);
          start.sourceKindLabel = SOURCE_KIND_LABELS[start.sourceKind] || start.sourceKind;
          const d = detectDispute(r.text, p, r.title || '', claim);
          if (d.disputed) start.dispute = { cues: d.cues, disputeQuote: d.disputeQuote };
          links = resolvePassageCitations(r.text, p, r.final_url || base, claim);
          start.hasPassageCitations = links.length > 0;
        }
      }
      timings.stages.push({ stage: 'start-page-citations', ms: now() - t0, linksFound: links.length });
    } catch (e) {
      if (e.code === 'BUDGET_CAP' || e.code === 'NOT_RECORDED') throw e;
      if (e.code === 'TRACE_TIMEOUT') budget.markHard();
      timings.stages.push({ stage: 'start-page-citations', ms: now() - t0, error: e.message });
    }
  }

  let current = start;
  for (let depth = 0; depth < cfg.maxDepth; depth++) {
    if (budget.remainingMs() <= 0) {
      budget.markHard();
      break;
    }
    if (budget.isSoftHit() && !timings.softLimitHit) {
      timings.softLimitHit = true;
      yield { type: 'status', msg: 'Still searching — following citations with partial results...', partialHops: chain.length };
    }
    const perHopLimit = current.sourceKind === 'tertiary' ? Math.max(cfg.perHop, 4) : cfg.perHop;
    const cands = rankLinks(links, claim, current.url).filter((l) => !visited.has(l.href)).slice(0, perHopLimit);
    if (!cands.length) {
      yield { type: 'status', msg: depth === 0 ? 'No citation links next to the claim on this page' : `No further citations in the passage on ${current.host}` };
      break;
    }
    yield { type: 'status', msg: `Opening ${cands.length} cited link${cands.length > 1 ? 's' : ''} from ${current.host}` };
    cands.forEach((c) => visited.add(c.href));
    stats.linksChecked += cands.length;
    const tHop = now();
    const { hits, misses } = await checkUrls(cands.map((c) => c.href), claim, tf, cfg, stats, budget);
    timings.stages.push({ stage: `hop-${depth + 1}`, ms: now() - tHop, urls: cands.length, hits: hits.length });
    for (const m of misses) {
      const r = { ...m, host: hostOf(m.url), citedBy: current.host };
      rejected.push(r);
      yield { type: 'rejected', ...r };
    }
    if (timings.hardLimitHit) break;
    if (!hits.length) {
      yield { type: 'status', msg: 'None of the cited pages state this claim' };
      break;
    }
    const best = pickBestHit(hits);
    hits.filter((h) => h !== best).forEach((h) => extras.push(toHop(h, `x${extras.length}`, 'citation', `Also cited by ${current.host}`)));
    const hop = toHop(best, `h${chain.length}`, 'citation', `Cited by ${current.host}`);
    chain.push(hop);
    yield { type: 'hop', hop: pubHop(hop) };
    current = hop;
    links = resolvePassageCitations(best.fullText || best.passage.blockRaw, best.passage, best.finalUrl, claim);
    if (hop.sourceKind === 'primary-likely' && !links.some((l) => l.inSelection)) break;
  }

  const tail = chain[chain.length - 1];
  const shouldSkipSearch = () => {
    if (timings.hardLimitHit) return 'hard time limit reached';
    if (!cfg.search) return 'search disabled in configuration';
    if (budget.isHardHit && budget.isHardHit()) return 'budget cap reached';
    // If a genuine primary source was reached through citation traversal, search is not needed.
    if (tail.sourceKind === 'primary-likely' && chain.length > 1) return 'primary source reached via citations';
    return null;
  };

  const searchSkipReason = shouldSkipSearch();
  if (searchSkipReason) {
    timings.stages.push({ stage: 'search', skipped: true, reason: searchSkipReason });
    if (timings.hardLimitHit) {
      yield { type: 'status', msg: `Time limit reached (${Math.round(hardLimitMs / 1000)}s) — finishing with the sources found so far` };
    }
  } else {
    if (budget.isSoftHit() && !timings.softLimitHit) {
      timings.softLimitHit = true;
      yield { type: 'status', msg: 'Still searching — running search for earlier primary sources...', partialHops: chain.length };
    } else {
      yield { type: 'status', msg: 'Searching for earlier or primary sources the chain missed' };
    }
    const known = chain.map((h) => h.date).filter(Boolean).sort();
    const tSearch = now();
    try {
      const { hits, misses } = await searchPhase(claim, tf, visited, known[0], cfg, stats, budget);
      timings.stages.push({ stage: 'search', ms: now() - tSearch, hits: hits.length });
      hits.forEach((h) => {
        const hop = toHop(h, `x${extras.length}`, 'search', 'Found by search; not cited by the pages above');
        extras.push(hop);
      });
      misses.forEach((m) => rejected.push({ ...m, host: hostOf(m.url), citedBy: 'search' }));
      if (timings.hardLimitHit) {
        yield { type: 'status', msg: `Time limit reached (${Math.round(hardLimitMs / 1000)}s) — finishing with the sources found so far` };
      }
    } catch (e) {
      if (e.code === 'BUDGET_CAP' || e.code === 'NOT_RECORDED') throw e;
      timings.stages.push({ stage: 'search', ms: now() - tSearch, error: e.message, skipped: true, reason: e.message });
      yield { type: 'status', msg: `Search unavailable: ${e.message}` };
    }
  }

  timings.totalMs = now() - startedAt;
  const state = {
    input: { claim: input.claim, url: input.url, title: input.title, date: input.date, inQuote: input.inQuote, paragraph: input.paragraph },
    chain, extras, rejected, stats, timings, visited: [...visited],
  };
  yield { type: 'state', state };
  yield { type: 'result', final: assemble(state) };
}

export function toHop(h, id, via, relation) {
  const kind = h.sourceKind || 'secondary';
  return {
    id, role: 'source', via, verifiedBy: h.verifiedBy, url: h.finalUrl, host: hostOf(h.finalUrl), title: h.title,
    date: h.date, dateSource: h.dateSource,
    ...(h.dateUncertain ? { dateUncertain: true, dateReason: h.dateReason || null } : {}),
    hasPassageCitations: !!h.hasPassageCitations,
    quote: h.passage.quote,
    ...(h.passage.scaleFactor > 1 ? { originScale: h.passage.scaleFactor } : {}),
    ...(h.passage.headEntityMatch ? { originEntityMatch: true } : {}),
    dispute: h.dispute?.disputed ? { cues: h.dispute.cues, disputeQuote: h.dispute.disputeQuote } : null,
    sourceKind: kind, sourceKindLabel: SOURCE_KIND_LABELS[kind] || kind, relation,
  };
}

const TONE = {
  MATCH: 'ok', UNCITED: 'warn', ROUNDED: 'warn', YEAR: 'warn', HEDGE_DROPPED: 'warn', DIFFERENT_CONTEXT: 'warn',
  CHANGED: 'bad', SCOPE: 'bad', CAUSATION: 'bad', MISQUOTED: 'bad', CONTRADICTED: 'bad', DISPUTED: 'bad',
  CITED_UNCONFIRMED: 'warn', PRIMARY_PUBLISHER: 'ok',
};
const SEV = {
  MATCH: 0, PRIMARY_PUBLISHER: 0, UNCITED: 1, YEAR: 1, ROUNDED: 1, CITED_UNCONFIRMED: 2, DIFFERENT_CONTEXT: 2, HEDGE_DROPPED: 2,
  SCOPE: 3, CAUSATION: 3, MISQUOTED: 3, CHANGED: 4, CONTRADICTED: 5, DISPUTED: 5,
};

export function isLikelyPrimaryPublisher(host = '') {
  const h = String(host || '').toLowerCase();
  if (/\.(?:gov|int|mil)$/i.test(h)) return true;
  if (/(?:^|\.)(?:who\.int|cdc\.gov|bls\.gov|sec\.gov|census\.gov|nih\.gov|un\.org|worldbank\.org|imf\.org|oecd\.org|pewresearch\.org|federalreserve\.gov|ecb\.europa\.eu)$/i.test(h)) return true;
  if (/\.edu$/i.test(h) && !/(?:^|\.)(?:wikipedia|wikimedia|wiktionary)\.org$/i.test(h)) return true;
  return false;
}

export function assemble(state) {
  const claim = parseClaim(state.input.claim, { inQuote: state.input.inQuote, paragraph: state.input.paragraph });
  let chain = (state.chain || []).map((h) => {
    const copy = { ...h };
    const isWiki = /(?:^|\.)wikipedia\.org$/i.test(copy.host || hostOf(copy.url)) || /\/wiki\//i.test(copy.url || '') || /(?:^|\.)wik[a-z0-9-]*\./i.test(copy.host || hostOf(copy.url));
    if (isWiki) {
      copy.dateUncertain = true;
      copy.dateReason = 'wiki page continuously edited (living page)';
    }
    return copy;
  });
  let extras = (state.extras || []).map((h) => ({ ...h }));

  // If start page is a likely primary publisher, any candidate or hop on the same organisation
  // with matching wording is a regional/mirror copy of the same publisher, not a deeper origin.
  if (chain.length > 0 && isLikelyPrimaryPublisher(chain[0].host)) {
    const startHost = chain[0].host;
    if (chain.length > 1) {
      const sameOrgHops = [];
      const remainingChain = [chain[0]];
      for (let i = 1; i < chain.length; i++) {
        const h = chain[i];
        if (isSameOrg(h.host, startHost)) {
          const comp = compare(chain[0].quote, h.quote, { kind: claim.kind, originScale: h.originScale || 1, originEntityMatch: !!h.originEntityMatch });
          if (comp.code === 'MATCH') {
            sameOrgHops.push({ ...h, relation: 'same publisher, regional copy' });
            continue;
          }
        }
        remainingChain.push(h);
      }
      chain = remainingChain;
      extras = [...extras, ...sameOrgHops];
    }
    extras = extras.map((h) => {
      if (isSameOrg(h.host, startHost)) {
        const comp = compare(chain[0].quote, h.quote, { kind: claim.kind, originScale: h.originScale || 1, originEntityMatch: !!h.originEntityMatch });
        if (comp.code === 'MATCH') {
          return { ...h, relation: 'same publisher, regional copy' };
        }
      }
      return h;
    });
  }

  const cands = [...chain.slice(1), ...extras];
  const stats = state.stats;
  const timings = state.timings || null;
  const base = { claim: { raw: state.input?.claim || claim.raw, kind: claim.kind }, stats, timings, rejected: state.rejected || [] };

  const originable = cands.filter((h) => {
    const comp = compare(chain[0].quote, h.quote, { kind: claim.kind, originScale: h.originScale || 1, originEntityMatch: !!h.originEntityMatch });
    if (comp.code === 'DIFFERENT_CONTEXT') return false;
    if (chain.length === 1 && isLikelyPrimaryPublisher(chain[0].host) && isSameOrg(h.host, chain[0].host)) {
      if (comp.code === 'MATCH') return false;
    }
    return !(
      chain.length === 1 &&
      chain[0]?.date && !chain[0].dateUncertain &&
      h.via === 'search' &&
      h.sourceKind !== 'primary-likely' &&
      !h.dateUncertain &&
      h.date && dateKey(h.date) > dateKey(chain[0].date)
    );
  });

  const FORUM_UGC_WORD_RE = /\b(forums?|comments?|discussions?|threads?|community|answers|quora|reddit|stackexchange|disqus)\b/i;
  const UGC_QUOTE_RE = /^\s*(?:[^\n:]{1,50}\s+wrote\s*:|posted\s+by\b)/i;
  const GENERIC_CLAIM_WORDS = new Set([
    'year', 'years', 'month', 'months', 'day', 'days', 'percent', 'percentage',
    'approximately', 'approx', 'estimated', 'total', 'reported', 'said', 'say',
    'found', 'stated', 'state', 'show', 'shows', 'time', 'times', 'met', 'make',
    'way', 'all', 'nearly', 'almost', 'number'
  ]);

  const annotateAlso = (items) => items
    .filter((h) => {
      // Step 0a: Exclude start page's own host from alsoFound
      if (chain[0]?.host && h.host === chain[0].host) return false;
      if (chain[0]?.url && cleanUrl(h.url) === cleanUrl(chain[0].url)) return false;

      // Filter forum posts, comment sections, Q&A threads or UGC discussion
      let uObj;
      try { uObj = new URL(h.url); } catch {}
      const hostAndPath = (uObj ? (uObj.hostname + ' ' + uObj.pathname) : (h.url || '')).toLowerCase();
      if (FORUM_UGC_WORD_RE.test(hostAndPath)) return false;

      // Filter quotes starting with "<name> wrote:" or "posted by"
      if (UGC_QUOTE_RE.test(h.quote || '')) return false;

      // Step 0b: Check that quote states the same statistic as the claim
      const claimNums = (parseClaim(chain[0]?.quote || claim.raw).numbers || []).map((n) => n.value);
      if (claimNums.length > 0) {
        const qNums = (parseClaim(h.quote).numbers || []).map((n) => n.value);
        const hasMatchingStat = claimNums.some((v) => qNums.includes(v));
        if (!hasMatchingStat) return false;
      }

      // Require that alsoFound passage shares the claim's subject words (e.g. for brain10: "brain")
      const claimSubjectToks = contentTokens(chain[0]?.quote || claim.raw).filter((t) => !GENERIC_CLAIM_WORDS.has(t));
      if (claimSubjectToks.length > 0) {
        const quoteToks = new Set(contentTokens(h.quote));
        const hasSubjectMatch = claimSubjectToks.some((t) => quoteToks.has(t));
        if (!hasSubjectMatch) return false;
      }

      return true;
    })
    .map((h) => {
      const vc = compare(chain[0].quote, h.quote, { kind: claim.kind, originScale: h.originScale || 1, originEntityMatch: !!h.originEntityMatch });
      return { ...h, vsClaim: { code: vc.code, flags: vc.flags } };
    })
    .filter((h) => h.vsClaim?.code !== 'CHANGED');

  if (!originable.length) {
    const alsoFound = annotateAlso(extras);
    const startDispute = chain[0]?.dispute;
    if (startDispute?.disputeQuote || startDispute?.cues?.length) {
      return {
        ...base, status: 'disputed_on_page', tone: 'bad', code: 'DISPUTED', severity: SEV.DISPUTED,
        headline: 'The page you are on disputes this claim',
        disputeQuote: startDispute.disputeQuote,
        disputeCues: startDispute.cues,
        disputeHost: chain[0].host,
        disputeDate: chain[0].date,
        disputeDateUncertain: !!chain[0].dateUncertain,
        reasons: [
          `The page at ${chain[0].host} disputes this claim (cues: ${startDispute.cues.join(', ')}).`,
          'No original source found for the claim.',
          ...(stats?.searches ? [`${stats.searches} search${stats.searches > 1 ? 'es' : ''} for the wording found no earlier page stating it.`] : []),
          ...(timings?.hardLimitHit ? ['Search reached the 40s time limit before external sources could be verified.'] : []),
        ],
        chain, alsoFound, deepTraceAvailable: true,
      };
    }

    // REQUIREMENT 3: Publisher is the source
    if (chain.length === 1 && isLikelyPrimaryPublisher(chain[0].host) && !chain[0].hasPassageCitations) {
      const host = chain[0].host;
      const hasRefLinks = Boolean(state.input?.hasReferenceLinks || chain[0]?.hasReferenceLinks);
      return {
        ...base,
        status: 'publisher_is_source',
        tone: 'ok',
        code: 'PRIMARY_PUBLISHER',
        severity: SEV.PRIMARY_PUBLISHER ?? 0,
        headline: `Publisher is the source: ${host} cites no earlier source for this passage`,
        origin: chain[0],
        hasReferenceLinks: hasRefLinks,
        reasons: [
          `This page is published by a recognized primary publisher (${host}).`,
          `It cites no earlier source for this passage.`,
          stats.searches ? `${stats.searches} search${stats.searches > 1 ? 'es' : ''} for the wording found no earlier publication.` : 'No earlier publication found.',
          ...(hasRefLinks ? ['This page has a References/Sources section.'] : []),
        ],
        chain,
        alsoFound,
        deepTraceAvailable: true,
      };
    }

    // REQUIREMENT 2: Cited, not confirmed / Cited, but could not be read
    const citedMisses = (state.rejected || []).filter((r) => r.citedBy && r.citedBy !== 'search');
    const checked = stats.linksChecked || citedMisses.length;
    const hasCitationsNearClaim = Boolean(chain[0]?.hasPassageCitations || checked > 0 || citedMisses.length > 0);
    if (hasCitationsNearClaim) {
      const citedPages = citedMisses.map((r) => {
        const isBotBlocked = Boolean(r.isBotBlocked || /bot check|recaptcha|checking your browser|just a moment/i.test(r.reason || ''));
        const reason = isBotBlocked ? 'blocked by a bot check' : (r.reason || 'page does not state this claim');
        const closestPassage = isBotBlocked ? null : (r.closestPassage || null);
        return {
          url: r.url,
          host: r.host || hostOf(r.url),
          date: r.date || null,
          title: r.title || null,
          closestPassage,
          note: closestPassage ? 'closest passage, not verified as the same claim' : null,
          reason,
          isBotBlocked,
        };
      });

      const allUnreadable = citedPages.length > 0 && citedPages.every((cp) => cp.isBotBlocked || cp.reason === 'blocked by a bot check' || cp.reason === 'page had almost no readable text' || cp.reason === 'site unreachable' || !cp.closestPassage);
      const headline = allUnreadable
        ? 'Cited, but the cited pages could not be read'
        : 'Cited, but none of the cited pages confirm this wording';
      const paraphraseNote = allUnreadable
        ? 'Open them to check the wording yourself.'
        : 'This can happen when the writer paraphrased the study.';

      return {
        ...base,
        status: 'cited_not_confirmed',
        tone: 'warn',
        code: 'CITED_UNCONFIRMED',
        severity: SEV.CITED_UNCONFIRMED ?? 2,
        headline,
        citedPages,
        allUnreadable,
        paraphraseNote,
        reasons: [
          allUnreadable
            ? `${citedPages.length || checked || 1} cited link${(citedPages.length || checked || 1) > 1 ? 's were' : ' was'} opened but could not be read (${citedPages[0]?.reason || 'blocked by a bot check'}).`
            : `${citedPages.length || checked || 1} cited link${(citedPages.length || checked || 1) > 1 ? 's were' : ' was'} opened and none state this claim.`,
          paraphraseNote,
          stats.searches ? `${stats.searches} search${stats.searches > 1 ? 'es' : ''} for the wording found no earlier page stating it.` : 'No searches were run.',
          'No verifiable primary or secondary source was found from this trace.',
        ],
        chain,
        alsoFound,
        deepTraceAvailable: true,
      };
    }

    if (alsoFound.length && !chain[0].hasPassageCitations) {
      const alsoScope = alsoFound.flatMap((a) => (a.vsClaim?.flags || []).filter((fl) => fl.code === 'SCOPE').map((fl) => `Also-found source (${a.host}): ${fl.text}`));
      return {
        ...base, status: 'earliest_uncited', tone: 'warn', code: 'UNCITED', severity: SEV.UNCITED,
        originCitesNothing: true,
        headline: 'Earliest page found cites no source; original not found',
        reasons: [
          'The page gives no citation next to this claim.',
          'The earliest page found states this claim, cites no source for it, and searches found nothing earlier; no original source was found.',
          ...alsoScope,
        ],
        chain, alsoFound, deepTraceAvailable: true,
      };
    }

    return {
      ...base, status: 'no_source', tone: 'none', code: 'NO_SOURCE', headline: 'No original source found',
      reasons: [
        'The page gives no citation next to this claim.',
        stats.searches ? `${stats.searches} searches for the wording found no earlier page stating it.` : 'No searches were run.',
        ...(timings?.hardLimitHit ? ['Search reached the 40s time limit; partial checks completed.'] : []),
        'No verifiable primary or secondary source was found from this trace.',
      ],
      chain, alsoFound, deepTraceAvailable: true,
    };
  }

  // Origin: primary-likely (earliest reliable first) -> non-tertiary (reliably dated earliest first, press-release preferred on equal date) -> tertiary only as last resort.
  const byDate = (a, b) => {
    if (!!a.dateUncertain !== !!b.dateUncertain) return a.dateUncertain ? 1 : -1;
    const dd = (dateKey(a.date) ?? Infinity) - (dateKey(b.date) ?? Infinity);
    if (dd !== 0) return dd;
    return (KIND_RANK[b.sourceKind] ?? 1) - (KIND_RANK[a.sourceKind] ?? 1);
  };
  const datedPrimaries = originable.filter((h) => h.sourceKind === 'primary-likely' && h.date && !h.dateUncertain).sort(byDate);
  const primaries = originable.filter((h) => h.sourceKind === 'primary-likely').sort(byDate);
  const nonTert = originable.filter((h) => h.sourceKind !== 'tertiary');
  const datedNonTert = nonTert.filter((h) => h.date && !h.dateUncertain).sort(byDate);
  const nonTertSorted = [...nonTert].sort(byDate);
  let origin = datedPrimaries[0] || datedNonTert[0] || primaries[0] || nonTertSorted[0] || originable.sort(byDate)[0] || chain[chain.length - 1];
  // If multiple candidate pages exist and origin has no dispute while another cited/non-tertiary page disputes it, surface the disputing page.
  const disputedCand = originable.find((h) => h.dispute && h.sourceKind !== 'tertiary') || originable.find((h) => h.dispute);
  if (!origin.dispute && disputedCand && (origin.sourceKind === 'tertiary' || disputedCand.sourceKind === 'primary-likely' || (origin.via === 'search' && disputedCand.via === 'search'))) {
    origin = disputedCand;
  }
  const start0 = (ch) => ch[0];
  if (origin === start0(chain)) origin = chain[chain.length - 1];
  const originIdx = chain.findIndex((h) => h.id === origin.id);
  let display = chain;
  let alsoFound = annotateAlso(extras.filter((h) => h.id !== origin.id).sort(byDate));
  if (originIdx < 0) {
    display = [...chain, { ...origin, role: 'source' }];
  } else {
    display = chain.slice(0, originIdx + 1); // anything cited beyond the origin is irrelevant
  }
  display = display.map((h) => ({ ...h }));
  const o = display[display.length - 1];
  o.role = 'origin';
  const kind = claim.kind;

  display.forEach((h, i) => {
    if (h === o) {
      h.vsOrigin = { code: 'MATCH', flags: [], diff: null };
      return;
    }
    const v = compare(h.quote, o.quote, { kind, originScale: o.originScale || 1, originEntityMatch: !!o.originEntityMatch });
    h.vsOrigin = { code: v.code, flags: v.flags };
    h.quoteDiff = v.diff;
    const next = display[i + 1];
    if (next) {
      const step = next === o ? v : compare(h.quote, next.quote, { kind, originScale: next.originScale || 1, originEntityMatch: !!next.originEntityMatch });
      h.vsCited = { code: step.code, flags: step.flags };
      h.changedHere = step.code !== 'MATCH';
    }
    // date sanity: a source cannot be cited before it was published
    if (next && h.date && next.date && !h.dateUncertain && !next.dateUncertain && dateKey(next.date) > dateKey(h.date)) {
      h.flags = [...(h.flags || []), { code: 'DATE', text: `Cites a source dated ${next.date}, later than its own date ${h.date}` }];
    }
    if (h.dateUncertain) {
      h.flags = [...(h.flags || []), { code: 'DATE', text: `Date shown as uncertain (${h.dateReason || 'unreliable page date'})` }];
    }
  });

  const start = display[0];
  const v = start.vsOrigin;
  const primary = o.sourceKind === 'primary-likely';
  const govRelease = o.sourceKind === 'gov-release';
  const pressRelease = o.sourceKind === 'press-release';
  const tertiary = o.sourceKind === 'tertiary';
  const journalCommentary = o.sourceKind === 'journal-commentary';
  const disputeHop = o.dispute ? o : display.find((h) => h.dispute && h !== start) || null;
  const startDispute = start.dispute?.disputeQuote ? start.dispute : null;
  const uncitedSecondary = !primary && !pressRelease && !govRelease && !tertiary && !disputeHop && !startDispute && v.code !== 'CONTRADICTED' && !o.hasPassageCitations && (stats?.searches > 0 || (chain.length <= 2 && extras.length === 0));
  const tracedPrimary = primary ? 'traced_primary' : tertiary ? 'traced_tertiary' : uncitedSecondary ? 'earliest_uncited' : 'traced_secondary';
  const where = display.find((h) => h.changedHere);

  let finalCode = v.code;
  let headline;
  let finalTone = TONE[finalCode] || 'warn';
  if (disputeHop) {
    finalCode = 'DISPUTED';
    finalTone = 'bad';
    headline = 'The source page disputes this claim';
    // If numbers are equal, suppress numeric CHANGED drift
    if (v.code === 'CHANGED') {
      const numsStart = (parseClaim(start.quote).numbers || []).map((n) => n.value);
      const numsOrig = (parseClaim(o.quote).numbers || []).map((n) => n.value);
      if (numsStart.length && numsOrig.length && numsStart[0] === numsOrig[0]) {
        v.flags = v.flags.filter((fl) => fl.code !== 'CHANGED');
        v.code = 'DISPUTED';
      }
    }
  } else if (startDispute) {
    finalCode = 'DISPUTED';
    finalTone = 'bad';
    headline = 'The page you are on disputes this claim';
  } else if (v.code === 'CONTRADICTED') {
    headline = 'Source wording contradicts this claim';
  } else if (govRelease) {
    if (v.code === 'MATCH') {
      headline = 'Matches the official agency news release';
      finalTone = 'ok';
    } else {
      headline = `${LABELS[v.code]} since the official agency news release`;
    }
  } else if (pressRelease) {
    if (v.code === 'MATCH') {
      headline = 'Earliest page found is a press release';
      finalTone = 'warn';
    } else {
      headline = `${LABELS[v.code]} since the institutional press release`;
    }
  } else if (v.code === 'MATCH') {
    if (primary) headline = 'Matches the likely primary source';
    else if (tertiary) headline = 'Matched only on a tertiary page (follow citations)';
    else if (uncitedSecondary) { finalCode = 'UNCITED'; headline = 'Earliest page found cites no source; original not found'; finalTone = 'warn'; }
    else headline = 'Matches the earliest page found';
  } else {
    headline = uncitedSecondary
      ? `${LABELS[v.code]} since earliest page found (cites no source)`
      : `${LABELS[v.code]} since the ${primary ? 'likely primary source' : 'earliest page found'}`;
  }

  const reasons = v.flags.map((f) => f.text);
  for (const a of alsoFound) {
    for (const fl of (a.vsClaim?.flags || []).filter((x) => x.code === 'SCOPE')) {
      reasons.push(`Also-found source (${a.host}): ${fl.text}`);
    }
  }
  if (disputeHop) {
    reasons.unshift(`The source at ${disputeHop.host} disputes this claim (cues: ${disputeHop.dispute.cues.join(', ')}).`);
    if (startDispute && disputeHop !== start) {
      reasons.push(`The starting page at ${start.host} also disputes this claim: "${startDispute.disputeQuote}"`);
    }
  } else if (startDispute) {
    reasons.unshift(`The page at ${start.host} disputes this claim (cues: ${startDispute.cues.join(', ')}).`);
  }
  if (where && where !== start && !disputeHop) reasons.push(`The wording first changes at ${where.host}.`);
  if (tertiary) {
    reasons.push(`The only matching page (${o.host}) is ${SOURCE_KIND_LABELS.tertiary}; follow its citations rather than treating it as a primary source.`);
  } else if (govRelease && !disputeHop) {
    reasons.push(`The earliest page found (${o.host}) is an official agency news release.`);
  } else if (pressRelease && !disputeHop) {
    reasons.push(`The earliest page found (${o.host}) is an institutional press release about the study (secondary), not the peer-reviewed study itself.`);
  } else if (uncitedSecondary && !disputeHop) {
    reasons.push('The earliest page found states this claim, cites no source for it, and searches found nothing earlier; no original source was found.');
  } else if (journalCommentary) {
    reasons.push('The earliest page found appears to be journal news or commentary (secondary), not a primary research study. A primary source may exist that this trace could not reach.');
  } else if (!primary) {
    reasons.push('The earliest page found looks like a secondary source (not a study, filing or dataset). A primary source may exist that this trace could not reach.');
  } else {
    reasons.push('The earliest page found looks like a primary source (judged from its domain and content; confirm before relying on it).');
  }
  const oDateKey = (!o.dateUncertain && o.date) ? dateKey(o.date) : null;
  const earlierOfficial = Number.isFinite(oDateKey)
    ? alsoFound
        .filter((a) => (a.sourceKind === 'gov-release' || a.sourceKind === 'press-release') && !a.dateUncertain && a.date && Number.isFinite(dateKey(a.date)) && dateKey(a.date) < oDateKey)
        .sort((a, b) => dateKey(a.date) - dateKey(b.date))[0] || null
    : null;
  if (earlierOfficial) {
    reasons.push(`Origin note (${o.host}, ${o.date}): an earlier official release is listed below (${earlierOfficial.host}, ${earlierOfficial.date}).`);
  }
  if (o.dateUncertain) {
    reasons.push(`The date on ${o.host} is shown as uncertain (${o.dateReason || 'updated or post-era page date'}).`);
  }
  if (timings?.hardLimitHit) {
    reasons.push('Search reached the 40s time limit; showing the sources verified so far.');
  }

  display.forEach((h) => {
    if (h.changedHere && (h.dispute || disputeHop)) {
      h.disputedHere = true;
    }
  });

  return {
    ...base,
    status: tracedPrimary,
    tone: finalTone,
    code: finalCode,
    severity: SEV[finalCode],
    headline,
    ...(uncitedSecondary ? { originCitesNothing: true } : {}),
    ...(where ? { firstDriftHopId: where.id } : {}),
    ...(disputeHop ? {
      disputeQuote: disputeHop.dispute.disputeQuote,
      disputeCues: disputeHop.dispute.cues,
      disputeHost: disputeHop.host,
      disputeDate: disputeHop.date,
      disputeDateUncertain: !!disputeHop.dateUncertain,
    } : startDispute ? {
      disputeQuote: startDispute.disputeQuote,
      disputeCues: startDispute.cues,
      disputeHost: start.host,
      disputeDate: start.date,
      disputeDateUncertain: !!start.dateUncertain,
    } : {}),
    reasons,
    chain: display,
    alsoFound,
    origin: {
      url: o.url,
      date: o.date,
      ...(o.dateUncertain ? { dateUncertain: true, dateReason: o.dateReason || null } : {}),
      ...(earlierOfficial ? { earlierOfficialRelease: { host: earlierOfficial.host, date: earlierOfficial.date, url: earlierOfficial.url, note: 'an earlier official release is listed below' } } : {}),
      host: o.host,
      sourceKind: o.sourceKind,
      sourceKindLabel: SOURCE_KIND_LABELS[o.sourceKind] || o.sourceKind,
    },
    deepTraceAvailable: true,
  };
}
const start0 = (chain) => chain[0];
