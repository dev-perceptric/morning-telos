---
name: design-a-page
description: Plans how a page looks and is laid out so visitors book: the order of the sections, the words and photo in each, type sizes, colors from the brand, spacing and the call to book, phone first. Builds the layout on the owner's Framer site as an unpublished change when Framer is connected. Use it when someone asks to "design a page", "lay out the homepage", "redesign this page", "make the site look better" or "make it look less generic". Do not use it to collect the brand (use match-the-brand), to check a page before it goes live (use review-the-design) or when only the words need work (use write-a-page or improve-a-page).
tools: search_knowledge, get_content_plan, app_search_actions, app_action
metadata:
  source: Parts adapted from Anthropic's frontend-design skill (https://github.com/anthropics/skills), Apache License 2.0 (http://www.apache.org/licenses/LICENSE-2.0). Changed: shortened and rewritten for small-business websites.
---
# Design a page

A plan for one page, section by section, that turns visitors into bookings: what each part says, what it shows and how it sits on a phone.

## When to use
- A new page needs a layout before it is built.
- A page looks generic, busy or hard to use on a phone.

## When not to use
- The brand isn't in memory yet. Run match-the-brand first.
- The page is built and needs a check before it goes live. Use review-the-design.
- Only the words need work. Use write-a-page or improve-a-page.

## What you have
- search_knowledge: services, prices, areas, hours, reviews and tone in the business's own words.
- get_content_plan: the planned piece, its keyword and the writer's notes.
- app_search_actions: shows which site builder is connected (Framer, Webflow or WordPress.com) and each action's inputs.
- app_action: reads the Framer project at once, and builds the layout there as an unpublished change. Each change waits for the owner's approval.
- The brand from match-the-brand, in the team's memory.

## Steps
1. Check the brand in memory. If the logo, colors or fonts are missing, run match-the-brand first.
2. Read the facts with search_knowledge and the piece with get_content_plan. Note what is real: reviews, rating, years in business, jobs done, the owner's photos and the way to book.
3. Name the page's one job (book, call or ask for a quote) and the one line that says what the business does and where.
4. Plan the sections in this order. Drop any with no real content:
   - Hero: what the business does in one line, the area, one button to book and a real photo of the work, the place or the team.
   - Proof: the star rating, the number of reviews or one number that matters, right under the hero.
   - Services: one short block each, with the price or "from" price when Knowledge has it.
   - How it works: 3 steps, only if booking really has steps.
   - More proof: two or three real reviews with a first name and town, or before and after photos.
   - FAQ: 3 to 5 questions customers really ask.
   - Book or contact: the button again, with the phone number, hours and address.
5. Set the look from the brand:
   - Type: one or two fonts. Body text 16 to 18px, headings about twice that, 3 or 4 sizes in all. Lines under about 75 characters.
   - Color: the main brand color for buttons and little else, a dark text color, a light background and one soft fill. Text needs contrast of at least 4.5 to 1, or 3 to 1 for large headings.
   - Spacing: a steady 8px grid, with more space between sections than inside them.
   - Buttons: filled, at least 44px tall, with a label that says what happens, like "Book a cleaning". One main button per screen.
   - Photos: the owner's real photos first. Never stock photos for "our team" or "our work". Every photo gets alt text.
6. Plan for the phone first: one column, the button on the first screen, tap targets with room between them. Keep it fast: two fonts at most, small photo files, no video that plays on its own.
7. Check the plan for the generic AI look and change what you find: everything centered, purple or blue gradients, emoji, vague slogans like "Elevate your experience", three matching icon cards, small capital labels over every heading, numbers nobody gave you. Keep one bold thing, like a big photo or the headline, and keep the rest quiet.
8. Check app_search_actions for a connected site builder:
   - Framer: build it the way build-on-framer does. Read the project with app_action (FRAMER_GET_AGENT_SYSTEM_PROMPT, FRAMER_GET_AGENT_CONTEXT, FRAMER_LIST_COMPONENTS_FOR_AGENT), reuse its styles and parts, add the page with FRAMER_CREATE_WEB_PAGE or FRAMER_CLONE_WEB_PAGE, then lay it out with FRAMER_APPLY_AGENT_CHANGES. It stays unpublished and waits for approval.
   - Webflow or WordPress.com: they can't take a new layout from you. Give the plan in chat, and put the words in with write-a-page.
   - None connected: give the plan and the copy in chat, and say the owner can connect Framer in Settings, Apps.
9. Run review-the-design on the result before you ask the owner to publish.

## Output
- The page plan: each section with its words, its photo and how it sits on a phone and on a computer.
- The look: fonts and sizes, colors with their hex codes, and the spacing.
- With Framer: what was built, and that it waits for the owner's approval.

## Rules
- Never publish without the owner's OK, unless they put you on autopilot.
- Never invent facts, prices, reviews, ratings or awards. Leave [fill in] where a fact or photo is missing.
- Never invent a logo or brand colors. Ask the owner.
- Reuse the site's own styles and parts. Never remove pages, sections or styles.
- Plain English, short sentences.
