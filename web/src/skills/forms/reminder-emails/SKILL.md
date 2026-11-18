---
name: reminder-emails
description: Writes and sends short reminder emails for the meetings and appointments coming up, from Gmail or Outlook after the owner approves. Use it when someone asks to "remind my clients", "send reminders for tomorrow", "cut no-shows", "confirm tomorrow's appointments" or "send a reminder email". Do not use it to book a new meeting (use book-a-meeting).
tools: search_knowledge, app_search_actions, app_action
---
# Reminder emails

A short, friendly reminder for each booking coming up, so fewer people miss them.

## When to use
- Meetings or appointments are coming up in the next day or two.
- A routine runs it every morning.

## When not to use
- The meeting isn't booked yet. Use book-a-meeting.

## What you have
- search_knowledge: the address, parking, what to bring, and the cancel or move policy.
- app_search_actions: shows the connected calendar and email apps and their actions.
- app_action: reads the bookings and sends each reminder after the owner approves.

## Steps
1. Check the apps with app_search_actions. Read the bookings for the next 24 to 48 hours with app_action.
2. Keep only bookings with a guest email. List any without one for the owner.
3. Read the address and the policy with search_knowledge.
4. Write one reminder per booking: the day, the time with the time zone, the place or link, and how to move it.
5. Send each one with app_action. They wait for the owner's approval.
6. If no calendar or email app is connected, write one reminder the owner can reuse and say which app to connect in Settings, Apps.

## Output
- How many bookings are coming up and how many reminders are ready.
- One sample reminder.
- One line saying they wait for approval.

## Rules
- Never change or cancel a booking.
- Never invent a policy. Leave it out when Knowledge doesn't have one.
