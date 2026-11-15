# TinyFish API notes (verified against docs.tinyfish.ai & live calls, Nov 2026)

Auth for all endpoints: header `X-API-Key: <key>`.

| Endpoint | Call | Used for |
|---|---|---|
| Fetch | `POST https://api.fetch.tinyfish.ai` `{urls[<=10], format, purpose}` -> `{results[{url, final_url, title, text, published_date}], errors[{url, error}]}` | Reads every cited page; the claim wording must appear in `text` to count as a hop |
| Search | `GET https://api.search.tinyfish.ai?query=&purpose=&domain_type=&before_date=` -> `{results[{title, url, snippet, date, pdf_url}]}` | Looks for earlier/primary sources the page did not cite; `before_date` pushes it back in time |
| Agent | `POST https://agent.tinyfish.ai/v1/automation/run` `{url, goal, output_schema, browser_profile}` -> `{run_id, status, started_at, finished_at, num_of_steps, result, error}` | Fallback when Fetch is blocked or empty. Bills per step ($0.016/step); gated behind `ALLOW_AGENT=1` |
| Research | `POST https://agent.tinyfish.ai/v1/automation/run-research-async` `{query, mode}` -> `{research_run_id, error}` then `GET /v1/research-run/{id}` | Opt-in deep trace ($2/run after free quota); gated behind `ALLOW_RESEARCH=1` and `confirm: true` |
| Wallet | `GET https://agent.tinyfish.ai/v1/wallet` -> `{available_balance, currency, as_of, rates}` | Read-only balance and rate card verification (`demo/spend-log.md`) |

## Verified Live Response Shapes (Nov 2026)
- **Agent `/v1/automation/run`**: Returns `{ run_id, status: "COMPLETED", started_at, finished_at, num_of_steps, result: { ...schema fields... }, error: null }`. Verified on `https://example.com`.
- **Research `/v1/research-run/{id}` (COMPLETED)**: Returns `{ research_run_id, status: "COMPLETED", query, quick_result: { answer, citations, actions, stats }, deep_result: { result, citations, freshness_report, termination_reason }, evidence: [], research_plan, iterations }`.
  - **Key Finding**: `deep_result.citations` and `evidence` may be empty arrays even when `deep_result.result` contains markdown citation links like `[Wikipedia](https://en.wikipedia.org/wiki/Python_(programming_language))`. Our `collectCitations()` in `research.js` parses balanced-parenthesis markdown links directly from `deep_result.result` as well as `citations` and `evidence`.

## Credit-Safety & Rate Limits
- Research `deep` runs take **5-20 minutes** (`max`: 5-45) and cost **$2.00/run** after the daily allowance. Quick trace uses Fetch ($0.001/url) + Search ($0.005/query).
- **Record/Replay Layer (`TF_MODE=replay|record|live`, default `replay`)**: Every TinyFish call is hashed and saved in `server/.tfcache/` with `fetched_at`. In `replay` mode, zero network requests are ever made.
- **Budget Guard (`server/.tfcache/usage.json`)**: Hard daily UTC caps: `MAX_FETCH_URLS_PER_DAY=150`, `MAX_SEARCHES_PER_DAY=40`, `MAX_AGENT_CALLS_PER_DAY=3`, `MAX_RESEARCH_RUNS_PER_DAY=0`.
- **Dev-Mode Trace Limits**: Non-live modes cap `maxDepth=3`, `perHop=3`, 1 search query, and omit `research_paper` search.
