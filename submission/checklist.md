# Source Hunter — Submission Verification & Audit Checklist

## 1. Hard Requirements Mapping

| # | Requirement | Status | Evidence in Code & Demo |
|---|---|---|---|
| 1 | Works on any site and topic (nothing hardcoded) | PASS | Dynamic selection/URL ingestion in [`extension/content.js`](../extension/content.js), [`extension/background.js`](../extension/background.js), and [`server/src/index.js`](../server/src/index.js); verified across 9 distinct topics in [`demo/final-traces.json`](../demo/final-traces.json) |
| 2 | Follows citations across live pages to earliest source | PASS | Citation extraction, date filtering (`before_date`), and chronological sorting in [`server/src/trace.js`](../server/src/trace.js) |
| 3 | Each hop shows URL, date, exact quoted wording, and relation | PASS | Verbatim substring extractor in `trace.js`; Drift meter, per-hop diff, `dateUncertain` indicator, and hop cards in [`extension/sidepanel.js`](../extension/sidepanel.js) and [`demo/build-gallery.js`](../demo/build-gallery.js) |
| 4 | Flags `CHANGED`, `ROUNDED`, `MISQUOTED`, `SCOPE`, `DISPUTED`, `UNCITED`, `NO_SOURCE` + honest `"No original source found"` | PASS | Deterministic verdict comparator in [`server/src/compare.js`](../server/src/compare.js) (including `DIFFERENT_CONTEXT` subject-mismatch suppression), context dispute detector [`detectDispute`](../server/src/text.js) in [`server/src/text.js`](../server/src/text.js), `press-release` / `UNCITED` / `no_source` statuses in [`server/src/trace.js`](../server/src/trace.js); secondary origins and press releases are never called `"likely primary source"` |
| 5 | Meaningful use of TinyFish endpoints (`Fetch`, `Search`, `Research`, plus `Agent` retry wiring) | PASS (`Fetch`, `Search`, `Research`); REAL-TRACE TIMEOUT (`Agent`) | Fetch (`POST api.fetch.tinyfish.ai`), Search (`GET api.search.tinyfish.ai`), and TinyResearch (default deep trace, `POST /v1/automation/run-research-async` via [`server/src/research.js`](../server/src/research.js), ~$2/run, default cap 3/day) PASS; Browser Agent (`POST agent.tinyfish.ai/v1/automation/run` via [`server/src/agent-retry.js`](../server/src/agent-retry.js)) passed the `example.com` structured test, but the real blocked-page attempt (`psychology.stackexchange.com`) timed out (`$0.160 USD`) and is **NOT** marked PASS on a real trace |
| 6 | 5+ real claims across topics (>=1 wrong/disputed & >=1 `NO_SOURCE`) | PASS | **10 recorded traces** in [`demo/index.html`](../demo/index.html) (`cpi91`, `plastic`, `apple`, `clean38`, `moore`, `brain10`, `marie`, `coyotiv`, `who`, `data90`), including 2 `DISPUTED` myths (`brain10`, `marie`), 1 `ROUNDED` SEC 10-K filing (`apple`), 1 `HEDGE_DROPPED` primary paper (`moore`), 1 `UNCITED` secondary (`clean38`), 1 recognized primary publisher (`who`), 1 `CONTRADICTED` claim on data creation (`data90`), and 1 real uncited blog ending in `NO_SOURCE` (`coyotiv`) |

---

## 2. Recorded 10-Claim Gallery Summary (`TF_MODE=record` Final Logic)

| ID | Topic | Verdict | Status | Earliest Found Host (Date) | Source Label | Hops |
|---|---|---|---|---|---|---|
| `cpi91` | Economics | `MATCH` | `traced_primary` | `bls.gov` (`2022-07-18`) | `likely primary source` (earlier official release: `dol.gov`, `2022-07-13`) | 2 |
| `plastic` | Environment · Deep Trace | `MATCH` | `traced_secondary` | `news.ucsb.edu` (`2015-02-12`) | `institutional press release about the study` | 2 |
| `apple` | Earnings | `ROUNDED` | `traced_primary` | `sec.gov` (`2023-11-02`) | `likely primary source` | 2 |
| `clean38` | Energy | `UNCITED` | `earliest_uncited` | `interestingengineering.com` (`2022-03-30`) | `secondary source` | 2 |
| `moore` | Computing | `HEDGE_DROPPED` | `traced_primary` | `hasler.ece.gatech.edu` (`1965-04-19`) | `likely primary source` | 2 |
| `brain10` | Neuroscience | `DISPUTED` | `traced_secondary` | `nature.com` (`2003-02`) | `journal news or commentary (secondary)` | 2 |
| `marie` | History Myth | `DISPUTED` | `traced_secondary` | `britannica.com` (`date uncertain`) | `secondary source` | 2 |
| `coyotiv` | Software · Uncited Blog | `NO_SOURCE` | `no_source` | — (`No original source found`) | — | 1 |
| `who` | Global Health | `PRIMARY_PUBLISHER` | `publisher_is_source` | `who.int` (`2025-07-31`) | `likely primary source` | 1 |
| `data90` | Technology · Deep Trace | `CONTRADICTED` | `traced_primary` | `oracle.com` (`date uncertain`) | `likely primary source` | 2 |

---

## 3. Part A.3 Verification (`clean38` — Subject Mismatch & `DIFFERENT_CONTEXT`)

- **Claim tested**: `"38% of global energy comes from clean sources"` (`https://ourworldindata.org/electricity-mix`)
- **Earliest uncited hit (`UNCITED`)**: `interestingengineering.com` (`2022-03-30`) — `"Put together with other clean sources, renewable sources met 38 percent of global energy demand, which is more than the 36 percent which was met by coal."` (`code: UNCITED`, `status: earliest_uncited`; title says `"global power demand"`)
- **Compared in `alsoFound` against `earth.org`** (`2022-12-16`, `https://earth.org/renewable-energy-facts/`): `"Renewable Energy Sources Generated 38% of Global Electricity in 2021"` -> `compare()` flags **`SCOPE`** (`"Scope changed: source refers specifically to final energy or electricity share rather than all global energy"`).
- **Compared in `alsoFound` against `carbonbrief.org`** (`2026-06-29`, `dateUncertain: true`, `https://www.carbonbrief.org/six-charts-show-how-clean-power-was-worlds-largest-source-of-new-energy-in-2025`): `"The COP31 presidency has called for countries to back a global goal for 35% of “final” energy to come from electricity by 2035, against a global average today of around 22%."` -> `compare()` returns **`DIFFERENT_CONTEXT`** (`"The two passages do not share the subject of the number; numeric comparison suppressed"`), suppressing all numeric/year/scope flags and rejecting the candidate from the trace.

---

## 4. Part A.4 Verification (`plastic` TinyResearch Deep Run)

- **Run ID**: `01a1cbfe-a061-7f77-8ba7-2c215837a708` (completed, `elapsedSec: 282` in [`demo/g2-research.json`](../demo/g2-research.json))
- **Extracted URLs**: `29` raw URLs extracted from report text (`researchSummary.totalCitationsFound: 28` valid/counted; `citationsProposed: 12` fed to Fetch).
- **Confirmed by Fetch (5)**:
  1. `https://news.uga.edu/new-science-paper-magnitude-plastic-waste-going-into-ocean-0215/` (`2015-02-13`, classified `press-release`: `"institutional press release about the study"`)
  2. `https://news.ucsb.edu/2015/014985/ocean-plastic` (`2015-02-12`, classified `press-release`: `"institutional press release about the study"`, headline `"Earliest page found is a press release"`, quoting co-author Roland Geyer)
  3. `https://ocean.si.edu/conservation/pollution/marine-plastics` (`2018-04-18`, classified `secondary`)
  4. `https://www.npr.org/2015/02/12/385752248/8-million-tons-of-plastic-clutter-our-seas` (`2015-02-12`)
  5. `https://beachapedia.org/Plastic_Pollution_Facts_and_Figures` (`2022-04-05`)
- **Discarded by Fetch (7)**:
  1. `https://pubmed.ncbi.nlm.nih.gov/25678662/` — `"page had almost no readable text"`
  2. `https://www.washingtonpost.com/news/energy-environment/wp/2015/02/12/humans-are-putting-8-million-metric-tons-of-plastic-in-the-oceans-annually/` — `"page does not state this claim"`
  3. `https://www.nationalgeographic.com/science/article/150212-ocean-debris-plastic-garbage-patches-science` — `"page does not state this claim"`
  4. `https://time.com/3707112/plastic-in-the-ocean/` — `"page does not state this claim"`
  5. `https://news.uga.edu/new-science-paper-magnitude-plastic-waste-going-into-ocean-0215/%60` — `"page no longer exists (404)"` (trailing backtick bug fixed afterward in `server/src/research.js`)
  6. `https://news.ucsb.edu/2015/014985/ocean-plastic%60` — `"page no longer exists (404)"` (fixed afterward in `server/src/research.js`)
  7. `https://www.nationalgeographic.com/environment/article/plastic-pollution` — `"page does not state this claim"`
- **2015 *Science* paper reached?**: No — TinyResearch did not reach the peer-reviewed *Science* paper directly via Fetch (`reached2015ScienceCitation: false`); it verified the same-day Feb 12, 2015 UCSB press release quoting co-author Roland Geyer verbatim, surfaced honestly as `"Earliest page found is a press release"`.

## 4b. TinyFish Browser Agent Status

- **`example.com` structured extraction test**: PASS (`status: "COMPLETED"`, schema fields verified in `docs/tinyfish-notes.md`).
- **Real blocked-page retry (`psychology.stackexchange.com`)**: TIMED OUT (`$0.160 USD`), reported honestly in `demo/spend-log.md`. Browser Agent is **not** marked PASS on a real claim trace.

---

## 5. Automated Checks & Manual Browser Checklist

### Automated Checks Executed (Author's Machine Verification)
- **Offline Unit Tests**: `npm test --prefix server` -> 49/49 passing (zero network calls).
- **Real-Browser & Server E2E**: [`demo/e2e-chrome.mjs`](../demo/e2e-chrome.mjs) verifies `/health`, real SSE `/api/trace` streams (`cpi91`, `moore`, `coyotiv`), fail-closed guards (`/api/research` `400`, `/api/agent-retry` `403`), and headless Chrome rendering all gallery cards in [`demo/index.html`](../demo/index.html).
- **Honest Chrome CLI Limitation**: Branded Google Chrome and Microsoft Edge (`Chromium 137+`) block automated CLI `--load-extension` sideloading for security reasons, so loading the unpacked MV3 extension into an interactive Chrome window requires the manual Developer Mode steps below.

### Manual `chrome://extensions` Developer Mode Checklist (2 Minutes)
1. Start the local server with your TinyFish API key in `server/.env` (`TF_MODE` defaults automatically to `record`; in a fresh clone with an empty cache, `TF_MODE=replay` returns `"not recorded"`):
   ```powershell
   npm start --prefix server
   ```
   Confirm `http://127.0.0.1:8787/health` returns `"ok":true` and your active `"mode"` (`"record"` when keyed, `"replay"` when unkeyed or forced offline).
2. Open Chrome and navigate to `chrome://extensions`, toggle **Developer mode** ON (top right).
3. Click **Load unpacked** and select `source-hunter/extension/` (or extract `submission/source-hunter-extension.zip` and select that folder).
4. Open any article (or [`demo/index.html`](../demo/index.html)), highlight a claim sentence, and click the floating **Trace source** button (or press `Alt+Shift+T`).
5. Verify the Chrome Side Panel opens, streams progress, displays the verdict pill, Drift meter, verbatim hop quotes, checked/rejected disclosure, Light/Dark theme toggle, **Copy citation**, **Export Trail Card (PNG)** download, and **Copy debug report** (JSON).
