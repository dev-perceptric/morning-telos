---
name: improve-a-page
description: Finds why an existing page isn't found on Google or named by AI tools, and rewrites the parts that matter: title, opening, headings, facts and calls to book, as an unpublished change or an approved update on the owner's Framer, Webflow, WordPress.com, WordPress or Shopify site when one is connected. Use it when someone asks "fix this page", "why doesn't this page rank", "improve our homepage", "update the copy" or gives a page address. Do not use it for a brand new page (use write-a-page).
tools: get_ai_crawlers, get_cited_sources, get_brand_presence, keyword_research, get_content_plan, update_content_plan, search_knowledge, app_search_actions, app_action, wordpress_list_pages, wordpress_get_page, wordpress_list_posts, wordpress_get_post, wordpress_update_page, wordpress_update_post, wordpress_add_draft_page
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
- app_search_actions: shows which site builder is connected (Framer, Webflow, WordPress.com or Shopify) and each action's inputs.
- app_action: reads the page from the site at once, and saves the new copy as an unpublished change or a draft. Changes wait for approval.
- wordpress_list_pages, wordpress_get_page, wordpress_list_posts and wordpress_get_post: read a page or post on the owner's own WordPress site at once.
- wordpress_update_page and wordpress_update_post: save the new copy there. They wait for approval, and a live page changes as soon as it is approved.
- wordpress_add_draft_page: a draft copy of the page to check first, with a preview link. It waits for approval.

## Steps
1. Read the page's text from the connected site builder with app_action (on WordPress, wordpress_list_pages or wordpress_list_posts, then wordpress_get_page or wordpress_get_post), or from Knowledge, or ask the owner to paste it.
2. Check get_ai_crawlers for whether AI bots read this page.
3. Check the keyword the page should win, with one keyword_research call if needed.
4. Compare with a page AI answers cite for the same topic (get_cited_sources).
5. List up to five problems, biggest first.
6. Rewrite the title, meta description, opening and the weakest sections. Keep what works.
7. Check app_search_actions for a connected site builder, then save the new copy there with app_action:
   - Framer: FRAMER_REPLACE_TEXT_FOR_AGENT for each changed line, or FRAMER_APPLY_AGENT_CHANGES for a bigger change, as in build-on-framer. It stays unpublished.
   - Webflow: WEBFLOW_UPDATE_COLLECTION_ITEM_V2 for a blog post or other CMS item, with isDraft set to true. For a page's search title and description, WEBFLOW_UPDATE_PAGE_METADATA. Other page copy stays in chat, ready to paste.
   - WordPress.com: WORDPRESS_COM_UPDATE_DRAFT_POST works only on drafts. For a published post, write a new draft with WORDPRESS_COM_CREATE_DRAFT_POST.
   - WordPress (the owner's own site): wordpress_update_page or wordpress_update_post. Tell the owner a live page changes as soon as they approve. For a big rewrite of a live page, offer a draft copy first with wordpress_add_draft_page and its preview link.
   - Shopify: SHOPIFY_UPDATE_PAGE or SHOPIFY_UPDATE_ARTICLE with the new body_html. Leave published as it is.
   - None connected: give the new copy in chat, and say the owner can connect Framer, Webflow, WordPress.com, WordPress or Shopify in Settings, Apps.
8. Run review-the-design on the changed page before you ask the owner to publish it.

## Output
- **What holds it back**: up to five points.
- **New copy**: each changed part, ready to paste.
- When a site builder is connected: what was saved there, and that it waits for the owner's approval.

## Rules
- Change only what helps. Don't rewrite a page that is mostly fine.
- Never invent facts. Leave a [fill in] where one is missing.
- Never publish. Unpublished changes and drafts only, after the owner's approval.
