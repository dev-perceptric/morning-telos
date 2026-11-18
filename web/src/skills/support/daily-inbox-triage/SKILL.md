---
name: daily-inbox-triage
description: Goes through new customer emails and tickets, sorts them (answer now, needs the owner, sales lead, nothing to do), writes replies for the easy ones and hands the rest on. Use it when someone asks to "check the inbox", "go through support", "what came in today", "triage my email" or "answer what's waiting". Do not use it for one message (use answer-an-email).
tools: app_search_actions, app_action, search_knowledge, handoff
---
# Daily inbox triage

Every new customer message is sorted, the easy ones are answered, and nothing urgent waits.

## When to use
- Every morning, or from a routine.
- The owner asks what came in.

## When not to use
- One customer needs an answer. Use answer-an-email.

## What you have
- app_search_actions: shows the connected email, help desk and chat apps and their actions.
- app_action: reads new messages and tickets, and sends replies or a Slack note after the owner approves.
- search_knowledge: the answers and the tone.
- handoff: gives sales leads to Hermes and booking requests to Hora.

## Steps
1. Check the apps with app_search_actions. If none is connected, say to connect Gmail, Outlook, Zendesk or Help Scout in Settings, Apps, and stop.
2. Read messages from the last 24 hours that have no reply with app_action.
3. Sort each one: answer now, needs the owner, sales lead, booking, or nothing to do.
4. Needs the owner: refunds, legal or medical questions, and angry customers. List them first, with who, what and why. Send nothing to them.
5. Answer now: write each reply from search_knowledge and send it with app_action. They wait for the owner's approval.
6. Hand sales leads to Hermes and booking requests to Hora with handoff.

## Output
- One line with the counts per group.
- The messages that need the owner, first.
- The replies, ready to approve.

## Rules
- Answer only from Knowledge. If it isn't there, put the message under needs the owner.
- Never close, delete or merge a ticket.
