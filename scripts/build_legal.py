#!/usr/bin/env python3
"""Builds /terms/ and /privacy/ with the homepage header and footer.
Usage: python3 scripts/build_legal.py"""
import html
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
BASE = "https://morningtelos.com"
UPDATED = "November 17, 2026"

HOME = (SITE / "index.html").read_text()
HEAD = HOME[:HOME.index("<main")]
FOOT = HOME[HOME.index("</main>"):]

STYLE = """<style>
  .legal-page { padding: 56px 0 110px; }
  .legal-page .wrap { max-width: 760px; }
  .legal-page h1 { font-family: var(--serif); font-weight: 400; font-size: clamp(40px, 5vw, 60px); line-height: 1.05; letter-spacing: -.02em; margin: 12px 0 8px; }
  .legal-page .upd { color: var(--ink-4); font-size: 14px; margin-bottom: 32px; }
  .legal-page h2 { font-family: var(--serif); font-weight: 400; font-size: 28px; margin: 36px 0 10px; }
  .legal-page p, .legal-page li { color: var(--ink-2); font-size: 17px; line-height: 1.65; }
  .legal-page p { margin: 0 0 14px; }
  .legal-page ul { margin: 0 0 14px 22px; display: grid; gap: 6px; }
  .legal-page a { color: var(--clay-hover); text-decoration: underline; text-underline-offset: 3px; }
  .legal-page .note { background: var(--ivory-2); border: 1px solid var(--line); border-radius: 14px; padding: 16px 18px; font-size: 15px; color: var(--ink-3); }
</style>"""

TERMS = """
<p class="note">Plain-English summary: you own your business data, your AI team only acts inside your workspace, changes wait for your approval unless you turn on Autopilot, and you can cancel or delete your workspace anytime.</p>
<h2>1. Who we are</h2>
<p>Morning Telos ("we", "us") runs the Morning Telos app at chat.morningtelos.com and the website at morningtelos.com. You can reach us at <a href="mailto:meet@morningtelos.com">meet@morningtelos.com</a>.</p>
<h2>2. Your account</h2>
<ul><li>You must give a real email address and keep your password safe.</li><li>You must be at least 18 and able to make agreements for your business.</li><li>The person who creates a workspace is its owner. The owner can add and remove teammates, change the plan and delete the workspace.</li><li>You are responsible for what happens in your workspace, including what your teammates do.</li></ul>
<h2>3. Free trial and paid plans</h2>
<ul><li>New workspaces get a 14-day free trial. No card is needed.</li><li>Paid plans renew every month until you cancel. Payments are handled by Stripe.</li><li>Each plan includes an AI allowance for each billing period. When it runs out, your team pauses until the next period or until you upgrade.</li><li>You can cancel anytime in Billing. Your plan stays active until the end of the period you paid for. We don't give refunds for partial months unless the law requires it.</li><li>We may change prices with at least 30 days' notice by email.</li></ul>
<h2>4. How the AI team works</h2>
<ul><li>Your AI employees use AI models to read, write and take actions in the services we run for your business, such as SEO and social media.</li><li>By default, anything that changes something (publishing, scheduling, sending, deleting) waits for your approval. If you turn on Autopilot for a teammate, it can make changes without asking.</li><li>AI can make mistakes. Check important work before you approve it. You are responsible for content you approve or publish.</li><li>Don't use the app to break the law, send spam, mislead people, infringe others' rights or harm anyone.</li></ul>
<h2>5. Your content</h2>
<p>You own the information you add and the content your team creates for you. You give us permission to store and process it only to run the service for you. We don't sell your data, and we don't use it to train AI models.</p>
<h2>6. Availability</h2>
<p>We work to keep the app running and back up data every night, but we can't promise it will never go down. We may update the app over time.</p>
<h2>7. Ending your account</h2>
<p>You can delete your workspace anytime in Settings. That deletes its chats, knowledge, approvals and routines from our live systems right away, and from backups within 30 days. We may suspend accounts that break these terms or don't pay.</p>
<h2>8. Liability</h2>
<p>The app is provided "as is." To the extent the law allows, we are not liable for indirect or lost-profit damages, and our total liability is limited to what you paid us in the 3 months before the claim.</p>
<h2>9. Changes</h2>
<p>We may update these terms. If a change is important, we'll email the workspace owner before it takes effect.</p>
"""

PRIVACY = """
<p class="note">Plain-English summary: we collect only what we need to run your AI team, we never sell your data, we don't train AI on it, and you can delete it anytime.</p>
<h2>What we collect</h2>
<ul><li><b>Account details:</b> your name, email, business name, website and time zone.</li><li><b>What you put in the app:</b> chats, knowledge docs, routines and approvals.</li><li><b>Usage:</b> how much AI your workspace uses, so we can show your allowance and bill correctly.</li><li><b>Billing:</b> handled by Stripe. We see your plan and payment status, not your full card number.</li><li><b>Security logs:</b> sign-in attempts and errors, to keep the app safe.</li></ul>
<h2>How we use it</h2>
<ul><li>To run your AI team and the services we operate for your business.</li><li>To send account emails, like email verification, password resets and billing notices.</li><li>To keep the app secure and fix problems.</li></ul>
<p>We don't sell your data, we don't use it for ads, and we don't use it to train AI models.</p>
<h2>Who helps us run the service</h2>
<ul><li><b>Anthropic</b> (Claude): the AI models your team uses.</li><li><b>Stripe:</b> payments.</li><li><b>Hostinger:</b> our servers.</li><li><b>Resend:</b> account emails.</li><li><b>Cloudflare:</b> encrypted backups.</li><li><b>Arrowsterr and Capybaroar:</b> SEO, AI visibility and social media tools we run for your business.</li><li><b>Google Fonts:</b> fonts on our pages.</li></ul>
<h2>How we protect it</h2>
<ul><li>Passwords are hashed. Service keys are encrypted.</li><li>Each business's data is kept separate, and your AI team can only reach your own brand in the services we run.</li><li>Backups are encrypted and kept for 30 days.</li></ul>
<h2>How long we keep it</h2>
<p>As long as your workspace exists. When you delete it, we delete your data from live systems right away and from backups within 30 days. Billing records may be kept longer where the law requires.</p>
<h2>Your choices</h2>
<p>You can see and edit your information in the app, download what you've written, and delete your workspace in Settings. For anything else, email <a href="mailto:meet@morningtelos.com">meet@morningtelos.com</a>.</p>
<h2>Cookies</h2>
<p>The app uses one cookie to keep you logged in. Our website doesn't use tracking cookies.</p>
"""


def page(slug, title, desc, h1, body):
    head = re.sub(r"<title>.*?</title>", f"<title>{html.escape(title)}</title>", HEAD, count=1)
    head = re.sub(r'<meta name="description" content="[^"]*">', f'<meta name="description" content="{html.escape(desc)}">', head, count=1)
    head = head.replace("</head>", f'<link rel="canonical" href="{BASE}/{slug}/">\n{STYLE}\n</head>', 1)
    main = f'<main id="top" class="legal-page"><div class="wrap"><span class="eyebrow">Legal</span><h1>{h1}</h1><p class="upd">Last updated {UPDATED}</p>{body}</div></main>'
    out = SITE / slug / "index.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(head + main + FOOT[len("</main>"):])
    print("built", out.relative_to(ROOT))


page("terms", "Terms of Service | Morning Telos", "The terms for using Morning Telos, the AI team for small businesses.", "Terms of Service", TERMS)
page("privacy", "Privacy Policy | Morning Telos", "What Morning Telos collects, how we use it, and how you control it.", "Privacy Policy", PRIVACY)
