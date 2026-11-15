const $ = (id) => document.getElementById(id);

const LABEL = {
  MATCH: 'Matches',
  PRIMARY_PUBLISHER: 'Likely primary publisher',
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
  UNCITED: 'Uncited source',
  CITED_UNCONFIRMED: 'Cited, not confirmed',
  NO_SOURCE: 'No original source found',
};

const TONE = {
  MATCH: 'ok',
  PRIMARY_PUBLISHER: 'ok',
  UNCITED: 'warn',
  CITED_UNCONFIRMED: 'warn',
  ROUNDED: 'warn',
  YEAR: 'warn',
  HEDGE_DROPPED: 'warn',
  DIFFERENT_CONTEXT: 'warn',
  CHANGED: 'bad',
  SCOPE: 'bad',
  CAUSATION: 'bad',
  MISQUOTED: 'bad',
  CONTRADICTED: 'bad',
  DISPUTED: 'bad',
  NO_SOURCE: 'none',
};

const DRIFT_STEPS = ['Match', 'Rounded / Date', 'Hedge / Context', 'Scope / Misquoted', 'Changed / Disputed'];
const DRIFT_LEVEL = {
  MATCH: 0, PRIMARY_PUBLISHER: 0, UNCITED: 1, ROUNDED: 1, YEAR: 1, CITED_UNCONFIRMED: 2, HEDGE_DROPPED: 2, DIFFERENT_CONTEXT: 2,
  SCOPE: 3, CAUSATION: 3, MISQUOTED: 3, CHANGED: 4, CONTRADICTED: 4, DISPUTED: 4,
};

const hasSyncStorage = typeof chrome !== 'undefined' && !!chrome.storage?.sync;
const hasSessionStorage = typeof chrome !== 'undefined' && !!chrome.storage?.session;

let cfg = { serverUrl: 'http://localhost:8787', appToken: '', theme: 'auto' };
let healthInfo = { ok: false, allowAgent: false, allowResearch: false, mode: 'unknown', hasKey: false };
let ctl = null;
let current = null; // { payload, key, final }
let timerId = null;
let highlightPlaced = false;
let lastStartedKey = '';
let lastStartedAt = 0;

function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'href') { e.href = v; e.target = '_blank'; e.rel = 'noopener noreferrer'; }
    else if (k === 'disabled') e.disabled = true;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, String(v));
  }
  for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}

const headers = () => ({ 'Content-Type': 'application/json', ...(cfg.appToken ? { 'x-app-token': cfg.appToken } : {}) });

function isDarkActive() {
  if (cfg.theme === 'dark') return true;
  if (cfg.theme === 'light') return false;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

function applyTheme() {
  const root = document.documentElement;
  if (cfg.theme === 'light' || cfg.theme === 'dark') root.setAttribute('data-theme', cfg.theme);
  else root.removeAttribute('data-theme');
  $('themeBtn').textContent = isDarkActive() ? 'Light' : 'Dark';
}

async function refreshHealth() {
  try {
    const r = await (await fetch(cfg.serverUrl + '/health')).json();
    healthInfo = { ...healthInfo, ...r, ok: true };
    const modeLabel = (r.mode || 'replay').toUpperCase();
    $('modeBadge').textContent = r.hasKey ? modeLabel : `${modeLabel} · No key`;
    $('health').textContent = r.hasKey ? `Connected (${modeLabel} mode)` : 'Connected (TINYFISH_API_KEY unset)';
    $('offlineBanner').hidden = true;
    return true;
  } catch {
    healthInfo.ok = false;
    $('modeBadge').textContent = 'Offline';
    $('health').textContent = 'Cannot reach server';
    $('offlineBanner').hidden = !$('view').hidden;
    return false;
  }
}

async function loadCfg() {
  if (hasSyncStorage) {
    const s = await chrome.storage.sync.get(['serverUrl', 'appToken', 'theme']);
    cfg = { ...cfg, ...s };
  }
  $('serverUrl').value = cfg.serverUrl;
  $('appToken').value = cfg.appToken || '';
  applyTheme();
  await refreshHealth();
}

$('themeBtn').onclick = async () => {
  cfg.theme = isDarkActive() ? 'light' : 'dark';
  applyTheme();
  if (hasSyncStorage) await chrome.storage.sync.set({ theme: cfg.theme });
};

$('gear').onclick = () => {
  const open = $('settings').hidden;
  $('settings').hidden = !open;
  $('gear').setAttribute('aria-expanded', String(open));
};

$('save').onclick = async () => {
  cfg.serverUrl = $('serverUrl').value.trim().replace(/\/$/, '') || 'http://localhost:8787';
  cfg.appToken = $('appToken').value.trim();
  if (hasSyncStorage) await chrome.storage.sync.set({ serverUrl: cfg.serverUrl, appToken: cfg.appToken });
  await refreshHealth();
};

$('retryConnBtn').onclick = async () => {
  const ok = await refreshHealth();
  if (!ok) {
    $('settings').hidden = false;
    $('gear').setAttribute('aria-expanded', 'true');
  } else if (current?.payload) {
    start(current.payload);
  }
};

$('cancelTraceBtn').onclick = () => {
  if (ctl) ctl.abort();
  stopTimer();
  $('progress').classList.add('done');
  renderTraceError('Trace stopped before finishing.', 'CANCELLED');
};

function buildDebugReport() {
  const version = (typeof chrome !== 'undefined' && chrome?.runtime?.getManifest?.()?.version) || '0.2.0';
  const mode = (healthInfo?.mode || 'unknown').toLowerCase();
  const f = current?.final || null;
  const payload = current?.payload || null;

  // Hops: every hop (url, date, verifiedBy, sourceKind, exact quote, flags)
  const chainSource = f?.chain || [];
  const hops = chainSource.map((h) => ({
    url: h.url || h.finalUrl || null,
    date: h.date || null,
    verifiedBy: h.verifiedBy || null,
    sourceKind: h.sourceKind || null,
    quote: h.quote || '',
    flags: Array.isArray(h.flags)
      ? h.flags.map((fl) => (typeof fl === 'string' ? fl : fl?.code || fl?.text || JSON.stringify(fl)))
      : [],
  }));

  // Rejected pages with reasons
  const rejected = (f?.rejected || []).map((r) => ({
    url: r.url || null,
    reason: r.reason || null,
  }));

  // Per-stage timings
  const timings = f?.timings ? {
    totalMs: f.timings.totalMs != null ? f.timings.totalMs : null,
    softLimitHit: !!f.timings.softLimitHit,
    hardLimitHit: !!f.timings.hardLimitHit,
    stages: Array.isArray(f.timings.stages) ? f.timings.stages : [],
  } : null;

  // Usage counters
  const usage = f?.stats ? {
    fetches: f.stats.fetches || 0,
    searches: f.stats.searches || 0,
    agentCalls: f.stats.agentCalls || 0,
    linksChecked: f.stats.linksChecked || 0,
  } : {
    fetches: 0,
    searches: 0,
    agentCalls: 0,
    linksChecked: 0,
  };

  // Any error message or code
  const err = current?.error ? {
    message: current.error.message || null,
    code: current.error.code || null,
  } : null;

  const report = {
    extensionVersion: version,
    serverMode: mode,
    claim: payload?.claim || f?.claim?.raw || '',
    pageUrl: payload?.url || f?.chain?.[0]?.url || '',
    verdict: f ? {
      code: f.code || null,
      headline: f.headline || null,
    } : null,
    verdictCode: f?.code || null,
    verdictHeadline: f?.headline || null,
    hops,
    rejected,
    timings,
    usage,
    error: err,
  };

  return report;
}

async function copyDebugReport() {
  const report = buildDebugReport();
  const text = JSON.stringify(report, null, 2);
  let ok = false;
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      ok = true;
    }
  } catch (err) {
    console.warn('Clipboard writeText failed', err);
  }
  if (!ok) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      ok = document.execCommand('copy');
      document.body.removeChild(ta);
    } catch {}
  }

  const btn = $('copyDebugBtn');
  const confirmEl = $('copyDebugConfirm');
  if (confirmEl) {
    confirmEl.hidden = false;
    setTimeout(() => {
      confirmEl.hidden = true;
    }, 1800);
  }
  if (btn) {
    btn.setAttribute('aria-expanded', 'true');
    setTimeout(() => {
      btn.setAttribute('aria-expanded', 'false');
    }, 1800);
  }
}

if ($('copyDebugBtn')) {
  $('copyDebugBtn').onclick = copyDebugReport;
}

window.SourceHunterDebug = {
  buildDebugReport,
  copyDebugReport,
};

const fmtDate = (hop) => (hop?.dateUncertain ? 'date uncertain' : (hop?.date || 'date unknown'));

function quoteNode(hop) {
  const q = h('p', { class: 'quote' });
  if (hop.quoteDiff && hop.vsOrigin?.code !== 'MATCH' && hop.vsOrigin?.code !== 'CONTRADICTED') {
    hop.quoteDiff.forEach((w, i) => { q.append(w.changed ? h('mark', {}, w.w) : w.w, i < hop.quoteDiff.length - 1 ? ' ' : ''); });
  } else q.append('\u201C' + hop.quote + '\u201D');
  return q;
}

function hopCard(hop) {
  const code = hop.vsOrigin?.code;
  const isDisputedHop = Boolean(hop.disputedHere || hop.dispute || hop.vsOrigin?.code === 'DISPUTED' || hop.vsCited?.code === 'DISPUTED' || current?.final?.code === 'DISPUTED');
  const tone = hop.dispute ? 'bad' : hop.role === 'origin' ? (hop.sourceKind === 'primary-likely' ? 'ok' : 'warn') : TONE[code] || 'none';
  const kindBadge = (hop.role === 'origin' || (hop.role !== 'start' && hop.sourceKindLabel))
    ? h('span', { class: `badge ${hop.sourceKind === 'primary-likely' ? 'p' : 't'}` }, hop.sourceKindLabel || hop.sourceKind)
    : null;
  const li = h('li', { id: `hop-${hop.id}`, class: `hop ${hop.role === 'origin' ? 'origin' : ''} ${hop.changedHere ? 'broken' : ''} ${tone}` }, h('span', { class: 'node', 'aria-hidden': 'true' }));
  const dateEl = hop.dateUncertain
    ? h('span', { class: 'badge t', title: hop.dateReason || 'Date flagged as unreliable' }, 'date uncertain')
    : h('span', {}, fmtDate(hop));
  const changeBadge = hop.changedHere
    ? h('span', { class: 'badge chg' }, isDisputedHop ? 'disputed here' : 'changed here')
    : null;
  const meta = h('div', { class: 'meta' },
    h('span', { class: 'host' }, hop.role === 'start' ? `You are here · ${hop.host}` : hop.host),
    dateEl,
    hop.verifiedBy === 'fetch' ? h('span', { class: 'badge v', title: 'Verbatim text verified in fetched page' }, 'verified in page') : null,
    hop.verifiedBy === 'agent' ? h('span', { class: 'badge a', title: 'Read via browser agent' }, 'agent-read') : null,
    hop.verifiedBy === 'selection' ? h('span', { class: 'badge', title: 'Highlighted text' }, 'your highlight') : null,
    kindBadge,
    changeBadge
  );
  const card = h('div', { class: 'card' }, meta, quoteNode(hop));
  if (hop.dispute?.disputeQuote) {
    card.append(h('div', { class: 'dispute-box' },
      h('div', { class: 'dispute-label' }, 'Disputing sentence on page'),
      h('blockquote', { class: 'dispute-quote' }, `\u201C${hop.dispute.disputeQuote}\u201D`),
      h('div', { class: 'dispute-meta' }, `${hop.host}, ${hop.dateUncertain ? 'date uncertain' : (hop.date || 'date unknown')}`)
    ));
  }
  const flags = [...(hop.changedHere && hop.vsCited ? hop.vsCited.flags : hop.vsOrigin?.flags || []), ...(hop.vsClaim?.flags || []), ...(hop.flags || [])];
  if (flags.length) {
    card.append(h('ul', { class: 'flags' }, flags.map((fl) => h('li', { class: ['CHANGED', 'SCOPE', 'CAUSATION', 'MISQUOTED', 'CONTRADICTED', 'DISPUTED'].includes(fl.code) ? 'bad' : 'warn' }, fl.text))));
  }
  card.append(h('div', { class: 'rel' }, hop.relation, hop.role !== 'start' ? [' · ', h('a', { href: hop.url }, 'open source')] : ''));
  li.append(card);
  return li;
}

function extractVersionSnippet(hop, kind) {
  const txt = String(hop?.quote || '');
  if (kind !== 'quote') {
    const unitNum = txt.match(/(?:about|around|roughly|nearly|almost|over|under|up to|at least|more than|less than|approximately)?\s*(?:[$£€]\s*\d[\d.,]*(?:\s*(?:billion|million|thousand|trillion))?|\d[\d.,]*\s*(?:%|percent|billion|million|thousand|trillion|metric\s+tons?))/i);
    if (unitNum) return unitNum[0].trim();
    const m = txt.match(/(?:about|around|roughly|nearly|almost|over|under|up to|at least|more than|less than|approximately)?\s*[$£€]?\d[\d.,]*(?:\s*(?:%|percent|billion|million|thousand|trillion|metric\s+tons?|times|years?))?/i);
    if (m) return m[0].trim();
    if (/\balmost half\b/i.test(txt)) return 'almost half';
  }
  return txt.length > 34 ? `${txt.slice(0, 32)}\u2026` : txt;
}

function buildDriftMeter(f) {
  const isNoSource = f.code === 'NO_SOURCE' || f.status === 'no_source';
  const isUncitedSecondary = f.code === 'UNCITED' || (f.status === 'earliest_uncited' && f.code !== 'DISPUTED' && f.code !== 'CONTRADICTED');
  const isCitedUnconfirmed = f.code === 'CITED_UNCONFIRMED' || f.status === 'cited_not_confirmed';
  const isPrimaryPub = f.code === 'PRIMARY_PUBLISHER' || f.status === 'publisher_is_source';
  const isDisputed = f.code === 'DISPUTED' || f.code === 'CONTRADICTED' || f.status === 'disputed_on_page' || !!f.disputeQuote || (f.chain || []).some((h) => h.dispute);

  const numbersEqual = Boolean(f.chain?.length >= 2 && f.chain[0]?.quote && f.origin?.quote && (() => {
    const s0 = f.chain[0].quote;
    const so = f.origin.quote;
    const n0 = (s0.match(/\d+(?:\.\d+)?%?/g) || []).map((x) => x.trim());
    const no = (so.match(/\d+(?:\.\d+)?%?/g) || []).map((x) => x.trim());
    return n0.length > 0 && no.length > 0 && n0[0] === no[0];
  })());

  const lvl = isNoSource ? -1
    : isPrimaryPub ? 0
    : isCitedUnconfirmed ? 2
    : isUncitedSecondary ? 1
    : isDisputed ? 4
    : (DRIFT_LEVEL[f.code] ?? 2);

  const segs = DRIFT_STEPS.map((_, idx) => h('span', { class: `drift-seg ${!isNoSource && idx <= lvl ? 'active' : ''}` }));
  const summary = isNoSource
    ? 'Untraceable — no original source found'
    : isPrimaryPub
      ? 'Primary publisher (1/5)'
      : isCitedUnconfirmed
        ? 'Cited, not confirmed'
        : isDisputed
          ? 'Disputed by source'
          : isUncitedSecondary
            ? 'Uncited secondary match (2/5)'
            : `${DRIFT_STEPS[lvl]} (${lvl + 1}/5)`;

  const ordered = [...(f.chain || [])].reverse();
  const chips = [];
  if (ordered.length >= 2 && !isDisputed && !numbersEqual) {
    ordered.forEach((hop, idx) => {
      if (idx > 0) chips.push(h('span', { class: 'dv-arrow', 'aria-hidden': 'true' }, '\u2192'));
      const who = hop.role === 'origin'
        ? (hop.sourceKind === 'primary-likely' ? 'Primary' : 'Earliest')
        : hop.role === 'start' ? 'Your page' : hop.host;
      chips.push(h('span', { class: 'dv-chip' }, h('b', {}, `${who}:`), extractVersionSnippet(hop, f.claim?.kind)));
    });
  }

  return h('div', { class: 'drift', role: 'group', 'aria-label': `Drift meter: ${summary}` },
    h('div', { class: 'drift-head' }, h('span', {}, 'Drift meter'), h('strong', {}, summary)),
    chips.length ? h('div', { class: 'drift-versions' }, chips) : null,
    h('div', { class: 'drift-track' }, segs),
    h('div', { class: 'drift-scale' }, h('span', {}, 'Exact'), h('span', {}, 'Minor'), h('span', {}, isDisputed ? 'Disputed' : 'Shifted / Disputed'))
  );
}

async function sendToActiveTab(msg) {
  try {
    let tabId = current?.payload?.tabId;
    if (!tabId && chrome.tabs?.query) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      tabId = tab?.id;
    }
    if (!tabId || !chrome.tabs?.sendMessage) return null;
    return await new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, msg, (resp) => {
        void chrome.runtime.lastError;
        resolve(resp || null);
      });
    });
  } catch {
    return null;
  }
}

async function retryWithAgent(rejectedItem, btn, msgEl) {
  if (!healthInfo.allowAgent) {
    msgEl.textContent = 'Set ALLOW_AGENT=1 in server/.env to enable browser agent retries.';
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Reading\u2026';
  msgEl.textContent = '';
  try {
    const r = await fetch(cfg.serverUrl + '/api/agent-retry', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ claim: current.payload.claim, url: current.payload.url, targetUrl: rejectedItem.url }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `Server error ${r.status}`);
    if (j.hit && j.final) {
      renderFinal(j.final);
      return;
    }
    msgEl.textContent = j.reason || 'Browser agent did not find this claim on the page.';
    btn.textContent = 'No match';
  } catch (e) {
    msgEl.textContent = e.message;
    btn.disabled = false;
    btn.textContent = 'Try browser agent';
  }
}

function renderRejected(rej) {
  $('rejectedBox').hidden = !rej.length;
  $('rejectedSum').textContent = `${rej.length} checked page${rej.length > 1 ? 's' : ''} did not verify this claim`;
  $('rejectedHint').hidden = !rej.length || healthInfo.allowAgent;
  if (!healthInfo.allowAgent) {
    $('rejectedHint').textContent = 'Browser-agent retries are disabled (ALLOW_AGENT=0) to protect your TinyFish credits.';
  }
  $('rejected').replaceChildren(...rej.map((r) => {
    const canRetry = /block|unreadable|timed out|failed|almost no readable|403|bot/i.test(r.reason || '');
    const msgEl = h('div', { class: 'agent-msg' });
    const btn = canRetry
      ? h('span', { class: 'action-item', style: 'display:inline-flex;margin-left:6px;' },
        h('button', {
          type: 'button',
          class: 'mini-btn',
          style: 'margin-left:0;',
          disabled: !healthInfo.allowAgent,
          title: healthInfo.allowAgent ? 'Open in headless browser agent' : 'Disabled: set ALLOW_AGENT=1 in server/.env',
          onclick: () => retryWithAgent(r, btn.querySelector('button'), msgEl),
        }, 'Try browser agent'),
        !healthInfo.allowAgent ? h('span', { class: 'btn-note' }, 'Disabled: set ALLOW_AGENT=1 in server/.env') : null
      )
      : null;
    return h('li', {}, h('a', { href: r.url }, r.host || r.url), ` · ${r.reason}`, btn, msgEl);
  }));
}

function renderFinal(f) {
  stopTimer();
  current = current || {};
  current.final = f;
  current.error = null;
  $('progress').classList.add('done');
  $('offlineBanner').hidden = true;

  const v = $('verdict');
  v.hidden = false;
  v.className = f.tone || 'none';

  const tagText = f.status === 'no_source' ? 'NO_SOURCE'
    : f.code === 'CITED_UNCONFIRMED' || f.status === 'cited_not_confirmed' ? 'CITED_NOT_CONFIRMED'
    : f.code === 'PRIMARY_PUBLISHER' || f.status === 'publisher_is_source' ? 'PRIMARY_SOURCE'
    : f.code === 'UNCITED' ? 'UNCITED'
      : f.status === 'earliest_uncited' ? 'UNCITED'
        : f.code === 'DISPUTED' ? 'DISPUTED'
          : f.code === 'CONTRADICTED' ? 'CONTRADICTED'
            : f.code === 'MATCH' ? 'MATCH'
              : (f.code || LABEL[f.code] || 'VERDICT');

  const originKindPill = f.origin?.sourceKindLabel
    ? h('span', { class: 'kind-pill' }, f.origin.sourceKindLabel)
    : null;

  const primaryReason = (f.reasons && f.reasons[0]) || (
    f.code === 'NO_SOURCE'
      ? 'No inline citation or earlier primary source was verified for this claim.'
      : 'See the verified hops below.'
  );
  const extraReasons = (f.reasons || []).slice(1);
  const reasonEl = h('p', { class: 'verdict-reason' }, primaryReason);
  const moreReasonsEl = extraReasons.length
    ? h('details', { class: 'more-reasons' },
      h('summary', {}, `${extraReasons.length} additional note${extraReasons.length === 1 ? '' : 's'}`),
      h('ul', {}, extraReasons.map((r) => h('li', {}, r)))
    )
    : null;

  const citedSection = (f.code === 'CITED_UNCONFIRMED' || f.status === 'cited_not_confirmed') && (f.citedPages || []).length
    ? h('div', { class: 'cited-unconfirmed-list' },
      (f.citedPages || []).map((cp) => h('div', { class: 'cited-unconfirmed-card' },
        h('div', { class: 'cited-unconfirmed-head' },
          h('a', { href: cp.url }, cp.host),
          h('span', { class: 'meta' }, cp.date || 'date unknown')
        ),
        cp.closestPassage
          ? h('div', { class: 'closest-passage-box' },
            h('div', { class: 'closest-passage-label' }, cp.note || 'closest passage, not verified as the same claim'),
            h('blockquote', { class: 'closest-passage-quote' }, `\u201C${cp.closestPassage}\u201D`),
            h('p', { class: 'closest-passage-note' }, f.paraphraseNote || 'This can happen when the writer paraphrased the study.')
          )
          : h('div', { class: 'closest-passage-box' },
            h('div', { class: 'closest-passage-label', style: 'color:var(--warn);' }, cp.reason || 'blocked by a bot check'),
            h('p', { class: 'closest-passage-note' }, f.paraphraseNote || 'Open them to check the wording yourself.')
          )
      ))
    )
    : null;

  const partialBanner = (f.partial || f.timings?.hardLimitHit)
    ? h('div', { class: 'partial-banner' },
      h('span', {}, 'Partial trace: reached time limit showing sources verified so far.'),
      h('button', { type: 'button', class: 'mini-btn', onclick: () => current?.payload && start(current.payload) }, 'Retry trace')
    )
    : null;

  const dispHop = (f.chain || []).find((h) => h.dispute) || f.origin || f.chain?.[f.chain.length - 1];
  const disputeBlock = f.disputeQuote
    ? h('div', { class: 'dispute-box' },
      h('div', { class: 'dispute-label' }, 'Disputing sentence from source'),
      h('blockquote', { class: 'dispute-quote' }, `\u201C${f.disputeQuote}\u201D`),
      h('div', { class: 'dispute-meta' }, `${f.disputeHost || dispHop?.host || ''}, ${f.disputeDateUncertain ? 'date uncertain' : (f.disputeDate || dispHop?.date || 'date unknown')}`)
    )
    : null;

  const rej = f.rejected || [];
  const s = f.stats || {};
  const checkedStrip = h('div', { class: 'checked-strip' },
    h('span', {}, `Checked: ${s.fetches || 0} pages opened`),
    h('span', {}, `${s.searches || 0} search${s.searches === 1 ? '' : 'es'}`),
    rej.length
      ? h('button', {
        type: 'button',
        class: 'checked-link',
        onclick: () => {
          $('rejectedBox').hidden = false;
          $('rejectedBox').open = true;
          $('rejectedBox').scrollIntoView({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
        },
      }, `${rej.length} cited page${rej.length === 1 ? '' : 's'} rejected`)
      : h('span', {}, '0 cited pages rejected')
  );

  const driftHop = (f.chain || []).find((x) => x.id === f.firstDriftHopId)
    || (f.chain || []).find((x) => x.changedHere)
    || (f.chain || []).find((x) => x.dispute)
    || (f.chain || []).find((x) => x.role !== 'origin' && x.vsOrigin?.code && x.vsOrigin.code !== 'MATCH');

  const jumpBtn = driftHop && f.code !== 'MATCH' && f.code !== 'NO_SOURCE' && f.code !== 'CITED_UNCONFIRMED' && f.code !== 'PRIMARY_PUBLISHER'
    ? h('button', {
      type: 'button',
      class: 'jump-btn',
      onclick: () => {
        const el = document.getElementById(`hop-${driftHop.id}`);
        if (!el) return;
        el.scrollIntoView({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
        el.classList.add('hop-focus');
        setTimeout(() => el.classList.remove('hop-focus'), 1600);
      },
    }, `Where it changed \u2192 ${driftHop.host}`)
    : null;

  const followRefBtn = ((f.code === 'PRIMARY_PUBLISHER' || f.status === 'publisher_is_source') && (f.hasReferenceLinks || current?.payload?.hasReferenceLinks))
    ? h('button', {
      type: 'button',
      class: 'btn-secondary',
      onclick: () => {
        alert("References/Sources links are present on this page.");
      },
    }, "Follow this page's References/Sources links")
    : null;

  const copyBtn = h('button', {
    type: 'button',
    class: 'btn-secondary',
    onclick: async () => {
      const txt = window.SourceHunterReceipt.formatCitationText(f, current.payload);
      await navigator.clipboard?.writeText(txt).catch(() => {});
      copyBtn.textContent = 'Copied';
      setTimeout(() => (copyBtn.textContent = 'Copy citation'), 1600);
    },
  }, 'Copy citation');

  const pngBtn = h('button', {
    type: 'button',
    class: 'btn-secondary',
    onclick: () => window.SourceHunterReceipt.exportPng(f, current.payload, isDarkActive()),
  }, 'Export PNG');

  const clearBtn = h('button', {
    type: 'button',
    class: 'btn-secondary',
    onclick: async () => {
      await sendToActiveTab({ type: 'CLEAR_HIGHLIGHT' });
      highlightPlaced = false;
      clearBtn.hidden = true;
    },
  }, 'Clear page mark');
  clearBtn.hidden = !highlightPlaced;

  v.replaceChildren(...[
    h('div', { class: 'verdict-top' }, h('div', { class: 'tag' }, tagText), originKindPill),
    h('h2', {}, f.headline),
    reasonEl,
    citedSection,
    partialBanner,
    buildDriftMeter(f),
    disputeBlock,
    moreReasonsEl,
    checkedStrip,
    h('div', { class: 'actions-row' },
      h('div', { class: 'actions-buttons' }, ...[jumpBtn, followRefBtn, copyBtn, pngBtn, clearBtn].filter(Boolean))
    ),
  ].filter(Boolean));

  $('chain').replaceChildren(...(f.chain || []).map(hopCard));
  renderRejected(f.rejected || []);

  const also = f.alsoFound || [];
  $('alsoBox').hidden = !also.length;
  $('alsoSum').textContent = `${also.length} other page${also.length > 1 ? 's' : ''} also state this claim`;
  $('also').replaceChildren(...also.map(hopCard));

  const timingStr = f.timings?.totalMs != null
    ? ` · ${(f.timings.totalMs / 1000).toFixed(1)}s total`
      + (f.timings.stages?.length ? ` (${f.timings.stages.map((st) => `${st.stage} ${st.ms}ms`).join(', ')})` : '')
    : '';
  $('stats').textContent = `Opened ${s.fetches || 0} pages · ${s.searches || 0} searches · ${s.agentCalls || 0} browser-agent reads${timingStr}. Quotes are copied verbatim from fetched pages.`;

  sendToActiveTab({
    type: 'HIGHLIGHT_VERDICT',
    claim: current.payload.claim,
    tone: f.tone || 'none',
    code: f.code,
    headline: f.headline,
    originHost: f.origin?.host || null,
  }).then((resp) => {
    if (resp?.ok) {
      highlightPlaced = true;
      clearBtn.hidden = false;
    }
  });

  renderDeep(f);
}

function renderDeep(f, run) {
  const box = $('deep');
  box.hidden = false;
  if (run?.status && !run.done) {
    box.replaceChildren(h('p', {}, `TinyResearch is working (${run.status.toLowerCase()}). Deep runs take 5 to 20 minutes; reopen this panel anytime to check.`));
    return;
  }
  if (run?.error) {
    box.replaceChildren(h('p', { class: 'err' }, 'Deep trace did not finish: ' + run.error));
    return;
  }
  if (f?.research) {
    box.replaceChildren(...[
      h('p', {}, `TinyResearch proposed ${f.research.citationsProposed} sources. ${f.research.confirmed} confirmed verbatim via Fetch; unconfirmed links were discarded.`),
      run?.report ? h('details', {}, h('summary', {}, 'TinyResearch report (unverified leads)'), h('div', { class: 'report' }, run.report)) : null,
    ].filter(Boolean));
    return;
  }
  const showConfirm = () => {
    box.replaceChildren(
      h('p', {}, 'Confirm deep trace? Uses 1 TinyResearch run (credit-gated, takes 5–20 minutes). Every proposed link is re-checked verbatim with Fetch.'),
      h('div', { class: 'deep-actions' },
        h('button', { type: 'button', class: 'btn', onclick: startDeep }, 'Confirm deep trace'),
        h('button', { type: 'button', class: 'btn-secondary', onclick: () => renderDeep(f) }, 'Cancel')
      )
    );
  };
  const deepBtn = h('button', {
    type: 'button',
    class: 'btn',
    disabled: !healthInfo.allowResearch,
    title: healthInfo.allowResearch ? 'Launch TinyResearch deep run' : 'Disabled: set ALLOW_RESEARCH=1 in server/.env',
    onclick: showConfirm,
  }, 'Run deep trace');
  const deepNote = !healthInfo.allowResearch
    ? h('span', { class: 'btn-note' }, 'Disabled: set ALLOW_RESEARCH=1 in server/.env to protect credits.')
    : null;
  box.replaceChildren(
    h('p', {}, 'Quick trace searches and follows links now. Deep trace hands this claim to TinyResearch and verifies every returned source verbatim.'),
    h('div', { class: 'action-item' }, h('div', {}, deepBtn), deepNote)
  );
}

async function startDeep() {
  $('deep').replaceChildren(h('p', {}, 'Starting TinyResearch\u2026'));
  try {
    const r = await fetch(cfg.serverUrl + '/api/research', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ claim: current.payload.claim, url: current.payload.url, confirm: true }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
    pollDeep(j.id);
  } catch (e) {
    $('deep').replaceChildren(h('p', { class: 'err' }, e.message));
  }
}

async function pollDeep(id) {
  const me = current;
  while (me === current) {
    try {
      const j = await (await fetch(`${cfg.serverUrl}/api/research/${id}`, { headers: headers() })).json();
      if (j.error && !j.status) throw new Error(j.error);
      if (j.done && j.final) { renderFinal(j.final); renderDeep(j.final, j); return; }
      renderDeep(current.final, j);
      if (j.done) return;
    } catch (e) {
      $('deep').replaceChildren(h('p', { class: 'err' }, e.message));
      return;
    }
    await new Promise((r) => setTimeout(r, 12000));
  }
}

function startTimer() {
  stopTimer();
  const t0 = Date.now();
  const tick = () => {
    const s = ((Date.now() - t0) / 1000).toFixed(1);
    $('elapsed').textContent = `${s}s`;
  };
  tick();
  timerId = setInterval(tick, 200);
}

function stopTimer() {
  if (timerId) { clearInterval(timerId); timerId = null; }
}

function renderTraceError(message, code) {
  stopTimer();
  $('progress').classList.add('done');
  const v = $('verdict');
  v.hidden = false;
  const normCode = code || (/failed to fetch|networkerror|econnrefused|unreachable/i.test(message) ? 'SERVER_UNREACHABLE'
    : /budget|cap/i.test(message) ? 'BUDGET_CAP'
    : /not recorded/i.test(message) ? 'NOT_RECORDED'
    : 'ERROR');

  current = current || {};
  current.error = { message: message || '', code: normCode };

  const cfgMap = {
    NOT_RECORDED: {
      tone: 'warn',
      tag: 'NOT_RECORDED',
      title: 'Not recorded in replay cache',
      reason: 'Offline replay mode serves only cached traces and has no recording for this page.',
      actionLabel: 'Open Settings',
      action: () => { $('settings').hidden = false; $('gear').setAttribute('aria-expanded', 'true'); },
    },
    BUDGET_CAP: {
      tone: 'warn',
      tag: 'BUDGET_CAP',
      title: 'Daily safety budget reached',
      reason: 'Credit-safety limit in server/.tfcache/usage.json paused live TinyFish calls until UTC midnight.',
      actionLabel: 'Open Settings',
      action: () => { $('settings').hidden = false; $('gear').setAttribute('aria-expanded', 'true'); },
    },
    SERVER_UNREACHABLE: {
      tone: 'warn',
      tag: 'OFFLINE',
      title: 'Trace server unreachable',
      reason: `Could not connect to Source Hunter server at ${cfg.serverUrl}. Ensure server is running.`,
      actionLabel: 'Retry connection',
      action: async () => { const ok = await refreshHealth(); if (ok && current?.payload) start(current.payload); },
    },
    CANCELLED: {
      tone: 'none',
      tag: 'CANCELLED',
      title: 'Trace stopped',
      reason: message || 'Trace cancelled before completion.',
      actionLabel: 'Retry trace',
      action: () => current?.payload && start(current.payload),
    },
    ERROR: {
      tone: 'bad',
      tag: 'ERROR',
      title: 'Could not complete trace',
      reason: message || 'An unexpected error interrupted this trace.',
      actionLabel: 'Try again',
      action: () => current?.payload && start(current.payload),
    },
  };
  const ui = cfgMap[normCode] || cfgMap.ERROR;
  v.className = ui.tone;
  v.replaceChildren(...[
    h('div', { class: 'verdict-top' }, h('div', { class: 'tag' }, ui.tag)),
    h('h2', {}, ui.title),
    h('p', { class: 'verdict-reason' }, ui.reason),
    message && ui.reason !== message ? h('p', { class: 'state-msg' }, message) : null,
    h('div', { class: 'actions-row' },
      h('div', { class: 'actions-buttons' },
        h('button', { type: 'button', class: 'btn-secondary', onclick: ui.action }, ui.actionLabel)
      )
    ),
  ].filter(Boolean));
}

function renderClaimHeader(payload, f) {
  const claimEl = $('claim');
  const target = payload?.claim || f?.claim?.raw || '';
  const isMulti = Boolean(payload?.multiSentence || f?.claim?.multiSentence);
  if (isMulti) {
    claimEl.replaceChildren(
      h('div', { class: 'multi-claim-prefix' }, 'Tracing this sentence:'),
      h('span', { class: 'multi-claim-target' }, `\u201C${target}\u201D`),
      h('div', { class: 'multi-claim-tip' }, payload?.multiSentenceTip || f?.claim?.multiSentenceTip || 'Tip: For best results, highlight one claim at a time.')
    );
  } else {
    claimEl.textContent = target;
  }
}

async function start(payload) {
  const dedupeKey = `${payload?.url || ''}|${payload?.claim || ''}`;
  const now = Date.now();
  if (dedupeKey === lastStartedKey && now - lastStartedAt < 400) return;
  lastStartedKey = dedupeKey;
  lastStartedAt = now;

  if (ctl) ctl.abort();
  ctl = new AbortController();
  current = { payload, key: null, final: null, error: null };
  highlightPlaced = false;
  $('offlineBanner').hidden = true;
  $('empty').hidden = true;
  $('view').hidden = false;
  renderClaimHeader(payload, null);
  $('verdict').hidden = true;
  $('chain').replaceChildren();
  ['rejectedBox', 'alsoBox', 'deep'].forEach((i) => ($(i).hidden = true));
  $('stats').textContent = '';
  $('progress').classList.remove('done');
  $('status').textContent = 'Connecting to trace server\u2026';
  startTimer();
  refreshHealth().catch(() => {});

  const live = [];
  try {
    const res = await fetch(cfg.serverUrl + '/api/trace', { method: 'POST', headers: headers(), body: JSON.stringify(payload), signal: ctl.signal });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const err = new Error(errBody.error || `Server error ${res.status}`);
      err.code = errBody.code || null;
      throw err;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const type = /^event: (.*)$/m.exec(frame)?.[1];
        const data = JSON.parse(/^data: (.*)$/m.exec(frame)?.[1] || '{}');
        if (type === 'status') $('status').textContent = data.msg;
        else if (type === 'hop') {
          if (!live.some((x) => x.id === data.hop.id)) live.push(data.hop);
          $('chain').replaceChildren(...live.map(hopCard));
        } else if (type === 'error') {
          const err = new Error(data.message);
          err.code = data.code || null;
          throw err;
        } else if (type === 'result') {
          current.key = data.key;
          renderClaimHeader(current?.payload, data.final);
          renderFinal(data.final);
          if (data.researchId) pollDeep(data.researchId);
        }
      }
    }
  } catch (e) {
    if (e.name === 'AbortError') return;
    renderTraceError(e.message, e.code);
  }
}

if (hasSessionStorage) {
  chrome.storage.session.onChanged.addListener((c) => { if (c.pending?.newValue) start(c.pending.newValue); });
}
(async () => {
  if (hasSyncStorage) {
    await loadCfg();
  } else {
    applyTheme();
  }
  if (hasSessionStorage) {
    const { pending } = await chrome.storage.session.get('pending');
    if (pending) start(pending);
    return;
  }
  // Safe offline preview hook (used only when opened outside Chrome extension runtime, e.g. screenshot capture)
  if (window.__SH_PREVIEW__) {
    const p = window.__SH_PREVIEW__;
    if (p.theme) { cfg.theme = p.theme; applyTheme(); }
    if (p.health) {
      healthInfo = { ...healthInfo, ...p.health };
      $('modeBadge').textContent = p.health.ok ? (p.health.mode || 'REPLAY').toUpperCase() : 'Offline';
    }
    $('offlineBanner').hidden = !p.offlineBanner;
    if (p.mode === 'empty') {
      $('empty').hidden = false;
      $('view').hidden = true;
    } else if (p.mode === 'loading') {
      $('empty').hidden = true;
      $('view').hidden = false;
      renderClaimHeader({ claim: p.claim, multiSentence: p.multiSentence, multiSentenceTip: p.multiSentenceTip }, null);
      $('progress').classList.remove('done');
      $('status').textContent = p.statusMsg || 'Fetching cited sources\u2026';
      $('elapsed').textContent = p.elapsed || '4.2s';
      current = { payload: { claim: p.claim || '' }, key: null, final: null };
      if (p.hops?.length) $('chain').replaceChildren(...p.hops.map(hopCard));
    } else if (p.mode === 'final' && p.final) {
      $('empty').hidden = true;
      $('view').hidden = false;
      renderClaimHeader({ claim: p.final.claim?.raw, multiSentence: p.final.claim?.multiSentence, multiSentenceTip: p.final.claim?.multiSentenceTip }, p.final);
      current = { payload: { claim: p.final.claim?.raw || '' }, key: 'preview', final: p.final };
      renderFinal(p.final);
    } else if (p.mode === 'error') {
      $('empty').hidden = true;
      $('view').hidden = false;
      $('claim').textContent = p.claim || '';
      current = { payload: { claim: p.claim || '' }, key: null, final: null };
      renderTraceError(p.message, p.code);
    }
  }
})();
