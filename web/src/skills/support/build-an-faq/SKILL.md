---
name: build-an-faq
description: Reads recent customer emails and tickets, finds the questions people ask again and again, and writes short answers from the business's knowledge for an FAQ page or saved replies. Use it when someone asks to "build an FAQ", "what do customers keep asking", "write help articles", "common questions" or "saved replies for support". Do not use it to answer one customer (use answer-an-email).
tools: app_search_actions, app_action, search_knowledge, remember, handoff
---
# Build an FAQ

The questions customers ask most, each with one short answer the whole team can use.

## When to use
- The owner wants fewer repeat questions, or an FAQ for the website.

## When not to use
- One customer needs an answer now. Use answer-an-email.

## What you have
- app_search_actions: shows the connected email and help desk apps and their actions.
- app_action: reads recent emails and tickets. It only reads here.
- search_knowledge: the facts each answer needs.
- remember: saves an answer the owner approves, so the team uses it.
- handoff: gives the FAQ to Archon to turn into a website page.

## Steps
1. Check the apps with app_search_actions. Read the last 30 days of customer emails or tickets with app_action.
2. Group them by question and count each one. Keep the top 10.
3. Write each answer from search_knowledge in two or three short lines. Mark any answer Knowledge doesn't have, and ask the owner for it.
4. Show the list to the owner. When they approve an answer, save it with remember.
5. If the owner wants it on the website, hand the FAQ to Archon with handoff.
6. If no app is connected, ask the owner for the questions they hear most and say to connect Gmail, Outlook, Zendesk or Help Scout in Settings, Apps.

## Output
- The top questions, each with how often it came up and its answer.
- The questions that still need an answer from the owner.

## Rules
- Never invent an answer. Leave it marked for the owner.
- Keep customers' names and emails out of the FAQ.
