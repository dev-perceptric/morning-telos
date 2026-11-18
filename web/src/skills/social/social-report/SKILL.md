---
name: social-report
description: Explains how social posts did: reach and engagement against the period before, the best and worst posts and why, and what to post more of. Use it when someone asks "how are our posts doing", "social results", "what worked on Instagram", "engagement" or "social report". Do not use it to write posts (use plan-weekly-posts).
tools: get_analytics, list_posts, get_post, list_channels
---
# Social report

What worked on social, what didn't, and what to do more of, in plain words.

## When to use
- The owner asks how social is going.
- A monthly routine asks for results.

## When not to use
- They want new posts. Use plan-weekly-posts.

## What you have
- get_analytics: reach and engagement for 7, 30 or 90 days against the period before, best times, results by format and top posts.
- list_posts and get_post: what went out and how each post did on each channel.
- list_channels: which channels are connected.

## Steps
1. Read get_analytics for 30 days, or the period the owner asked for.
2. Note the change in reach and engagement from the period before.
3. Pick the two best posts and open them with get_post to see what they had in common.
4. Note the best times and formats.
5. Turn it into two or three things to do more of, and one to stop.

## Output
- **Results**: reach and engagement with the change, in one line.
- **What worked**: the two best posts and why.
- **Do next**: two or three short steps.

## Rules
- Use only numbers the tools return. If a channel has too little data, say so.
