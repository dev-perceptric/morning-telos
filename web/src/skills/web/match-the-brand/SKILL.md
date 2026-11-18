---
name: match-the-brand
description: Collects the business's brand before any design work: the logo, colors as hex codes, fonts, photo style and tone, from Knowledge, the owner's current site and the styles in Framer, then saves it to the team's memory so every later page uses it. Use it when someone asks to "use our brand", "match our colors", "set up our brand", "what are our brand colors", or before design-a-page when the brand isn't in memory yet. Do not use it to lay out a page (use design-a-page) or to check one (use review-the-design).
tools: search_knowledge, app_search_actions, app_action, remember
---
# Match the brand

One short brand card for the business, saved so the whole team uses the same logo, colors, fonts and tone on every page.

## When to use
- Before the first page is designed or built.
- The owner changed the logo, colors or fonts.
- A page doesn't look like the rest of the site.

## When not to use
- The brand is already in memory and nothing changed. Use it as it is.
- They want a page laid out or checked. Use design-a-page or review-the-design.

## What you have
- search_knowledge: the business's words and tone, and any brand notes or files the team added. The site text read at sign-up holds words, not colors or fonts.
- app_search_actions: shows which site builder is connected (Framer, Webflow or WordPress.com) and each action's inputs.
- app_action: reads the site's styles and pages at once. Here you only read.
- remember: saves each part of the brand to the team's memory. It needs no approval, so show the owner first.

## Steps
1. Check memory first. If the brand is there and the owner hasn't changed it, use it and stop.
2. Search Knowledge with search_knowledge for brand, logo, colors, fonts and tone.
3. Check app_search_actions for a connected site builder, and read it with app_action:
   - Framer: FRAMER_GET_AGENT_CONTEXT lists the project's color styles and text styles. FRAMER_READ_PROJECT_FOR_AGENT and FRAMER_GET_NODES_WITH_TYPE find the logo and the photos.
   - Webflow: find the homepage with WEBFLOW_LIST_PAGES, then read WEBFLOW_GET_PAGE_DOM for the logo, the photos and their alt text. Webflow doesn't share its colors or fonts here.
   - WordPress.com: WORDPRESS_COM_GET_SITE_OVERVIEW for the site's name and tagline.
   - None connected: use Knowledge and ask the owner. Say they can connect Framer in Settings, Apps, so the team can read the site's styles.
4. Write the brand card:
   - Logo: where the file is, and whether there is a light and a dark version.
   - Colors: each hex code and its job (main, text, background, accent).
   - Fonts: the heading font and the body font.
   - Photos: what they show, real or stock, bright or dark.
   - Tone: three words, plus one sentence the business really wrote.
5. Mark what you couldn't find, and ask the owner for it in one short message. They can send the logo file or a brand guide, or add it on the Knowledge page.
6. Show the card to the owner. Once they agree, save it with remember, one part per fact, like "Brand colors: main #1F4E79 for buttons, text #1A1A1A, background #FFFFFF."

## Output
- The brand card: logo, colors, fonts, photos and tone.
- What was saved to memory.
- What is still missing, as one short question to the owner.

## Rules
- Never invent a logo, colors or fonts. Never guess a hex code from a photo or the type of business. Ask the owner.
- Use only what the owner's site, files and words show.
- Save only what the owner agreed to.
- Never change styles on the site here. Read only.
- Never invent facts, reviews, prices or awards.
- Plain English, short sentences.
