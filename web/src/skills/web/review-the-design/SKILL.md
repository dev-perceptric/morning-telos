---
name: review-the-design
description: Checks a draft or live page before it goes live: one main action per screen, the call to book on the first phone screen, headings that say what the business does, contrast, tap sizes, photo alt text, the page title and description, empty or broken sections and the brand. Lists up to 7 problems, biggest first, each with its fix, and offers to make the fixes in one approval. Use it when someone asks to "check the page", "review the design", "is this ready to publish" or "what's wrong with this page", and as the last step before asking to publish in build-on-framer, write-a-page, improve-a-page and design-a-page. Do not use it to design a new page (use design-a-page).
tools: search_knowledge, app_search_actions, app_action, wordpress_get_page, wordpress_get_post, wordpress_update_page, wordpress_update_post
metadata:
  source: Parts adapted from Anthropic's frontend-design skill (https://github.com/anthropics/skills), Apache License 2.0 (http://www.apache.org/licenses/LICENSE-2.0). Changed: shortened and rewritten as a checklist for small-business websites.
---
# Review the design

A short check of one page before it goes live: what would stop a visitor from booking, and the fix for each.

## When to use
- A page is built or changed and the owner is about to publish it.
- The owner asks if a page is ready, or why it doesn't get bookings.

## When not to use
- There is no page yet. Use design-a-page.

## What you have
- app_search_actions: shows which site builder is connected (Framer, Webflow, WordPress.com or Shopify) and each action's inputs.
- app_action: reads the page's structure at once, and makes the fixes. Fixes wait for the owner's approval.
- wordpress_get_page and wordpress_get_post: read a page or post on the owner's own WordPress site at once. wordpress_update_page and wordpress_update_post make the fixes there, after approval.
- search_knowledge: the facts to check the page against, and the site's text read at sign-up.
- The brand from match-the-brand, in the team's memory.
- You can't see the page as a picture. You check its structure, styles and words, and you say so.

## Steps
1. Find the page:
   - Framer: FRAMER_GET_UNPUBLISHED_PAGE_CHANGES for what changed, then FRAMER_SERIALIZE_FOR_AGENT or FRAMER_READ_PROJECT_FOR_AGENT for the page's layers, text, styles and phone layout.
   - Webflow: WEBFLOW_LIST_PAGES to find it, WEBFLOW_GET_PAGE for its title and description, WEBFLOW_GET_PAGE_DOM for its text, links and images.
   - WordPress.com: WORDPRESS_COM_GET_POST for the draft.
   - WordPress (the owner's own site): wordpress_get_page or wordpress_get_post for its block markup.
   - Shopify: SHOPIFY_GET_PAGE_BY_ID or SHOPIFY_GET_ARTICLE for its body_html.
   - Otherwise: the draft in this chat, the site text in Knowledge, or ask the owner to paste the page. Say the owner can connect Framer, Webflow, WordPress.com, WordPress or Shopify in Settings, Apps.
2. Check the page, phone first:
   - One main action per screen: one filled button, the rest plain links.
   - The call to book on the first phone screen, before any tall photo or long text.
   - The main heading says what the business does and where, not a slogan.
   - Contrast: text at least 4.5 to 1 on its background, large headings 3 to 1. Work it out from the hex codes.
   - Tap targets at least 44px tall, with room between them. Body text at least 16px on a phone.
   - Every photo has alt text that says what it shows. No stock photos of "our team" or "our work".
   - A page title under 60 characters and a description under 155, both naming the service and the place.
   - No empty sections, [fill in], sample text, broken links or buttons that go nowhere.
   - The brand: only its colors and fonts, the logo in place, the tone the same as the rest of the site.
   - Facts: every price, review, rating and award is in Knowledge (search_knowledge). Flag any that isn't.
3. Pick up to 7 problems, biggest first. Anything that stops a booking comes first.
4. Write each fix exactly: the new words, the new hex code, the alt text, the button label.
5. Offer to make all the fixes in one approval:
   - Framer: one FRAMER_APPLY_AGENT_CHANGES with every fix for the page. It stays unpublished.
   - Webflow: WEBFLOW_UPDATE_PAGE_METADATA for the title and description, and WEBFLOW_UPDATE_COLLECTION_ITEM_V2 with isDraft set to true for a blog post or CMS item. Other fixes stay in chat, ready to paste.
   - WordPress.com: WORDPRESS_COM_UPDATE_DRAFT_POST for a draft.
   - WordPress: one wordpress_update_page or wordpress_update_post with the fixed content. A draft stays a draft.
   - Shopify: one SHOPIFY_UPDATE_PAGE or SHOPIFY_UPDATE_ARTICLE with the fixed body_html. Leave published as it is.
   - None connected: the fixes in chat, ready to paste.
6. When nothing big is wrong, say the page is ready, so the skill that asked can ask the owner to publish.

## Output
- One line: **Ready to publish** or **Fix first**.
- Up to 7 problems, biggest first: what is wrong, where, and the fix.
- One line saying the check read the page's structure and words, not a picture of it.
- What waits for the owner's approval.

## Rules
- Never publish. The skill that asked does that, after the owner's OK.
- Never invent facts, reviews, prices or awards. A claim that isn't in Knowledge gets a [fill in].
- Change only what the problem list names. Never remove pages, sections or styles.
- Plain English, short sentences.
