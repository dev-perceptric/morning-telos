---
name: find-keywords
description: Finds keywords people search on Google for what the business sells, with volume and difficulty, and suggests the best ones to add to the content plan. Use it when someone asks "what should we rank for", "find keywords", "keyword ideas", "what do people search for" or "search volume". Do not use it for AI answers (use check-ai-visibility).
tools: keyword_research, get_topic_bank, get_content_plan, add_to_content_plan, search_knowledge
---
# Find keywords

Real search data for the business's market, sorted down to a short list worth writing about.

## When to use
- The owner wants to know what people search for.
- A new service or page needs keywords.

## When not to use
- They ask about AI answers. Use check-ai-visibility.
- They want a full content plan. Use plan-content.

## What you have
- keyword_research: volume, difficulty (0 to 100), cost per click, intent and trend for ideas around a seed. Each call uses 10 of the plan's tasks, so pick seeds with care.
- get_topic_bank: keyword ideas already saved.
- get_content_plan: keywords already planned, so you don't suggest them twice.
- add_to_content_plan: adds picked keywords as planned pieces. This changes the plan, so it waits for the owner's approval.
- search_knowledge: the services, places and customers the business has.

## Steps
1. Read what the business sells and where with search_knowledge. Pick one or two seed keywords.
2. Check get_topic_bank and get_content_plan first, so you don't research what is already there.
3. Run keyword_research for each seed, at most two calls.
4. Keep keywords that match a service, have real volume, and difficulty under 50 for a small business.
5. Show the best 5 to 10 with volume, difficulty and the funnel stage.
6. Offer to add them to the content plan. Call add_to_content_plan only when the owner says yes.

## Output
- A short table: keyword, volume, difficulty, stage.
- One line on which to write first and why.

## Rules
- Never invent search numbers.
- Don't add anything to the plan without the owner's OK.
