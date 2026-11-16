// Pure text utilities. No network, no LLM: everything here is deterministic and testable.

const STOP = new Set(
  ('a an the and or but if of in on at to for from by with as is are was were be been being it its this that these ' +
    'those than then there their they them he she his her we our you your i not no nor so such into over under about ' +
    'after before between during while also just only more most some any each other which who whom whose what when ' +
    'where why how can could may might will would should has have had do does did said says say per via vs').split(' ')
);

export function stripMd(s = '') {
  return String(s)
    .replace(/([A-Za-z]{2,})-\r?\n[ \t]*([a-z]{2,})/g, '$1$2')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\((?:[^()\s]|\([^)]*\))*(?:\s+"[^"]*")?\)/g, '$1')
    .replace(/[*_`#>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalize(s = '') {
  return stripMd(s)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u00a0/g, ' ')
    .replace(/\s*%/g, '%')
    .replace(/(\d),(?=\d{3}\b)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export function contentTokens(s = '') {
  const out = [];
  for (let t of normalize(s).split(/[^a-z0-9]+/)) {
    if (!t || /^\d+$/.test(t) || t.length < 3 || STOP.has(t)) continue;
    if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) t = t.slice(0, -1);
    out.push(t);
  }
  return out;
}

// ---------- numbers ----------
const QUAL =
  'about|around|roughly|approximately|approx|nearly|almost|over|under|more than|less than|fewer than|at least|at most|up to|as many as|close to|just over|just under|upwards of|an estimated|estimated';
const NUM_RE = new RegExp(
  `(?:\\b(${QUAL})\\s+)?([$€£₹])?\\s?(?<![A-Za-z_])(?<![A-Za-z]-)(\\d{1,3}(?:,\\d{3})+|\\d+(?:\\.\\d+)?)(?:\\s?(%)|\\s(percent|per cent|percentage points?|million|billion|trillion|thousand|bn|mn|times)\\b|(k|m|b|t|x)\\b)?`,
  'gi'
);
const WORDNUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twenty: 20, hundred: 100 };

export function extractNumbers(text = '') {
  const plain = stripMd(text).normalize('NFKC');
  const out = [];
  NUM_RE.lastIndex = 0;
  let m;
  while ((m = NUM_RE.exec(plain))) {
    const [raw, q, cur, numStr, pct, word, single] = m;
    const after = plain.slice(m.index + raw.length);
    // Ignore index base-period notation such as (1982-84=100) or (1967=100) so it isn't misread as an event year
    if (/^\s*(?:[-\u2013\u2014]\s*\d{2,4})?\s*=\s*\d+/.test(after)) continue;
    const unitTok = (pct || word || single || '').toLowerCase();
    const shown = parseFloat(numStr.replace(/,/g, ''));
    if (Number.isNaN(shown)) continue;
    const decimals = (numStr.split('.')[1] || '').length;
    let unit = 'num';
    let scale = 1;
    if (pct || /^per ?cent$|^percent$/.test(unitTok)) unit = '%';
    else if (/percentage point/.test(unitTok)) unit = 'pp';
    else if (['million', 'mn', 'm'].includes(unitTok)) scale = 1e6;
    else if (['billion', 'bn'].includes(unitTok) || (unitTok === 'b' && (cur || /\./.test(numStr)))) scale = 1e9;
    else if (unitTok === 'trillion' || (unitTok === 't' && cur)) scale = 1e12;
    else if (['thousand', 'k'].includes(unitTok)) scale = 1e3;
    else if (['x', 'times'].includes(unitTok)) unit = 'x';
    const year =
      unit === 'num' && !cur && scale === 1 && !q && Number.isInteger(shown) && shown >= 1800 && shown <= 2100 && !numStr.includes(',');
    out.push({
      raw: raw.trim(),
      value: shown * scale,
      shown,
      decimals,
      unit,
      currency: cur || null,
      qualifier: q ? q.toLowerCase() : null,
      year,
      derived: false,
    });
  }
  const frac = /\b(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:in|out of)\s+(?:every\s+)?(one|two|three|four|five|six|seven|eight|nine|ten|twenty|hundred|\d+)\b/gi;
  while ((m = frac.exec(plain))) {
    const a = WORDNUM[m[1].toLowerCase()] ?? Number(m[1]);
    const b = WORDNUM[m[2].toLowerCase()] ?? Number(m[2]);
    if (a > 0 && b > a) {
      const pct = (a / b) * 100;
      out.push({ raw: m[0], value: pct, shown: pct, decimals: 1, unit: '%', currency: null, qualifier: null, year: false, derived: true });
    }
  }
  return out;
}

export const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-12);

// ---------- claim ----------
const GENERIC_CAP = new Set(
  ('the a an in on at by for to from of as is are was were be been have has had do does did will would could should may might can ' +
    'about around over under nearly almost roughly approximately estimated human humans people person study studies research report data ' +
    'according more most some any every all no not none one two three four five six seven eight nine ten this that these those ' +
    'there here when where what which who why how let true false january february march april may june july august september october november december ' +
    'initially originally previously formerly currently recently historically typically generally commonly widely largely mostly actually today later meanwhile however although despite moreover furthermore therefore instead indeed otherwise perhaps individually specifically notably ' +
    'drinking eating smoking working using finding scientists researchers experts doctors').split(' ')
);

const TOKEN_ALIASES = {
  revenue: ['sale', 'sales', 'turnover'],
  sale: ['revenue'],
  sales: ['revenue'],
  human: ['people', 'person'],
  people: ['human'],
  microchip: ['chip', 'transistor', 'component', 'processor', 'circuit'],
  transistor: ['microchip', 'chip', 'component'],
  chip: ['microchip', 'transistor', 'component'],
  component: ['transistor', 'microchip', 'chip'],
  annual: ['yearly', 'fiscal'],
  fiscal: ['annual', 'year'],
  ocean: ['sea', 'marine'],
  plastic: ['plastics', 'polymer'],
  double: ['doubling', 'doubled'],
  doubling: ['double', 'doubled'],
  doubled: ['double', 'doubling'],
  clean: ['renewable', 'renewables'],
  renewable: ['clean'],
};

function extractEntities(text = '') {
  const seen = new Set();
  const raw = stripMd(text).replace(/[“”"'()[\]]/g, ' ');
  for (const tok of raw.split(/\s+/)) {
    const clean = tok.replace(/[.,;:!?]+$/, '').replace(/'s$/i, '');
    if (!clean || clean.length < 3) continue;
    const isProper = /^[A-Z][a-zA-Z0-9-]{2,}$/.test(clean) || /^[A-Z]{3,8}$/.test(clean);
    if (!isProper) continue;
    const low = clean.toLowerCase();
    if (GENERIC_CAP.has(low) || STOP.has(low)) continue;
    seen.add(low);
  }
  return [...seen];
}

export function cleanClaimText(text = '') {
  let s = String(text || '').replace(/\s+/g, ' ').trim();
  // Strip bracketed citation markers: [76], [n], [a], [citation needed], [note 1], [clarification needed], etc.
  s = s.replace(/\[\s*(?:\d+(?:\s*[,–-]\s*\d+)*|[a-z]|citation needed|note\s*\d+|clarification needed)\s*\]/gi, '');
  // Strip unicode superscripts (e.g. ⁰ ¹ ² ³ ⁴ ⁵ ⁶ ⁷ ⁸ ⁹)
  s = s.replace(/[\u2070\u00B9\u00B2\u00B3\u2074-\u2079]+/g, '');
  // Strip trailing superscript footnote digits at word ends before punctuation or boundary
  s = s.replace(/([a-zA-Z]{3,})\d{1,3}(?=[.,;:\s]|$)/g, (m, p1) => p1);
  // Clean whitespace before punctuation
  s = s.replace(/\s+([.,;:!?])/g, (m, p1) => p1);
  return s.replace(/\s+/g, ' ').trim();
}

export function normalizeClaimText(text = '') {
  let s = String(text || '');
  s = s
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u00a0/g, ' ');
  s = cleanClaimText(s);
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/^[.,;:!?\s"'—–-]+/, '').replace(/[.,;:!?\s"'—–-]+$/, '');
  return s.replace(/\s+/g, ' ').trim();
}

export function extractTargetSentence(text = '') {
  const cleaned = cleanClaimText(text);
  const sents = splitSentences(cleaned);
  if (sents.length <= 1) {
    return { target: cleaned, multiSentence: false, sentences: sents, fullText: cleaned };
  }
  const target = sents.find((s) => /\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|percent|billion|million)\b/i.test(s)) || sents[0];
  return { target, multiSentence: true, sentences: sents, fullText: cleaned };
}

export function parseClaim(text, hints = {}) {
  const normalized = normalizeClaimText(text);
  const sents = splitSentences(normalized);
  const isMulti = sents.length > 1;
  const target = isMulti
    ? (sents.find((s) => /\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|percent|billion|million)\b/i.test(s)) || sents[0])
    : normalized;
  const raw = target.replace(/\s+/g, ' ').trim();
  const quoted = /^["\u201C\u2018'].+["\u201D\u2019']$/.test(raw);
  const all = extractNumbers(raw);
  const numbers = all.filter((n) => !n.year);
  const years = all.filter((n) => n.year).map((n) => n.shown);
  const kind = quoted || hints.inQuote ? 'quote' : numbers.length ? 'stat' : 'statement';
  const quoteText = quoted ? raw.slice(1, -1).trim() : raw;
  let sentence = null;
  if (hints.paragraph) {
    const n = normalize(raw);
    sentence = splitSentences(stripMd(hints.paragraph)).find((s) => normalize(s).includes(n)) || null;
  }
  const basis = sentence && raw.split(/\s+/).length < 12 ? sentence : quoteText;
  return {
    raw, kind, numbers, years, sentence, quoteText,
    tokens: contentTokens(basis),
    entities: extractEntities(basis),
    norm: normalize(quoteText),
    ...(isMulti ? { multiSentence: true, fullRaw: normalized, multiSentenceTip: 'Tip: For best results, highlight one claim at a time.' } : {}),
  };
}

// ---------- sentences & passages ----------
const ABBR = /(?:\b[A-Z]|\b(?:Dr|Mr|Mrs|Ms|St|Inc|Corp|Ltd|vs|No|Fig|approx|etc))\.$/;
export function splitSentences(plain = '') {
  const parts = plain.split(/(?<=[.!?]["\u201D')\]]?)\s+(?=["\u201C'(\[]?[A-Z0-9])/);
  const out = [];
  for (const p of parts) {
    if (out.length && ABBR.test(out[out.length - 1])) out[out.length - 1] += ' ' + p;
    else out.push(p);
  }
  return out.filter(Boolean);
}

export function tokenMatchCount(tokensA, tokensB) {
  const setB = tokensB instanceof Set ? tokensB : new Set(tokensB);
  let matched = 0;
  for (const t of tokensA) {
    if (setB.has(t)) matched += 1;
    else if ((TOKEN_ALIASES[t] || []).some((a) => setB.has(a))) matched += 0.65;
  }
  return matched;
}

export function scoreSentence(claim, sentence, ctx = {}) {
  const sTok = new Set(contentTokens(sentence));
  let matched = tokenMatchCount(claim.tokens, sTok);
  if (
    claim.tokens.some((t) => t === 'double' || t === 'doubling' || t === 'doubled') &&
    !sTok.has('double') && !sTok.has('doubling') && !sTok.has('doubled') &&
    /\bfactor\s+of\s+(?:two|2)\b/i.test(sentence)
  ) {
    matched = Math.min(claim.tokens.length, matched + 0.85);
  }
  if (
    claim.tokens.includes('every') && !sTok.has('every') &&
    /\b(?:every|each)\s+(year|month|week|day)s?\b/i.test(claim.raw || '') &&
    /\b(?:per|a|each)\s+(year|month|week|day)\b/i.test(sentence)
  ) {
    matched = Math.min(claim.tokens.length, matched + 1);
  }
  if (ctx.headEntityMatch && (sTok.has('company') || sTok.has('registrant'))) {
    const hasEntityInClaim = (claim.entities || []).some((e) => !sTok.has(e));
    if (hasEntityInClaim) matched = Math.min(claim.tokens.length, matched + 1);
  }
  const overlap = claim.tokens.length ? Math.min(1, matched / claim.tokens.length) : 0;
  const sAllNums = extractNumbers(sentence);
  const sNums = sAllNums.filter((n) => !n.year);
  const sYears = sAllNums.filter((n) => n.year).map((n) => n.shown);
  const scaleFactor = ctx.inMillions ? 1e6 : 1;
  let exact = 0;
  let close = 0;
  let near = 0;
  for (const n of claim.numbers) {
    const matchesExact = (x) => {
      if (x.unit !== n.unit) return false;
      if (rel(x.value, n.value) < 1e-9) return true;
      return scaleFactor > 1 && x.value < 1e7 && n.value >= 1e7 && rel(x.value * scaleFactor, n.value) < 1e-9;
    };
    const matchesClose = (x) => {
      if (x.unit !== n.unit) return false;
      if (rel(x.value, n.value) <= 0.02) return true;
      return scaleFactor > 1 && x.value < 1e7 && n.value >= 1e7 && rel(x.value * scaleFactor, n.value) <= 0.02;
    };
    const matchesNear = (x) => {
      if (x.unit !== n.unit) return false;
      if (rel(x.value, n.value) <= 0.25) return true;
      return scaleFactor > 1 && x.value < 1e7 && n.value >= 1e7 && rel(x.value * scaleFactor, n.value) <= 0.25;
    };
    if (sNums.some(matchesExact)) exact++;
    else if (sNums.some(matchesClose)) close++;
    else if (sNums.some(matchesNear)) near++;
  }
  const nn = claim.numbers.length;
  const sNorm = normalize(sentence);
  let ok = false;
  let score = overlap;
  if (claim.kind === 'quote') {
    if (claim.norm && sNorm.includes(claim.norm)) {
      ok = true;
      score = 2;
    } else {
      ok = claim.tokens.length >= 3 && overlap >= 0.8;
    }
  } else if (claim.kind === 'stat') {
    ok = (exact + close === nn && overlap >= 0.34) || (overlap >= 0.6 && exact + close + near === nn);
    score = overlap * 0.7 + (nn ? (exact + 0.9 * close + 0.5 * near) / nn : 0) * 0.3;
  } else {
    ok = claim.tokens.length >= 3 && overlap >= 0.6;
  }
  if (ok && claim.years?.length && sYears.length) {
    if (claim.years.some((y) => sYears.includes(y))) score += 0.1;
    else score -= 0.15;
  }
  if (ok && claim.norm) {
    const words = claim.norm.split(/\s+/).filter(Boolean);
    const bigrams = [];
    for (let i = 0; i + 1 < words.length; i++) {
      if (words[i].length >= 3 && words[i + 1].length >= 3) bigrams.push(`${words[i]} ${words[i + 1]}`);
    }
    if (bigrams.length) {
      const hits = bigrams.filter((bg) => sNorm.includes(bg)).length;
      score += (hits / bigrams.length) * 0.15;
    }
    const cFreq = claim.norm.match(/\bevery\s+(year|month|week|day)\b/);
    if (cFreq && !new RegExp(`\\bevery\\s+${cFreq[1]}\\b`).test(sNorm) && /\bevery\s+(?:\d+|two|three|four|five)\s+(?:months?|years?|weeks?|days?)\b/.test(sNorm)) {
      score -= 0.08;
    }
  }
  return { ok, score, overlap, exact, near };
}

const CITATION_LIST_LINE = /^(?:\[\d+\]|\d+\.\s*\^|\d+(?:\s+\d+){2,})\b/;
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const BOT_INTERSTITIAL_RE = /checking your browser|just a moment|enable javascript|access denied|verify you are human|recaptcha|enable cookies|bot verification|ddos protection|attention required! \| cloudflare/i;

export function isBotInterstitial(text = '') {
  const s = String(text || '').trim();
  if (!s) return false;
  if (BOT_INTERSTITIAL_RE.test(s)) {
    if (s.length < 2000) return true;
    if (/checking your browser|recaptcha|verify you are human|just a moment\.\.\.|attention required! \| cloudflare|access denied/i.test(s)) return true;
  }
  return false;
}

export function findPassage(markdown = '', claim, title = '') {
  const rawMd = String(markdown);
  if (isBotInterstitial(rawMd)) return null;
  const normMd = normalize(rawMd);
  const blocks = rawMd.split(/\r?\n\s*\r?\n/);
  const secCoverIdx = rawMd.indexOf('SECURITIES AND EXCHANGE COMMISSION');
  const secCoverSlice = secCoverIdx >= 0 && secCoverIdx < 35000 ? rawMd.slice(secCoverIdx, secCoverIdx + 2000) : '';
  const headNorm = normalize(`${title} ${rawMd.slice(0, 2000)} ${secCoverSlice}`);
  const headEntityMatch = Boolean((claim.entities || []).length && (claim.entities || []).some((e) =>
    new RegExp(`(?:^|[^a-z0-9])${escRe(e)}(?:'s)?(?:[^a-z0-9]|$)`, 'i').test(headNorm)
  ));
  let best = null;
  const interviewCut = rawMd.search(/\bExcerpts from A Conversation\s+with\b/i);
  let rawCursor = 0;
  blocks.forEach((raw, bi) => {
    const blockStart = rawMd.indexOf(raw, rawCursor);
    if (blockStart >= 0) rawCursor = blockStart + raw.length;
    const inAppendedInterview = interviewCut > 0 && blockStart >= interviewCut;
    const plain = stripMd(raw);
    if (plain.length < 20) return;
    const prevRaw = blocks[bi - 1] || '';
    const nextRaw = blocks[bi + 1] || '';
    const nearbyNorm = normalize(`${prevRaw} ${plain} ${nextRaw}`);
    const entities = claim.entities || [];
    const entityPresent = !entities.length || entities.some((e) => {
      const re = new RegExp(`(?:^|[^a-z0-9])${escRe(e)}(?:'s)?(?:[^a-z0-9]|$)`, 'i');
      return re.test(headNorm) || re.test(nearbyNorm);
    });
    const inMillions = /\(\s*in millions\b|\bin millions\b/i.test(`${prevRaw} ${plain}`);
    const isRefLine = CITATION_LIST_LINE.test(plain) || ((raw.match(/\[[^\]]+\]\(https?:\/\//g) || []).length >= 3 && plain.length < 260);
    const sents = splitSentences(plain);
    sents.forEach((s, si) => {
      const cands = [s];
      if (si + 1 < sents.length) cands.push(s + ' ' + sents[si + 1]);
      cands.forEach((cand, k) => {
        if (cand.length > 450) return;
        const sc = scoreSentence(claim, cand, { inMillions, headEntityMatch });
        if (!sc.ok) return;
        if (entities.length && !entityPresent && (claim.kind !== 'quote' || sc.overlap < 0.85)) return;
        const score = sc.score - (k ? 0.02 : 0) - (isRefLine ? 0.3 : 0) - (inAppendedInterview ? 0.35 : 0);
        if (!best || score > best.score) {
          best = { ...sc, score, quote: cand, blockRaw: raw, blockPlain: plain, blockIndex: bi, prevRaw, nextRaw, scaleFactor: inMillions ? 1e6 : 1, headEntityMatch };
        }
      });
    });
  });
  // real verification: the quote must be present in the page text we were given
  if (best && !normMd.includes(normalize(best.quote))) return null;
  if (best) {
    const bi = best.blockIndex;
    const adj = [];
    const minI = Math.max(0, bi - 3);
    const maxI = Math.min(blocks.length - 1, bi + 5);
    for (let i = minI; i <= maxI; i++) {
      if (i === bi) continue;
      const b = blocks[i];
      if (!b) continue;
      const p = stripMd(b);
      if (p.length >= 15 && !/^[-*_~=\s]+$/.test(p)) {
        adj.push(b);
      }
    }
    best.adjacentBlocks = adj;
  }
  return best;
}

export function findClosestPassage(markdown = '', claim = '') {
  const rawText = stripMd(String(markdown || '')).trim();
  if (rawText.length < 20 || isBotInterstitial(rawText)) return null;
  const claimObj = typeof claim === 'string' ? parseClaim(claim) : (claim || {});
  const sents = splitSentences(rawText).map((s) => s.trim()).filter((s) => s.length >= 15 && s.length <= 400);
  if (!sents.length) return null;

  const claimTokens = claimObj.tokens || contentTokens(claimObj.raw || '');
  const claimNumbers = (claimObj.numbers || []).map((n) => n.shown);
  let best = null;
  let bestScore = -1;

  for (const s of sents) {
    if (BOT_INTERSTITIAL_RE.test(s)) continue;
    const sToks = contentTokens(s);
    const matchCount = tokenMatchCount(claimTokens, sToks);
    let score = claimTokens.length ? matchCount / claimTokens.length : 0;
    for (const num of claimNumbers) {
      if (s.includes(String(num))) score += 0.25;
    }
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  if (bestScore > 0 && best && !BOT_INTERSTITIAL_RE.test(best)) return best;
  const firstNonBot = sents.find((s) => !BOT_INTERSTITIAL_RE.test(s));
  return firstNonBot || null;
}

// ---------- links ----------
export function extractLinks(md = '') {
  const re = /\[([^\]]*)\]\(((?:[^()\s]|\([^)]*\))+)(?:\s+"[^"]*")?\)/g;
  const out = [];
  let m;
  while ((m = re.exec(md))) if (/^https?:/i.test(m[2])) out.push({ text: m[1].trim(), href: m[2] });
  return out;
}

export function cleanUrl(u, base) {
  try {
    const x = new URL(u, base);
    if (!/^https?:$/.test(x.protocol)) return null;
    x.hash = '';
    for (const k of [...x.searchParams.keys()]) if (/^(utm_|fbclid|gclid|mc_|ref$|ref_src|cmpid|ocid)/i.test(k)) x.searchParams.delete(k);
    return x.href;
  } catch {
    return null;
  }
}

const BLOCKED = /(^|\.)(facebook|twitter|x|linkedin|pinterest|instagram|tiktok|whatsapp|t\.me|youtube|youtu|reddit|bsky)\.(com|be|me|app|social)$/i;
const TERTIARY = /(^|\.)(wikipedia\.org|wikidata\.org|wikimedia\.org|linkedin\.com|medium\.com|substack\.com|reddit\.com|quora\.com|blogspot\.[a-z.]+|wordpress\.com|facebook\.com|tumblr\.com|fandom\.com)$/i;
const NAV = /\/(tag|tags|category|categories|author|authors|about|privacy|terms|login|signin|subscribe|share|search|wiki\/Help:|wiki\/Special:|wiki\/Talk:|wiki\/File:|wiki\/Category:|wiki\/Wikipedia:)(\/|$|\?|$)/i;
const CUES = /(study|report|survey|data|according|analysis|research|paper|white ?paper|filing|10-k|transcript|interview|press release|statistic|census|index|poll|journal|findings|review|doi|source|citation|reference)/i;
const SCHOLARLY_HOSTS = /(^|\.)(nature\.com|science\.org|sciencedirect\.com|springer\.com|jamanetwork\.com|thelancet\.com|nejm\.org|bmj\.com|plos\.org)$/i;
const SCHOLARLY_RESEARCH_CUES = [
  /\babstract\b/i,
  /\b(?:methods|methodology|materials and methods)\b/i,
  /\b(?:we surveyed|our survey|we analyzed|we analysed|we measured|our study|we tested|we examined|we sequenced|we recruited|we randomized|we randomised)\b/i,
  /\bsample size\b/i,
  /\b(?:p-value|confidence interval|statistically significant|regression|odds ratio|hazard ratio)\b/i,
  /\bdoi(?::\s*|\s+https?:\/\/doi\.org\/|\s+)10\.\d{4,}/i,
];
const PRIMARY_HOSTS = /(^|\.)(arxiv\.org|doi\.org|pewresearch\.org|europa\.eu|un\.org|worldbank\.org|imf\.org|oecd\.org|ssrn\.com|pnas\.org|cell\.com|nih\.gov|cdc\.gov|sec\.gov|census\.gov|bls\.gov|who\.int|nber\.org|gallup\.com|pubmed\.ncbi\.nlm\.nih\.gov|pmc\.ncbi\.nlm\.nih\.gov)$/i;
const PRIMARY_TEXT_CUES = [
  /\b(?:methods|methodology)\b/i,
  /\b(we surveyed|our survey|we analyzed|we analysed|we measured|our study)\b/i,
  /\brespondents\b/i,
  /\bsample size\b/i,
  /\bparticipants\b/i,
  /\babstract\b/i,
  /\b(p-value|confidence interval|statistically significant|regression)\b/i,
  /\b(form 10-k|form 10-q|annual report|fiscal year ended)\b/i,
  /\b(peer[- ]reviewed|doi:\s*10\.)\b/i,
];

export const hostOf = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return u;
  }
};

export function registrableDomain(host = '') {
  const parts = String(host || '').toLowerCase().replace(/^www\./, '').split('.');
  if (parts.length <= 2) return parts.join('.');
  const secondLast = parts[parts.length - 2];
  if (['gov', 'edu', 'org', 'co', 'ac', 'com', 'net'].includes(secondLast) && parts[parts.length - 1].length === 2) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}

export function isSameOrg(hostA = '', hostB = '') {
  if (!hostA || !hostB) return false;
  const a = String(hostA).toLowerCase();
  const b = String(hostB).toLowerCase();
  if (a === b) return true;
  return registrableDomain(a) === registrableDomain(b);
}

export function isTertiary(url) {
  return TERTIARY.test(hostOf(url));
}

export function isBlocked(url) {
  return BLOCKED.test(hostOf(url));
}

const EDU_PRESS_HOST = /^(?:news|press|media|today|blog|magazine|gazette)\./i;
const EDU_PRESS_PATH = /\/(?:news|newsroom|press|press-releases?|press_releases?|releases?|blog|blogs|story|stories|gazette|magazine|media|announcements?|spotlight)(?:\/|$)/i;
const EDU_SECONDARY_PATH = /\/(?:podcast|podcasts|episodes?|events?|conservation|education|explainers?)(?:\/|$)/i;

export function sourceKind(url, text = '') {
  let u;
  try {
    u = new URL(url);
  } catch {
    return 'secondary';
  }
  const h = u.hostname.replace(/^www\./, '');
  if (TERTIARY.test(h)) return 'tertiary';
  const isGovMilInt = /\.(gov|int|mil)(\.[a-z]{2})?$/.test(h);
  const isEdu = /\.edu(\.[a-z]{2})?$/.test(h) && !/(^|\.)academia\.edu$/.test(h);
  if (isGovMilInt || isEdu) {
    if (EDU_PRESS_HOST.test(h) || EDU_PRESS_PATH.test(u.pathname)) return isGovMilInt ? 'gov-release' : 'press-release';
    if (EDU_SECONDARY_PATH.test(u.pathname)) return 'secondary';
    if (/\.pdf($|\?)/i.test(u.pathname)) return 'primary-likely';
    if (isGovMilInt) return 'primary-likely';
    // .edu HTML pages must show research cues (avoid treating outreach/course pages as primary studies)
    const sample = String(text).slice(0, 30000);
    const cueHits = PRIMARY_TEXT_CUES.filter((re) => re.test(sample)).length;
    return cueHits >= 2 ? 'primary-likely' : 'secondary';
  }
  if (/\.pdf($|\?)/i.test(u.pathname)) return 'primary-likely';
  const sample = String(text).slice(0, 30000);
  if (SCHOLARLY_HOSTS.test(h)) {
    const scholarlyHits = SCHOLARLY_RESEARCH_CUES.filter((re) => re.test(sample)).length;
    return scholarlyHits >= 2 ? 'primary-likely' : 'journal-commentary';
  }
  if (PRIMARY_HOSTS.test(h)) return 'primary-likely';
  const cueHits = PRIMARY_TEXT_CUES.filter((re) => re.test(sample)).length;
  if (cueHits >= 2) return 'primary-likely';
  return 'secondary';
}

export function rankLinks(links, claim, currentUrl) {
  const curHost = hostOf(currentUrl);
  const seen = new Set();
  const out = [];
  for (const l of links) {
    const href = cleanUrl(l.href, currentUrl);
    if (!href || seen.has(href)) continue;
    seen.add(href);
    const h = hostOf(href);
    if (BLOCKED.test(h) || NAV.test(href)) continue;
    let score = 0;
    if (l.fromFootnote) score += 3.5;
    if (l.inSelection) score += 3;
    if (l.adjacent) score -= 2;
    if (CUES.test(l.text || '')) score += 2;
    if (claim.numbers.some((n) => (l.text || '').includes(String(n.shown)))) score += 1;
    if (/\.pdf($|\?)/i.test(href)) score += 3;
    if (/(^|\.)(doi\.org|sec\.gov|arxiv\.org|pubmed\.ncbi\.nlm\.nih\.gov|pmc\.ncbi\.nlm\.nih\.gov)$/i.test(h)) score += 3.5;
    if (/\.(gov|edu|int|mil)(\.[a-z]{2})?$/.test(h)) score += 3;
    const kind = sourceKind(href);
    if (kind === 'primary-likely') score += 2;
    if (kind === 'tertiary') score -= 5;
    if (h === curHost) score -= 0.5;
    out.push({ ...l, href, score });
  }
  return out.sort((a, b) => b.score - a.score);
}

// ---------- dispute detection ----------
const DISPUTE_PATTERNS = [
  ['myth', /\b(?:myth|myths|neuromyths?|urban legends?)\b/i],
  ['misconception', /\bmisconceptions?\b/i],
  ['misattributed', /\b(?:misattribut(?:e|ed|es|ing|ion)|(?:falsely|wrongly|erroneously)\s+attributed)\b/i],
  ['apocryphal', /\bapocryphal\b/i],
  ['never said', /\bnever\s+(?:actually\s+|really\s+)?(?:said|uttered|wrote|spoken|made\s+(?:that|this|the)\s+(?:remark|statement|quote))\b/i],
  ['did not say', /\b(?:did\s+not|didn't|never\s+did)\s+(?:actually\s+|really\s+)?(?:say|utter|write|speak)\b/i],
  ['no evidence', /\bno\s+(?:historical\s+|contemporary\s+|scientific\s+|credible\s+|solid\s+|verifiable\s+)?evidence\b/i],
  ['falsely', /\bfalsely\b/i],
  ['debunk', /\bdebunk(?:ed|s|ing)?\b/i],
  ['hoax', /\bhoax(?:es)?\b/i],
  ['fabricated', /\b(?:(?:is|are|was|were|be|been|completely|wholly|entirely|totally|purely|simply)\s+fabricat(?:ed|ion)|fabricat(?:ed|ing)\s+(?:(?:a|the|this|that)\s+)?(?:claim|quote|quotation|remark|statement|story|statistic|data|evidence|report|myth)|fabricat(?:ed|ion)\s+of\s+(?:a|the)\s+(?:claim|quote|story|evidence))\b/i],
  ['no record', /\bno\s+(?:historical\s+|contemporary\s+|written\s+|official\s+)?record\b/i],
  ['not true', /\b(?:(?:is|are|was|were)\s+not|isn't|aren't|wasn't|weren't)\s+true\b|\bnot\s+true\b|\buntrue\b|\bclaim\s+(?:is|was)\s+false\b/i],
  ['unfounded', /\bunfounded\b/i],
];

const SLOWDOWN_ONLY_RE = /\b(?:slowing\s+down|slowed\s+down|taper(?:ing)?\s+off|plateau(?:ing|ed)?)\b/i;
const ATTRIB_DENIAL_RE = /\b(?:never\s+(?:actually\s+|really\s+)?(?:said|uttered|wrote|spoken|claimed)|(?:did\s+not|didn't|never\s+did)\s+(?:actually\s+|really\s+)?(?:say|utter|write|speak|claim))\b/i;
const ANAPHOR_RE = /\b(?:this|that|these|those|such|the)\s+(?:claim|quote|quotation|remark|words?|phrase|saying|expression|assertion|statement|statistic|figure|number|myth|misconception|story|idea|notion|rumor|legend|finding)\b|\b(?:this|that|these|it)\s+(?:is|are|was|were)\s+(?:not\s+true|untrue|false|wrong|apocryphal|a\s+myth|unfounded|debunked|fabricated|misattributed|no\s+longer)\b/i;

function disputeSentenceRefersToClaim(sentence, claimObj) {
  if (!sentence || !claimObj) return true;
  if (SLOWDOWN_ONLY_RE.test(sentence) && !DISPUTE_PATTERNS.some(([label, re]) => !['not true'].includes(label) && re.test(sentence))) {
    return false;
  }
  const denyMatch = sentence.match(ATTRIB_DENIAL_RE);
  if (denyMatch) {
    const afterCue = sentence.slice(denyMatch.index + denyMatch[0].length, denyMatch.index + denyMatch[0].length + 70)
      .split(/[,;.!?]|(?:\s+(?:that|which|but|and|while|although)\b)/i)[0] || '';
    const deniedNums = extractNumbers(afterCue).filter((n) => !n.year);
    const claimNums = claimObj.numbers || [];
    if (deniedNums.length) {
      const claimHasNum = deniedNums.some((dn) =>
        claimNums.some((cn) => cn.unit === dn.unit && rel(cn.value, dn.value) <= 0.05) ||
        claimObj.norm.includes(String(dn.shown).toLowerCase())
      );
      if (!claimHasNum) return false;
    }
    const deniedPeriod = afterCue.match(/\b(\d+|two|three|four|five|six|eight|ten|twelve|eighteen|18)\s+(months?|years?|weeks?|days?)\b/i);
    if (deniedPeriod && !claimObj.norm.includes(normalize(deniedPeriod[0]))) {
      return false;
    }
  }
  const sTok = new Set(contentTokens(sentence));
  const claimToks = claimObj.tokens || [];
  const claimEnts = claimObj.entities || [];
  const claimNums = (claimObj.numbers || []).map((n) => String(n.shown));
  const sharesNum = claimNums.some((num) => new RegExp(`\\b${escRe(num)}(?:\\s*%|\\s*percent)?\\b`, 'i').test(sentence));
  const sharesTopic = claimToks.some((t) => sTok.has(t)) || claimEnts.some((e) => sTok.has(e)) || sharesNum;
  return sharesTopic || ANAPHOR_RE.test(sentence);
}

export function detectDispute(markdown = '', passage = null, title = '', claim = null) {
  const plainFull = stripMd(markdown);
  const headSlice = plainFull.slice(0, 650);
  const introSents = [];
  let cursor = 0;
  for (const s of splitSentences(headSlice)) {
    const pos = plainFull.indexOf(s, cursor);
    if (pos >= 0 && pos < 400) introSents.push(s);
    if (pos >= 0) cursor = pos + s.length;
  }
  const blockPlain = passage?.blockPlain || '';
  const prevPlain = stripMd(passage?.prevRaw || '');
  const nextPlain = stripMd(passage?.nextRaw || '');
  const titlePlain = stripMd(title || '');
  const claimObj = claim
    ? (typeof claim === 'string' ? parseClaim(claim) : claim)
    : (passage?.quote ? parseClaim(passage.quote) : null);

  const normMd = normalize(markdown);
  const normQuote = passage?.quote ? normalize(passage.quote) : '';
  const adjacentPlainSents = (passage?.adjacentBlocks || []).flatMap((b) => splitSentences(stripMd(b)));
  const proseSents = [
    ...splitSentences(blockPlain),
    ...adjacentPlainSents,
    ...splitSentences(nextPlain),
    ...splitSentences(prevPlain),
    ...introSents,
  ].filter((s) => s.length >= 15 && s.length <= 380);

  const verified = (s) => normMd.includes(normalize(s));
  const matchingSents = proseSents.filter(
    (s) => DISPUTE_PATTERNS.some(([, re]) => re.test(s)) && verified(s) && disputeSentenceRefersToClaim(s, claimObj)
  );
  const matchingTitle = titlePlain && DISPUTE_PATTERNS.some(([, re]) => re.test(titlePlain)) && disputeSentenceRefersToClaim(titlePlain, claimObj)
    ? titlePlain
    : null;

  const cueSet = new Set();
  for (const s of matchingSents) {
    for (const [label, re] of DISPUTE_PATTERNS) {
      if (re.test(s)) cueSet.add(label);
    }
  }
  if (!cueSet.size && matchingTitle) {
    for (const [label, re] of DISPUTE_PATTERNS) {
      if (re.test(matchingTitle)) cueSet.add(label);
    }
  }
  const cues = [...cueSet];
  if (!cues.length) return { disputed: false, cues: [], disputeQuote: null };

  const distinctHit = matchingSents.find((s) => normalize(s) !== normQuote);
  const sameHit = matchingSents[0];
  const disputeQuote = distinctHit || sameHit || matchingTitle;
  return { disputed: true, cues, disputeQuote };
}

// ---------- citation / footnote resolution ----------
const BARE_URL_RE = /https?:\/\/[^\s<>()]+(?:\([^\s<>()]*\)[^\s<>()]*)?/gi;
const DOI_RE = /\b(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)(10\.\d{4,9}\/[^\s\]\)>,;"']+)/gi;

export function extractCitationLinks(text = '', currentUrl = '') {
  const out = [];
  const seen = new Set();
  const curClean = cleanUrl(currentUrl);
  const add = (href, linkText = '') => {
    const trimmed = String(href).replace(/[.,;:)\]}>'"]+$/, '');
    const cleaned = cleanUrl(trimmed, currentUrl);
    if (!cleaned || cleaned === curClean || seen.has(cleaned)) return;
    seen.add(cleaned);
    out.push({ text: linkText || trimmed, href: cleaned });
  };
  for (const l of extractLinks(text)) {
    const cleaned = cleanUrl(l.href, currentUrl);
    if (!cleaned || cleaned === curClean) continue; // skips same-page #cite_note anchor targets as direct URLs
    add(l.href, l.text);
  }
  let m;
  DOI_RE.lastIndex = 0;
  while ((m = DOI_RE.exec(text))) {
    const doi = m[1].replace(/[.,;:)\]}>'"]+$/, '');
    add(`https://doi.org/${doi}`, `doi:${doi}`);
  }
  BARE_URL_RE.lastIndex = 0;
  while ((m = BARE_URL_RE.exec(text))) {
    add(m[0]);
  }
  return out;
}

const REF_HEADING_RE = /^(?:#{1,4}\s*|\*{2})?(references|notes|citations|sources|bibliography|works cited|footnotes)\b/i;

export function extractFootnoteMap(markdown = '', currentUrl = '') {
  const lines = String(markdown).split(/\r?\n/);
  const byKey = new Map();
  const allEntries = [];
  const put = (key, entry) => {
    const k = String(key).toLowerCase();
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(entry);
  };
  let inRefSection = false;
  let seq = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (REF_HEADING_RE.test(line)) {
      inRefSection = true;
      continue;
    }
    if (inRefSection && /^#{1,2}\s+\S/.test(line) && !REF_HEADING_RE.test(line)) {
      inRefSection = false;
    }

    let m;
    // [^1]: ...
    if ((m = line.match(/^\[\^([^\]]+)\]:\s*(.+)$/))) {
      const links = extractCitationLinks(m[2], currentUrl);
      const entry = { key: m[1], line: m[2], links };
      put(m[1], entry);
      if (links.length) allEntries.push(entry);
      continue;
    }
    // 1. ^ ... (Wikipedia style, including \^ or [↑](#...)) or [1] ... or (under References) 1. ...
    const isWikiRef = (m = line.match(/^(\d{1,3})\.\s*(?:\\?\^|\[[\^↑]\](?:\([^)]+\))?)\s*(.+)$/));
    const isBracketRef = !isWikiRef && (m = line.match(/^[-*]?\s*\[(\d{1,3})\](?!\()\s*(.+)$/));
    const isSecRef = !isWikiRef && !isBracketRef && inRefSection && (m = line.match(/^(\d{1,3})\.\s+(.+)$/));
    const isPlainBulletRef = !isWikiRef && !isBracketRef && !isSecRef && inRefSection && /^[-*]\s+/.test(line);
    if (m) {
      let body = m[2];
      // Gather short wrapped continuation lines
      while (i + 1 < lines.length && lines[i + 1].trim() && !/^(?:\[\^|\d+\.|\[?\d+\]|[-*#])/.test(lines[i + 1].trim())) {
        body += ' ' + lines[++i].trim();
      }
      const links = extractCitationLinks(body, currentUrl);
      const entry = { key: m[1], line: body, links };
      put(m[1], entry);
      if (links.length) allEntries.push(entry);
    } else if (isPlainBulletRef) {
      const links = extractCitationLinks(line, currentUrl);
      if (links.length) allEntries.push({ key: `r${++seq}`, line, links });
    }
  }
  return { byKey, allEntries };
}

export function resolvePassageCitations(markdown = '', passage = null, currentUrl = '', claim = null) {
  if (!passage) return [];
  const out = [];
  const byHref = new Map();
  const pushLink = (l, flags) => {
    const cleaned = cleanUrl(l.href, currentUrl);
    if (!cleaned) return;
    const prev = byHref.get(cleaned);
    if (prev) {
      if (flags.fromFootnote) prev.fromFootnote = true;
      if (flags.inSelection) {
        prev.inSelection = true;
        prev.adjacent = false;
      }
      return;
    }
    const item = { ...l, href: cleaned, ...flags };
    byHref.set(cleaned, item);
    out.push(item);
  };

  const inspectBlock = (raw, inSelection) => {
    if (!raw || (!inSelection && REF_HEADING_RE.test(raw.trim()))) return;
    for (const l of extractCitationLinks(raw, currentUrl)) {
      pushLink(l, { inSelection, adjacent: !inSelection });
    }
  };
  inspectBlock(passage.blockRaw, true);
  inspectBlock(passage.prevRaw, false);
  inspectBlock(passage.nextRaw, false);

  const fnMap = extractFootnoteMap(markdown, currentUrl);
  const extractKeys = (raw = '') => {
    const keys = [];
    let m;
    const citeRe = /#cite_note-(?:[A-Za-z0-9_.-]*?-)?(\d+)/g;
    while ((m = citeRe.exec(raw))) keys.push(m[1]);
    const mdFn = /\[\^([^\]]+)\]/g;
    while ((m = mdFn.exec(raw))) keys.push(m[1]);
    const brFn = /\[(\d{1,3})\](?!\()/g;
    while ((m = brFn.exec(raw))) keys.push(m[1]);
    const linkBrFn = /\[\[(\d{1,3})\]\]\([^)]+\)/g;
    while ((m = linkBrFn.exec(raw))) keys.push(m[1]);
    return [...new Set(keys)];
  };

  for (const [raw, inSel] of [[passage.blockRaw, true], [passage.prevRaw, false], [passage.nextRaw, false]]) {
    for (const key of extractKeys(raw)) {
      for (const entry of fnMap.byKey.get(String(key).toLowerCase()) || []) {
        for (const l of entry.links) {
          pushLink(l, { inSelection: inSel, adjacent: !inSel, fromFootnote: true });
        }
      }
    }
  }

  // Fallback for tertiary / encyclopedic pages or scholarly articles with topical Reference entries matching the claim
  if (isTertiary(currentUrl) && fnMap.allEntries.length && claim) {
    const nonTertCount = out.filter((l) => !isTertiary(l.href)).length;
    if (nonTertCount === 0) {
      const wantToks = new Set([...(claim.entities || []), ...(claim.tokens || [])]);
      for (const entry of fnMap.allEntries) {
        const lineNorm = normalize(entry.line);
        const lineToks = new Set(contentTokens(entry.line));
        const entMatch = (claim.entities || []).some((e) => lineNorm.includes(e));
        const tokMatches = [...wantToks].filter((t) => lineToks.has(t)).length;
        const yrMatch = (claim.years || []).some((y) => entry.line.includes(String(y)));
        if (entMatch || tokMatches >= 2 || (yrMatch && tokMatches >= 1)) {
          for (const l of entry.links) {
            pushLink(l, { inSelection: true, adjacent: false, fromFootnote: true });
          }
        }
      }
    }
  }

  return out;
}

// ---------- dates ----------
export function normalizeDate(s) {
  if (!s) return null;
  s = String(s).trim();
  if (/^\d{4}$/.test(s)) return s;
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  let t = /(?:Z|[+-]\d{2}:?\d{2}|GMT|UTC)$/i.test(s)
    ? Date.parse(s)
    : Date.parse(`${s} UTC`);
  if (Number.isNaN(t)) t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString().slice(0, 10);
}
export function dateKey(d) {
  if (!d) return null;
  const full = d.length === 4 ? `${d}-01-01` : d.length === 7 ? `${d}-01` : d;
  const t = Date.parse(full);
  return Number.isNaN(t) ? null : t;
}
export function findDateInfo(text = '', metaDate = null, url = '', claim = null) {
  const fullClean = String(text || '').replace(/\u00a0/g, ' ');
  const head = fullClean.slice(0, 3500);
  const DATE_PAT = '([A-Z][a-z]{2,8}\\.?\\s+\\d{1,2},?\\s+\\d{4}|\\d{1,2}\\s+[A-Z][a-z]{2,8}\\.?\\s+\\d{4}|\\d{4}-\\d{2}-\\d{2})';
  const pubRe = new RegExp(`(?:originally\\s+published|published|posted|released|\\bpublication\\s+date)\\s*(?:on\\s*)?[:\\s-]*${DATE_PAT}`, 'i');
  const updRe = new RegExp(`(?:last\\s+updated|updated|modified|revised)\\s*(?:on\\s*)?[:\\s-]*${DATE_PAT}`, 'i');
  const pubMatch = head.match(pubRe);
  const updMatch = head.match(updRe);
  const top = fullClean.slice(0, 600);
  const topRe = /\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},\s+\d{4}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{4})\b/i;
  const topMatch = top.match(topRe);

  let secDate = null;
  if (!pubMatch && !metaDate && !topMatch && /SECURITIES AND EXCHANGE COMMISSION/i.test(fullClean.slice(0, 35000))) {
    const sigIdx = fullClean.lastIndexOf('SIGNATURES');
    const sigSlice = sigIdx >= 0 ? fullClean.slice(sigIdx, sigIdx + 1200) : '';
    const sigDate = sigSlice.match(new RegExp(`Date\\s*:\\s*${DATE_PAT}`, 'i'));
    const coverIdx = fullClean.indexOf('SECURITIES AND EXCHANGE COMMISSION');
    const coverDate = coverIdx >= 0 ? fullClean.slice(coverIdx, coverIdx + 1500).match(new RegExp(`fiscal year ended\\s+${DATE_PAT}`, 'i')) : null;
    secDate = normalizeDate(sigDate?.[1] || coverDate?.[1]);
  }

  const pubDate = normalizeDate(pubMatch?.[1]);
  const metaNorm = normalizeDate(metaDate);
  const updDate = normalizeDate(updMatch?.[1]);
  const topDate = normalizeDate(topMatch?.[1]);

  let date = pubDate || metaNorm || topDate || updDate || secDate || null;
  let dateSource = pubDate ? 'page-text' : metaNorm ? 'page-metadata' : (topDate || updDate || secDate) ? 'page-text' : null;
  let dateUncertain = false;
  let dateReason = null;

  if (date) {
    const topPrefix = topMatch ? top.slice(Math.max(0, topMatch.index - 24), topMatch.index) : '';
    const labeledUpdatedOnly = !pubDate && (
      (updDate && date === updDate) ||
      (updMatch && metaNorm && date === metaNorm) ||
      (/\b(?:updated|modified|revised)\b/i.test(topPrefix) && date === topDate) ||
      (!metaNorm && !topDate && !!updDate)
    );
    if (labeledUpdatedOnly) {
      dateUncertain = true;
      dateReason = 'page date is labelled as updated';
    }
    const urlYearMatch = String(url || '').match(/(?:\/|-in-)(19\d{2}|20\d{2})(?:[/-]|$)/i);
    const dateYear = Number(date.slice(0, 4));
    if (urlYearMatch && dateYear > Number(urlYearMatch[1])) {
      dateUncertain = true;
      dateReason = `page metadata date (${date}) is later than URL year (${urlYearMatch[1]})`;
    }
    const claimYears = claim?.years?.length
      ? claim.years
      : extractNumbers(claim?.raw || '').filter((n) => n.year).map((n) => n.value);
    if (claimYears.length) {
      const maxEraYear = Math.max(...claimYears);
      if (dateYear > maxEraYear + 1) {
        dateUncertain = true;
        dateReason = `page date (${date}) is later than the claim's era (${maxEraYear})`;
      }
    }
  }
  const isWiki = /(?:^|\.)wikipedia\.org$/i.test(hostOf(url)) || /\/wiki\//i.test(url) || /(?:^|\.)wik[a-z0-9-]*\./i.test(hostOf(url));
  if (isWiki) {
    dateUncertain = true;
    dateReason = 'wiki page continuously edited (living page)';
  }
  return { date, dateSource, dateUncertain, dateReason };
}

export function findDateInText(text = '') {
  return findDateInfo(text).date;
}

// ---------- word diff (marks words in `a` that are not in the LCS with `b`) ----------
const nw = (w) => w.toLowerCase().replace(/[^a-z0-9%.]/g, '').replace(/\.$/, '');
export function wordDiff(a, b) {
  const A = stripMd(a).split(/\s+/).filter(Boolean);
  const B = stripMd(b).split(/\s+/).filter(Boolean);
  const na = A.map(nw);
  const nb = B.map(nw);
  const dp = Array.from({ length: na.length + 1 }, () => new Array(nb.length + 1).fill(0));
  for (let i = na.length - 1; i >= 0; i--)
    for (let j = nb.length - 1; j >= 0; j--) dp[i][j] = na[i] === nb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const keep = new Array(na.length).fill(false);
  let i = 0;
  let j = 0;
  while (i < na.length && j < nb.length) {
    if (na[i] === nb[j]) {
      keep[i] = true;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return { ops: A.map((w, k) => ({ w, changed: !keep[k] })), ratio: na.length ? dp[0][0] / Math.max(na.length, nb.length) : 0 };
}
