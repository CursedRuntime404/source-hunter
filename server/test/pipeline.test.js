// These tests use a FAKE TinyFish client with invented pages to test the logic only.
// Fake data is never used by the running server or in the demo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseClaim, findPassage, findClosestPassage, isBotInterstitial, extractNumbers, normalize, cleanClaimText, normalizeClaimText, findDateInText, findDateInfo } from '../src/text.js';
import { compare } from '../src/compare.js';
import { runTrace, assemble, isLikelyPrimaryPublisher } from '../src/trace.js';

const PAGES = {
  'https://blog.example/post': {
    title: 'Blog', published_date: '2021-03-10',
    text: 'Intro paragraph about sleep and health in general terms here.\n\nA new analysis found that nearly 40% of adults sleep poorly, according to [the Sleep Institute report](https://sleep.example/report.pdf).',
  },
  'https://sleep.example/report.pdf': {
    title: 'Sleep Institute Report 2019', published_date: '2019-05-02',
    text: 'Abstract. We surveyed 2,400 respondents. We found that 37.6% of adults sleep poorly, with a sample size of 2,400 participants.\n\nMethodology follows.',
  },
};
const fake = (pages) => ({
  async fetch({ urls }) {
    const results = [];
    const errors = [];
    for (const u of urls) pages[u] ? results.push({ url: u, final_url: u, ...pages[u] }) : errors.push({ url: u, error: 'page_not_found', status: 404 });
    return { results, errors };
  },
  async search() { return { results: [] }; },
  async agent() { return { result: { found: false } }; },
});

async function run(input, tf) {
  let final;
  for await (const ev of runTrace(input, tf)) if (ev.type === 'result') final = ev.final;
  return final;
}

test('normalize handles quotes, commas and percent spacing', () => {
  assert.equal(normalize('It\u2019s 1,200 \u201Cpeople\u201D at 38 %'), 'it\'s 1200 "people" at 38%');
});

test('number extraction: units, qualifiers, years, fractions', () => {
  const n = extractNumbers('Nearly 40% of 2.5 million people in 2019, or one in three.');
  assert.equal(n.find((x) => x.unit === '%' && !x.derived).qualifier, 'nearly');
  assert.equal(n.find((x) => x.shown === 2.5).value, 2.5e6);
  assert.equal(n.find((x) => x.shown === 2019).year, true);
  assert.ok(Math.abs(n.find((x) => x.derived).value - 33.33) < 0.1);
});

test('passage finder returns a verbatim sentence from the page', () => {
  const claim = parseClaim('37.6% of adults sleep poorly');
  const p = findPassage(PAGES['https://sleep.example/report.pdf'].text, claim);
  assert.ok(p);
  assert.match(p.quote, /37\.6% of adults sleep poorly/);
  assert.ok(normalize(PAGES['https://sleep.example/report.pdf'].text).includes(normalize(p.quote)));
});

test('rounded: 40% vs 37.6% with "nearly"', () => {
  assert.equal(compare('Nearly 40% of adults sleep poorly.', 'We found that 37.6% of adults sleep poorly.').code, 'ROUNDED');
});
test('changed: 60% vs 37.6%', () => {
  const r = compare('About 60% of adults sleep poorly.', 'We found that 37.6% of adults sleep poorly.');
  assert.equal(r.code, 'CHANGED');
});
test('correct rounding 38 vs 37.6', () => {
  assert.equal(compare('38% of adults sleep poorly.', '37.6% of adults sleep poorly.').code, 'ROUNDED');
});
test('scope widened and hedge dropped', () => {
  assert.equal(compare('All adults sleep poorly.', 'Some adults may sleep poorly.').code, 'SCOPE');
  assert.equal(compare('Adults sleep poorly.', 'Adults may sleep poorly, the study suggests.').code, 'HEDGE_DROPPED');
});
test('causation: association turned into cause', () => {
  assert.equal(compare('Coffee causes anxiety.', 'Coffee intake was associated with anxiety.').code, 'CAUSATION');
});
test('quote: minor edit is MISQUOTED, identical is MATCH', () => {
  const o = 'We shall never surrender to the enemy.';
  assert.equal(compare('We shall never surrender to the enemy.', o, { kind: 'quote' }).code, 'MATCH');
  assert.equal(compare('We will never surrender to them.', o, { kind: 'quote' }).code, 'MISQUOTED');
});

test('full trace: blog -> PDF, rounded, primary found', async () => {
  const f = await run(
    {
      claim: 'nearly 40% of adults sleep poorly', url: 'https://news.example/a', title: 'News', date: '2022-01-05',
      paragraph: 'Experts say nearly 40% of adults sleep poorly.',
      links: [{ href: 'https://blog.example/post', text: 'a blog post', inSelection: true }],
    },
    fake(PAGES)
  );
  assert.equal(f.status, 'traced_primary');
  assert.equal(f.chain.length, 3);
  assert.equal(f.chain[2].role, 'origin');
  assert.equal(f.chain[2].date, '2019-05-02');
  assert.equal(f.code, 'ROUNDED');
  assert.ok(f.chain.every((h) => h.verifiedBy));
});

test('honest: no source when no citations near claim and search is empty', async () => {
  const f = await run(
    { claim: '73% of statistics are made up', url: 'https://news.example/b', links: [] },
    fake({})
  );
  assert.equal(f.status, 'no_source');
  assert.equal(f.headline, 'No original source found');
});

test('cited page that does not state the claim gives cited_not_confirmed with closest passage', async () => {
  const f = await run(
    { claim: '38% of adults sleep poorly', url: 'https://news.example/c', links: [{ href: 'https://other.example/p', text: 'report', inSelection: true }] },
    fake({ 'https://other.example/p': { text: 'This page is about gardening and tomatoes. '.repeat(8) } })
  );
  assert.equal(f.status, 'cited_not_confirmed');
  assert.equal(f.headline, 'Cited, but none of the cited pages confirm this wording');
  assert.ok(f.citedPages && f.citedPages.length > 0);
  assert.ok(f.citedPages[0].closestPassage);
  assert.equal(f.rejected[0].reason, 'page does not state this claim');
});

test('cleanClaimText strips citation markers from Wikipedia sleep sentence and footnotes', () => {
  const rawSleep = 'Researchers have found that sleeping 6–7 hours each night correlates with longevity and cardiac health in humans, though many underlying factors may be involved in the causality behind this relationship.[76][77][78][79][51][80][81]';
  const cleaned = cleanClaimText(rawSleep);
  assert.equal(
    cleaned,
    'Researchers have found that sleeping 6–7 hours each night correlates with longevity and cardiac health in humans, though many underlying factors may be involved in the causality behind this relationship.'
  );

  const parsed = parseClaim(rawSleep);
  assert.equal(parsed.raw, normalizeClaimText(rawSleep));
  assert.ok(!parsed.raw.includes('[76]'));

  // Also verify [citation needed], [a], and word-end footnote digits
  assert.equal(cleanClaimText('Some statistic[citation needed] shows growth[a] in sectors12.'), 'Some statistic shows growth in sectors.');
});

test('multi-sentence highlights: trace first sentence with numbers and show tip', () => {
  const multi = 'Cardiovascular diseases (CVDs) are the leading cause of death globally. An estimated 19.8 million people died from CVDs in 2022, representing approximately 32% of all global deaths. Of these deaths, 85% were due to heart attack and stroke.';
  const parsed = parseClaim(multi);
  assert.equal(parsed.raw, 'An estimated 19.8 million people died from CVDs in 2022, representing approximately 32% of all global deaths.');
  assert.equal(parsed.multiSentence, true);
  assert.equal(parsed.multiSentenceTip, 'Tip: For best results, highlight one claim at a time.');
});

test('visible date extraction: extracts date from WHO page header fixture', () => {
  const headerFixture = 'Cardiovascular diseases (CVDs)\n31 July 2025 | Reading time: 6 min (1506 words)\nKey facts';
  const d = findDateInText(headerFixture);
  assert.equal(d, '2025-07-31');
});

test('primary publisher is the source: who.int without citations produces PRIMARY_PUBLISHER status', async () => {
  const state = {
    input: { claim: 'An estimated 19.8 million people died from CVDs in 2022', hasReferenceLinks: true },
    chain: [{
      id: 'h0', role: 'start', host: 'who.int', url: 'https://who.int/news-room/fact-sheets/detail/cardiovascular-diseases-(cvds)',
      date: '2025-07-31', quote: 'An estimated 19.8 million people died from CVDs in 2022, representing approximately 32% of all global deaths.',
      sourceKind: 'primary-likely', hasPassageCitations: false, hasReferenceLinks: true
    }],
    stats: { fetches: 1, searches: 0 },
    timings: { totalMs: 50, stages: [] },
    rejected: []
  };
  const f = assemble(state);
  assert.equal(f.status, 'publisher_is_source');
  assert.equal(f.code, 'PRIMARY_PUBLISHER');
  assert.equal(f.tone, 'ok');
  assert.equal(f.headline, 'Publisher is the source: who.int cites no earlier source for this passage');
  assert.equal(f.hasReferenceLinks, true);
  assert.ok(isLikelyPrimaryPublisher('who.int'));
  assert.ok(isLikelyPrimaryPublisher('cdc.gov'));
  assert.ok(!isLikelyPrimaryPublisher('wikipedia.org'));
});

test('same organisation regional copy (afro.who.int) does not become origin hop, goes to alsoFound', async () => {
  const quote = 'An estimated 19.8 million people died from CVDs in 2022, representing approximately 32% of all global deaths.';
  const state = {
    input: { claim: quote, url: 'https://www.who.int/news-room/fact-sheets/detail/cardiovascular-diseases-(cvds)' },
    chain: [{
      id: 'h0', role: 'start', host: 'who.int', url: 'https://www.who.int/news-room/fact-sheets/detail/cardiovascular-diseases-(cvds)',
      date: '2025-07-31', quote, sourceKind: 'primary-likely', hasPassageCitations: false,
    }],
    extras: [{
      id: 'x0', role: 'source', via: 'search', host: 'afro.who.int', url: 'https://afro.who.int/health-topics/cardiovascular-diseases',
      date: null, quote, sourceKind: 'primary-likely', relation: 'Found by search; not cited by the pages above'
    }],
    stats: { fetches: 7, searches: 1 },
    timings: { totalMs: 1200, stages: [{ stage: 'search', ms: 400, hits: 1 }] },
    rejected: []
  };
  const f = assemble(state);
  assert.equal(f.status, 'publisher_is_source');
  assert.equal(f.code, 'PRIMARY_PUBLISHER');
  assert.equal(f.headline, 'Publisher is the source: who.int cites no earlier source for this passage');
  assert.equal(f.chain.length, 1);
  assert.equal(f.chain[0].host, 'who.int');
  assert.equal(f.alsoFound.length, 1);
  assert.equal(f.alsoFound[0].host, 'afro.who.int');
  assert.equal(f.alsoFound[0].relation, 'same publisher, regional copy');
  assert.equal(f.alsoFound[0].vsClaim.code, 'MATCH');
});

test('WHO search trigger: runs search when start page has no passage citations', async () => {
  let searchRan = false;
  const mockTf = {
    async fetch({ urls }) {
      return { results: urls.map((u) => ({ url: u, final_url: u, title: 'WHO CVD', text: 'Key facts. An estimated 19.8 million people died from CVDs in 2022.' })), errors: [] };
    },
    async search() {
      searchRan = true;
      return { results: [] };
    },
    async agent() { return { result: { found: false } }; }
  };
  const f = await run(
    {
      claim: 'An estimated 19.8 million people died from CVDs in 2022',
      url: 'https://www.who.int/news-room/fact-sheets/detail/cardiovascular-diseases-(cvds)',
      title: 'CVDs',
      date: '2025-07-31',
      links: []
    },
    mockTf
  );
  assert.equal(searchRan, true);
  assert.equal(f.code, 'PRIMARY_PUBLISHER');
  assert.ok(f.timings.stages.some((s) => s.stage === 'search'));
});

test('bot-check detection: identifies interstitials and never returns them as closest passage', () => {
  const pubmedChallenge = 'Checking your browser before accessing pubmed.ncbi.nlm.nih.gov ...\n\nClick here if you are not automatically redirected after 5 seconds.';
  assert.equal(isBotInterstitial(pubmedChallenge), true);
  assert.equal(isBotInterstitial('Just a moment... Enable JavaScript and cookies to continue'), true);
  assert.equal(isBotInterstitial('Access denied | Error 1020 Ray ID: 123456789 Cloudflare'), true);
  assert.equal(isBotInterstitial('Please verify you are human to access the page.'), true);

  // Normal content is not an interstitial
  assert.equal(isBotInterstitial('This is a peer-reviewed research paper about sleep habits and cardiovascular health.'), false);

  // findClosestPassage must return null on bot challenges
  assert.equal(findClosestPassage(pubmedChallenge, 'sleeping 6-7 hours correlates with longevity'), null);
});

test('Wikipedia & living pages: dates are flagged dateUncertain and not displayed as publication date', () => {
  const dInfo = findDateInfo('Some article text', '2001-08-10', 'https://en.wikipedia.org/wiki/Sleep');
  assert.equal(dInfo.dateUncertain, true);
  assert.equal(dInfo.dateReason, 'wiki page continuously edited (living page)');
});

test('Wikipedia sleep case with recorded PubMed text gives "Cited, but the cited pages could not be read"', async () => {
  const recordedPubMedText = 'Checking your browser before accessing pubmed.ncbi.nlm.nih.gov ...\n\nClick here if you are not automatically redirected after 5 seconds.';
  const f = await run(
    {
      claim: 'Researchers have found that sleeping 6–7 hours each night correlates with longevity and cardiac health in humans',
      url: 'https://en.wikipedia.org/wiki/Sleep',
      links: [
        { href: 'https://pubmed.ncbi.nlm.nih.gov/16895254', text: '[76]', inSelection: true },
        { href: 'https://pubmed.ncbi.nlm.nih.gov/15642774', text: '[77]', inSelection: true },
      ]
    },
    fake({
      'https://pubmed.ncbi.nlm.nih.gov/16895254': { text: recordedPubMedText },
      'https://pubmed.ncbi.nlm.nih.gov/15642774': { text: recordedPubMedText },
    })
  );

  assert.equal(f.status, 'cited_not_confirmed');
  assert.equal(f.code, 'CITED_UNCONFIRMED');
  assert.equal(f.headline, 'Cited, but the cited pages could not be read');
  assert.equal(f.allUnreadable, true);
  assert.equal(f.paraphraseNote, 'Open them to check the wording yourself.');
  assert.equal(f.citedPages.length, 2);
  assert.equal(f.citedPages[0].reason, 'blocked by a bot check');
  assert.equal(f.citedPages[0].closestPassage, null);
  assert.equal(f.rejected[0].reason, 'blocked by bot check');
  assert.equal(f.chain[0].dateUncertain, true);
});
