---
name: win-back
description: Writes a short win-back email for customers who haven't bought or booked in a while, in the business's voice, and sends it from Gmail or Outlook after the owner approves. Use it when someone asks to "win back old customers", "email people who stopped coming", "bring back past clients", "a we miss you email" or "re-engage our list". Do not use it for brand new customers (use welcome-series).
tools: search_knowledge, app_search_actions, app_action
---
# Win back

One warm email that gives past customers a real reason to come back.

## When to use
- The owner wants to hear from customers who went quiet.

## When not to use
- They are new customers. Use welcome-series.
- The owner wants a general newsletter. Use write-a-campaign.

## What you have
- search_knowledge: what's new at the business, current offers and the tone.
- app_search_actions: shows the connected email app and its actions, like searching sent mail.
- app_action: reads past emails to find who went quiet, and sends the email after the owner approves.

## Steps
1. Read what's new and any current offer with search_knowledge. Ask the owner if there is an offer when Knowledge has none.
2. Ask the owner who to send it to, or how long counts as quiet (for example, 6 months).
3. If the email app is connected, find past customers with app_search_actions and a read action through app_action. Show the list to the owner before writing to anyone.
4. Write the email: say you noticed it has been a while, share what's new, and give one clear reason and one ask to come back.
5. If no email app is connected, give the email in chat and say to connect Gmail or Outlook in Settings, Apps.
6. When the owner approves the list and the words, send it with app_action, one email per person.

## Output
- The subject line and the email.
- The people it goes to, as the owner approved them.
- One line saying it waits for approval.

## Rules
- Never invent an offer or a deadline.
- Never guilt or pressure. Keep it friendly and short.
- Send only to real past customers, never to a bought list.
