---
name: quote-follow-up
description: Finds quotes and proposals that went out without an answer, and writes a polite follow-up for each that helps the lead decide, sent from Gmail or Outlook after the owner approves. Use it when someone asks to "follow up on quotes", "check on open proposals", "who hasn't answered our quote", "nudge the estimate we sent" or "close open deals". Do not use it for brand new leads (use follow-up-new-leads).
tools: search_knowledge, app_search_actions, app_action
---
# Quote follow-up

Every quote gets an answer: a yes, a no, or a clear next step.

## When to use
- Quotes or proposals went out and the lead has gone quiet.
- A routine runs it twice a week.

## When not to use
- The lead hasn't had a quote yet. Use follow-up-new-leads.

## What you have
- search_knowledge: services, prices and what makes the business different.
- app_search_actions: shows the connected email and CRM apps and their actions.
- app_action: reads sent quotes and open deals, and sends follow-ups after the owner approves.

## Steps
1. Check the apps with app_search_actions. Find quotes sent 3 or more days ago with no reply, in sent mail or open CRM deals, with app_action.
2. For each, read the quote: what, how much, and when it was sent.
3. Write a short follow-up: remind them what the quote covers, answer one likely question, and ask for a yes, a no or a call.
4. Send each one with app_action. They wait for the owner's approval.
5. If a lead has had three follow-ups, don't send a fourth. List them for the owner instead.
6. If no email app is connected, write the follow-ups in chat and say to connect Gmail or Outlook in Settings, Apps.

## Output
- Open quotes, with the lead, the amount and the days since sent.
- The follow-ups, ready to approve.

## Rules
- Use only the amounts in the quote or the deal. Never offer a discount the owner didn't give.
- Stay polite and neutral. No pressure.
