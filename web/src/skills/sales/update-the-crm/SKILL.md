---
name: update-the-crm
description: Keeps HubSpot, Pipedrive or Salesforce up to date from the latest emails and calls: new contacts, notes and next steps, saved after the owner approves. Use it when someone asks to "update the CRM", "log this lead", "add this contact", "add a note to the deal" or "clean up my pipeline". Do not use it to write to leads (use follow-up-new-leads or quote-follow-up).
tools: app_search_actions, app_action, search_knowledge
---
# Update the CRM

The CRM shows what really happened, so no lead is lost.

## When to use
- After new emails, calls or meetings with leads.
- The owner asks to log something.

## When not to use
- The job is to write to a lead. Use follow-up-new-leads or quote-follow-up.

## What you have
- app_search_actions: shows the connected CRM and email apps and their actions, and each action's inputs.
- app_action: reads contacts and deals, and saves changes after the owner approves.
- search_knowledge: the pipeline stages and words the owner uses.

## Steps
1. Check the CRM with app_search_actions. If none is connected, list the updates in chat and say to connect HubSpot, Pipedrive or Salesforce in Settings, Apps.
2. Read the recent emails or the details the owner gave with app_action.
3. Look up each person in the CRM first, so you never add someone twice.
4. Prepare each change: a new contact, a note, or a next step with a date.
5. Save each change with app_action. They wait for the owner's approval.

## Output
- The changes, as a short list: who, what changes.
- One line saying they wait for approval.

## Rules
- Only facts from the emails, the calls or the owner. Never guess a value, a date or a stage.
- Never change a deal's value or stage unless the owner said so.
- Never delete anything.
