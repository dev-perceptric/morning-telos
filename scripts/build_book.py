#!/usr/bin/env python3
"""Builds the booking page at site/book/ with the Claritia form embed.
Usage: python3 scripts/build_book.py"""
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
BASE = "https://morningtelos.com"
FORM_ID = "5d351c24-715b-40c4-bff3-f060201010b3"

HOME = (SITE / "index.html").read_text()
head = HOME[:HOME.index("<main")]
footer = HOME[HOME.index("</main>"):]
avs = re.search(r'<div class="avs".*?</div>', HOME, re.S).group(0)

title = "Book a Free Telos Session | Morning Telos"
desc = "Book a free 30-minute Telos Session with Morning Telos. We'll find your highest-leverage first move for software and AI automation."
head = re.sub(r"<title>.*?</title>", f"<title>{title}</title>", head, count=1)
head = re.sub(r'<meta name="description" content="[^"]*">', f'<meta name="description" content="{desc}">', head, count=1)
schema = {"@context": "https://schema.org", "@type": "ContactPage", "name": title, "url": f"{BASE}/book/",
          "about": {"@type": "Organization", "name": "Morning Telos", "url": BASE + "/", "email": "meet@morningtelos.com"}}
extra = f'''<link rel="canonical" href="{BASE}/book/">
<script type="application/ld+json">{json.dumps(schema)}</script>
<script src="https://app.tryclaritia.com/forms/v1.js" async></script>
<style>
  .book {{ padding: 48px 0 110px; }}
  .book-grid {{ display: grid; grid-template-columns: 1fr 1.15fr; gap: 64px; align-items: start; }}
  .book-copy {{ position: sticky; top: 110px; }}
  .book-copy h1 {{ font-family: var(--serif); font-weight: 400; font-size: clamp(42px, 5vw, 68px); line-height: 1.04; letter-spacing: -.02em; margin: 14px 0 18px; text-wrap: balance; }}
  .book-copy .lead {{ margin-bottom: 30px; }}
  .bk-steps {{ list-style: none; display: grid; gap: 14px; margin-bottom: 30px; }}
  .bk-steps li {{ display: grid; grid-template-columns: 40px 1fr; gap: 14px; align-items: start; }}
  .bk-steps .n {{ width: 40px; height: 40px; border-radius: 50%; background: var(--clay); color: #fff; display: grid; place-items: center; font-family: var(--mono); font-size: 13px; }}
  .bk-steps b {{ display: block; font-size: 16.5px; }}
  .bk-steps span {{ color: var(--ink-3); font-size: 15px; }}
  .bk-mail {{ margin-top: 22px; font-size: 14.5px; color: var(--ink-3); }}
  .bk-mail a {{ color: var(--clay-hover); text-decoration: underline; text-underline-offset: 3px; }}
  .book-form {{ min-height: 700px; }}
  .book-form claritia-form {{ display: block; }}
  @media (max-width: 1000px) {{ .book-grid {{ grid-template-columns: 1fr; gap: 28px; }} .book-copy {{ position: static; }} .book-form {{ min-height: 0; }} }}
  @media (max-width: 640px) {{ .book {{ padding: 24px 0 80px; }} }}
</style>
'''
head = head.replace('<link rel="stylesheet" href="/assets/site.css">', '<link rel="stylesheet" href="/assets/site.css">\n' + extra, 1)

page = head + f'''<main id="top">
  <section class="book">
    <div class="wrap book-grid">
      <div class="book-copy">
        <div class="crumb"><a href="/">Home</a> / Book a Telos Session</div>
        <h1>Book your free <span class="clay">Telos Session.</span></h1>
        <p class="lead">A 30-minute strategy call with Morning Telos. Tell us where your business is headed and where it's stuck. You leave with a clear first move.</p>
        <ol class="bk-steps">
          <li><span class="n">01</span><div><b>Tell us about your business</b><span>Name, company and where AI automation could help.</span></div></li>
          <li><span class="n">02</span><div><b>Pick a time that suits you</b><span>Choose a 30-minute slot on the calendar.</span></div></li>
          <li><span class="n">03</span><div><b>Leave with a clear first move</b><span>We map your goal and the busywork in the way. No slides, no pressure.</span></div></li>
        </ol>
        <div class="hero-proof">{avs}<p><b>For founders, operators and decision makers.</b><br>Free, 30 minutes, on video.</p></div>
        <p class="bk-mail">Prefer email? Write to <a href="mailto:meet@morningtelos.com">meet@morningtelos.com</a>.</p>
      </div>
      <div class="book-form">
        <claritia-form form-id="{FORM_ID}"></claritia-form>
      </div>
    </div>
  </section>
</main>
''' + footer

out = SITE / "book" / "index.html"
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(page)
print("wrote", out.relative_to(ROOT))
