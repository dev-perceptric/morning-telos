---
name: follow-up-new-leads
description: Finds new leads in the inbox or the CRM that haven't had a reply, writes a fast, personal reply to each that offers a call, and sends them from Gmail or Outlook after the owner approves. Use it when someone asks to "follow up on new leads", "answer the new inquiries", "reply to people who contacted us", "who hasn't heard back" or "get back to leads". Do not use it for quotes already sent (use quote-follow-up).
tools: search_knowledge, app_search_actions, app_action, handoff, remember
---
# Follow up new leads

Every new lead gets a real reply and a way to book a call, fast.

## When to use
- New inquiries came in by email, a form or the CRM.
- A routine runs it every morning.

## When not to use
- The lead already has a quote. Use quote-follow-up.
- It's a customer with a problem. Hand it to Hestia.

## What you have
- search_knowledge: services, prices, service area, the booking link and the tone.
- app_search_actions: shows the connected email, calendar and CRM apps and their actions.
- app_action: reads new emails and contacts, and sends replies after the owner approves.
- handoff: gives a support question to Hestia or a booking to Hora.
- remember: saves facts the owner teaches you, like "we don't serve that area".

## Steps
1. Check the apps with app_search_actions. Read new inquiries from the last 3 days with app_action, from the inbox and the CRM.
2. Keep the ones with no reply yet. Skip spam and people who are already customers.
3. For each lead, read what they asked and the matching service and price with search_knowledge.
4. Write a short reply: thank them, answer their question, and offer a call with two times or the booking link.
5. Send each reply with app_action. They wait for the owner's approval.
6. Hand support questions to Hestia with handoff.
7. If no email app is connected, write the replies in chat and say to connect Gmail or Outlook in Settings, Apps.

## Output
- How many new leads and how many replies are ready.
- Each reply, with who it's to.
- One line saying they wait for approval.

## Rules
- Never invent a price, a discount or a date. Quote prices only from Knowledge.
- Never promise a result.
- One reply per lead. Never send the same reply twice.
