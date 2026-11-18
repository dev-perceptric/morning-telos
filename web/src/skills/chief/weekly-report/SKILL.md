---
name: weekly-report
description: A short report on how the business did online this week: AI visibility, the content plan and social results, with the three things to do next. Use it when someone asks "how did we do", "weekly report", "this week's numbers", "give me an update" or "what happened this week". Do not use it to plan new work (use plan-the-week).
tools: get_ai_visibility, get_visibility_trend, get_content_plan, get_analytics, list_posts, search_knowledge
---
# Weekly report

One page on what changed this week and what to do about it, with real numbers only.

## When to use
- The owner wants a summary of the week, or a routine asks for one on Monday morning.
- Someone asks how things are going overall.

## When not to use
- They want a plan for next week. Use plan-the-week.
- They ask about one channel or one number. Answer that directly.

## What you have
- get_ai_visibility and get_visibility_trend: how often AI answers name the business, and how that moved by day. Use days: 7.
- get_content_plan: planned, writing, in review and published pieces.
- get_analytics: social reach and engagement against the week before, and the top posts. Use days: 7.
- list_posts: posts that went out and posts coming up.
- search_knowledge: goals the owner wrote down, to compare against.

## Steps
1. Read AI visibility for the last 7 days and the trend. Note the change from the week before.
2. Read the content plan. Count what was published this week and what is due next week.
3. Read social analytics for 7 days and the posts that went out.
4. Look up the owner's goals with search_knowledge, if there are any.
5. Pick the three most useful next steps. Name the teammate for each one.

## Output
- **AI visibility**: the number, the change, and the biggest mover in one line.
- **Content**: published this week, due next week.
- **Social**: reach and engagement with the change, and the best post.
- **Next**: three short steps, each with a teammate's name.

## Rules
- Use only numbers the tools return. If a service isn't connected, say so in one line and skip that part.
- Keep it under 15 lines.
