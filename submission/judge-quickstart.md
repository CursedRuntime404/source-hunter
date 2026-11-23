# Source Hunter — Judge Quickstart Guide

This guide gives judges three clear ways to evaluate Source Hunter, from a 30-second zero-install inspection to live tracing with your own TinyFish API key.

---

### Path A: Zero-Install Interactive Showcase (30 Seconds)

If you have 30 seconds and want to evaluate the project immediately without installing anything:

1. Open the live gallery at [https://cursedruntime404.github.io/source-hunter/demo/](https://cursedruntime404.github.io/source-hunter/demo/) in any web browser, or open [`demo/index.html`](../demo/index.html) locally if you cloned the repository.
2. **What to inspect:**
   - **10 Real-World Traces:** Matches (`cpi91`, `plastic`), drift and rounding (`apple` Form 10-K, `moore` 1965 paper), disputed myths (`brain10`, `marie`), uncited claims (`clean38`), an uncited engineering blog with no source (`coyotiv`), a recognized primary publisher (`who.int`), and deep trace contradiction on global data creation (`data90`).
   - **Visual Language:** Stamp verdict badges, verbatim quote diffs with `<mark>` tags, animated vertical trails with dashed red break indicators, and 1-5 Drift Meters.
   - **Interactive Controls:** Filter by verdict category, toggle Dark/Light themes (in-memory), and inspect the 4-column architecture footer with honest capability limits.
   - **Embedded Trace Data:** All 10 traces load instantly with zero installation or network calls from self-contained recorded trace data embedded directly in the page.

---

### Path B: Chrome Extension & Live Tracing with Your Own TinyFish Key (5 Minutes)

If you want to run the real Chrome extension on live web pages using your own TinyFish key:

> **Important Note on the Extension & Local Cache:**  
> The author's recorded responses (`server/.tfcache/`) are not published in this public repository for privacy and copyright compliance. Therefore, **the Chrome extension requires a TinyFish API key to trace claims**. Without an API key, an unkeyed server runs in `TF_MODE=replay`, which only replays what your own machine has already cached. On a fresh clone with an empty cache, every claim returns `"not recorded; rerun with TF_MODE=record"`.  
> To test the extension, add your TinyFish key to `server/.env`. `TF_MODE` defaults automatically to `record`: each new trace calls TinyFish live (costing a few cents each), caches responses locally on your machine, and enforces daily spend caps.

#### 1. Start the Local Server
```bash
git clone <repo-url>
cd source-hunter/server
cp .env.example .env    # On Windows: copy .env.example .env
```
Add your key to `server/.env`:
```ini
TINYFISH_API_KEY=your_key_here
PORT=8787
```
Run tests and start the server:
```bash
npm test     # 49 offline unit & regression tests pass (zero network calls)
npm start    # Starts http://localhost:8787 in TF_MODE=record
```
*Note:* When `TINYFISH_API_KEY` is set, `TF_MODE` defaults automatically to `record`. Cache hits on your own machine cost **$0.000**, while new pages call live TinyFish APIs (enforcing daily hard caps in `server/.tfcache/usage.json`) and record responses for future replay.

#### 2. Load the Chrome Extension
1. Open Google Chrome and navigate to `chrome://extensions`.
2. Turn ON **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked** and select the [`extension/`](../extension/) folder from this repository (or unzip `submission/source-hunter-extension.zip`).
4. *(Optional)* Check or customize the `Alt+Shift+T` shortcut anytime at `chrome://extensions/shortcuts`.

#### 3. Trace a Claim
1. Open any web article, Wikipedia page, or financial report.
2. Highlight a sentence containing a number, claim, or quote.
3. Click the floating **Trace source** button, right-click and select **Trace this claim with Source Hunter**, or press <kbd>Alt+Shift+T</kbd>.
4. The Chrome side panel opens, streams verification progress in real time, and renders the verdict card, vertical provenance trail, and exportable 1200x630 Trail Card PNG.

#### 4. Expected Cost per Trace
- **Standard Trace (1 search + 2–6 page fetches):** **~$0.007 to $0.015 USD** (TinyFish rate: ~$0.005 per search, ~$0.001 per fetch URL).
- **Local Cache Replay (Pages previously fetched on your machine):** **$0.000 USD** (0 credits).
- **Opt-In Browser Agent Retry:** ~$0.016 per step (disabled by default; capped at 3 calls/day in `usage.json`).
- **Default TinyResearch Deep Trace:** ~$2.000 flat per run (defaults ON when keyed, capped at 3 runs/day in `usage.json`; can be toggled OFF in Extension Settings or via `ALLOW_RESEARCH=0`).
- **Credit Safety:** Daily hard caps in `server/.tfcache/usage.json` (`MAX_FETCH_URLS_PER_DAY=150`, `MAX_SEARCHES_PER_DAY=40`, `MAX_RESEARCH_RUNS_PER_DAY=3`) ensure live testing never runs up unexpected charges.

---

### Path C: What to Expect When a Claim Has No Source (Honesty in Action)

Source Hunter is designed never to hallucinate citations. To verify how it handles claims with no verifiable origin:

1. **Test Claim:** Highlight an uncited blog statement, such as the Coyotiv engineering quote:  
   *“They spent 80% of their time laying bricks... and only 20% designing the skyscraper”* (from `coyotiv.com`).
2. **What the Engine Does:**
   - TinyFish Fetch reads the starting page and checks for inline citations.
   - When no inline citation exists, TinyFish Search queries the web for earlier instances of the statement.
   - Candidate hits are fetched and checked verbatim. Unrelated or unreadable pages are rejected.
3. **The Resulting State:**
   - **Verdict Badge:** Neutral grey **`NO_SOURCE`** badge.
   - **Headline:** `"No original source found"`
   - **Explanation:** States plainly that the starting page gives no citation, and candidate search hits did not state the claim.
   - **Checked Line:** Displays the exact count of pages inspected and rejected (e.g. `5 pages opened, 1 search, 4 rejected`).
   - **Rejected Pages Drawer:** Expandable list showing every URL checked and why it was rejected (`"page does not state this claim"`).
   - **Debug Report:** Click **Copy debug report** in the footer to copy the sanitized JSON report containing the full audit log, timings, and usage counters without any API keys or tokens.
