// Deterministic drift detection between a hop's wording and the origin's wording.
// Numbers are compared in code. No LLM is involved, so every flag has a reproducible reason.
import { extractNumbers, rel, normalize, contentTokens, tokenMatchCount, wordDiff, splitSentences } from './text.js';

const WIDEN = ['all', 'every', 'always', 'never', 'everyone', 'nobody', 'entire', 'completely', 'guaranteed', 'proves', 'proven'];
const HEDGE = ['may', 'might', 'up to', 'as many as', 'estimated', 'approximately', 'about', 'around', 'some', 'often', 'suggests', 'suggest', 'appears', 'likely', 'roughly'];
const WEAK_LINK = ['associated with', 'linked to', 'correlated with', 'correlation', 'related to'];
const CAUSAL = ['causes', 'caused by', 'leads to', 'lead to', 'results in', 'due to', 'because of', 'triggers', 'makes you'];
const LOWER_BOUND = ['over', 'more than', 'at least', 'upwards of', 'just over'];
const UPPER_BOUND = ['under', 'less than', 'fewer than', 'at most', 'nearly', 'almost', 'just under'];

const hasPhrase = (norm, p) => new RegExp(`(^|[^a-z])${p.replace(/ /g, '\\s+')}([^a-z]|$)`).test(norm);
const present = (norm, list) => list.filter((p) => hasPhrase(norm, p));

function precision(n) {
  return n.decimals;
}

function compareNumbers(hopNums, origNums) {
  const flags = [];
  const used = new Set();
  let worst = 'MATCH';
  const rank = { MATCH: 0, ROUNDED: 1, CHANGED: 2 };
  const bump = (v) => {
    if (rank[v] > rank[worst]) worst = v;
  };
  for (const a of hopNums) {
    let bestJ = -1;
    let bestRel = Infinity;
    origNums.forEach((b, j) => {
      if (used.has(j) || a.unit !== b.unit) return;
      const r = rel(a.value, b.value);
      if (r < bestRel) {
        bestRel = r;
        bestJ = j;
      }
    });
    if (bestJ < 0) continue; // no same-unit number in the original to compare against
    const b = origNums[bestJ];
    used.add(bestJ);
    if (bestRel < 1e-9) {
      if (a.qualifier !== b.qualifier && (b.qualifier || a.qualifier)) {
        flags.push({ code: 'QUALIFIER', text: `Original says "${b.raw}", this version says "${a.raw}"` });
      }
      continue;
    }
    const coarser = Math.min(precision(a), precision(b));
    const half = 0.5 * Math.pow(10, -coarser);
    const unitScale = a.value / (a.shown || 1);
    const diffShown = Math.abs(a.value - b.value) / (unitScale || 1);
    let rounded = diffShown <= half + 1e-9;
    if (!rounded && a.qualifier && rel(a.value, b.value) <= 0.1) {
      if (LOWER_BOUND.includes(a.qualifier) && a.value <= b.value) rounded = true;
      if (UPPER_BOUND.includes(a.qualifier) && a.value >= b.value) rounded = true;
      if (['about', 'around', 'roughly', 'approximately', 'approx', 'close to'].includes(a.qualifier)) rounded = true;
    }
    if (rounded) {
      bump('ROUNDED');
      flags.push({ code: 'ROUNDED', text: `Original says ${b.raw}; this version says ${a.raw} (rounded, ${(rel(a.value, b.value) * 100).toFixed(1)}% off)` });
    } else {
      bump('CHANGED');
      flags.push({ code: 'CHANGED', text: `Original says ${b.raw}; this version says ${a.raw} (${(rel(a.value, b.value) * 100).toFixed(0)}% different)` });
    }
  }
  return { worst, flags };
}

const CONTRADICT_RE = /\b(not|never|didn'?t|did not|doesn'?t|does not|don'?t|do not|cannot|can't|couldn'?t|could not|wasn'?t|was not|weren'?t|were not|isn'?t|is not|aren'?t|are not|hasn'?t|has not|haven'?t|have not|neither|nor|no\s+(?:historical\s+|contemporary\s+|scientific\s+|credible\s+)?(?:evidence|record|proof|basis|truth|longer)|myth|misconception|misattributed|apocryphal|falsely|debunk(?:ed|s|ing)?|hoax|fabricated|untrue|unfounded)\b/gi;
const CLAIM_WRONG_RE = /\b(?:claim|story|myth|notion|idea|quote|rumor|rumour|it|this|that)\s+(?:is|was|are|were)\s+(?:false|wrong|incorrect)\b|\b(?:is|was)\s+(?:wrong|false)\b/i;
const GENERIC_SUBJECT = new Set(
  ('percent percentage total global world worldwide national country countries share rate level amount number ' +
   'average median mean today now year years every each couple two three four five fiscal annual quarterly annualy yearly monthly daily month day time ' +
   'come comes came go goes went make makes made get gets got met take took ' +
   'use used using give gave given show shows shown find found report reported state stated ' +
   'said claim claimed according roughly about around approximately nearly almost over under ' +
   'more less higher lower high low large small major minor part way case million billion trillion thousand hundred').split(' ')
);

const INTERVAL_NUMS = {
  a: 1, an: 1, one: 1, single: 1,
  two: 2, couple: 2,
  three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  twelve: 12, fifteen: 15, eighteen: 18, twenty: 20, twentyfour: 24,
};
const INTERVAL_UNIT_MONTHS = { day: 1 / 30, week: 12 / 52, month: 1, year: 12, decade: 120 };

function extractInterval(norm = '') {
  const m = norm.match(
    /\b(?:(?:every|each)\s+(?:(\d+(?:\.\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|eighteen|twenty|couple)\s+(?:of\s+)?)?(day|week|month|year|decade)s?|per\s+(day|week|month|year)|(annual|annually|yearly|biennial|biennially|monthly|weekly|daily))\b/i
  );
  if (!m) return null;
  if (m[4]) {
    const k = m[4].toLowerCase();
    const months = k.startsWith('bienn') ? 24 : k.startsWith('annu') || k === 'yearly' ? 12 : k === 'monthly' ? 1 : k === 'weekly' ? 12 / 52 : 1 / 30;
    return { raw: m[0], months };
  }
  const unit = (m[2] || m[3] || '').toLowerCase();
  const qRaw = m[1] ? m[1].toLowerCase() : '1';
  const count = /^\d/.test(qRaw) ? Number(qRaw) : (INTERVAL_NUMS[qRaw] ?? 1);
  return { raw: m[0], months: count * (INTERVAL_UNIT_MONTHS[unit] || 12) };
}

const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function getSentenceForNumber(text = '', targetNums = []) {
  if (!text) return '';
  const sents = splitSentences(text);
  if (sents.length <= 1) return text;
  const numPatterns = (targetNums && targetNums.length)
    ? targetNums.map((n) => new RegExp(`\\b${escRe(String(n.shown || n.raw || n.value))}\\b`, 'i'))
    : [/\d[\d.,]*\s*(?:%|percent|billion|million|thousand|trillion)?/i];
  for (const s of sents) {
    if (numPatterns.some((p) => p.test(s))) {
      return s;
    }
  }
  return sents[0] || text;
}

function extractRelativeTimeFrame(norm = '') {
  const ago = norm.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|couple)\s+(years?|months?|decades?)\s+ago\b/i);
  if (ago) {
    const count = /^\d/.test(ago[1]) ? Number(ago[1]) : (INTERVAL_NUMS[ago[1].toLowerCase()] ?? 1);
    return { type: 'ago', count, unit: ago[2].toLowerCase(), raw: ago[0] };
  }
  const last = norm.match(/\b(?:over\s+|in\s+|within\s+)?(?:the\s+)?(last|past)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|couple)\s+(years?|months?|decades?)\b/i);
  if (last) {
    const count = /^\d/.test(last[2]) ? Number(last[2]) : (INTERVAL_NUMS[last[2].toLowerCase()] ?? 1);
    return { type: 'last', count, unit: last[3].toLowerCase(), raw: last[0] };
  }
  return null;
}

function negationSignature(text = '') {
  const n = normalize(text);
  const hits = n.match(CONTRADICT_RE) || [];
  const wrongHit = CLAIM_WRONG_RE.test(n) ? 1 : 0;
  return { count: hits.length + wrongHit, markers: [...new Set(hits.map((h) => h.toLowerCase()))] };
}

/**
 * Compare `hopText` (a later version) against `originText` (the earlier/primary wording).
 * Returns { code, flags[], diff[] } where code is one of
 * MATCH | ROUNDED | CHANGED | SCOPE | HEDGE_DROPPED | CAUSATION | YEAR | MISQUOTED | DIFFERENT_CONTEXT | CONTRADICTED
 */
export function compare(hopText, originText, { kind = 'stat', originScale = 1, originEntityMatch = false } = {}) {
  const hn = normalize(hopText);
  const on = normalize(originText);
  const { ops, ratio } = wordDiff(hopText, originText);
  const flags = [];
  let code = 'MATCH';
  const sev = { MATCH: 0, YEAR: 1, ROUNDED: 1, HEDGE_DROPPED: 2, SCOPE: 3, CAUSATION: 3, MISQUOTED: 3, DIFFERENT_CONTEXT: 3, CHANGED: 4, CONTRADICTED: 5 };
  const raise = (c) => {
    if (sev[c] > sev[code]) code = c;
  };

  const hNums = extractNumbers(hopText).filter((n) => !n.year);
  const oNums = extractNumbers(originText).filter((n) => !n.year).map((n) => (
    originScale > 1 && n.value < 1e7 ? { ...n, value: n.value * originScale, raw: `${n.raw} million` } : n
  ));

  const hSent = getSentenceForNumber(hopText, hNums);
  const oSent = getSentenceForNumber(originText, oNums);

  const htList = [...new Set(contentTokens(hopText))];
  const otList = [...new Set(contentTokens(originText))];
  const hasFactorTwo = (a, b) =>
    a.some((t) => t === 'double' || t === 'doubling' || t === 'doubled') &&
    !b.includes('double') && !b.includes('doubling') && !b.includes('doubled') &&
    /\bfactor\s+of\s+(?:two|2)\b/i.test(originText);
  let rawHits = tokenMatchCount(htList, otList);
  if (hasFactorTwo(htList, otList)) rawHits += 0.85;
  if (htList.includes('every') && !otList.includes('every') && /\b(?:per|a|each)\s+(year|month|week|day)\b/i.test(originText)) rawHits += 0.85;
  const hasSecEntityProxy = (otList.includes('company') || otList.includes('registrant')) && !htList.includes('company');
  if (rawHits > 0 && (originEntityMatch || hasSecEntityProxy)) rawHits += 1;
  const shared = rawHits / Math.max(1, Math.min(htList.length, otList.length));
  const subjH = htList.filter((t) => !GENERIC_SUBJECT.has(t));
  const subjO = otList.filter((t) => !GENERIC_SUBJECT.has(t));
  let subjHits = subjH.length >= 2 && subjO.length >= 2 ? tokenMatchCount(subjH, subjO) : 0;
  if (subjH.length >= 2 && subjO.length >= 2 && hasFactorTwo(subjH, subjO)) subjHits += 0.85;
  if (subjHits > 0 && (originEntityMatch || (subjHits >= 0.6 && hasSecEntityProxy))) subjHits += 1;
  const subjShared = subjH.length >= 2 && subjO.length >= 2
    ? Math.min(1, subjHits / Math.min(subjH.length, subjO.length))
    : shared;

  const hTf = extractRelativeTimeFrame(normalize(hSent));
  const oTf = extractRelativeTimeFrame(normalize(oSent));
  const timeFrameMismatch = Boolean(
    hTf && oTf && (hTf.type !== oTf.type || hTf.count !== oTf.count || hTf.unit !== oTf.unit)
  );

  const isDifferentContext = shared < 0.4 || subjShared < 0.5 || timeFrameMismatch;

  if (isDifferentContext && !hn.includes(on) && !on.includes(hn)) {
    return {
      code: 'DIFFERENT_CONTEXT',
      flags: [{ code: 'DIFFERENT_CONTEXT', text: timeFrameMismatch ? 'Time frame or subject differs; numeric comparison suppressed' : 'The two passages do not share the subject of the number; numeric comparison suppressed' }],
      diff: ops,
      similarity: ratio,
    };
  }

  const hPol = negationSignature(hSent);
  const oPol = negationSignature(oSent);
  if ((hPol.count > 0) !== (oPol.count > 0) && (hn.includes(on) || on.includes(hn) || !isDifferentContext)) {
    raise('CONTRADICTED');
    const detail = oPol.count > hPol.count
      ? `Polarity differs: source includes "${oPol.markers.join('", "') || 'contradicting phrasing'}"`
      : `Polarity differs: claim includes "${hPol.markers.join('", "') || 'negation'}" not in source`;
    flags.push({ code: 'CONTRADICTED', text: detail });
    return { code: 'CONTRADICTED', flags, diff: ops, similarity: ratio };
  }

  if (hn === on || hn.includes(on) || on.includes(hn)) return { code: 'MATCH', flags: [], diff: ops, similarity: 1 };

  if (kind === 'quote') {
    flags.push({ code: 'MISQUOTED', text: `Wording differs from the original (${Math.round(ratio * 100)}% of words in common)` });
    return { code: 'MISQUOTED', flags, diff: ops, similarity: ratio };
  }

  if (isDifferentContext) {
    return {
      code: 'DIFFERENT_CONTEXT',
      flags: [{ code: 'DIFFERENT_CONTEXT', text: 'The two passages do not share the subject of the number; numeric comparison suppressed' }],
      diff: ops,
      similarity: ratio,
    };
  }

  const nc = compareNumbers(hNums, oNums);
  if (nc.worst !== 'MATCH') raise(nc.worst);
  flags.push(...nc.flags);

  const hy = extractNumbers(hopText).filter((n) => n.year).map((n) => n.shown);
  const oy = extractNumbers(originText).filter((n) => n.year).map((n) => n.shown);
  let targetYearMismatch = false;
  if (hy.length && oy.length && !hy.some((y) => oy.includes(y))) {
    targetYearMismatch = true;
    raise('YEAR');
    flags.push({ code: 'YEAR', text: `Time period changed: original refers to ${oy.join(', ')}, this version to ${hy.join(', ')}` });
  } else if (!hy.length && oy.length && /\b(goal|target|pledg|forecast|projection|by\s+20\d{2})\b/i.test(on)) {
    targetYearMismatch = true;
    raise('YEAR');
    flags.push({ code: 'YEAR', text: `Time period changed: source cites a ${oy.join(', ')} goal or target, stated here without that year` });
  }

  let measureScopeShift = false;
  const hInterval = extractInterval(hn);
  const oInterval = extractInterval(on);
  const widened = present(hn, WIDEN).filter((w) => {
    if (hasPhrase(on, w)) return false;
    if (w === 'every' && hInterval && oInterval) {
      const nonTemporalEvery = hn.replace(/\bevery\s+(?:(?:\d+(?:\.\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|eighteen|twenty|couple)\s+(?:of\s+)?)?(?:day|week|month|year|decade)s?\b/gi, '');
      if (!/\bevery\b/i.test(nonTemporalEvery)) return false;
    }
    return true;
  });
  if (widened.length) {
    measureScopeShift = true;
    raise('SCOPE');
    flags.push({ code: 'SCOPE', text: `Scope widened: "${widened.join('", "')}" does not appear in the original wording` });
  }
  const srcFinalVsGlobal = /\bfinal energy\b/i.test(on) && !/\bfinal energy\b/i.test(hn) && /\benergy\b/i.test(hn);
  const srcElecVsEnergy = /\belectricity\b/i.test(on) && !/\belectricity\b/i.test(hn) && /\benergy\b/i.test(hn);
  const srcGoalDropped = /\b(global goal|target for|called for .* goal)\b/i.test(on) && !/\b(goal|target|pledge|proposed)\b/i.test(hn);
  if (srcFinalVsGlobal || srcElecVsEnergy || srcGoalDropped) {
    measureScopeShift = true;
    raise('SCOPE');
    const detail = srcElecVsEnergy
      ? 'Scope narrower than claimed: claim says "energy" while this source says "electricity"'
      : srcFinalVsGlobal
        ? 'Scope changed: source refers specifically to final energy share rather than all global energy'
        : 'Scope changed: source states a target or goal rather than current realized share';
    flags.push({ code: 'SCOPE', text: detail });
  }
  if (code === 'CHANGED' && (measureScopeShift || targetYearMismatch)) {
    code = measureScopeShift ? 'SCOPE' : 'YEAR';
  }
  let intervalChanged = false;
  if (hInterval && oInterval && Math.abs(hInterval.months - oInterval.months) > 0.05) {
    intervalChanged = true;
    raise('CHANGED');
    flags.push({
      code: 'CHANGED',
      text: `Time interval changed: original says "${oInterval.raw}", this version says "${hInterval.raw}"`,
    });
  }
  const dropped = present(on, HEDGE).filter((w) => !hasPhrase(hn, w));
  const hedgeLeft = present(hn, HEDGE).length;
  if (!intervalChanged && dropped.length && !hedgeLeft && !flags.some((f) => f.code === 'QUALIFIER')) {
    raise('HEDGE_DROPPED');
    flags.push({ code: 'HEDGE_DROPPED', text: `Hedge dropped: the original says "${dropped.join('", "')}"` });
  }
  if (present(on, WEAK_LINK).length && present(hn, CAUSAL).length) {
    raise('CAUSATION');
    flags.push({ code: 'CAUSATION', text: 'Original describes an association; this version states a cause' });
  }

  return { code, flags, diff: ops, similarity: ratio };
}

export const LABELS = {
  MATCH: 'Matches',
  UNCITED: 'Uncited source',
  ROUNDED: 'Rounded',
  CHANGED: 'Number changed',
  SCOPE: 'Scope widened',
  HEDGE_DROPPED: 'Hedge dropped',
  CAUSATION: 'Cause claimed',
  YEAR: 'Time period changed',
  MISQUOTED: 'Misquoted',
  DIFFERENT_CONTEXT: 'Different context',
  CONTRADICTED: 'Contradicted',
  DISPUTED: 'Disputed by source',
};
