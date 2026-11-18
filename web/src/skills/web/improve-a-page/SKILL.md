---
name: improve-a-page
description: Finds why an existing page isn't found on Google or named by AI tools, and rewrites the parts that matter: title, opening, headings, facts and calls to book. Use it when someone asks "fix this page", "why doesn't this page rank", "improve our homepage", "update the copy" or gives a page address. Do not use it for a brand new page (use write-a-page).
tools: get_ai_crawlers, get_cited_sources, get_brand_presence, keyword_research, get_content_plan, update_content_plan, search_knowledge
---
# Improve a page

A short list of what holds a page back, then the new copy for the parts worth changing.

## When to use
- The owner names a page that isn't working.
- A content plan piece is set to update an existing page.

## When not to use
- The page doesn't exist yet. Use write-a-page.

## What you have
- get_ai_crawlers: whether AI bots read the site, and key pages they skipped.
- get_cited_sources: pages AI answers link to, to compare against.
- get_brand_presence: missing listings that make AI tools less sure about the business.
- keyword_research: the searches the page should answer. 10 tasks a call.
- get_content_plan and update_content_plan: the piece for this page and its notes. Changes wait for approval.
- search_knowledge: the business's facts and the page text if it was read from the website.

## Steps
1. Read the page's text from Knowledge, or ask the owner to paste it.
2. Check get_ai_crawlers for whether AI bots read this page.
3. Check the keyword the page should win, with one keyword_research call if needed.
4. Compare with a page AI answers cite for the same topic (get_cited_sources).
5. List up to five problems, biggest first.
6. Rewrite the title, meta description, opening and the weakest sections. Keep what works.

## Output
- **What holds it back**: up to five points.
- **New copy**: each changed part, ready to paste.

## Rules
- Change only what helps. Don't rewrite a page that is mostly fine.
- Never invent facts. Leave a [fill in] where one is missing.
