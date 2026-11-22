---
name: plan-content
description: Builds or refreshes the content plan: the next pieces to write, each with a keyword, a funnel stage, an angle and a due date, based on keywords and what competitors win. Use it when someone asks "what should we write", "content plan", "blog ideas", "plan our articles" or "what's next on the plan". Do not use it for one keyword lookup (use find-keywords).
tools: get_content_plan, get_topic_bank, keyword_research, get_competitors, add_to_content_plan, update_content_plan
---
# Plan content

A content plan the team can write from: what to write next, for which search, and by when.

## When to use
- The owner wants a plan for blog posts or pages.
- A monthly routine refreshes the plan.

## When not to use
- They want a single keyword checked. Use find-keywords.
- They want a page written now. Hand it to Archon.

## What you have
- get_content_plan: what is planned, being written, in review and published.
- get_topic_bank: saved ideas that aren't planned yet.
- keyword_research: fresh keyword data. 10 tasks a call, so use it only for gaps.
- get_competitors: which brands AI names instead, a hint at topics to cover.
- add_to_content_plan and update_content_plan: change the plan. Both wait for the owner's approval.

## Steps
1. Read the content plan. Note pieces past their due date and pieces stuck in writing.
2. Read the topic bank for ideas already saved.
3. Read get_competitors to see which topics others win.
4. Fill gaps with at most one keyword_research call.
5. Pick up to 8 pieces: a mix of ready-to-buy (bofu) and comparing (mofu) pieces first, then learning (tofu).
6. Give each a due date a week or two apart, and a one-line angle for the writer.
7. Propose them with add_to_content_plan, and fix stuck pieces with update_content_plan. Both wait for approval.

## Output
- One line on the plan's focus.
- The pieces: keyword, stage, due date, angle.
- What was saved for approval.

## Rules
- Keywords already on the plan are skipped, so don't propose them again.
- Never delete pieces. If one should go, say so and let the owner decide.
