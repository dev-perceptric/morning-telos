---
name: write-a-post
description: Writes one social post about something the owner names (an offer, an event, a new product, a tip), shaped for each connected channel and saved as a draft. Use it when someone asks "write a post about", "post this", "announce", "share our sale" or "make an Instagram post". Do not use it to plan a whole week (use plan-weekly-posts).
tools: list_channels, create_posts, next_queue_slot, search_knowledge
---
# Write a post

One post, ready for approval, that fits each channel it goes on.

## When to use
- The owner has one thing to share.

## When not to use
- They want a week of posts. Use plan-weekly-posts.

## What you have
- list_channels: connected channels with their character limit and settings.
- next_queue_slot: the next free time, when the owner gives none.
- create_posts: saves the post as a draft that waits for approval.
- search_knowledge: the real details (dates, prices, address) and the business's tone.

## Steps
1. Read the channels with list_channels.
2. Read the details with search_knowledge. Ask for the one fact that's missing, if any.
3. Write the post: a first line that stops the scroll, the details, and one call to act. Keep it within the shortest channel's limit, or write a shorter version for that channel.
4. Pick the time the owner asked for, or the next queue slot.
5. Save it with create_posts as a draft.

## Output
- The post text, the channels and the time.
- One line saying it waits for approval.

## Rules
- Drafts only, unless the owner clearly asks to post now or schedule.
- Never invent facts, prices or customer names.
