# Spec: Cluster 1 template articles (Morning Telos blog)

This file is guidance for writers. It is NOT a post (the builder only reads files that start with `---`; this one doesn't).

## Brand
Morning Telos (morningtelos.com) builds software and AI automation for founders, business owners and operators. Sign-up link: `https://chat.morningtelos.com/#signup` (free 14-day trial, no card). Email: meet@morningtelos.com.

Industry pages you may link: `/solutions/clinics/`, `/solutions/home-services/`, `/solutions/real-estate/`, `/solutions/law-firms/`, `/solutions/ecommerce/`, `/solutions/accounting/`, `/solutions/fitness/`, `/solutions/logistics/`, `/solutions/agencies/`, `/solutions/saas/`, `/solutions/insurance/`, `/solutions/recruiting/`.
Service pages: `/services/ai-agents/`, `/services/ai-automation/`, `/services/crm-sales-automation/`, `/services/partnership/`.
Existing posts you may link: `/blog/ai-receptionist-cost/`, `/blog/how-to-automate-customer-service/`, `/blog/best-ai-automation-agencies/`, and the other Cluster 1 posts by slug (list below).

## Writing rules (strict)
- Plain English, 9th-grade reading level. Short paragraphs (1-3 sentences). Short sentences.
- Do NOT use these patterns: "not X, but Y", "X, not Y", "it's not about X, it's about Y". Avoid groups of three adjectives/phrases used for rhythm. Never use the word "quietly". No em dashes (—); use commas, colons or periods.
- No hype words: revolutionary, game-changing, unlock, leverage, seamless, robust, delve, elevate, in today's fast-paced world.
- Answer first: the first line under the title is a blockquote starting with `> **Short answer:**`.
- NEVER invent statistics, studies, prices or quotes. Only use the stats in "Allowed stats" below, with their exact source link. If no stat fits, use none.
- Promote Morning Telos occasionally and naturally: one [[PROMO]] mid-article, one [[MANUAL]] box after the main templates, one [[OFFER]] near the end, and a final short paragraph linking to the free trial and one industry page. Don't mention Morning Telos more than ~5 times total.
- Templates: realistic, warm, short (texts under ~300 characters; emails can be longer). Use placeholders in square brackets: [Name], [Business], [Day], [Date], [Time], [Address], [Link], [Phone], [Service], [Staff name]. Include opt-out language like "Reply STOP to opt out" in a few marketing-type texts (reviews, follow-ups), not in every reminder.
- Each template group needs a short `###` heading in the body plus `[[TPL key]]`, and a matching list under `templates.key` in front matter.

## Allowed stats (use only these)
- CallRail, 2025 survey of 1,000 US consumers: 78% have abandoned a business after an unanswered call; 82% say they'll call a competitor if a business doesn't answer; 21% immediately call another business. URL: https://www.callrail.com/blog/missed-calls-cost-businesses-more-than-ever
- U.S. Bureau of Labor Statistics: median receptionist pay $38,010/year ($18.27/hour), May 2025. URL: https://www.bls.gov/ooh/office-and-administrative-support/receptionists.htm
- Zendesk CX Trends 2026: 74% of consumers now expect 24/7 customer service because of AI. URL: https://www.zendesk.com/newsroom/press-releases/contextual-intelligence-becomes-the-new-standard-for-exceptional-customer-experience-in-2026/
Stat cards use the `stats` front matter (n, text, source, url) and the [[STATS]] shortcode. Also list used sources in `sources`.

## File format (YAML front matter + Markdown body)
Save as `content/blog/<slug>.md`. Front matter must be valid YAML. Quote every string that contains a colon, quote mark, # or starts with [ or *. For multi-line template text use a `|` block scalar.

```yaml
---
title: "45+ Appointment Reminder Text Templates (Copy & Paste)"
description: "One or two plain sentences, under ~160 characters, for search and the page subtitle."
category: templates
date: 2026-11-16
image: /img/blog/<image-file>.webp
image_alt: "Short description of the statue image"
services: [ai-agents, ai-automation]
manual:
  title: "Sending these by hand?"
  text: "One or two sentences on the time it takes by hand, and that it can run automatically."
  link_text: "See how automatic reminders work"
  link: "/solutions/clinics/"
offer:
  kicker: "Done for you by Morning Telos"
  title: "Automatic appointment reminders"
  text: "One or two sentences describing the setup."
  points:
    - "Short benefit"
    - "Short benefit"
    - "Short benefit"
    - "Short benefit"
  cta: "Book a free Telos Session"
  side_title: "Want reminders that send themselves?"
  side_text: "We set it up for you, usually in about a week."
promo: "One sentence mentioning Morning Telos naturally, with a Markdown link, e.g. [AI receptionist](/services/ai-agents/)."
stats:
  - n: "78%"
    text: "of consumers have given up on a business after an unanswered call."
    source: "CallRail, 2025"
    url: "https://www.callrail.com/blog/missed-calls-cost-businesses-more-than-ever"
templates:
  first:
    - title: "Short label"
      text: |
        Hi [Name], this is [Business]. ...
faqs:
  - q: "Question?"
    a: "Answer in 1-3 sentences."
sources:
  - title: "CallRail, missed calls survey (2025)"
    url: "https://www.callrail.com/blog/missed-calls-cost-businesses-more-than-ever"
---
```

## Body structure
```
> **Short answer:** ... (include 1-2 example templates inline as plain sentences or a short list)

Intro: 2-3 short paragraphs. Who this is for, what's inside.

[[STATS]]            (only if a stat fits)

## What makes a good <type>?
4-6 bullet rules with **bold lead-ins**.

## <N> <type> templates
Short intro line.

### <Group 1 heading>
[[TPL group1]]

### <Group 2 heading>
[[TPL group2]]
... (6-9 groups; one group may be "By industry" with trade-specific templates)

[[PROMO]]            (place somewhere in the middle of the groups)

[[MANUAL]]           (right after the last template group)

## When to send <type>        (a Markdown timing table, or "Best practices")

## Tips / mistakes to avoid   (short bullets)

[[OFFER]]

## (optional) Short closing section linking the free trial and one /solutions/ page

(FAQ is rendered automatically from front matter; don't write an FAQ heading.)
```
The template count in the title must match the real number of templates in front matter (round down to a "N+" figure that's true).

## The 8 articles
| slug | title idea | image | main keyword | link focus | offer |
|---|---|---|---|---|---|
| appointment-reminder-text-templates | 45+ Appointment Reminder Text Templates (Copy & Paste) | appointment-reminder-text-templates.webp | appointment reminder text / template | clinics, fitness, home-services | Automatic appointment reminders |
| appointment-reminder-email-templates | 25+ Appointment Reminder Email Templates (Copy & Paste) | appointment-reminder-email-templates.webp | appointment reminder email template | clinics, law-firms, accounting | Automatic appointment reminders |
| dental-appointment-reminder-templates | 30+ Dental Appointment Reminder Templates (Text & Email) | reduce-no-shows.webp | dental appointment reminder | clinics | No-show recovery for dental practices |
| missed-call-text-back-templates | 30+ Missed Call Text Back Templates ("Sorry I Missed Your Call") | missed-call-text-back.webp | sorry i missed your call / missed call text back | home-services, clinics, real-estate | Missed call text back in 30 seconds |
| auto-reply-message-templates | 40+ Auto Reply Message Templates for Small Business | auto-reply-message-templates.webp | auto reply message templates | all; ai-receptionist-cost post | AI receptionist for calls, texts and chat |
| review-request-templates | 30+ Review Request Text & Email Templates (Get More Google Reviews) | review-request-templates.webp | review request template | home-services, clinics, fitness | Automatic review requests after every job |
| quote-follow-up-templates | 25+ Quote Follow-Up Text & Email Templates to Win More Jobs | quote-follow-up-templates.webp | quote follow up template | home-services, insurance | Automatic quote follow-up |
| after-hours-voicemail-scripts | 20+ After-Hours Voicemail Greeting & Text Scripts | after-hours-voicemail-scripts.webp | after hours voicemail greeting | clinics, law-firms, home-services | 24/7 AI answering |

All images are in `/img/blog/`. Category: `templates` for all 8. Date: 2026-11-16.

## Groups to cover (see each article)
1. Reminder texts: first reminder (2-3 days), day before, same day/2 hours, confirm or reschedule (reply YES / R), running late, rescheduled, cancelled, recurring visits, and industry versions (dental, medical, salon/spa, HVAC/plumbing, cleaning, fitness, law, real estate showing).
2. Reminder emails: 1 week before, day before, prep instructions, video/phone appointment, reschedule request, after a no-show, new client first visit.
3. Dental: new patient, cleaning/6-month recall, treatment appointment, day before, same day, confirm by text, missed appointment, overdue recall, insurance/forms reminder, family appointments.
4. Missed call text back: general, after hours, weekend, busy on a job, with booking link, with a quick question, emergency routing, plus trades (HVAC, plumbing, roofing, cleaning, dental, salon, real estate, law).
5. Auto replies: text auto reply, email out-of-office, after business hours, holiday, booked solid, Instagram/Facebook DM, Google Business Profile messages, new-lead instant reply, website chat.
6. Review requests: right after the job (text), next day (email), gentle reminder, after a compliment, QR/in-person script, replying to a 5-star review, replying to a negative review.
7. Quote follow-up: same day, 2 days later, 1 week later, "still interested?", price/budget questions, seasonal push, final follow-up, after you win, after you lose.
8. After-hours: voicemail greetings (standard after-hours, holiday, emergency line, lunch break), matching after-hours texts, trade versions (clinic, law firm, HVAC/plumbing, property management).
