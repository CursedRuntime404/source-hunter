# Source Hunter — 2-Minute Demo Script

Target runtime: **2:00** (calm pace, zero dead air).  
Environment: Chrome browser with Source Hunter side panel open; local Node server running (`TF_MODE=replay` for instant, reliable recorded gallery playback; `TF_MODE=record` for live demonstration).

---

### [0:00 – 0:25] Scene 1: Primary Source Trace & Verbatim Verification
- **Trace ID**: `cpi91`
- **Mode**: `REPLAY` (`TF_MODE=replay`, on-screen badge `RECORD` inactive / `REPLAY`)
- **URL to open**: `https://www.cnbc.com/2022/07/13/inflation-rose-9point1percent-in-june-even-more-than-expected-as-price-pressures-intensify.html`
- **Exact text to highlight**: `"The consumer price index increased 9.1% from a year ago in June"`
- **On-screen action**: Highlight sentence, click floating "Trace source" button or press `Alt+Shift+T`.
- **On-screen panel values**:
  - Verdict badge: **`MATCH`** (green), subtitle badge: `likely primary source`
  - Headline: `"Matches the likely primary source"`
  - Drift meter: **`Match (1/5)`** (chips: `Primary: 9.1 percent` $\to$ `Your page: 9.1%`, scale: `Exact`)
  - Origin host & date: `bls.gov`, `2022-07-18`
  - Origin quote: `"Over the 12 months ended June 2022, the Consumer Price Index for All Urban Consumers increased 9.1 percent."`
  - Origin note: `"Origin note (bls.gov, 2022-07-18): an earlier official release is listed below (dol.gov, 2022-07-13)."`
  - Checked line: `Checked: 6 pages opened · 1 search`, `2 cited pages rejected`
  - Click **Export PNG** to display the generated 1200x630 editorial Trail Card.
- **Spoken**: "When you read a headline figure online, you need to know where it came from and whether it drifted. Highlight the sentence, click Trace source, and Source Hunter traces the citation chain back to the official Bureau of Labor Statistics release, verifying every quote verbatim."

---

### [0:25 – 0:45] Scene 2: Saved Deep Trace Results & Press Release Disclosure
- **Trace ID**: `plastic`
- **Mode**: `REPLAY`
- **URL to open**: `https://environmental-action.org/articles/8-million-tons-of-plastic-pollution-each-year/`
- **Exact text to highlight**: `"Each year, approximately 8 million metric tons of plastic waste make their way into our world’s oceans."`
- **On-screen action**: Inspect the trace results. Do NOT click "Run deep trace" live (costs ~$2.00 in live API credits). View the saved TinyResearch findings box.
- **On-screen panel values**:
  - Saved TinyResearch summary: `12 proposed, 5 confirmed, 7 discarded by Fetch`
  - Verdict badge: **`MATCH`** (amber), subtitle badge: `institutional press release about the study`
  - Headline: `"Earliest page found is a press release"`
  - Drift meter: **`Match (1/5)`**
  - Origin host & date: `news.ucsb.edu`, `2015-02-12`
  - Origin quote: `“Using the average density of uncompacted plastic waste, 8 million metric tons — the midpoint of our estimate — would cover an area 34 times the size of Manhattan ankle-deep in plastic waste,” said co-author Roland Geyer, an associate professor at the Bren School of Environmental Science & Management.`
  - Checked line: `Checked: 21 pages opened · 1 search`, `8 cited pages rejected`
- **Spoken**: "When starting links end at a secondary summary, opt-in TinyResearch can explore deeper leads. Here we display a saved run where TinyResearch evaluated 12 proposed sources, confirming 5 and discarding 7 via Fetch. Because the earliest confirmed page is the university press release rather than the journal paper, Source Hunter discloses that it is a press release, not primary research."

---

### [0:45 – 1:05] Scene 3: Uncited Secondary & Scope Difference
- **Trace ID**: `clean38`
- **Mode**: `REPLAY`
- **URL to open**: `https://interestingengineering.com/innovation/clean-energy-record-38`
- **Exact text to highlight**: `"renewable sources met 38 percent of global energy demand"`
- **On-screen action**: Trace claim.
- **On-screen panel values**:
  - Start page & earliest page: `interestingengineering.com`, `2022-03-30`
  - Verdict badge: **`UNCITED`** (amber), subtitle badge: `secondary source`
  - Headline: `"Earliest page found cites no source; original not found"`
  - Drift meter: **`Uncited secondary match (2/5)`**
  - Origin host & date: None (earliest found is `interestingengineering.com`, `2022-03-30`)
  - Origin quote: `"renewable sources met 38 percent of global energy demand"`
  - alsoFound entry: `earth.org` (`2022-12-16`, quote: `"Renewable Energy Sources Generated 38% of Global Electricity in 2021"`)
  - Scope flag: `"Scope narrower than claimed: claim says "energy" while this source says "electricity""`
  - Checked line: `Checked: 6 pages opened · 1 search`, `4 cited pages rejected`
- **Spoken**: "Here interestingengineering.com states that clean sources met 38% of energy demand. The page cites no source, and search found no earlier primary report. However, earth.org is listed under other findings stating 38% of global electricity. Source Hunter assigns an amber UNCITED badge and flags the scope difference."

---

### [1:05 – 1:25] Scene 4: Debunking Disputed Claims
- **Trace ID**: `brain10`
- **Mode**: `REPLAY`
- **URL to open**: `https://www.scientificamerican.com/article/do-people-only-use-10-percent-of-their-brains/`
- **Exact text to highlight**: `"humans "only" employ 10 percent of their brain"`
- **On-screen action**: Trace claim.
- **On-screen panel values**:
  - Verdict badge: **`DISPUTED`** (red), subtitle badge: `journal news or commentary (secondary)`
  - Headline: `"The source page disputes this claim"`
  - Drift meter: **`Disputed by source`** (Meter scale displays **`Disputed`**, not a number)
  - Origin host & date: `nature.com`, `2003-02`
  - Origin quote: `"We only use 10% of our brains. Advertising executives know it, self-help authors know it, and so do many ordinary people."`
  - Disputing quote box: `"Academics may be tempted to wonder whether those who continue to spread this stubborn myth really do use less of their brains than the rest of us."` (`nature.com, 2003-02`)
  - Checked line: `Checked: 7 pages opened · 1 search`, `2 cited pages rejected`
- **Spoken**: "Context is critical. When tracing the ten-percent brain claim, the algorithm scans for dispute cues in the text. Finding the word 'myth' in Nature Neuroscience, it marks DISPUTED and switches the drift meter to 'Disputed by source', displaying the exact disputing passage verbatim."

---

### [1:25 – 1:45] Scene 5: Honest `NO_SOURCE` & Debug Transparency
- **Trace ID**: `coyotiv`
- **Mode**: `REPLAY`
- **URL to open**: `https://coyotiv.com/blog/from-coder-to-architect-learning-software-engineering-in-the-age-of-ai/`
- **Exact text to highlight**: `"They spent 80% of their time laying bricks — writing boilerplate code, debugging syntax, configuring environments — and only 20% designing the skyscraper."`
- **On-screen action**: Trace claim, then click **Copy debug report**.
- **On-screen panel values**:
  - Verdict badge: **`NO_SOURCE`** (neutral grey)
  - Headline: `"No original source found"`
  - Drift meter: **`Untraceable — no original source found`**
  - Origin quote: `"They spent 80% of their time laying bricks — writing boilerplate code, debugging syntax, configuring environments — and only 20% designing the skyscraper."`
  - Checked line: `Checked: 7 pages opened · 1 search`, `6 cited pages rejected`
  - Footer button: Click **Copy debug report**, button label updates to green **`Copied`**.
- **Spoken**: "Source Hunter never hallucinates an origin. On this blog claim, it checked 7 pages and 1 search, rejected all 6 irrelevant hits, and stopped at NO_SOURCE. In the footer, 'Copy debug report' copies the complete JSON trace report for full transparency."

---

### [1:45 – 2:00] Scene 6: Live Trace (`TF_MODE=record`) & 10-Second Fallback
- **Trace ID**: `live-demo`
- **Mode**: `LIVE` (`TF_MODE=record`, on-screen badge shows active `RECORD`)
- **Note**: Choose a news or health article with a statistic that has a source link next to it; rehearse it once in record mode before filming.
- **Exact text to highlight**: The target sentence with a statistic and adjacent source link.
- **On-screen action**: Highlight sentence, press `Alt+Shift+T`.
- **On-screen text**:
  - Progress tracker streams stages live: `Connecting to trace server…` $\to$ `Reading starting page citations…` $\to$ `Searching for earlier reports…`
  - *10-Second Fallback Note*: If an external live network fetch encounters latency exceeding 10 seconds, the progress bar and timer indicate ongoing retrieval before gracefully displaying results or falling back to cached replay data.
- **Spoken**: "In live mode with TF_MODE=record, Source Hunter connects directly to TinyFish APIs, respecting daily request caps and timeout guards. If a live trace encounters slow pages, it streams progress and ensures tracing remains deterministic and credit-safe."
