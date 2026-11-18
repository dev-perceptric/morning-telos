---
name: write-a-page
description: Writes a full website page for a service or a question people search for: title, headings, copy in the business's voice and a clear call to book, built around a keyword from the content plan, and puts it on the owner's Framer, Webflow or WordPress.com site as a draft when one is connected. Use it when someone asks "write a page", "write our services page", "landing page", "write the copy for" or "draft a blog post". Do not use it to fix a page that already exists (use improve-a-page).
tools: get_content_plan, keyword_research, get_prompt_answers, search_knowledge, update_content_plan, app_search_actions, app_action
---
# Write a page

A page ready to paste into the website: it answers what people search, sounds like the business, and ends with a call to book.

## When to use
- A new page, landing page or article is needed.
- A piece on the content plan is due.

## When not to use
- The page already exists and needs work. Use improve-a-page.
- They want a list of pages for the whole site. Use plan-the-site.

## What you have
- get_content_plan: the planned piece, its keyword, stage and the writer's notes.
- keyword_research: related searches to cover. 10 tasks a call, so use it at most once.
- get_prompt_answers: how AI tools answer the same question today, to cover what they look for.
- search_knowledge: services, prices, areas, hours and tone from the business's own words.
- update_content_plan: marks the piece as in review once the draft is ready. It waits for approval.
- app_search_actions: shows which site builder is connected (Framer, Webflow or WordPress.com) and each action's inputs.
- app_action: puts the page on the site as a draft or an unpublished change. It waits for approval.

## Steps
1. Find the piece on the content plan, or ask for the keyword if there isn't one.
2. Read the business facts with search_knowledge. Use only real prices, places and offers.
3. Check related searches or a matching AI answer to see what the page must cover.
4. Write the page: a title under 60 characters, a meta description under 155, an H1, 4 to 6 sections with H2s, short paragraphs and a FAQ of 3 questions.
5. End with a clear call to book or buy, with the real way to do it.
6. Check app_search_actions for a connected site builder, then put the page there with app_action:
   - Framer: follow build-on-framer. The page stays an unpublished change.
   - Webflow: a blog post or other CMS item with WEBFLOW_CREATE_COLLECTION_ITEM and is_draft set to true. Find the collection with WEBFLOW_LIST_COLLECTIONS first. Webflow can't design a new page, so a designed page stays in chat.
   - WordPress.com: a draft with WORDPRESS_COM_CREATE_DRAFT_POST. The owner publishes it in WordPress.
   - None connected: give the page in chat, and say the owner can connect Framer, Webflow or WordPress.com in Settings, Apps.
7. Offer to mark the piece as in review with update_content_plan.
8. Run review-the-design on the draft before you ask the owner to publish it.

## Output
- The page in Markdown, ready to paste.
- When a site builder is connected: where the draft is, and that it waits for the owner's approval.
- One line on the keyword and who it is for.

## Rules
- Never invent facts, prices, reviews or awards. Leave a [fill in] where a fact is missing.
- Never publish. Drafts and unpublished changes only, after the owner's approval.
- Plain English, short sentences.
