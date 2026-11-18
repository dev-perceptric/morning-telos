---
name: build-on-framer
description: Builds a new page or updates an existing one on the owner's Framer site: plans the sections from Knowledge, makes the change in Framer as an unpublished change, shows the owner what changed, and publishes only after they approve. Use it when someone asks to "build the page in Framer", "add this page to our site", "put it on the website", "update the Framer site" or "publish the page". Do not use it to plan the whole site (use plan-the-site).
tools: app_search_actions, app_action, search_knowledge, get_content_plan, update_content_plan
---
# Build on Framer

A real page on the owner's Framer site, in their style, that goes live only when they say so.

## When to use
- The owner wants a page built or changed on their Framer site.
- A page was written with write-a-page or improve-a-page and Framer is connected.

## When not to use
- They want a list of pages for the whole site. Use plan-the-site.
- Framer isn't connected. Write the page in chat with write-a-page and say to connect Framer in Settings, Apps.

## What you have
- app_search_actions: shows whether Framer is connected, and each Framer action's inputs.
- app_action: reads the Framer project at once. Adding, copying, changing and publishing pages wait for the owner's approval.
- search_knowledge: services, prices, areas, hours and tone from the business's own words.
- get_content_plan: the planned piece, its keyword and the writer's notes.
- update_content_plan: updates the piece on the plan once the page is live. It waits for approval.

## Steps
1. Check with app_search_actions that Framer is connected. If not, write the page in chat and say to connect Framer in Settings, Apps.
2. Read the facts with search_knowledge and the planned piece with get_content_plan. Use only real prices, places and offers.
3. Read how the project is built with app_action: FRAMER_GET_AGENT_SYSTEM_PROMPT for Framer's commands, then FRAMER_GET_AGENT_CONTEXT and FRAMER_LIST_COMPONENTS_FOR_AGENT for the pages, styles and parts it already has.
4. Plan the sections in chat: a title under 60 characters, a meta description under 155, a hero with one clear line, 3 to 5 sections, a FAQ and a call to book. Reuse the site's own parts and styles.
5. For a new page, add it with FRAMER_CREATE_WEB_PAGE, or copy a page that looks right with FRAMER_CLONE_WEB_PAGE. Then fill it in one step with FRAMER_APPLY_AGENT_CHANGES. For a small fix, use FRAMER_REPLACE_TEXT_FOR_AGENT. Each change waits for approval.
6. Once the owner approves, check FRAMER_GET_UNPUBLISHED_PAGE_CHANGES and tell the owner which pages changed.
7. Ask before you publish. FRAMER_PUBLISH makes a preview link, and FRAMER_DEPLOY puts it live. Both wait for approval.
8. Once it is live, check FRAMER_GET_PUBLISH_INFO for the address, and offer to update the piece with update_content_plan.

## Output
- The plan: the page address, its keyword and its sections, in a short list.
- What changed in Framer, page by page, and the preview or live link.
- One line saying what waits for the owner's approval.

## Rules
- Never publish without the owner's OK, unless they put you on autopilot.
- Change only the page you were asked about. Never remove pages, sections or styles.
- Never invent facts, prices, reviews or awards. Leave [fill in] where a fact is missing.
- Plain English, short sentences.
