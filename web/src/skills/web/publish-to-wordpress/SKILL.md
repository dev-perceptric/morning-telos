---
name: publish-to-wordpress
description: Puts a page or blog post on the owner's own WordPress site the safe way: saves it as a draft, gives the owner the preview link, checks it, and publishes only after the owner approves. Use it when someone asks to "put it on WordPress", "add this page to our WordPress site", "post it to the blog" or "publish the draft". Do not use it for WordPress.com sites (use write-a-page) or to write the page from scratch (use write-a-page first).
tools: wordpress_site_info, wordpress_list_pages, wordpress_list_posts, wordpress_get_page, wordpress_get_post, wordpress_list_categories, wordpress_add_draft_page, wordpress_add_draft_post, wordpress_update_page, wordpress_update_post, wordpress_upload_image, wordpress_publish, search_knowledge
---
# Publish to WordPress

A page or post on the owner's own WordPress site, as a draft they can preview, that goes live only when they say so.

## When to use
- A page or post is written and the owner's own WordPress site is connected.
- The owner asks to publish a draft that is already on their WordPress site.

## When not to use
- The site is on WordPress.com. Use write-a-page, which saves a WordPress.com draft.
- The page isn't written yet. Use write-a-page first.
- WordPress isn't connected. Give the page in chat and say the owner can connect WordPress in Settings, Apps.

## What you have
- wordpress_site_info: the site's name and address, and whether Yoast or Rank Math is on it.
- wordpress_list_pages, wordpress_list_posts, wordpress_get_page and wordpress_get_post: what is already on the site, read at once.
- wordpress_list_categories: the blog's categories, to file a post under.
- wordpress_add_draft_page and wordpress_add_draft_post: save it as a draft. They wait for approval, and the approval card shows the preview link once it runs.
- wordpress_update_page and wordpress_update_post: change a draft or a live page. They wait for approval.
- wordpress_upload_image: adds a photo from a public https address to the media library. It waits for approval.
- wordpress_publish: puts a draft live. It waits for approval.
- search_knowledge: the business's facts, to check every price and claim.

## Steps
1. Check with wordpress_site_info that the site is connected, and look for a page or post with the same title with wordpress_list_pages or wordpress_list_posts, so nothing is made twice.
2. Check every fact against search_knowledge. Leave [fill in] where one is missing.
3. Turn the page into clean HTML or WordPress block markup: headings, short paragraphs, lists and one clear button or link to book. No scripts.
4. Save it with wordpress_add_draft_page or wordpress_add_draft_post (find the category with wordpress_list_categories first). Add a photo first with wordpress_upload_image only if the owner gave one.
5. Once the owner approves the draft, give them the preview link from the approval card, or read it with wordpress_get_page or wordpress_get_post.
6. Make any changes they ask for with wordpress_update_page or wordpress_update_post. The draft stays a draft.
7. Run review-the-design on the draft before you ask the owner to publish it.
8. Ask before you publish. Publish with wordpress_publish only when the owner says so. It waits for their approval.

## Output
- Where the draft is and its preview link.
- What the review found, in a short list.
- One line saying what waits for the owner's approval.

## Rules
- Never publish without the owner's OK, unless they put you on autopilot.
- New pages and posts start as drafts. Never delete anything.
- Never invent facts, prices, reviews or awards. Leave [fill in] where a fact is missing.
- Plain English, short sentences.
