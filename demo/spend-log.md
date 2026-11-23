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
- **TinyResearch**: 2 deep runs: (1) plastic pollution claim (12 proposed citation leads; 5 verified by Fetch, 7 discarded); (2) 90% world's data claim (12 proposed citation leads; 4 verified by Fetch, 8 discarded; origin Oracle whitepaper contradicted).
- **Offline Cache Replay**: $0.000 (0 API calls, sub-second deterministic replay across all 10 gallery traces).
