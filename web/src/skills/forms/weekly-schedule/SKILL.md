---
name: weekly-schedule
description: A short look at the owner's coming week from Google Calendar or Calendly: meetings, busy days, open time and clashes, with what to fix. Use it when someone asks "what does my week look like", "am I free on", "my schedule this week", "where are my gaps" or "plan my calendar". Do not use it to book a meeting (use book-a-meeting).
tools: search_knowledge, app_search_actions, app_action, handoff
---
# Weekly schedule

The week ahead on one screen: what's booked, where the gaps are and what needs a decision.

## When to use
- The start of a week, or a routine that runs on Monday morning.
- The owner asks when they are free.

## When not to use
- They want to book something now. Use book-a-meeting.

## What you have
- search_knowledge: working hours and the days the business is closed.
- app_search_actions: shows the connected calendar apps and their actions.
- app_action: reads the events and free times for the week. It only reads here.
- handoff: passes a sales meeting to Midas or a customer issue to Irene when one needs work.

## Steps
1. Check the calendar with app_search_actions. If none is connected, say to connect Google Calendar or Calendly in Settings, Apps, and stop.
2. Read the week's events with app_action.
3. Read working hours with search_knowledge.
4. Find the busiest day, the open blocks of an hour or more, and any clashes or meetings outside working hours.
5. If a meeting needs prep from a teammate, such as a sales call, hand it off with handoff.

## Output
- One line on the week.
- Meetings per day, as a short list.
- Open time and clashes, with one suggestion each.

## Rules
- Read only. Never move or cancel anything in this skill.
- Say times with the time zone.
