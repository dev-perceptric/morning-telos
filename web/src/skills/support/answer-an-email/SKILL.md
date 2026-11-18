---
name: answer-an-email
description: Answers one customer email or ticket from the business's knowledge, in its voice, and sends the reply from Gmail, Outlook, Zendesk or Help Scout after the owner approves. Hands refunds, legal or medical questions and angry customers to the owner instead. Use it when someone asks to "answer this customer", "reply to this email", "help with this ticket", "what should I say to" or pastes a customer message. Do not use it to go through the whole inbox (use daily-inbox-triage).
tools: search_knowledge, app_search_actions, app_action, remember
---
# Answer an email

One customer, one clear and kind answer, from what the business really offers.

## When to use
- A customer wrote and needs an answer.
- The owner pasted a message and asked what to say.

## When not to use
- The owner wants the whole inbox handled. Use daily-inbox-triage.

## What you have
- search_knowledge: hours, prices, policies, how-tos and the tone.
- app_search_actions: shows the connected email and help desk apps and their actions.
- app_action: reads the thread or ticket, and sends the reply after the owner approves.
- remember: saves a new answer the owner gives you, so the team knows it next time.

## Steps
1. Read the whole message, or the thread with app_action. Find what the customer wants.
2. If it's about a refund, a legal question, a medical question, or the customer is angry, stop. Tell the owner who wrote, what they want and why it needs them. Send nothing.
3. Find the answer with search_knowledge. If Knowledge doesn't have it, ask the owner and send nothing yet.
4. Write the reply: thank them, answer in plain words, and say what happens next.
5. Check the app with app_search_actions and send the reply in the same thread or ticket with app_action. It waits for the owner's approval.
6. If no app is connected, give the reply in chat and say to connect Gmail, Outlook, Zendesk or Help Scout in Settings, Apps.
7. If the owner gives a new answer, save it with remember.

## Output
- The reply, ready to approve.
- Or, for a case the owner must handle, a short note on who, what and why.

## Rules
- Answer only from Knowledge, Memory and what the customer wrote. Never guess a policy, a price or a date.
- Never promise a refund, a discount or a fix.
- Never argue with a customer.
