// Offline regression tests for false matches (STEP 1) and deep citation tracing (STEP 2).
import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseClaim, findPassage, sourceKind, isTertiary,
  resolvePassageCitations, rankLinks, findDateInText, findDateInfo,
} from '../src/text.js';
import { compare } from '../src/compare.js';
import { runTrace, buildQueries } from '../src/trace.js';

const REAL_PAGES = JSON.parse(fs.readFileSync(new URL('./fixtures-real.json', import.meta.url), 'utf8'));

function fake(pages, searchMap = {}) {
  return {
    mode: 'replay',
    async fetch({ urls }) {
      const results = [];
      const errors = [];
      for (const u of urls) {
        if (pages[u]) results.push({ url: u, final_url: u, ...pages[u] });
        else errors.push({ url: u, error: 'page_not_found', status: 404 });
      }
      return { results, errors };
    },
    async search({ query }) {
      return { results: searchMap[query] || Object.values(searchMap).flat() };
    },
    async agent() { return { result: { found: false } }; },
  };
}

async function runEvents(input, tf, opts = {}) {
  const events = [];
  let final;
  for await (const ev of runTrace(input, tf, opts)) {
    events.push(ev);
    if (ev.type === 'result') final = ev.final;
  }
  return { events, final };
}

test('STEP 1b: compare() flags CONTRADICTED when polarity differs even on substring matches', () => {
  const claim = "Marie Antoinette said 'Let them eat cake' when told the peasants had no bread";
  const disputing = "Marie Antoinette never said 'Let them eat cake' when told the peasants had no bread.";
  const r = compare(claim, disputing);
  assert.equal(r.code, 'CONTRADICTED');

  const neg = compare('Humans only use 10% of their brains.', 'Humans do not use only 10% of their brains.');
  assert.equal(neg.code, 'CONTRADICTED');

  // Shared "no bread" does not invert identical positive statements
  const same = compare(claim, "In popular tradition, Marie Antoinette said 'Let them eat cake' when told the peasants had no bread.");
  assert.equal(same.code, 'MATCH');
});

test('STEP 1c & 1d: tertiary domains can never be primary; text cues require 2+ distinct cues on non-tertiary', () => {
  for (const u of [
    'https://en.wikipedia.org/wiki/Let_them_eat_cake',
    'https://www.linkedin.com/pulse/some-post',
    'https://medium.com/@author/essay',
    'https://writer.substack.com/p/claim',
    'https://www.reddit.com/r/science/comments/123',
    'https://www.quora.com/Did-Watson-say',
    'https://example.blogspot.com/2020/01/post.html',
    'https://site.wordpress.com/article',
    'https://www.facebook.com/page/posts/1',
  ]) {
    assert.equal(sourceKind(u, 'Abstract. Methodology: 1,200 participants and sample size regression p-value.'), 'tertiary');
    assert.equal(isTertiary(u), true);
  }
  // Single cue on .com is not enough
  assert.equal(sourceKind('https://blog.example/news', 'The 500 participants answered a quick poll.'), 'secondary');
  // Two+ distinct cues on non-tertiary .com -> primary-likely
  assert.equal(
    sourceKind('https://research.example/study', 'Abstract: We surveyed 2,400 respondents using a peer-reviewed methodology.'),
    'primary-likely'
  );
  // .pdf / .gov / .edu / sec.gov are primary-likely
  assert.equal(sourceKind('https://www.bls.gov/opub/cpi.htm', ''), 'primary-likely');
  assert.equal(sourceKind('https://www.sec.gov/Archives/edgar/data/320193/000032019323000106/aapl-20230930.htm', ''), 'primary-likely');
});

test('STEP 1e: Marie Antoinette regression (real recorded .tfcache pages) - never returns MATCH; detects dispute', async () => {
  const claim = "Marie Antoinette said 'Let them eat cake' when told the peasants had no bread";
  const pages = {
    'https://www.history.com/news/did-marie-antoinette-really-say-let-them-eat-cake': REAL_PAGES['https://www.history.com/news/did-marie-antoinette-really-say-let-them-eat-cake'],
    'https://inquisitiveeater.com/2012/10/22/marie-antoinette-i-want-candy-pastry-porn-shoes-and-macaron/': REAL_PAGES['https://inquisitiveeater.com/2012/10/22/marie-antoinette-i-want-candy-pastry-porn-shoes-and-macaron/'],
    'http://www.thefoodgeek.com/blog/let-them-eat-cake.html': REAL_PAGES['http://www.thefoodgeek.com/blog/let-them-eat-cake.html'],
  };
  const { final } = await runEvents(
    { claim, url: 'https://www.history.com/news/did-marie-antoinette-really-say-let-them-eat-cake' },
    fake(pages, { q: [{ url: 'https://inquisitiveeater.com/2012/10/22/marie-antoinette-i-want-candy-pastry-porn-shoes-and-macaron/' }, { url: 'http://www.thefoodgeek.com/blog/let-them-eat-cake.html' }] })
  );
  assert.notEqual(final.code, 'MATCH');
  assert.equal(final.code, 'DISPUTED');
  assert.equal(final.tone, 'bad');
  assert.equal(final.headline, 'The source page disputes this claim');
  assert.ok(!/false/i.test(final.headline + ' ' + final.reasons.join(' ')));
  assert.match(final.disputeQuote, /no historical record/i);
});

test('STEP 1e: 10% brain regression (real recorded .tfcache pages) - never returns MATCH; detects dispute on Nature Neuroscience', async () => {
  const claim = 'Humans only use 10% of their brains';
  const pages = {
    'https://www.scientificamerican.com/article/do-people-only-use-10-percent-of-their-brains/': REAL_PAGES['https://www.scientificamerican.com/article/do-people-only-use-10-percent-of-their-brains/'],
    'https://www.nature.com/articles/nn0203-99': REAL_PAGES['https://www.nature.com/articles/nn0203-99'],
    'https://faculty.washington.edu/chudler/tenper.html': REAL_PAGES['https://faculty.washington.edu/chudler/tenper.html'],
  };
  const { final } = await runEvents(
    { claim, url: 'https://www.scientificamerican.com/article/do-people-only-use-10-percent-of-their-brains/' },
    fake(pages, { q: [{ url: 'https://www.nature.com/articles/nn0203-99' }, { url: 'https://faculty.washington.edu/chudler/tenper.html' }] })
  );
  assert.notEqual(final.code, 'MATCH');
  assert.equal(final.code, 'DISPUTED');
  assert.equal(final.tone, 'bad');
  assert.equal(final.headline, 'The source page disputes this claim');
  assert.equal(final.origin.host, 'nature.com');
  assert.equal(final.origin.sourceKind, 'journal-commentary');
  assert.equal(final.origin.sourceKindLabel, 'journal news or commentary (secondary)');
  assert.match(final.disputeQuote, /stubborn myth/i);
});

test('STEP 1e: Thomas Watson regression (real recorded .tfcache pages) - never returns MATCH; detects dispute', async () => {
  const claim = "Thomas Watson said 'I think there is a world market for maybe five computers' in 1943";
  const pages = {
    'https://en.wikipedia.org/wiki/Thomas_J._Watson': REAL_PAGES['https://en.wikipedia.org/wiki/Thomas_J._Watson'],
    'https://geekhistory.com/content/urban-legend-i-think-there-world-market-maybe-five-computers': REAL_PAGES['https://geekhistory.com/content/urban-legend-i-think-there-world-market-maybe-five-computers'],
    'https://www.cs.princeton.edu/courses/archive/spr96/cs425/quotes.html': REAL_PAGES['https://www.cs.princeton.edu/courses/archive/spr96/cs425/quotes.html'],
  };
  const { final } = await runEvents(
    { claim, url: 'https://en.wikipedia.org/wiki/Thomas_J._Watson' },
    fake(pages, { q: [{ url: 'https://geekhistory.com/content/urban-legend-i-think-there-world-market-maybe-five-computers' }, { url: 'https://www.cs.princeton.edu/courses/archive/spr96/cs425/quotes.html' }] })
  );
  assert.notEqual(final.code, 'MATCH');
  assert.equal(final.code, 'DISPUTED');
  assert.equal(final.tone, 'bad');
  assert.equal(final.origin.host, 'geekhistory.com');
  assert.match(final.disputeQuote, /urban legend/i);
});

test('STEP 1c/2 offline guards against G1 edge cases: apples-to-apples rejection, .edu episode secondary, CDP press-release date, Wikipedia footnote traversal', async () => {
  // 1. Wikipedia #cite_note footnote traversal with mock page (logic test)
  const wikiMock = {
    'https://en.wikipedia.org/wiki/Thomas_J._Watson': {
      title: 'Thomas J. Watson - Wikipedia',
      published_date: '2003-04-01',
      text:
        'Thomas Watson is famously said to have stated, "I think there is a world market for maybe five computers" in 1943.[[1]](https://en.wikipedia.org/wiki/Thomas_J._Watson#cite_note-1)\n\n' +
        '## References\n' +
        '1. ^ [GeekHistory on Watson 1943](https://geekhistory.com/content/urban-legend-i-think-there-world-market-maybe-five-computers)',
    },
    'https://geekhistory.com/content/urban-legend-i-think-there-world-market-maybe-five-computers': REAL_PAGES['https://geekhistory.com/content/urban-legend-i-think-there-world-market-maybe-five-computers'],
  };
  const wRes = await runEvents(
    { claim: "Thomas Watson said 'I think there is a world market for maybe five computers' in 1943", url: 'https://en.wikipedia.org/wiki/Thomas_J._Watson' },
    fake(wikiMock)
  );
  assert.equal(wRes.final.code, 'DISPUTED');
  assert.equal(wRes.final.origin.host, 'geekhistory.com');

  // 2. "apples-to-apples" must NOT satisfy Apple entity guard; buildQueries keeps "apple" first
  const appleClaim = parseClaim('Apple reported $383 billion in revenue for fiscal year 2023');
  assert.match(buildQueries(appleClaim).base, /\bapple\b/i);
  assert.equal(
    findPassage('On an apples-to-apples basis, total revenues in FY2019 increased by 4 percent ($133 billion), while spending increased by 7 percent ($294 billion), compared to the prior fiscal year.', appleClaim, 'Deficit Tracker'),
    null
  );

  // 3. Emory Goizueta podcast /episodes/ on .edu classifies as secondary, not primary-likely
  const emory = REAL_PAGES['https://goizueta-effect.emory.edu/episodes/the-science-of-decision-making'];
  assert.equal(sourceKind(emory.url, emory.text), 'secondary');

  // 4. CDP press release date extraction parses "Jul 10, 2017"
  const cdp = REAL_PAGES['https://www.cdp.net/en/press-releases/new-report-shows-just-100-companies-are-source-of-over-70-of-emissions'];
  assert.equal(findDateInText(cdp.text), '2017-07-10');
});

test('STEP 1f: soft and hard time budgets stream status and log per-stage timings', async () => {
  let clock = 0;
  const slowTf = {
    mode: 'replay',
    async fetch({ urls }) {
      clock += 25;
      return {
        results: urls.map((u) => ({
          url: u, final_url: u, title: 'Blog', published_date: '2022-01-01',
          text: 'Nearly 40% of adults sleep poorly according to [Report](https://sleep.example/report.pdf).',
        })),
        errors: [],
      };
    },
    async search() {
      clock += 25;
      return { results: [] };
    },
  };
  const { events, final } = await runEvents(
    { claim: 'nearly 40% of adults sleep poorly', url: 'https://news.example/x', links: [{ href: 'https://blog.example/a', text: 'blog', inSelection: true }] },
    slowTf,
    { softLimitMs: 10, hardLimitMs: 40, now: () => clock }
  );
  assert.ok(events.some((e) => e.type === 'status' && /Still searching/i.test(e.msg)));
  assert.ok(final.timings);
  assert.equal(final.timings.softLimitHit, true);
  assert.equal(final.timings.hardLimitHit, true);
  assert.ok(Array.isArray(final.timings.stages) && final.timings.stages.length >= 1);
});

test('STEP 2: depth - footnote & DOI resolution, SEC EDGAR 10-K scaling, entity guard against taxfoundation mismatch', async () => {
  // 1. Queries keep explicit years
  const q = buildQueries(parseClaim('Apple reported $383 billion in revenue for fiscal year 2023'));
  assert.match(q.base, /2023/);

  // 2. Entity guard blocks corporate tax revenue 2022 from matching Apple FY2023
  const claim = parseClaim('Apple reported $383 billion in revenue for fiscal year 2023');
  const taxText = 'The White House has included a forecast in its annual budget, predicting corporate tax revenue will grow just 2.9 percent this fiscal year to $383 billion in 2022.';
  assert.equal(findPassage(taxText, claim, 'Corporate Tax Revenue'), null);

  // 3. SEC Form 10-K table "(In millions)" + "net sales" matches and flags ROUNDED ($383B vs $383,285M = $383.285B)
  const apple10K =
    'UNITED STATES SECURITIES AND EXCHANGE COMMISSION\nApple Inc. Form 10-K for the Fiscal Year Ended September 30, 2023\n\n' +
    'CONSOLIDATED STATEMENTS OF OPERATIONS (In millions, except number of shares)\n\n' +
    'During fiscal year 2023, total net sales were $383,285 compared to $394,328 in 2022.';
  const hit = findPassage(apple10K, claim, 'Apple Inc. Form 10-K');
  assert.ok(hit);
  assert.match(hit.quote, /383,285/);

  // 4. Wikipedia / academic footnote + DOI resolution follows external primary links and ranks .gov/.edu/.pdf/DOI above blogs
  const wikiMd =
    'Roughly 8 million metric tons of plastic enter the ocean each year.[[3]](https://en.wikipedia.org/wiki/Marine_plastic#cite_note-Jambeck2015-3)\n\n' +
    '## References\n' +
    '3. ^ Jambeck, Jenna R. (2015). [Plastic waste inputs from land into the ocean](https://www.science.org/doi/10.1126/science.1260352). doi:10.1126/science.1260352.';
  const passage = findPassage(wikiMd, parseClaim('8 million metric tons of plastic enter the ocean each year'));
  const resolved = resolvePassageCitations(wikiMd, passage, 'https://en.wikipedia.org/wiki/Marine_plastic');
  const ranked = rankLinks(resolved, parseClaim('8 million metric tons of plastic enter the ocean each year'), 'https://en.wikipedia.org/wiki/Marine_plastic');
  assert.ok(ranked.some((l) => l.href.includes('science.org')));
  assert.ok(ranked.some((l) => l.href === 'https://doi.org/10.1126/science.1260352'));
  assert.ok(ranked[0].fromFootnote);

  // 5. Full end-to-end trace reaches SEC 10-K (ROUNDED, primary) while rejecting taxfoundation mismatch
  const appleTrace = await runEvents(
    { claim: 'Apple reported $383 billion in revenue for fiscal year 2023', url: 'https://news.example/apple-fy23' },
    fake(
      {
        'https://taxfoundation.org/tax-forecast': {
          title: 'Corporate Tax Revenue',
          published_date: '2022-04-14',
          text: taxText,
        },
        'https://www.sec.gov/Archives/edgar/data/320193/000032019323000106/aapl-20230930.htm': {
          title: 'Apple Inc. Form 10-K',
          published_date: '2023-11-03',
          text: apple10K,
        },
      },
      {
        q: [
          { url: 'https://taxfoundation.org/tax-forecast' },
          { url: 'https://www.sec.gov/Archives/edgar/data/320193/000032019323000106/aapl-20230930.htm' },
        ],
      }
    )
  );
  assert.equal(appleTrace.final.status, 'traced_primary');
  assert.equal(appleTrace.final.code, 'ROUNDED');
  assert.equal(appleTrace.final.origin.host, 'sec.gov');
  assert.ok(appleTrace.final.rejected.some((r) => r.host === 'taxfoundation.org'));
});

test('PART A: unreliable/post-era dates flagged dateUncertain, uncited secondary gets honest headline, clean38 shifts to SCOPE/YEAR', async () => {
  // 1. Updated or post-era dates -> dateUncertain
  const upd = findDateInfo('Last updated: Jan 25, 2026\nTracker text here.', '2026-01-25', 'https://example.org/tracker');
  assert.equal(upd.dateUncertain, true);

  const era = findDateInfo('Posted Apr 20, 2026\nThomas Watson quote...', '2026-04-20', 'https://geekhistory.com/watson', parseClaim("Thomas Watson said 'I think there is a world market for maybe five computers' in 1943"));
  assert.equal(era.dateUncertain, true);
  assert.match(era.dateReason, /1943/);

  const urlYr = findDateInfo('Article analysis', '2026-06-29', 'https://www.carbonbrief.org/six-charts-clean-power-in-2025');
  assert.equal(urlYr.dateUncertain, true);

  const reliable = findDateInfo('Published: Jul 10, 2017\nPress release.', null, 'https://www.cdp.net/en/press-releases/100-companies');
  assert.equal(reliable.date, '2017-07-10');
  assert.equal(reliable.dateUncertain, false);

  // 2. Earliest page found states claim, cites nothing, search finds nothing earlier
  const uncitedTrace = await runEvents(
    { claim: 'Adults make 35,000 decisions a day', url: 'https://blog.example/decisions' },
    fake(
      {
        'https://blog.example/decisions': {
          title: 'Decision Making',
          published_date: '2024-05-01',
          text: 'Adults make 35,000 decisions a day according to common estimates.',
        },
        'https://earlier.example/post': {
          title: 'Everyday Choices',
          published_date: '2019-06-01',
          text: 'Studies often note that adults make 35,000 decisions a day in daily life.',
        },
      },
      { q: [{ url: 'https://earlier.example/post' }] }
    )
  );
  assert.equal(uncitedTrace.final.headline, 'Earliest page found cites no source; original not found');
  assert.equal(uncitedTrace.final.status, 'earliest_uncited');
  assert.equal(uncitedTrace.final.code, 'UNCITED');
  assert.equal(uncitedTrace.final.tone, 'warn');

  // 3. clean38 (38% global energy vs 35% of final energy electricity goal by 2035) suppresses numeric flags under DIFFERENT_CONTEXT
  const cleanCmp = compare(
    '38% of global energy comes from clean sources',
    'The COP31 presidency has called for countries to back a global goal for 35% of "final" energy to come from electricity by 2035, against a global average today of around 22%.'
  );
  assert.equal(cleanCmp.code, 'DIFFERENT_CONTEXT');
  assert.ok(cleanCmp.flags.some((f) => f.code === 'DIFFERENT_CONTEXT'));
  assert.equal(
    cleanCmp.flags.some((f) => ['CHANGED', 'ROUNDED', 'QUALIFIER', 'YEAR', 'HEDGE_DROPPED'].includes(f.code)),
    false
  );

  // 4. CPI index baseline (1982-84=100) must not trigger a false YEAR mismatch against June 2022
  const cpiCmp = compare(
    'US consumer price index peaked at 9.1% in June 2022',
    'The Consumer Price Index for All Urban Consumers (CPI-U) increased 9.1 percent over the last 12 months to an index level of 296.311 (1982-84=100).'
  );
  assert.equal(cpiCmp.code, 'MATCH');
});

test('FINAL FIX PASS: clean38 recorded texts, moore dispute precision, press-release label, and corporate SEC targeting', async () => {
  const { parseClaim, detectDispute, sourceKind } = await import('../src/text.js');
  const { mergeResearch } = await import('../src/research.js');

  // Item 1: clean38 recorded text from Carbon Brief vs Earth.Org vs Interesting Engineering
  const carbonBriefQuote =
    'The COP31 presidency has called for countries to back a global goal for 35% of “final” energy to come from electricity by 2035, against a global average today of around 22%.';
  const earthOrgQuote = 'Renewable Energy Sources Generated 38% of Global Electricity in 2021';
  const ieQuote =
    'Put together with other clean sources, renewable sources met 38 percent of global energy demand, which is more than the 36 percent which was met by coal.';

  const cbCheck = compare('38% of global energy comes from clean sources', carbonBriefQuote);
  assert.equal(cbCheck.code, 'DIFFERENT_CONTEXT');
  assert.equal(cbCheck.flags.some((f) => ['CHANGED', 'ROUNDED', 'QUALIFIER', 'YEAR'].includes(f.code)), false);

  const eoCheck = compare('38% of global energy comes from clean sources', earthOrgQuote);
  assert.equal(eoCheck.code, 'SCOPE');

  const cleanPad =
    'Global electricity generation shifted significantly during 2021 as wind and solar output expanded across major grids worldwide, according to international energy analysts reviewing annual generation datasets. ';
  const cleanTrace = await runEvents(
    { claim: '38% of global energy comes from clean sources', url: 'https://ourworldindata.org/electricity-mix' },
    fake(
      {
        'https://ourworldindata.org/electricity-mix': {
          title: 'Electricity Mix',
          published_date: '2024-01-01',
          text: cleanPad + 'Across global benchmarks, 38% of global energy comes from clean sources in recent tracking.',
        },
        'https://interestingengineering.com/innovation/clean-energy-record-38': {
          title: 'Clean energy met a record-breaking 38 percent of global power demand in 2021',
          published_date: '2022-03-30',
          text: cleanPad + ieQuote,
        },
        'https://earth.org/renewable-energy-facts/': {
          title: earthOrgQuote,
          published_date: '2022-12-16',
          text: cleanPad + earthOrgQuote + ' according to Ember annual data.',
        },
        'https://www.carbonbrief.org/six-charts-show-how-clean-power-was-worlds-largest-source-of-new-energy-in-2025': {
          title: 'Six charts show how clean power was worlds largest source of new energy',
          published_date: '2026-06-29',
          text: cleanPad + carbonBriefQuote,
        },
      },
      {
        q: [
          { url: 'https://www.carbonbrief.org/six-charts-show-how-clean-power-was-worlds-largest-source-of-new-energy-in-2025' },
          { url: 'https://interestingengineering.com/innovation/clean-energy-record-38' },
          { url: 'https://earth.org/renewable-energy-facts/' },
        ],
      }
    )
  );
  assert.notEqual(cleanTrace.final.origin?.url?.includes('carbonbrief.org'), true);
  assert.notEqual(cleanTrace.final.code, 'CHANGED');

  // Item 2: moore dispute precision using recorded 1965 PDF quote and slowing-down guard
  const mooreClaim = parseClaim('The number of transistors on a microchip doubles every year');
  const mooreEighteenQuote = 'I never said 18 months that\u2019s the way it often gets quoted.';
  const mooreConfirmingQuote =
    'The complexity for minimum component costs has increased at a rate of roughly a factor of two per year (see graph on next page).';
  assert.equal(detectDispute(mooreEighteenQuote, { quote: mooreConfirmingQuote }, 'Moore 1965', mooreClaim).disputed, false);
  assert.equal(
    detectDispute(
      'Critics argue transistor scaling is slowing down as process nodes approach physical limits.',
      { quote: 'The number of transistors on a microchip doubles every year.' },
      'Scaling',
      mooreClaim
    ).disputed,
    false
  );
  assert.equal(
    detectDispute(
      mooreEighteenQuote,
      { quote: 'Transistor count doubles every 18 months.' },
      'Moore 1965',
      parseClaim('The number of transistors on a microchip doubles every 18 months')
    ).disputed,
    true
  );

  const mooreTrace = await runEvents(
    {
      claim: 'The number of transistors on a microchip doubles every year',
      url: 'https://en.wikipedia.org/wiki/Moore%27s_law',
    },
    fake(
      {
        'https://en.wikipedia.org/wiki/Moore%27s_law': {
          title: "Moore's law",
          published_date: '2025-01-01',
          text:
            cleanPad +
            'Moore observed that the number of transistors on a microchip doubles every year in his 1965 paper.',
        },
        'https://hasler.ece.gatech.edu/Published_papers/Technology_overview/gordon_moore_1965_article.pdf': {
          title: 'Cramming more components onto integrated circuits',
          published_date: '1965-04-19',
          text:
            cleanPad +
            mooreConfirmingQuote +
            ' Later reflections noted: ' +
            mooreEighteenQuote +
            ' From 1959 we had about doubled every year the amount of components we could put on a chip.',
        },
      },
      {
        q: [{ url: 'https://hasler.ece.gatech.edu/Published_papers/Technology_overview/gordon_moore_1965_article.pdf' }],
      }
    )
  );
  assert.notEqual(mooreTrace.final.code, 'DISPUTED');
  assert.equal(Boolean(mooreTrace.final.dispute?.disputed), false);

  // Item 3: institutional press releases vs primary PDFs, plus plastic Science honesty note
  assert.equal(sourceKind('https://news.ucsb.edu/2015/014985/ocean-plastic', 'Press release text'), 'press-release');
  assert.equal(sourceKind('https://news.uga.edu/research/plastic', 'Press release text'), 'press-release');
  assert.equal(sourceKind('https://www.agency.gov/press/2024-report', 'Press release text'), 'gov-release');
  assert.equal(sourceKind('https://www.dol.gov/newsroom/economicdata/cpi_07132022.pdf', 'CPI data'), 'gov-release');

  const plasticPad =
    'Coastal researchers analyzed solid waste streams across 192 ocean-bordering countries to quantify how much mismanaged municipal plastic debris enters marine waters annually worldwide. ';
  const plasticFake = fake(
    {
      'https://www.nationalgeographic.com/environment/article/ocean-plastic-pollution-science-study': {
        title: 'Eight Million Tons of Plastic Dumped in Ocean Every Year',
        published_date: '2015-02-13',
        text: plasticPad + 'Researchers warn 8 million metric tons of plastic enter the ocean each year from coastal nations.',
      },
      'https://news.ucsb.edu/2015/014985/ocean-plastic': {
        title: 'Ocean plastic estimate',
        published_date: '2015-02-12',
        text:
          plasticPad +
          '“Using the average density of uncompacted plastic waste, 8 million metric tons — the midpoint of our estimate — would cover an area 34 times the size of Manhattan ankle-deep in plastic waste,” said co-author Roland Geyer, an associate professor at the Bren School of Environmental Science & Management.',
      },
      'https://pubmed.ncbi.nlm.nih.gov/25678662/': {
        title: 'PubMed',
        published_date: '2015-02-13',
        text: 'Access denied',
      },
    },
    {}
  );
  let plasticState;
  for await (const ev of runTrace(
    {
      claim: '8 million metric tons of plastic enter the ocean each year',
      url: 'https://www.nationalgeographic.com/environment/article/ocean-plastic-pollution-science-study',
    },
    plasticFake,
    { maxDepth: 2, perHop: 2, searchFetchLimit: 2, allowAgent: false }
  )) {
    if (ev.type === 'state') plasticState = ev.state;
  }
  const mergedPlastic = await mergeResearch(
    plasticState,
    {
      deep_result: {
        result: 'The claim originates from **Jambeck et al. (2015)**, a peer-reviewed paper published in *Science* on February 13, 2015.',
        citations: [
          { url: 'https://news.ucsb.edu/2015/014985/ocean-plastic' },
          { url: 'https://pubmed.ncbi.nlm.nih.gov/25678662/' },
        ],
      },
    },
    plasticFake,
    { agentFallback: false, maxAgentCalls: 0 }
  );
  assert.equal(mergedPlastic.final.headline, 'Earliest page found is a press release');
  assert.equal(mergedPlastic.final.origin?.sourceKind, 'press-release');
  assert.equal(mergedPlastic.final.origin?.sourceKindLabel, 'institutional press release about the study');
  assert.ok(mergedPlastic.final.reasons.some((r) => /Science/i.test(r) && /did not reach/i.test(r)));

  // Item 5: corporate earnings claim builds a single targeted sec.gov + investor domain query
  const appleQ = buildQueries(parseClaim('Apple reported $383 billion in revenue for fiscal year 2023'));
  assert.equal(appleQ.isCorp, true);
  assert.equal(appleQ.corpDomains, 'sec.gov,investor.apple.com');
  assert.match(appleQ.corpQuery, /Form 10-K/i);

  // Item 1 (follow-up): Moore time-interval change ("every two years" / "every couple of years" vs "every year") flags time interval changed, NOT HEDGE_DROPPED
  const moore2y = compare(
    'The number of transistors on a microchip doubles every year',
    'Gordon Moore later noted that transistor counts on a chip would roughly double every two years.'
  );
  assert.equal(moore2y.code, 'CHANGED');
  assert.ok(moore2y.flags.some((f) => f.code === 'CHANGED' && /time interval changed/i.test(f.text)));
  assert.equal(moore2y.flags.some((f) => f.code === 'HEDGE_DROPPED'), false);

  const mooreCouple = compare(
    'The number of transistors on a microchip doubles every year',
    'In 1975 he revised the chip transistor forecast to doubling every couple of years.'
  );
  assert.equal(mooreCouple.code, 'CHANGED');
  assert.ok(mooreCouple.flags.some((f) => /time interval changed/i.test(f.text)));

  // SEC iXBRL 10-K matching ("Apple Inc." cover after 15KB iXBRL header, "The Company's total net sales were $383.3 billion", signature Date)
  const { findPassage: findP, findDateInfo: findDI } = await import('../src/text.js');
  const { assemble } = await import('../src/trace.js');
  const fake10k =
    '0'.repeat(15050) +
    '\nSECURITIES AND EXCHANGE COMMISSION\nFORM 10-K\nFor the fiscal year ended September 30, 2023\nApple Inc.\n\n' +
    'Overview and Results of Operations.\n\nThe Company\u2019s total net sales were $383.3 billion and net income was $97.0 billion during 2023.\n\nSIGNATURES\nDate: November\u00a02, 2023 | Apple Inc.\n';
  const aClaim = parseClaim('Apple reported $383 billion in revenue for fiscal year 2023');
  const aPass = findP(fake10k, aClaim, 'aapl-20230930');
  assert.ok(aPass && aPass.quote.includes('$383.3 billion'));
  const aDate = findDI(fake10k, null, 'https://www.sec.gov/Archives/edgar/data/320193/000032019323000106/aapl-20230930.htm', aClaim);
  assert.equal(aDate.date, '2023-11-02');
  assert.equal(aDate.dateSource, 'page-text');
  const aCmp = compare(aClaim.raw, aPass.quote);
  assert.equal(aCmp.code, 'ROUNDED');
});

test('CORRECTION PASS: real Moore 1965 PDF body, could non-hedge, CPI bls>dol, clean38 earth.org SCOPE', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { findPassage: findP, findDateInfo: findDI } = await import('../src/text.js');
  const { assemble } = await import('../src/trace.js');
  const tfPath = path.join(process.cwd(), 'server/.tfcache/fetch-7e73cf582ed827b3f37ac52b8e61874a.json').replace(/server[\\/]server/, 'server');
  let mooreRec;
  if (fs.existsSync(tfPath)) {
    const mooreFetch = JSON.parse(fs.readFileSync(tfPath, 'utf8'));
    mooreRec = (mooreFetch.response?.results || []).find((r) => (r.url || '').includes('gordon_moore_1965_article.pdf'));
  } else {
    const fixPath = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'fixtures-real.json');
    const fix = JSON.parse(fs.readFileSync(fixPath, 'utf8'));
    mooreRec = fix['https://hasler.ece.gatech.edu/Published_papers/Technology_overview/gordon_moore_1965_article.pdf'];
  }
  assert.ok(mooreRec && mooreRec.text.length > 50, 'Expected recorded Moore 1965 PDF');

  const mClaim = parseClaim('Initially, he said transistors on a chip would double every year.');
  const mPass = findP(mooreRec.text, mClaim, mooreRec.title || '');
  assert.ok(mPass, 'Should match Moore 1965 PDF');
  assert.match(mPass.quote, /complexity for minimum component costs has increased at a rate of roughly a factor of two per year/i);
  const mDate = findDI(mooreRec.text, mooreRec.published_date, mooreRec.url, mClaim);
  assert.equal(mDate.date, '1965-04-19');
  const mCmp = compare(mClaim.raw, mPass.quote);
  assert.equal(mCmp.code, 'HEDGE_DROPPED');
  assert.ok(mCmp.flags.some((f) => /roughly/i.test(f.text)));

  // Non-epistemic ability "could" / "can" must not trigger HEDGE_DROPPED
  const abilityCmp = compare(
    'We put twice as many transistors on a chip every year.',
    'The engineers realized what they could put on a chip when doubling every year.'
  );
  assert.equal(abilityCmp.flags.some((f) => f.code === 'HEDGE_DROPPED'), false);

  // CPI: bls.gov primary-likely wins origin ahead of dol.gov/newsroom/...pdf gov-release
  const cpiState = {
    input: { claim: 'The consumer price index increased 9.1% from a year ago in June', url: 'https://www.cnbc.com/2022/07/13/x' },
    chain: [{
      id: 'h0', role: 'start', host: 'cnbc.com', url: 'https://www.cnbc.com/2022/07/13/x',
      date: '2022-07-13', verifiedBy: 'selection', sourceKind: 'secondary',
      quote: 'The consumer price index increased 9.1% from a year ago in June', relation: 'Starting claim',
    }],
    extras: [
      {
        id: 'x0', role: 'source', via: 'search', verifiedBy: 'fetch', host: 'dol.gov',
        url: 'https://www.dol.gov/newsroom/economicdata/cpi_07132022.pdf',
        date: '2022-07-13', sourceKind: sourceKind('https://www.dol.gov/newsroom/economicdata/cpi_07132022.pdf'),
        sourceKindLabel: 'official agency news release',
        quote: 'Over the last 12 months, the all items index increased 9.1 percent before seasonal adjustment.',
        relation: 'Found by search',
      },
      {
        id: 'x1', role: 'source', via: 'search', verifiedBy: 'fetch', host: 'bls.gov',
        url: 'https://www.bls.gov/opub/ted/2022/consumer-prices-up-9-1-percent-over-the-year-ended-june-2022-largest-increase-in-40-years.htm',
        date: '2022-07-18', sourceKind: sourceKind('https://www.bls.gov/opub/ted/2022/consumer-prices-up-9-1-percent-over-the-year-ended-june-2022-largest-increase-in-40-years.htm'),
        sourceKindLabel: 'likely primary source',
        quote: 'Over the 12 months ended June 2022, the Consumer Price Index for All Urban Consumers increased 9.1 percent.',
        relation: 'Found by search',
      },
    ],
    rejected: [],
    stats: { fetches: 2, searches: 1 },
  };
  const cpiFin = assemble(cpiState);
  assert.equal(cpiFin.origin?.host, 'bls.gov');
  assert.equal(cpiFin.alsoFound?.[0]?.host, 'dol.gov');
  assert.equal(cpiFin.alsoFound?.[0]?.sourceKind, 'gov-release');
  assert.ok(
    cpiFin.reasons.some((r) => /an earlier official release is listed below/i.test(r)),
    'Expected origin note about earlier official release in alsoFound'
  );
  assert.equal(cpiFin.origin?.earlierOfficialRelease?.host, 'dol.gov');

  // clean38: later search hit earth.org stays in alsoFound with SCOPE flag (energy vs electricity)
  const cleanState = {
    input: { claim: 'renewable sources met 38 percent of global energy demand', url: 'https://interestingengineering.com/innovation/clean-energy-record-38' },
    chain: [{
      id: 'h0', role: 'start', host: 'interestingengineering.com', url: 'https://interestingengineering.com/innovation/clean-energy-record-38',
      date: '2022-03-30', verifiedBy: 'selection', sourceKind: 'secondary', hasPassageCitations: false,
      quote: 'renewable sources met 38 percent of global energy demand', relation: 'Starting claim',
    }],
    extras: [{
      id: 'x0', role: 'source', via: 'search', verifiedBy: 'fetch', host: 'earth.org',
      url: 'https://earth.org/renewable-energy-facts/', date: '2022-12-16', sourceKind: 'secondary',
      quote: 'Renewable Energy Sources Generated 38% of Global Electricity in 2021',
      relation: 'Found by search',
    }],
    rejected: [],
    stats: { fetches: 1, searches: 1 },
  };
  const cleanFin = assemble(cleanState);
  assert.equal(cleanFin.code, 'UNCITED');
  assert.equal(cleanFin.alsoFound?.length, 1);
  assert.equal(cleanFin.alsoFound[0].vsClaim?.code, 'SCOPE');
  assert.match(cleanFin.alsoFound[0].vsClaim?.flags?.[0]?.text || '', /claim says "energy" while this source says "electricity"/i);
});

test('FINAL POLISH A: scholarly-publisher domains require research cues; Nature nn0203-99 commentary is journal-commentary', async () => {
  const { assemble } = await import('../src/trace.js');
  const naturePage = REAL_PAGES['https://www.nature.com/articles/nn0203-99'];
  assert.ok(naturePage && naturePage.text.length > 50);
  assert.equal(sourceKind('https://www.nature.com/articles/nn0203-99', naturePage.text), 'journal-commentary');
  assert.equal(sourceKind('https://www.thelancet.com/news/story-123', 'Brief commentary noting public debate.'), 'journal-commentary');
  assert.equal(
    sourceKind(
      'https://www.science.org/doi/10.1126/science.1260352',
      'Abstract. Methods: We measured coastal plastic waste with sample size n = 192. doi:10.1126/science.1260352'
    ),
    'primary-likely'
  );
  assert.equal(
    sourceKind(
      'https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0000001',
      'Abstract: We analysed biomarker levels across 450 patients.'
    ),
    'primary-likely'
  );

  // Full brain10 re-assembly from recorded Nature text -> DISPUTED with journal news or commentary (secondary)
  const { final } = await runEvents(
    {
      claim: 'humans "only" employ 10 percent of their brain',
      url: 'https://www.scientificamerican.com/article/do-people-only-use-10-percent-of-their-brains/',
    },
    fake(
      {
        'https://www.scientificamerican.com/article/do-people-only-use-10-percent-of-their-brains/':
          REAL_PAGES['https://www.scientificamerican.com/article/do-people-only-use-10-percent-of-their-brains/'],
        'https://www.nature.com/articles/nn0203-99': naturePage,
      },
      { q: [{ url: 'https://www.nature.com/articles/nn0203-99' }] }
    )
  );
  assert.equal(final.code, 'DISPUTED');
  assert.equal(final.origin.host, 'nature.com');
  assert.equal(final.origin.sourceKind, 'journal-commentary');
  assert.equal(final.origin.sourceKindLabel, 'journal news or commentary (secondary)');
  assert.ok(final.reasons.some((r) => /journal news or commentary \(secondary\)/i.test(r)));
  assert.ok(assemble);
});

test('assemble() filters out forum posts, UGC discussion and quotes starting with "<name> wrote:" from alsoFound', async () => {
  const { assemble } = await import('../src/trace.js');

  // Test 1: recorded comment (contains "Jane Doe wrote:") and off-topic quote are dropped
  const brainState = {
    input: { claim: 'humans "only" employ 10 percent of their brain', url: 'https://www.scientificamerican.com/article/do-people-only-use-10-percent-of-their-brains/' },
    chain: [{
      id: 'h0', role: 'start', host: 'scientificamerican.com',
      url: 'https://www.scientificamerican.com/article/do-people-only-use-10-percent-of-their-brains/',
      date: '2008-02-07', verifiedBy: 'selection', sourceKind: 'secondary',
      quote: 'humans "only" employ 10 percent of their brain', relation: 'Starting claim',
    }],
    extras: [
      {
        id: 'x0', role: 'source', via: 'search', verifiedBy: 'fetch', host: 'nature.com',
        url: 'https://www.nature.com/articles/nn0203-99',
        date: '2003-02-01', sourceKind: 'journal-commentary',
        quote: 'We only use 10% of our brains. Advertising executives know it, self-help authors know it, and so do many ordinary people.',
        relation: 'Found by search',
        dispute: { disputeQuote: 'The idea that we only use 10% of our brains is a stubborn myth.', cues: ['myth'] }
      },
      {
        id: 'x1', role: 'source', via: 'search', verifiedBy: 'fetch', host: 'nationalgeographic.com',
        url: 'https://www.nationalgeographic.com/science/article/the-brain-comment-thread',
        date: '2008-03-01', sourceKind: 'secondary',
        quote: 'Jane Doe wrote: “So in a way, N. equitans is both ‘smarter’ in that it uses more of its total capabilities (versus humans and the old ‘10% of the brain thing’) and ‘more efficient’ in the way it works.”',
        relation: 'Found by search',
      },
      {
        id: 'x2', role: 'source', via: 'search', verifiedBy: 'fetch', host: 'unrelated.example',
        url: 'https://unrelated.example/stat',
        date: '2008-05-01', sourceKind: 'secondary',
        quote: 'Nearly 10 percent of all respondents agreed with the survey results.',
        relation: 'Found by search',
      },
      {
        id: 'x3', role: 'source', via: 'search', verifiedBy: 'fetch', host: 'faculty.washington.edu',
        url: 'https://faculty.washington.edu/chudler/tenper.html',
        date: '2008-04-01', sourceKind: 'secondary',
        quote: 'In fact, most of us use only about 10 percent of our brains, if that.',
        relation: 'Found by search',
      },
    ],
    rejected: [],
    stats: { fetches: 4, searches: 1 },
  };
  const brainFin = assemble(brainState);
  assert.equal(brainFin.alsoFound.some((a) => a.host === 'nationalgeographic.com'), false, 'NatGeo comment must be dropped');
  assert.equal(brainFin.alsoFound.some((a) => a.host === 'unrelated.example'), false, 'Off-topic passage without brain subject must be dropped');
  assert.equal(brainFin.alsoFound.some((a) => a.host === 'faculty.washington.edu'), true, 'Legitimate faculty quote must be kept');

  // Test 2: freedictionary forum post is dropped
  const marieState = {
    input: { claim: 'Let them eat cake', url: 'https://www.history.com/news/did-marie-antoinette-really-say-let-them-eat-cake' },
    chain: [{
      id: 'h0', role: 'start', host: 'history.com',
      url: 'https://www.history.com/news/did-marie-antoinette-really-say-let-them-eat-cake',
      date: '2012-10-24', verifiedBy: 'selection', sourceKind: 'secondary',
      quote: 'Let them eat cake', relation: 'Starting claim',
    }],
    extras: [
      {
        id: 'x0', role: 'source', via: 'search', verifiedBy: 'fetch', host: 'inquisitiveeater.com',
        url: 'https://inquisitiveeater.com/2012/10/22/marie-antoinette-i-want-candy-pastry-porn-shoes-and-macaron/',
        date: '2012-10-22', sourceKind: 'secondary',
        quote: 'One of the most recognizable and symbolic phrases ever attributed to royalty could be Queen Marie Antoinette’s infamous quote, “Let them eat cake.” Although there is no historical record of these words having ever been uttered by the Queen, the quotation is claimed to have been voiced in response to the widespread famine under the reign of her husband, King Louis XVI.',
        relation: 'Found by search',
        dispute: { disputeQuote: 'Although there is no historical record of these words having ever been uttered by the Queen', cues: ['no historical record'] }
      },
      {
        id: 'x1', role: 'source', via: 'search', verifiedBy: 'fetch', host: 'forum.thefreedictionary.com',
        url: 'https://forum.thefreedictionary.com/postst12345_Let-them-eat-cake.aspx',
        date: '2012-10-25', sourceKind: 'secondary',
        quote: 'The way I heard it, when she was told her poor subjects were starving, she replied with, "Let them eat cake!"',
        relation: 'Found by search',
      },
      {
        id: 'x2', role: 'source', via: 'search', verifiedBy: 'fetch', host: 'thefoodgeek.com',
        url: 'http://www.thefoodgeek.com/blog/let-them-eat-cake.html',
        date: '2012-10-26', sourceKind: 'secondary',
        quote: 'The advisor told her that the peasants had no bread, and she responded, "Let them eat cake!"',
        relation: 'Found by search',
      },
    ],
    rejected: [],
    stats: { fetches: 3, searches: 1 },
  };
  const marieFin = assemble(marieState);
  assert.equal(marieFin.alsoFound.some((a) => a.host === 'forum.thefreedictionary.com'), false, 'FreeDictionary forum post must be dropped');
  assert.equal(marieFin.alsoFound.some((a) => a.host === 'thefoodgeek.com'), true, 'TheFoodGeek quote must be kept');
});
