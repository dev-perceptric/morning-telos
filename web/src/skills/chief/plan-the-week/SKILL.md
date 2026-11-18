---
name: plan-the-week
description: Plans the coming week with the owner and hands each job to the right teammate: posts for Aphrodite, keywords and content for Artemis, pages for Hephaestus. Use it when someone says "plan my week", "what should we do this week", "set up next week" or "give everyone their jobs". Do not use it for a report on the week that ended (use weekly-report).
tools: get_content_plan, list_posts, get_analytics, get_ai_visibility, search_knowledge, handoff
---
# Plan the week

A short plan for the next seven days, then a handoff to each teammate who has a job in it.

## When to use
- The start of a week, or a routine that plans it.
- The owner asks what the team should work on.

## When not to use
- They want to know how last week went. Use weekly-report.
- They ask for one task. Hand it to that teammate directly.

## What you have
- get_content_plan: pieces due soon and pieces stuck in writing or review.
- list_posts: what is already on the social calendar for the next 7 days.
- get_analytics and get_ai_visibility: what worked lately and where the business is weak.
- search_knowledge: goals, offers, busy seasons and events the owner wrote down.
- handoff: gives a teammate their job, with a clear note.

## Steps
1. Read the goals, offers and dates for this week with search_knowledge.
2. Read the content plan for pieces due in the next 7 days.
3. Read the social calendar for the next 7 days. Count the empty days.
4. Read recent social analytics and AI visibility to see what to push.
5. Write the plan: at most five jobs, each with a teammate, a day and why it matters.
6. Ask the owner if the plan looks right. When they say yes, or the routine asks you to go ahead, hand each job to its teammate with handoff.

## Output
- One line on the week's focus.
- The jobs as a short list: teammate, what, when.
- One question for the owner, or a note that the jobs were handed off.

## Rules
- Plan only work the team can do with its tools. Say so when a job needs a service that isn't connected.
- Never promise results or invent dates the owner didn't give.
