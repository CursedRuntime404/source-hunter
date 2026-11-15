// TinyResearch is the "deep trace". It runs for minutes (5-20 for mode "deep"), so it is async and opt-in.
// IMPORTANT: Research output is treated as a LEAD, never as evidence. Every URL it cites is re-fetched by the
// Fetch API and the claim must be found in the page text before it appears in the trail.
import { checkUrls, toHop, assemble } from './trace.js';
import { parseClaim, cleanUrl, hostOf } from './text.js';

export function researchQuery(input) {
  const sentence = (input.paragraph && parseClaim(input.claim, { paragraph: input.paragraph }).sentence) || input.claim;
  return (
    `Trace where this claim originally came from: "${sentence.slice(0, 600)}" (seen at ${input.url}). ` +
    `Find the earliest or primary source (the original study, report, filing, dataset or interview) and the publications that repeated it on the way. ` +
    `For each, give the URL, the publication date, and the exact wording of the claim. ` +
    `Say clearly if the numbers or wording changed along the way, and say explicitly if no original source can be found.`
  );
}

export async function startResearch(input, tf) {
  const r = await tf.researchStart({ query: researchQuery(input), mode: 'deep' });
  const id = r.research_run_id || r.run_id || r.id;
  if (!id) throw new Error('Research did not return a run id');
  return id;
}

function extractUrlsFromText(text, add) {
  if (!text) return;
  // First extract markdown links [label](url) supporting balanced single-level parens e.g. Wikipedia
  const mdRe = /\[[^\]]*\]\((https?:\/\/(?:[^()\s]+|\([^()\s]*\))+)\)/g;
  for (const m of text.matchAll(mdRe)) add(m[1]);
  // Also extract bare URLs not matched cleanly (strip trailing punctuation/backticks)
  const bareRe = /https?:\/\/(?:[^()\s<>"'`]+|\([^()\s<>"'`]*\))+/g;
  for (const m of text.matchAll(bareRe)) add(m[0].replace(/[.,;`]+$/, ''));
}

export function collectCitations(run) {
  const urls = new Set();
  const add = (u) => {
    const c = typeof u === 'string' ? cleanUrl(u) : null;
    if (c) urls.add(c);
  };
  const d = run?.deep_result || run?.quick_result || {};
  (d.citations || []).forEach((c) => add(typeof c === 'string' ? c : c?.url));
  if (Array.isArray(run?.evidence)) {
    for (const e of run.evidence) add(e?.url || e?.source_url);
  } else if (Array.isArray(run?.evidence?.sources)) {
    for (const e of run.evidence.sources) add(e?.url || e?.source_url);
  }
  const text = String(d.result || d.answer || d.summary || d.markdown || '');
  extractUrlsFromText(text, add);
  if (Array.isArray(d.sections)) {
    for (const s of d.sections) {
      extractUrlsFromText(String(s.content || s.text || s.markdown || ''), add);
      (s.citations || []).forEach((c) => add(typeof c === 'string' ? c : c?.url));
    }
  }
  return [...urls];
}

export function reportText(run) {
  const d = run?.deep_result || run?.quick_result || {};
  return String(d.result || d.answer || '');
}

/** Verify Research's citations with Fetch and fold the ones that really state the claim into the trail. */
const ACADEMIC_RE = /(?:science\.org|sciencemag\.org|nature\.com|doi\.org|pubmed|ncbi\.nlm\.nih\.gov|plos\.org|pnas\.org|arxiv\.org|springer\.com|wiley\.com|sciencedirect\.com|\.(?:gov|edu)(?:\/|$))/i;

export async function mergeResearch(state, run, tf, cfg = { agentFallback: false, maxAgentCalls: 0 }) {
  const claim = parseClaim(state.input.claim, { inQuote: state.input.inQuote, paragraph: state.input.paragraph });
  const visited = new Set(state.visited || []);
  const limit = Number.isFinite(cfg?.maxCitations) ? Math.max(0, cfg.maxCitations) : 12;
  const allFresh = collectCitations(run).filter((u) => !visited.has(u));
  const prioritized = [
    ...allFresh.filter((u) => ACADEMIC_RE.test(u)),
    ...allFresh.filter((u) => !ACADEMIC_RE.test(u)),
  ];
  const fresh = prioritized.slice(0, limit);
  const stats = state.stats;
  const { hits, misses } = fresh.length ? await checkUrls(fresh, claim, tf, cfg, stats, null, { via: 'research' }) : { hits: [], misses: [] };
  const extras = [...state.extras];
  hits.forEach((h) =>
    extras.push(toHop(h, `r${extras.length}`, 'research', 'Proposed by TinyResearch, confirmed by fetching the page'))
  );
  const rejected = [...(state.rejected || []), ...misses.map((m) => ({ ...m, host: hostOf(m.url), citedBy: 'TinyResearch' }))];
  const next = { ...state, extras, rejected, visited: [...visited, ...fresh] };
  const final = assemble(next);
  if (!final.origin || final.origin.sourceKind !== 'primary-likely') {
    const rep = reportText(run);
    const jMatch = rep.match(/published(?:\s+on[^.]{0,40})?\s+in\s+\*?([A-Z][A-Za-z0-9&'-]{2,30})\*?/);
    const failedAcad = [...new Set(misses.filter((m) => ACADEMIC_RE.test(m.url)).map((m) => hostOf(m.url)))];
    const msg = jMatch
      ? `TinyResearch did not reach the peer-reviewed ${jMatch[1]} paper${failedAcad.length ? ` (Fetch could not read ${failedAcad.join(', ')})` : ''}.`
      : `TinyResearch proposed ${fresh.length} citation(s) (${hits.length} verified by Fetch), but did not reach a fetch-verified primary paper.`;
    final.reasons = [...(final.reasons || []), msg];
  }
  final.research = {
    totalCitationsFound: allFresh.length,
    citationsProposed: fresh.length,
    confirmed: hits.length,
    proposedUrls: fresh,
    confirmedUrls: hits.map((h) => h.finalUrl || h.url),
    discardedUrls: misses.map((m) => ({ url: m.url, reason: m.reason })),
    terminationReason: run?.deep_result?.termination_reason || null,
  };
  return { state: next, final };
}
