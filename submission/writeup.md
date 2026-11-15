# Source Hunter — Bounty Submission

Source Hunter is a zero-dependency Chrome MV3 extension and local Node server that traces online claims, numbers, and quotes back to earlier sources, verifying every quote verbatim.

### How TinyFish APIs Are Used
1. **Fetch (`api.fetch.tinyfish.ai`)**: Reads highlighted pages, cited links, and footnote targets. Extracts verbatim text and publication dates. If a page does not contain the claim, it is rejected.
2. **Search (`api.search.tinyfish.ai`)**: Queries earlier primary reports and government releases before the publication date to locate earlier sources (e.g. US CPI on bls.gov, Moore's 1965 paper on gatech.edu).
3. **Browser Agent (`agent.tinyfish.ai`)**: Opt-in fallback for blocked pages. Only the example.com structured test passed; the one real blocked-page attempt timed out ($0.160 USD) and is not marked passing on a real trace.
4. **TinyResearch (`run-research-async`)**: Background deep trace for multi-hop leads. One deep run on the plastic claim; it did not reach the Science paper; citations were re-verified by Fetch (5 confirmed, 7 discarded), finding a university press release.

### Deterministic Engine & Speed
Verdicts (`MATCH`, `ROUNDED`, `SCOPE`, `YEAR`, `HEDGE_DROPPED`, `DISPUTED`, `UNCITED`, `NO_SOURCE`, `PRIMARY_PUBLISHER`) are computed deterministically. Secondary pages and press releases are never labeled "original". Recognized primary publishers (e.g. who.int) citing no earlier source are reported as the primary source. Execution time is 26ms–640ms in offline replay across 9 recorded traces and 10s–40s for live multi-hop traces. Daily caps in server/.tfcache/usage.json prevent accidental spend. When searches find no source, it reports honestly: no source found.
