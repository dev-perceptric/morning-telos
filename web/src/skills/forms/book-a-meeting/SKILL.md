---
name: book-a-meeting
description: Finds open times in Google Calendar or Calendly for a meeting the owner names, offers the best ones, and books it with an invite after the owner approves. Use it when someone asks to "book a call", "set up a meeting", "find a time with", "schedule an appointment" or "send my booking link". Do not use it for reminders about meetings already booked (use reminder-emails).
tools: search_knowledge, app_search_actions, app_action
---
# Book a meeting

The right time, checked against the calendar, booked once the owner says yes.

## When to use
- The owner wants to meet someone, or a lead asked for a call.

## When not to use
- The meeting is already booked and needs a reminder. Use reminder-emails.

## What you have
- search_knowledge: working hours, meeting length, location or video link, and the time zone.
- app_search_actions: shows the connected calendar and email apps and their actions, like finding free slots.
- app_action: reads free times, and adds the event or sends the invite after the owner approves.

## Steps
1. Get the guest, the reason, the length and the days from the owner. Ask for what's missing. Never guess an email address.
2. Read working hours and the usual meeting place with search_knowledge.
3. Check the calendar with app_search_actions, then read free times with app_action. With Calendly, find the booking link that fits.
4. Offer three times, each with the day, the time and the time zone.
5. When the owner picks one, add the event with the guest's email through app_action, or send the Calendly link by email.
6. If no calendar is connected, propose times from the working hours, write the invite in chat and say to connect Google Calendar or Calendly in Settings, Apps.

## Output
- Three times to pick from, with the time zone.
- The invite text.
- One line saying it waits for approval.

## Rules
- Never book over another meeting.
- Never invent a guest, a place or a video link.
- Always say the time zone.
