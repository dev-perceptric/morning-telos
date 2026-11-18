---
name: plan-weekly-posts
description: Plans and drafts next week's social posts for every connected channel, at the times that work best, as drafts that wait for approval. Use it when someone asks "plan next week's posts", "fill the calendar", "posts for this week", "social plan" or a weekly routine asks for posts. Do not use it for one post (use write-a-post).
tools: list_channels, get_analytics, list_posts, next_queue_slot, create_posts, search_knowledge
---
# Plan weekly posts

A week of posts in the business's voice, spread over the best days and times, saved as drafts for approval.

## When to use
- The start of a week, or a weekly routine.
- The owner says the calendar is empty.

## When not to use
- They want one post. Use write-a-post.
- They want results. Use social-report.

## What you have
- list_channels: connected channels, each with its character limit and the settings it needs. Use only these channel ids.
- get_analytics: the best times to post, the formats that worked and the top posts.
- list_posts: posts already on the calendar, so you don't double up.
- next_queue_slot: the next free slot in the posting queue.
- create_posts: saves the posts. They are drafts and wait for the owner's approval.
- search_knowledge: offers, events, products and tone to write about.

## Steps
1. Read the channels with list_channels. If none are connected, say so and stop.
2. Read get_analytics for 30 days: best times, best formats, top posts.
3. Read list_posts for the next 7 days. Skip days that already have a post.
4. Read this week's offers and news with search_knowledge.
5. Write 3 to 5 posts: a mix of an offer, a tip, a behind-the-scenes moment and a question. Fit each channel's limit.
6. Save them with create_posts as drafts, with publish_at at the best times, ISO 8601 with an offset.

## Output
- The week as a short list: day, time, channel, the first line of each post.
- One line saying the drafts wait for approval.

## Rules
- Drafts only, unless the owner clearly asks to schedule.
- Never invent facts, prices, numbers, quotes or customer names.
