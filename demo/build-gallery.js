// Builds demo/index.html strictly from real recorded trace JSONs (zero fabricated quotes, URLs or dates).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assemble } from '../server/src/trace.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(here, '..');
const cacheDir = path.join(rootDir, 'server', '.cache');
const spendFile = path.join(here, 'spend-log.md');
const outHtml = path.join(here, 'index.html');
const manifestFile = path.join(here, 'final-traces.json');

const DEFAULT_CASES = [
  { id: 'cpi91', topic: 'Economics', file: path.join(cacheDir, '43bd56af79a7a5614b515eb5.json'), recordedAt: '2026-11-11' },
  { id: 'apple', topic: 'Earnings', file: path.join(cacheDir, 'b732aca3c8c29fda6187c8ec.json'), recordedAt: '2026-11-11' },
  { id: 'brain10', topic: 'Neuroscience', file: path.join(cacheDir, '500700f529ed3a3d64867489.json'), recordedAt: '2026-11-11' },
  { id: 'marie', topic: 'History', file: path.join(cacheDir, 'b796a389d5c2254d59955730.json'), recordedAt: '2026-11-11' },
  { id: 'clean38', topic: 'Energy', file: path.join(cacheDir, '34eb2d13e4fe2c3a017d23f5.json'), recordedAt: '2026-11-11' },
  { id: 'moore', topic: 'Computing', file: path.join(cacheDir, 'ceb03ee29da19c4b14a9c0df.json'), recordedAt: '2026-11-11' },
];

function serializeTrace(id, topic, recordedAt, raw) {
  const fin = (raw.state ? assemble(raw.state) : raw.final) || raw;
  return {
    id,
    topic,
    recordedAt,
    final: {
      claim: fin.claim,
      code: fin.code,
      status: fin.status,
      tone: fin.tone,
      severity: fin.severity ?? 0,
      headline: fin.headline,
      originCitesNothing: !!fin.originCitesNothing,
      firstDriftHopId: fin.firstDriftHopId || null,
      disputeQuote: fin.disputeQuote || null,
      disputeCues: fin.disputeCues || null,
      reasons: fin.reasons || [],
      origin: fin.origin || null,
      chain: (fin.chain || []).map((h) => ({
        role: h.role,
        host: h.host,
        url: h.url,
        date: h.date || null,
        dateUncertain: !!h.dateUncertain,
        dateReason: h.dateReason || null,
        verifiedBy: h.verifiedBy,
        sourceKind: h.sourceKind,
        sourceKindLabel: h.sourceKindLabel || null,
        quote: h.quote,
        quoteDiff: h.quoteDiff || null,
        dispute: h.dispute || null,
        vsOrigin: h.vsOrigin || null,
        vsCited: h.vsCited || null,
        changedHere: !!h.changedHere,
        flags: h.flags || [],
        relation: h.relation,
      })),
      rejected: (fin.rejected || []).slice(0, 8),
      rejectedCount: (fin.rejected || []).length,
      alsoFound: (fin.alsoFound || []).slice(0, 5).map((h) => ({
        host: h.host,
        url: h.url,
        date: h.date || null,
        dateUncertain: !!h.dateUncertain,
        sourceKind: h.sourceKind || null,
        sourceKindLabel: h.sourceKindLabel || null,
        vsClaim: h.vsClaim || null,
        quote: h.quote,
        via: h.via,
        relation: h.relation || null,
      })),
      alsoFoundCount: (fin.alsoFound || []).length,
      stats: fin.stats || {},
      timings: fin.timings || null,
      research: fin.research || null,
      citedPages: fin.citedPages || null,
      paraphraseNote: fin.paraphraseNote || null,
      hasReferenceLinks: !!fin.hasReferenceLinks,
      disputeHost: fin.disputeHost || null,
      disputeDate: fin.disputeDate || null,
      disputeDateUncertain: !!fin.disputeDateUncertain,
    },
  };
}

let cases = [];
let g2Research = null;
if (fs.existsSync(manifestFile)) {
  const m = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  cases = (m.cases || []).map((entry) => {
    const abs = path.isAbsolute(entry.file) ? entry.file : path.join(here, entry.file);
    if (!fs.existsSync(abs)) return null;
    return serializeTrace(entry.id, entry.topic, entry.recordedAt, JSON.parse(fs.readFileSync(abs, 'utf8')));
  }).filter(Boolean);
  if (m.research) g2Research = m.research;
} else {
  cases = DEFAULT_CASES.map((entry) => {
    if (!fs.existsSync(entry.file)) return null;
    return serializeTrace(entry.id, entry.topic, entry.recordedAt, JSON.parse(fs.readFileSync(entry.file, 'utf8')));
  }).filter(Boolean);
}

const spendMd = fs.existsSync(spendFile) ? fs.readFileSync(spendFile, 'utf8') : '';
const researchSample = g2Research || JSON.parse(fs.readFileSync(path.join(here, 'research-completed-sample.json'), 'utf8'));

const payload = {
  generatedAt: new Date().toISOString(),
  cases,
  researchPreview: g2Research ? {
    mode: 'verified',
    claim: g2Research.claim,
    report: g2Research.report,
    research: g2Research.final?.research || null,
    origin: g2Research.final?.origin || null,
    recordedAt: g2Research.recordedAt || null,
  } : {
    mode: 'shape-verification',
    query: researchSample.query,
    runId: researchSample.research_run_id,
    status: researchSample.status,
    answerPreview: String(researchSample.deep_result?.result || '').slice(0, 600),
  },
  walletNote: spendMd
    .split(/\r?\n/)
    .filter((l) => /Wallet|Difference|Session API|Daily Totals/.test(l))
    .slice(-6)
    .map((l) => l.replace(/^- /, '').replace(/\*\*|`/g, '')),
};

const safeJson = JSON.stringify(payload).replace(/<\/script/gi, '<\\/script');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Source Hunter — Citation Trail Gallery</title>
<style>
:root {
  --bg: #f6f4ef; --panel: #ffffff; --ink: #17202a; --muted: #4d5966; --line: #d6d1c7;
  --ok: #14633c; --ok-bg: #e8f5ee; --warn: #7c4600; --warn-bg: #fdf3dc;
  --bad: #a61e18; --bad-bg: #fdeceb; --none: #4d5966; --none-bg: #eceff2;
  --link: #095975; --mark: #fde087; --rail: #c9c3b8;
  --serif: Georgia, "Iowan Old Style", "Times New Roman", serif;
  --sans: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
:root[data-theme="dark"] {
  --bg: #10151b; --panel: #182028; --ink: #edf1f5; --muted: #a6b3bf; --line: #2d3742;
  --ok: #64d397; --ok-bg: #122b1e; --warn: #f0b354; --warn-bg: #2e220f;
  --bad: #f7877f; --bad-bg: #311716; --none: #aeb9c4; --none-bg: #202831;
  --link: #73ccf0; --mark: #5e470c; --rail: #3a4654;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 14.5px/1.55 var(--sans); -webkit-font-smoothing: antialiased; }
a { color: var(--link); }
a:focus-visible, button:focus-visible, summary:focus-visible { outline: 2.5px solid var(--link); outline-offset: 2px; border-radius: 4px; }

.wrap { max-width: 1180px; width: 100%; margin: 0 auto; padding: 30px 24px 64px; }
header.top {
  display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 22px;
  padding-bottom: 20px; border-bottom: 1px solid var(--line); margin-bottom: 18px;
}
.hero-copy { min-width: 0; }
.hero-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 6px; }
.eyebrow { font-size: 11px; text-transform: uppercase; letter-spacing: 0.09em; color: var(--muted); font-weight: 700; }
h1 { margin: 4px 0 8px; font: 700 clamp(24px, 3vw, 32px)/1.16 var(--serif); letter-spacing: -0.01em; }
.lead { max-width: 64ch; color: var(--muted); margin: 0; font-size: 15px; }

/* Hero SVG trail micro-animation */
.hero-viz {
  background: var(--panel); border: 1px solid var(--line); border-radius: 10px;
  padding: 10px 14px; width: 320px; max-width: 100%; flex-shrink: 0;
}
.hero-svg { display: block; width: 100%; height: auto; overflow: visible; }
.hero-lbl { font: 700 10px var(--sans); fill: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; }
.hero-sub { font: 11px var(--serif); fill: var(--ink); }
.hero-line-ok { stroke: var(--ok); stroke-width: 2.2; fill: none; }
.hero-line-break {
  stroke: var(--bad); stroke-width: 2.4; stroke-dasharray: 5 4; fill: none;
  animation: dashFlow 4.8s linear infinite;
}
.hero-word-chip { fill: var(--warn-bg); stroke: var(--warn); stroke-width: 1; animation: chipShift 4.8s ease-in-out infinite; }
.hero-word-old { animation: oldFade 4.8s ease-in-out infinite; fill: var(--ok); font: 700 10.5px var(--serif); }
.hero-word-new { animation: newFade 4.8s ease-in-out infinite; fill: var(--bad); font: 700 10.5px var(--serif); }
.hero-dot-pulse { animation: dotPulse 4.8s ease-in-out infinite; transform-origin: center; }
@keyframes dashFlow {
  0% { stroke-dashoffset: 0; opacity: 0.55; }
  45%, 80% { stroke-dashoffset: -27; opacity: 1; }
  100% { stroke-dashoffset: -36; opacity: 0.55; }
}
@keyframes chipShift {
  0%, 35% { fill: var(--ok-bg); stroke: var(--ok); }
  50%, 90% { fill: var(--bad-bg); stroke: var(--bad); }
  100% { fill: var(--ok-bg); stroke: var(--ok); }
}
@keyframes oldFade {
  0%, 36%, 95%, 100% { opacity: 1; }
  45%, 88% { opacity: 0; }
}
@keyframes newFade {
  0%, 38%, 95%, 100% { opacity: 0; }
  48%, 86% { opacity: 1; }
}
@keyframes dotPulse {
  0%, 100% { opacity: 0.7; }
  55% { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .hero-line-break, .hero-word-chip, .hero-word-old, .hero-word-new, .hero-dot-pulse { animation: none !important; }
  .hero-word-old { opacity: 0; }
  .hero-word-new { opacity: 1; }
}

/* Summary strip */
.summary-strip {
  display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px;
  margin-bottom: 12px;
}
.sum-card {
  display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
  padding: 10px 13px; border-radius: 8px; background: var(--panel);
  border: 1px solid var(--line); border-left: 4px solid var(--tone, var(--none));
  color: var(--ink); font: 600 12.5px var(--sans); cursor: pointer; text-align: left;
  transition: transform 0.14s ease, border-color 0.14s ease;
}
.sum-card:hover { transform: translateY(-1px); border-color: var(--tone, var(--ink)); }
.sum-card.active { background: var(--tone-bg, var(--none-bg)); border-color: var(--tone, var(--ink)); }
.sum-card .sum-n { font: 700 20px/1 var(--serif); color: var(--tone, var(--ink)); }
.sum-card .sum-lbl { color: var(--ink); font-size: 12px; }

/* Sticky filter bar */
.filter-bar {
  position: sticky; top: 0; z-index: 20;
  background: var(--bg); border-bottom: 1px solid var(--line);
  padding: 10px 0; margin-bottom: 18px;
}
.pill-btn {
  background: var(--panel); color: var(--ink); border: 1px solid var(--line);
  padding: 6px 12px; border-radius: 99px; font: 600 12px var(--sans); cursor: pointer;
}
.pill-btn:hover { border-color: var(--ink); }
.pill-btn.active { background: var(--ink); color: var(--panel); border-color: var(--ink); }
.filters { display: flex; gap: 7px; flex-wrap: wrap; align-items: center; }

/* Cards matching side panel visual language */
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr)); gap: 18px; align-items: start; }
.case {
  background: var(--panel); border: 1px solid var(--line); border-radius: 10px;
  border-top: 4px solid var(--tone, var(--none)); padding: 16px 18px; display: flex; flex-direction: column; gap: 11px;
  min-width: 0; overflow-wrap: break-word;
}
.ok { --tone: var(--ok); --tone-bg: var(--ok-bg); }
.warn { --tone: var(--warn); --tone-bg: var(--warn-bg); }
.bad { --tone: var(--bad); --tone-bg: var(--bad-bg); }
.none { --tone: var(--none); --tone-bg: var(--none-bg); }

.case-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; }
.case-head-left { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.topic { font-size: 11px; text-transform: uppercase; letter-spacing: 0.07em; color: var(--muted); font-weight: 700; }
.rec-date { font-size: 11px; color: var(--muted); border: 1px solid var(--line); padding: 1px 7px; border-radius: 99px; }
.vbadge {
  font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 800;
  padding: 2px 8px; border-radius: 4px; background: var(--tone-bg); color: var(--tone);
  border: 1.5px solid var(--tone); display: inline-block; transform: rotate(-1.2deg);
}
.headline { margin: 0; font: 700 19px/1.25 var(--serif); color: var(--ink); }
.claim {
  margin: 0; padding: 2px 0 2px 11px; border-left: 3px solid var(--ink);
  font: italic 15.5px/1.44 var(--serif); color: var(--ink);
}
.origin-note {
  font-size: 12px; color: var(--warn); background: var(--warn-bg);
  border: 1px solid var(--warn); border-radius: 6px; padding: 6px 9px; font-weight: 600;
}

.drift { padding: 9px 11px; background: var(--bg); border: 1px solid var(--line); border-radius: 7px; }
.drift-top { display: flex; justify-content: space-between; gap: 8px; font-size: 11.5px; color: var(--muted); margin-bottom: 5px; }
.drift-top strong { color: var(--tone); }
.drift-vers { display: flex; flex-wrap: wrap; gap: 4px 6px; align-items: center; margin-bottom: 6px; font-size: 11.5px; }
.dv-pill { background: var(--panel); border: 1px solid var(--line); border-radius: 4px; padding: 2px 6px; color: var(--ink); }
.dv-pill b { color: var(--muted); font-weight: 600; margin-right: 3px; }
.drift-bars { display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; }
.drift-bar { height: 5px; border-radius: 3px; background: var(--line); }
.drift-bar.on { background: var(--tone); }

.dispute { padding: 8px 10px; border-left: 3px solid var(--bad); background: var(--bad-bg); border-radius: 0 6px 6px 0; }
.dispute b { display: block; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--bad); margin-bottom: 3px; }
.dispute q { font: 13.5px/1.45 var(--serif); }
.dispute-meta { margin-top: 4px; font-size: 11px; color: var(--muted); font-weight: 600; }
.cited-unconfirmed-list { margin-top: 10px; display: flex; flex-direction: column; gap: 8px; }
.cited-unconfirmed-head { font-size: 11.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
.cited-unconfirmed-card { background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 8px 10px; font-size: 12px; }
.cited-meta { display: flex; justify-content: space-between; gap: 8px; font-size: 11.5px; font-weight: 600; margin-bottom: 4px; }
.closest-passage-box { margin-top: 6px; padding: 6px 8px; border-left: 3px solid var(--line); background: var(--panel); border-radius: 0 4px 4px 0; }
.closest-passage-label { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin-bottom: 3px; font-weight: 600; }
.closest-passage-quote { margin: 0 0 4px; font: italic 12.5px/1.45 var(--serif); color: var(--ink); }
.closest-passage-note { display: block; font-size: 11px; color: var(--muted); }

/* Animated Inspect the trail + vertical rail identical to side panel */
details.trail { border-top: 1px solid var(--line); padding-top: 9px; }
details.trail summary {
  cursor: pointer; font-weight: 600; font-size: 12.5px; color: var(--link);
  list-style: none; display: flex; align-items: center; justify-content: space-between; gap: 8px;
}
details.trail summary::-webkit-details-marker { display: none; }
details.trail summary::after { content: "▾"; font-size: 12px; transition: transform 0.2s ease; }
details.trail[open] summary::after { transform: rotate(180deg); }
.trail-body { display: grid; grid-template-rows: 0fr; transition: grid-template-rows 0.26s ease; }
details.trail[open] .trail-body { grid-template-rows: 1fr; }
.trail-inner { overflow: hidden; }
@media (prefers-reduced-motion: reduce) {
  .trail-body, details.trail summary::after { transition: none !important; }
}

.chain { list-style: none; margin: 11px 0 0; padding: 0 0 0 18px; position: relative; }
.chain::before { content: ""; position: absolute; left: 6px; top: 8px; bottom: 8px; width: 2px; background: var(--rail); }
.hop {
  position: relative; margin-bottom: 10px; padding: 9px 11px;
  border: 1px solid var(--line); border-radius: 7px; background: var(--bg);
}
.hop::before {
  content: ""; position: absolute; left: -16px; top: 13px; width: 10px; height: 10px;
  border-radius: 50%; background: var(--panel); border: 2.5px solid var(--ok);
}
.hop.broken::before { border-color: var(--bad); background: var(--bad-bg); }
.hop.broken::after {
  content: ""; position: absolute; left: -12px; top: -11px; height: 22px; width: 0;
  border-left: 2px dashed var(--bad);
}
.hop:first-child.broken::after { display: none; }
.hop-meta { display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; font-size: 11.5px; color: var(--muted); margin-bottom: 4px; }
.hop-host { color: var(--ink); font-weight: 700; }
.hop-quote { margin: 4px 0; font: 13.5px/1.48 var(--serif); }
.hop-quote mark { background: var(--mark); color: var(--ink); padding: 0 3px; border-radius: 2px; }
.hop-flags { margin: 4px 0 4px 16px; padding: 0; font-size: 12px; color: var(--bad); }
.hop-rel { font-size: 11.5px; color: var(--muted); display: flex; flex-wrap: wrap; gap: 6px; justify-content: space-between; align-items: center; }
.hop-rel a { white-space: nowrap; font-weight: 600; }

.case-foot {
  padding-top: 9px; border-top: 1px solid var(--line); font-size: 11.5px; color: var(--muted);
  display: flex; flex-direction: column; gap: 3px;
}
.case-foot-row { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 6px; }
.checked-line { color: var(--ink); font-weight: 600; }

.panels { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr)); gap: 18px; margin-top: 24px; }
.box { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 16px 18px; min-width: 0; overflow-wrap: anywhere; }
.box h3 { margin: 0 0 8px; font: 700 17px/1.3 var(--serif); }
.box pre { white-space: pre-wrap; max-width: 100%; overflow-x: auto; overflow-wrap: anywhere; margin: 8px 0 0; font: 12px/1.5 ui-monospace, Consolas, monospace; color: var(--muted); background: var(--bg); padding: 10px; border-radius: 6px; border: 1px solid var(--line); }

/* How it works 4-column footer */
footer.how-footer {
  margin-top: 26px; padding: 20px; background: var(--panel);
  border: 1px solid var(--line); border-radius: 10px;
}
.how-head { display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 10px; margin-bottom: 14px; }
.how-head h2 { margin: 0; font: 700 18px/1.25 var(--serif); }
.how-cols { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
.how-col { padding: 11px 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); }
.how-col h3 { margin: 0 0 5px; font: 700 13.5px var(--sans); color: var(--ink); text-transform: uppercase; letter-spacing: 0.05em; }
.how-col p { margin: 0; font-size: 12.5px; color: var(--muted); line-height: 1.5; }

@media (max-width: 860px) {
  header.top { grid-template-columns: 1fr; }
  .hero-viz { width: 100%; max-width: 360px; }
  .summary-strip { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .how-cols { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 540px) {
  .wrap { padding: 18px 14px 44px; }
  .summary-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .how-cols { grid-template-columns: 1fr; }
}
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <div class="hero-copy">
      <div class="hero-bar">
        <div class="eyebrow">TinyFish Source Hunter</div>
        <button id="themeToggle" class="pill-btn" type="button" aria-pressed="false">Dark theme</button>
      </div>
      <h1>Every Claim Leaves a Trail — Or Shows Where None Exists</h1>
      <p class="lead">${cases.length} recorded traces: matches, drift, disputed myths, and honest gaps.</p>
    </div>
    <figure class="hero-viz" aria-label="Animated diagram showing a claim drifting along three citation hops from Primary study to Viral post">
      <svg class="hero-svg" viewBox="0 0 300 92" role="img" aria-hidden="true">
        <text x="10" y="14" class="hero-lbl">Primary</text>
        <text x="122" y="14" class="hero-lbl">News</text>
        <text x="234" y="14" class="hero-lbl">Shared</text>
        <line x1="28" y1="36" x2="132" y2="36" class="hero-line-ok"/>
        <line x1="142" y1="36" x2="250" y2="36" class="hero-line-break"/>
        <circle cx="24" cy="36" r="7" fill="var(--ok-bg)" stroke="var(--ok)" stroke-width="2.5"/>
        <circle cx="136" cy="36" r="7" fill="var(--ok-bg)" stroke="var(--ok)" stroke-width="2.5"/>
        <circle cx="256" cy="36" r="7" class="hero-dot-pulse" fill="var(--bad-bg)" stroke="var(--bad)" stroke-width="2.5"/>
        <rect x="6" y="54" width="84" height="22" rx="4" fill="var(--ok-bg)" stroke="var(--ok)" stroke-width="1"/>
        <text x="14" y="69" class="hero-sub">may double</text>
        <rect x="104" y="54" width="82" height="22" rx="4" fill="var(--bg)" stroke="var(--line)" stroke-width="1"/>
        <text x="112" y="69" class="hero-sub">likely doubles</text>
        <rect x="200" y="54" width="92" height="22" rx="4" class="hero-word-chip"/>
        <text x="210" y="69" class="hero-word-old">may double</text>
        <text x="210" y="69" class="hero-word-new">will triple</text>
      </svg>
    </figure>
  </header>

  <section id="summaryStrip" class="summary-strip" aria-label="Trace verdict counts"></section>
  <div class="filter-bar">
    <div id="filters" class="filters" role="group" aria-label="Filter claims by verdict"></div>
  </div>
  <div id="grid" class="grid"></div>

  <div class="panels">
    <section id="researchBox" class="box"></section>
    <section id="spendBox" class="box"></section>
  </div>

  <footer class="how-footer">
    <div class="how-head">
      <h2>How it works</h2>
      <a href="../README.md">Setup &amp; extension instructions (README.md)</a>
    </div>
    <div class="how-cols">
      <div class="how-col">
        <h3>Fetch</h3>
        <p>Reads the starting page and follows inline links verbatim; cannot execute blocked logins or dynamic firewalls.</p>
      </div>
      <div class="how-col">
        <h3>Search</h3>
        <p>Queries earlier primary studies and filings before the article date; search hits stay unverified until Fetch checks the quote.</p>
      </div>
      <div class="how-col">
        <h3>Agent</h3>
        <p>Browser fallback when opt-in; structured example.com test passed, while our one real blocked-page attempt timed out ($0.16).</p>
      </div>
      <div class="how-col">
        <h3>Research</h3>
        <p>Deep traces take minutes for complex citations, and every proposed URL is re-checked verbatim by Fetch before display.</p>
      </div>
    </div>
  </footer>
</div>

<script id="demo-data" type="application/json">${safeJson}</script>
<script>
const DATA = JSON.parse(document.getElementById('demo-data').textContent);
const LEVEL = { MATCH: 0, PRIMARY_PUBLISHER: 0, UNCITED: 1, CITED_UNCONFIRMED: 2, ROUNDED: 1, YEAR: 1, HEDGE_DROPPED: 2, DIFFERENT_CONTEXT: 2, SCOPE: 3, CAUSATION: 3, MISQUOTED: 3, CHANGED: 4, CONTRADICTED: 4, DISPUTED: 4 };
const STEPS = ['Match', 'Rounded / Date', 'Hedge / Context', 'Scope / Misquoted', 'Changed / Disputed'];

let activeFilter = 'ALL';
const $ = (s) => document.querySelector(s);

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'href') { n.href = v; n.target = '_blank'; n.rel = 'noopener noreferrer'; }
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null) n.append(k.nodeType ? k : document.createTextNode(String(k)));
  return n;
}

let currentTheme = new URLSearchParams(location.search).get('theme') === 'dark' ? 'dark' : 'light';
function applyTheme(next) {
  currentTheme = next === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', currentTheme);
  $('#themeToggle').textContent = currentTheme === 'dark' ? 'Light theme' : 'Dark theme';
  $('#themeToggle').setAttribute('aria-pressed', currentTheme === 'dark' ? 'true' : 'false');
}
applyTheme(currentTheme);
$('#themeToggle').onclick = () => applyTheme(currentTheme === 'dark' ? 'light' : 'dark');

const fmtDate = (h) => (h?.dateUncertain ? 'date uncertain' : (h?.date || 'date unknown'));
function verSnippet(h, kind) {
  const txt = String(h?.quote || '');
  if (kind !== 'quote') {
    const u = txt.match(/(?:about|around|roughly|nearly|almost|over|under|up to|at least|more than|less than|approximately)?\\s*(?:[$£€]\\s*\\d[\\d.,]*(?:\\s*(?:billion|million|thousand|trillion))?|\\d[\\d.,]*\\s*(?:%|percent|billion|million|thousand|trillion|metric\\s+tons?))/i);
    if (u) return u[0].trim();
    const m = txt.match(/(?:about|around|roughly|nearly|almost|over|under|up to|at least|more than|less than|approximately)?\\s*[$£€]?\\d[\\d.,]*(?:\\s*(?:%|percent|billion|million|thousand|trillion|metric\\s+tons?|times|years?))?/i);
    if (m) return m[0].trim();
  }
  return txt.length > 30 ? txt.slice(0, 28) + '\\u2026' : txt;
}

const SUMMARY_GROUPS = [
  { id: 'GROUP_MATCH', label: 'Match / Primary', tone: 'ok', match: (f) => f.code === 'MATCH' || f.code === 'PRIMARY_PUBLISHER' },
  { id: 'GROUP_DRIFTED', label: 'Drifted', tone: 'warn', match: (f) => ['ROUNDED', 'HEDGE_DROPPED', 'YEAR', 'SCOPE', 'CAUSATION', 'DIFFERENT_CONTEXT', 'MISQUOTED', 'CHANGED'].includes(f.code) },
  { id: 'GROUP_DISPUTED', label: 'Disputed', tone: 'bad', match: (f) => f.code === 'DISPUTED' || f.code === 'CONTRADICTED' },
  { id: 'GROUP_CITED', label: 'Cited unconfirmed', tone: 'warn', match: (f) => f.code === 'CITED_UNCONFIRMED' },
  { id: 'GROUP_UNCITED', label: 'Uncited', tone: 'warn', match: (f) => f.code === 'UNCITED' },
  { id: 'GROUP_NOSOURCE', label: 'No source', tone: 'none', match: (f) => f.code === 'NO_SOURCE' },
];

function renderSummaryStrip() {
  $('#summaryStrip').replaceChildren(...SUMMARY_GROUPS.map((g) => {
    const count = DATA.cases.filter((c) => g.match(c.final)).length;
    const isActive = activeFilter === g.id;
    return el('button', {
      type: 'button',
      class: 'sum-card ' + g.tone + (isActive ? ' active' : ''),
      'aria-pressed': isActive ? 'true' : 'false',
      onclick: () => {
        activeFilter = isActive ? 'ALL' : g.id;
        renderSummaryStrip(); renderFilters(); renderGrid();
      },
    }, el('span', { class: 'sum-lbl' }, g.label), el('span', { class: 'sum-n' }, String(count)));
  }));
}

function renderFilters() {
  const counts = { ALL: DATA.cases.length };
  const order = ['ALL', 'MATCH', 'PRIMARY_PUBLISHER', 'ROUNDED', 'HEDGE_DROPPED', 'YEAR', 'SCOPE', 'CAUSATION', 'DIFFERENT_CONTEXT', 'MISQUOTED', 'CHANGED', 'CITED_UNCONFIRMED', 'UNCITED', 'DISPUTED', 'CONTRADICTED', 'NO_SOURCE'];
  DATA.cases.forEach((c) => { const k = c.final.code; counts[k] = (counts[k] || 0) + 1; });
  const keys = Object.keys(counts).sort((a, b) => (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 99 : order.indexOf(b)));
  $('#filters').replaceChildren(...keys.map((code) =>
    el('button', {
      type: 'button',
      class: 'pill-btn ' + (activeFilter === code ? 'active' : ''),
      onclick: () => { activeFilter = code; renderSummaryStrip(); renderFilters(); renderGrid(); },
    }, code + ' (' + counts[code] + ')')
  ));
}

function renderQuote(h) {
  const p = el('p', { class: 'hop-quote' });
  if (h.quoteDiff && h.vsOrigin?.code && h.vsOrigin.code !== 'MATCH' && h.vsOrigin.code !== 'CONTRADICTED') {
    h.quoteDiff.forEach((w, i) => p.append(w.changed ? el('mark', {}, w.w) : w.w, i < h.quoteDiff.length - 1 ? ' ' : ''));
  } else p.append('\u201C' + h.quote + '\u201D');
  return p;
}

function renderGrid() {
  const grp = SUMMARY_GROUPS.find((g) => g.id === activeFilter);
  const list = grp
    ? DATA.cases.filter((c) => grp.match(c.final))
    : activeFilter === 'ALL' ? DATA.cases : DATA.cases.filter((c) => c.final.code === activeFilter);
  $('#grid').replaceChildren(...list.map((c, idx) => {
    const f = c.final;
    const isNone = f.code === 'NO_SOURCE';
    const isPrimaryPub = f.code === 'PRIMARY_PUBLISHER';
    const isCitedUnconfirmed = f.code === 'CITED_UNCONFIRMED';
    const isDisputed = f.code === 'DISPUTED' || f.code === 'CONTRADICTED';
    const isUncited = f.code === 'UNCITED' || (f.status === 'earliest_uncited' && !isDisputed);
    const lvl = isNone ? -1 : isPrimaryPub ? 0 : isCitedUnconfirmed ? 2 : isUncited ? 1 : (LEVEL[f.code] ?? 2);
    const rev = [...(f.chain || [])].reverse();
    const vers = rev.length >= 2 ? el('div', { class: 'drift-vers' }, rev.flatMap((h, i) => [
      i > 0 ? el('span', {}, '\\u2192') : null,
      el('span', { class: 'dv-pill' }, el('b', {}, h.role === 'origin' ? (h.sourceKind === 'primary-likely' ? 'Primary:' : 'Earliest:') : 'Claim:'), verSnippet(h, f.claim?.kind))
    ])) : null;
    let driftTitle = STEPS[lvl] + ' (' + (lvl + 1) + '/5)';
    if (isNone) driftTitle = 'No original source';
    else if (isPrimaryPub) driftTitle = 'Likely primary publisher';
    else if (isCitedUnconfirmed) driftTitle = 'Cited, but not confirmed';
    else if (isDisputed) driftTitle = 'Disputed by source';
    else if (isUncited) driftTitle = 'Uncited secondary (2/5)';

    const drift = el('div', { class: 'drift' },
      el('div', { class: 'drift-top' }, el('span', {}, 'Drift meter'), el('strong', {}, driftTitle)),
      vers,
      el('div', { class: 'drift-bars' }, STEPS.map((_, i) => el('span', { class: 'drift-bar ' + (!isNone && i <= lvl ? 'on' : '') })))
    );
    const dispHop = (f.chain || []).find((h) => h.dispute);
    const disputeHost = f.disputeHost || dispHop?.host || '';
    const disputeDate = f.disputeDateUncertain || dispHop?.dateUncertain ? 'date uncertain' : (f.disputeDate || dispHop?.date || 'date unknown');
    const disputeMeta = disputeHost ? el('div', { class: 'dispute-meta' }, disputeHost + ', ' + disputeDate) : null;
    const dispute = f.disputeQuote
      ? el('div', { class: 'dispute' }, el('b', {}, 'Disputing sentence from source'), el('q', {}, f.disputeQuote), disputeMeta)
      : null;
    const relNote = f.origin?.earlierOfficialRelease
      ? el('div', { class: 'origin-note' }, 'Origin (' + f.origin.host + ', ' + f.origin.date + '): an earlier official release is listed below (' + f.origin.earlierOfficialRelease.host + ', ' + f.origin.earlierOfficialRelease.date + ').')
      : null;
    const refLinksNote = f.hasReferenceLinks
      ? el('div', { class: 'origin-note', style: 'background:var(--ok-bg);color:var(--ok);border-color:var(--ok);' }, 'This page has a References/Sources section.')
      : null;
    const citedSection = f.citedPages && f.citedPages.length ? el('div', { class: 'cited-unconfirmed-list' },
      el('div', { class: 'cited-unconfirmed-head' }, 'Cited pages opened:'),
      ...f.citedPages.map((cp) => el('div', { class: 'cited-unconfirmed-card' },
        el('div', { class: 'cited-meta' },
          el('a', { href: cp.url }, cp.host),
          el('span', {}, cp.date || 'date unknown')
        ),
        cp.closestPassage ? el('div', { class: 'closest-passage-box' },
          el('span', { class: 'closest-passage-label' }, cp.note || 'closest passage, not verified as the same claim'),
          el('blockquote', { class: 'closest-passage-quote' }, '\\u201C' + cp.closestPassage + '\\u201D'),
          el('span', { class: 'closest-passage-note' }, f.paraphraseNote || 'This can happen when the writer paraphrased the study.')
        ) : el('div', { class: 'closest-passage-box' },
          el('span', { class: 'closest-passage-label', style: 'color:var(--warn);' }, cp.reason || 'blocked by a bot check'),
          el('span', { class: 'closest-passage-note' }, f.paraphraseNote || 'Open them to check the wording yourself.')
        )
      ))
    ) : null;

    const hopNodes = (f.chain || []).map((h, i) => {
      const roleTitle = h.role === 'start' ? 'Start' : h.role === 'origin' ? (h.sourceKind === 'primary-likely' ? 'Likely primary' : 'Earliest page') : ('Hop ' + i);
      const flags = [...(h.changedHere && h.vsCited ? h.vsCited.flags : h.vsOrigin?.flags || []), ...(h.flags || [])];
      const isDispHop = h.dispute || isDisputed;
      const chgBadge = h.changedHere ? el('span', { class: 'vbadge ' + (isDispHop ? 'bad' : 'warn'), style: 'font-size:9.5px;padding:1px 5px;margin-left:6px;' }, isDispHop ? 'DISPUTED HERE' : 'CHANGED HERE') : null;
      return el('li', { class: 'hop ' + (h.changedHere ? 'broken' : '') },
        el('div', { class: 'hop-meta' },
          el('span', { class: 'hop-host' }, roleTitle + ' · ' + h.host),
          el('span', {}, fmtDate(h) + ' · ' + (h.sourceKindLabel || h.verifiedBy || ''), chgBadge)
        ),
        renderQuote(h),
        flags.length ? el('ul', { class: 'hop-flags' }, flags.map((fl) => el('li', {}, fl.text))) : null,
        el('div', { class: 'hop-rel' }, el('span', {}, h.relation), el('a', { href: h.url }, 'open source'))
      );
    });

    const alsoNodes = (f.alsoFound || []).map((a) =>
      el('li', { class: 'hop' + ((a.vsClaim?.flags || []).some((fl) => fl.code === 'SCOPE') ? ' broken' : '') },
        el('div', { class: 'hop-meta' },
          el('span', { class: 'hop-host' }, a.host + ' · via ' + (a.via || 'search')),
          el('span', {}, fmtDate(a) + (a.sourceKindLabel ? ' · ' + a.sourceKindLabel : ''))
        ),
        el('p', { class: 'hop-quote' }, '\u201C' + a.quote + '\u201D'),
        (a.vsClaim?.flags || []).length ? el('ul', { class: 'hop-flags' }, a.vsClaim.flags.map((fl) => el('li', {}, fl.text))) : null,
        el('div', { class: 'hop-rel' }, el('span', {}, a.via === 'search' ? 'Verified by Fetch from search' : 'Related source'), el('a', { href: a.url }, 'open source'))
      )
    );
    const scopeNotes = (f.reasons || []).filter((r) => /Also-found source|Scope narrower than claimed/i.test(r));
    const scopeNoteEl = scopeNotes.length
      ? el('ul', { class: 'hop-flags', style: 'margin:0 0 0 16px;' }, scopeNotes.map((r) => el('li', {}, r)))
      : null;
    const details = el('details', { class: 'trail', ...(idx < 2 ? { open: '' } : {}) },
      el('summary', {}, 'Inspect the trail · ' + (f.chain?.length || 0) + ' hops' + (alsoNodes.length ? ' (+' + alsoNodes.length + ' related)' : '')),
      el('div', { class: 'trail-body' },
        el('div', { class: 'trail-inner' },
          el('ol', { class: 'chain' }, hopNodes),
          alsoNodes.length ? el('div', { class: 'hop-rel', style: 'margin-top:10px;font-weight:700;' }, 'Other verified pages stating related claims:') : null,
          alsoNodes.length ? el('ol', { class: 'chain', style: 'margin-top:6px;' }, alsoNodes) : null
        )
      )
    );

    const originText = f.origin
      ? (f.origin.sourceKind === 'primary-likely' ? 'Likely primary: ' : 'Earliest page: ') + f.origin.host + ' (' + fmtDate(f.origin) + ') · ' + (f.origin.sourceKindLabel || '')
      : 'Origin: none found';
    const checkedText = 'What was checked: ' + (f.stats?.fetches || 0) + ' pages opened, ' + (f.stats?.searches || 0) + ' search' + ((f.stats?.searches || 0) === 1 ? '' : 'es') + ', ' + (f.rejectedCount || 0) + ' rejected';

    return el('article', { class: 'case ' + (f.tone || 'none') },
      el('div', { class: 'case-head' },
        el('div', { class: 'case-head-left' },
          el('span', { class: 'topic' }, c.topic),
          el('span', { class: 'rec-date' }, 'Recorded ' + c.recordedAt)
        ),
        el('span', { class: 'vbadge' }, f.code)
      ),
      el('h2', { class: 'headline' }, f.headline),
      el('blockquote', { class: 'claim' }, f.claim.raw),
      relNote,
      refLinksNote,
      drift,
      scopeNoteEl,
      dispute,
      citedSection,
      details,
      el('div', { class: 'case-foot' },
        el('div', { class: 'case-foot-row' }, el('span', {}, originText)),
        el('div', { class: 'case-foot-row checked-line' }, el('span', {}, checkedText))
      )
    );
  }));
}

function renderBottom() {
  const r = DATA.researchPreview;
  if (r.mode === 'verified') {
    const conf = (r.research?.confirmedUrls || []).map((u) => el('li', {}, el('a', { href: u }, u)));
    const disc = (r.research?.discardedUrls || []).map((d) => el('li', {}, d.url + ' — ' + d.reason));
    $('#researchBox').replaceChildren(...[
      el('h3', {}, 'TinyResearch Deep Trace (Fetch-Verified' + (r.recordedAt ? ' · Recorded ' + r.recordedAt : '') + ')'),
      el('p', {}, 'Claim: "' + r.claim + '" — Proposed ' + (r.research?.citationsProposed || 0) + ' URLs checked via Fetch; ' + (r.research?.confirmed || 0) + ' confirmed verbatim, ' + disc.length + ' discarded.'),
      conf.length ? el('details', {}, el('summary', {}, 'Confirmed by Fetch (' + conf.length + ')'), el('ul', {}, conf)) : null,
      disc.length ? el('details', {}, el('summary', {}, 'Discarded by Fetch (' + disc.length + ')'), el('ul', {}, disc)) : null,
      el('pre', {}, r.report || ''),
    ].filter(Boolean));
  } else {
    $('#researchBox').replaceChildren(
      el('h3', {}, 'TinyResearch Schema Probe (Pre-G2 Deep Run)'),
      el('p', {}, 'Verified COMPLETED shape on run ' + r.runId + ' ("' + r.query + '"). Live claim Deep Trace updates here after Gate YES.'),
      el('pre', {}, r.answerPreview || '')
    );
  }
  $('#spendBox').replaceChildren(
    el('h3', {}, 'Credit Safety & Wallet Transparency'),
    el('p', {}, 'Server runs offline in TF_MODE=replay by default. Every recorded session logs exact TinyFish usage deltas.'),
    el('pre', {}, (DATA.walletNote || []).join('\\n'))
  );
}

renderSummaryStrip();
renderFilters();
renderGrid();
renderBottom();
</script>
</body>
</html>
`;

fs.writeFileSync(outHtml, html);
console.log(`Built demo/index.html with ${cases.length} traces.`);
