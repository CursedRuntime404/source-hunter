import { parseClaim, cleanUrl } from './text.js';
import { agentCheck, toHop, assemble } from './trace.js';

/** Retry a rejected/blocked URL via TinyFish Browser Agent (requires ALLOW_AGENT=1). */
export async function runAgentRetry({ state, targetUrl, tf }) {
  const normalizedTarget = cleanUrl(targetUrl) || targetUrl;
  const claim = parseClaim(state.input.claim, {
    inQuote: state.input.inQuote,
    paragraph: state.input.paragraph,
  });
  const stats = { ...state.stats };
  const errorOut = {};
  const hit = await agentCheck(normalizedTarget, claim, tf, stats, { throwOnPolicy: true, errorOut });
  if (!hit) {
    const nextState = { ...state, stats };
    return {
      hit: null,
      reason: errorOut.message || 'Browser agent opened the page, but could not find a verbatim sentence matching this claim.',
      state: nextState,
      final: assemble(nextState),
    };
  }
  const hop = toHop(hit, `a${state.extras.length}`, 'agent', 'Read via browser agent after Fetch failed; confirmed verbatim wording');
  const extras = [...state.extras, hop];
  const rejected = (state.rejected || []).filter((r) => (cleanUrl(r.url) || r.url) !== normalizedTarget);
  const visited = [...new Set([...(state.visited || []), normalizedTarget])];
  const nextState = { ...state, extras, rejected, stats, visited };
  return { hit: hop, reason: null, state: nextState, final: assemble(nextState) };
}
