---
name: welcome-series
description: Writes a short welcome series for new customers or sign-ups (three emails over about a week) in the business's voice, and sends the first one from Gmail or Outlook after the owner approves. Use it when someone asks for "a welcome email", "emails for new customers", "an onboarding email", "a thank you email after they buy" or "a welcome flow". Do not use it for a one-off announcement (use write-a-campaign).
tools: search_knowledge, app_search_actions, app_action
---
# Welcome series

Three short emails that welcome a new customer, help them get value, and invite them back.

## When to use
- A new customer, a new sign-up, or a first purchase.

## When not to use
- The owner wants to announce one thing to everyone. Use write-a-campaign.

## What you have
- search_knowledge: what the business sells, how it helps, its hours, address, prices and tone.
- app_search_actions: shows the connected email app and its actions.
- app_action: sends an email or saves a draft. Sending waits for the owner's approval.

## Steps
1. Read what the business offers and its tone with search_knowledge.
2. Write email 1 (day 0): thank them, say what happens next and how to reach the business.
3. Write email 2 (day 3): one tip or answer to a common question that helps them get the most from what they bought.
4. Write email 3 (day 7): ask how it went and give one clear next step, like booking again or leaving a review.
5. Check the email app with app_search_actions. If none is connected, give the emails in chat and say to connect Gmail or Outlook in Settings, Apps.
6. When the owner names the new customer and says go, send email 1 with app_action, or save all three as drafts.

## Output
- The three emails, each with a subject line and the day it goes out.
- One line on what waits for approval.

## Rules
- Never invent a discount, a gift or a promise the owner didn't give.
- Keep each email under 150 words, with one ask.
- Emails 2 and 3 are drafts for the owner to send later. Say so, since nothing sends them on a timer yet.
