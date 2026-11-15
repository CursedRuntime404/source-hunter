# Source Hunter — Judge Quickstart Guide

This guide gives judges three clear ways to evaluate Source Hunter, from a 30-second zero-install inspection to live tracing with your own TinyFish API key.

---

### Path A: Zero-Install Interactive Showcase (30 Seconds)

If you have 30 seconds and want to evaluate the project immediately without installing anything:

1. Open [`demo/index.html`](../demo/index.html) directly in Chrome, Edge, Safari, or Firefox.
2. **What to inspect:**
   - **9 Real-World Traces:** Matches (`cpi91`, `plastic`), drift and rounding (`apple` Form 10-K, `moore` 1965 paper), disputed myths (`brain10`, `marie`), uncited claims (`clean38`), an uncited engineering blog with no source (`coyotiv`), and a recognized primary publisher (`who.int`).
   - **Visual Language:** Stamp verdict badges, verbatim quote diffs with `<mark>` tags, animated vertical trails with dashed red break indicators, and 1-5 Drift Meters.
   - **Interactive Controls:** Filter by verdict category, toggle Dark/Light themes (in-memory), and inspect the 4-column architecture footer with honest capability limits.
   - **No Network Calls:** All traces load instantly (26ms–640ms) from recorded verification JSON.

---

### Path B: Chrome Extension & Live Tracing with Your Own TinyFish Key (5 Minutes)

If you want to run the real Chrome extension on live web pages using your own TinyFish key:

#### 1. Start the Local Server
```bash
git clone <repo-url>
cd source-hunter/server
cp .env.example .env    # On Windows: copy .env.example .env
```
Add your key to `server/.env`:
```ini
TINYFISH_API_KEY=
PORT=8787
```
Run tests and start the server:
```bash
npm test     # 42 offline unit & regression tests pass (0 network calls)
npm start    # Starts http://localhost:8787 in TF_MODE=record
```
*Note:* When `TINYFISH_API_KEY` is set, `TF_MODE` defaults automatically to `record`. Cache hits in `server/.tfcache/` cost **$0.000**, while new pages call live TinyFish APIs and record responses for future replay.

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
- **Cache Replay (Previously inspected pages):** **$0.000 USD** (0 credits).
- **Opt-In Browser Agent Retry:** ~$0.016 per step (disabled by default; capped at 3 calls/day in `usage.json`).
- **Opt-In TinyResearch Deep Run:** $2.000 flat (disabled by default; requires `ALLOW_RESEARCH=1` and `confirm: true`).
- **Credit Safety:** Daily hard caps in `server/.tfcache/usage.json` (`MAX_FETCH_URLS_PER_DAY=150`, `MAX_SEARCHES_PER_DAY=40`) ensure live testing never runs up unexpected charges.

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
