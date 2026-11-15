# TinyFish API Cost & Usage Reference

### Per-Call Rate Card
- **Search API (`api.search.tinyfish.ai`)**: ~$0.005 / query
- **Fetch API (`api.fetch.tinyfish.ai`)**: ~$0.001 / URL
- **Browser Agent (`agent.tinyfish.ai`)**: ~$0.016 / step
- **TinyResearch (`run-research-async`)**: $2.000 / deep run

### Project Usage Summary
- **Fetch Calls**: Used for extracting verbatim page passages, inline citations, and verifying search candidate hits.
- **Search Calls**: Used for discovering earlier primary sources and official releases when inline citations are absent.
- **Browser Agent**: 1 opt-in trial attempt on a bot-blocked page (timed out, marked incomplete).
- **TinyResearch**: 1 opt-in background deep run on the multi-hop plastic claim (12 proposed citation leads; 5 verified by Fetch, 7 discarded).
- **Offline Cache Replay**: $0.000 (0 API calls, sub-second deterministic replay across all 9 gallery traces).
