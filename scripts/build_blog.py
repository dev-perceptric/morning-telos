#!/usr/bin/env python3
"""Morning Telos blog builder.

Posts live in content/blog/*.md as YAML front matter + Markdown.
Usage: python3 scripts/build_blog.py
Builds: site/blog/<slug>/, site/blog/ (index), site/blog/category/<cat>/,
site/blog/rss.xml, and rewrites site/sitemap.xml from every page on disk.

Body shortcodes:
  [[TABLE]]    at-a-glance comparison table (listicles, from `entries`)
  [[ENTRIES]]  the numbered entries (listicles, from `entries`)
  [[STATS]]    sourced stat cards (from `stats`: n, text, source, url)
  [[TPL key]]  copy-ready template cards (from `templates.key`: list of {title, text})
"""
import datetime as dt
import html
import json
import pathlib
import re
import urllib.parse

import markdown
import yaml

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
CONTENT = ROOT / "content" / "blog"
BASE = "https://morningtelos.com"

CATEGORIES = {
    "top-agencies": ("Top agencies", "Honest shortlists of AI agencies and consultants, with services, results and pricing."),
    "how-to-automate": ("How to automate", "Step-by-step guides to automating the jobs that eat your week."),
    "costs": ("Costs & pricing", "What AI automation, agents and receptionists really cost."),
    "receptionist-voice": ("AI receptionists & voice", "Phone agents, AI receptionists and voice AI for business."),
    "build-vs-buy": ("Build vs buy", "When off-the-shelf software is enough, and when custom wins."),
    "industries": ("Industries", "Automation playbooks for specific industries."),
    "statistics": ("Statistics", "Sourced numbers on AI, automation and customer service."),
    "templates": ("Templates", "Copy-ready texts, emails and scripts for local businesses."),
    "local-business": ("Local business growth", "Practical playbooks for clinics, home services and other local businesses."),
}
SERVICES = {
    "ai-automation": ("AI &amp; automation", "Workflows that run on their own"),
    "ai-agents": ("AI agents", "Agents that do real jobs"),
    "ai-lead-generation": ("AI lead generation", "A pipeline that fills itself"),
    "crm-sales-automation": ("CRM &amp; sales automation", "Follow-up that never forgets"),
    "custom-software": ("Custom software", "Tools built around how you run"),
    "partnership": ("Ongoing partnership", "Systems that keep improving"),
}

HOME = (SITE / "index.html").read_text()
HEAD_TPL = HOME[:HOME.index("<main")]
FOOTER = HOME[HOME.index("</main>"):]
MARK = re.search(r'<span class="mark" aria-hidden="true">.*?</span>', HOME, re.S).group(0)


def esc(s):
    return html.escape(str(s), quote=True)


def md(text):
    return markdown.markdown(text or "", extensions=["tables", "sane_lists", "attr_list"])


def slugify(s):
    s = re.sub(r"<[^>]+>", "", s)
    s = re.sub(r"[^a-zA-Z0-9\s-]", "", s).strip().lower()
    return re.sub(r"[\s-]+", "-", s)[:70]


def head(title, desc, canonical, extra=""):
    h = re.sub(r"<title>.*?</title>", f"<title>{esc(title)}</title>", HEAD_TPL, count=1)
    h = re.sub(r'<meta name="description" content="[^"]*">', f'<meta name="description" content="{esc(desc)}">', h, count=1)
    og = (f'<link rel="canonical" href="{canonical}">\n<meta property="og:type" content="article">\n'
          f'<meta property="og:title" content="{esc(title)}">\n<meta property="og:description" content="{esc(desc)}">\n'
          f'<meta property="og:url" content="{canonical}">\n<link rel="alternate" type="application/rss+xml" title="Morning Telos Blog" href="{BASE}/blog/rss.xml">\n')
    h = re.sub(r'<meta property="og:[^>]*>\n?', "", h)
    return h.replace('<link rel="stylesheet" href="/assets/site.css">', '<link rel="stylesheet" href="/assets/site.css">\n<link rel="stylesheet" href="/assets/blog.css">\n' + og + extra, 1)


def load_posts():
    posts = []
    for f in sorted(CONTENT.glob("*.md")):
        raw = f.read_text()
        m = re.match(r"^---\n(.*?)\n---\n(.*)$", raw, re.S)
        meta, body = yaml.safe_load(m.group(1)), m.group(2)
        meta["body"] = body
        meta.setdefault("slug", f.stem)
        meta.setdefault("updated", meta["date"])
        words = len(re.sub(r"[#>*_`\[\]()|-]", " ", body).split())
        words += sum(len(" ".join(str(v) for v in e.values()).split()) for e in meta.get("entries", []))
        words += sum(len((q["q"] + " " + q["a"]).split()) for q in meta.get("faqs", []))
        words += sum(len(t["text"].split()) for g in (meta.get("templates") or {}).values() for t in g)
        meta["read"] = max(3, round(words / 230))
        posts.append(meta)
    posts.sort(key=lambda p: str(p["updated"]), reverse=True)
    return posts


def fmt_date(d):
    d = d if isinstance(d, dt.date) else dt.date.fromisoformat(str(d))
    return d.strftime("%B %-d, %Y")


# ---------------- listicle parts ----------------
def table_html(p):
    rows = "".join(
        f'<tr><td class="n">{i}</td><td><a href="#{slugify(e["name"])}">{esc(e["name"])}</a></td><td>{esc(e.get("known_for", ""))}</td>'
        f'<td>{esc(e.get("best_for_short", e.get("best_for", "")))}</td><td>{esc(e.get("price_short", e.get("pricing", "")))}</td></tr>'
        for i, e in enumerate(p["entries"], 1))
    return (f'<div class="glance"><table><thead><tr><th>#</th><th>{esc(p.get("entry_label", "Agency"))}</th><th>Known for</th><th>Best for</th><th>Starting price</th></tr></thead>'
            f'<tbody>{rows}</tbody></table></div>')


def entries_html(p):
    out = ""
    for i, e in enumerate(p["entries"], 1):
        host = urllib.parse.urlparse(e["url"]).netloc.replace("www.", "")
        shot = f'<img src="{e["shot"]}" alt="{esc(e["name"])} website homepage" loading="lazy" width="1200" height="750">' if e.get("shot") else ""
        bullets = ""
        if e.get("services"):
            bullets += f'<li><b>Services:</b> {esc(", ".join(e["services"]))}.</li>'
        if e.get("best_for"):
            bullets += f'<li><b>Best for:</b> {esc(e["best_for"])}</li>'
        if e.get("pricing"):
            pr = esc(e["pricing"])
            if e.get("pricing_url"):
                pr = f'<a href="{esc(e["pricing_url"])}" rel="nofollow noopener" target="_blank">{pr}</a>'
            bullets += f'<li><b>Pricing:</b> {pr}</li>'
        out += f'''<section class="entry" id="{slugify(e["name"])}">
  <h3>{i}. {esc(e["name"])}</h3>
  <a class="browser" href="{esc(e["url"])}" rel="nofollow noopener" target="_blank"><span class="bar"><i></i><i></i><i></i><span>{esc(host)}</span></span>{shot}</a>
  {md(e.get("body", ""))}
  <ul class="facts">{bullets}</ul>
</section>
'''
    return out


def tpl_html(p, key):
    items = (p.get("templates") or {}).get(key, [])
    return '<div class="tpls">' + "".join(
        f'<div class="tpl"><div class="tpl-h"><b>{esc(t["title"])}</b><button type="button" class="tpl-copy">Copy</button></div><p class="tpl-t">{esc(t["text"].strip())}</p></div>'
        for t in items) + "</div>"


def stats_html(p):
    cards = "".join(f'<div class="stat"><b>{esc(x["n"])}</b><p>{esc(x["text"])}</p><a href="{esc(x["url"])}" rel="nofollow noopener" target="_blank">{esc(x["source"])}</a></div>' for x in p.get("stats", []))
    return f'<div class="stats">{cards}</div>' if cards else ""


# ---------------- post page ----------------
def share_bar(url, title):
    q = urllib.parse.quote
    prompt = q(f"Summarize the key points of {url} and explain what a small business owner should take away from it.")
    return f'''<div class="actions">
      <a class="act pref" href="https://www.google.com/preferences/source?q=morningtelos.com" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.5 12.3c0-.8-.1-1.5-.2-2.3H12v4.3h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2-1.9 3.2-4.7 3.2-8z"/><path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.7c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.8A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.8 14.2a6.6 6.6 0 0 1 0-4.3V7.1H2.1a11 11 0 0 0 0 9.9z"/><path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 7.1l3.7 2.8C6.7 7.3 9.1 5.4 12 5.4z"/></svg><span>Add as a preferred<br>source on Google</span></a>
      <div class="act ai"><button type="button" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>AI Summary</button>
        <div class="ai-menu"><a href="https://chatgpt.com/?q={prompt}" target="_blank" rel="noopener">Summarize with ChatGPT</a><a href="https://www.perplexity.ai/search?q={prompt}" target="_blank" rel="noopener">Summarize with Perplexity</a><a href="https://claude.ai/new?q={prompt}" target="_blank" rel="noopener">Summarize with Claude</a></div></div>
      <button class="act copy" type="button" data-url="{url}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg><span>Copy link</span></button>
      <span class="shares"><a href="https://www.linkedin.com/sharing/share-offsite/?url={q(url)}" target="_blank" rel="noopener" aria-label="Share on LinkedIn"><svg viewBox="0 0 24 24"><path d="M4 9h3v11H4zM5.5 4a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6zM10 9h3v1.6c.5-.9 1.7-1.8 3.4-1.8 3.3 0 3.6 2.2 3.6 5V20h-3v-5.4c0-1.3 0-3-1.8-3s-2.2 1.4-2.2 2.9V20h-3z"/></svg></a><a href="https://x.com/intent/post?url={q(url)}&text={q(title)}" target="_blank" rel="noopener" aria-label="Share on X"><svg viewBox="0 0 24 24"><path d="M17.8 3h3.1l-6.8 7.8 8 10.2h-6.3l-4.9-6.4L5.3 21H2.2l7.3-8.3L1.8 3h6.4l4.4 5.9zM16.7 19.2h1.7L7.4 4.7H5.6z"/></svg></a><a href="mailto:?subject={q(title)}&body={q(url)}" aria-label="Share by email"><svg viewBox="0 0 24 24"><path d="M3 5h18v14H3z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3 6l9 7 9-7" fill="none" stroke="currentColor" stroke-width="1.8"/></svg></a></span>
    </div>'''


def build_post(p, posts):
    url = f"{BASE}/blog/{p['slug']}/"
    cat_name = CATEGORIES[p["category"]][0]
    body = p["body"]
    has_list = "[[ENTRIES]]" in body
    # convert body with placeholders protected
    body = body.replace("[[TABLE]]", "\n\nTABLEPLACEHOLDER\n\n").replace("[[ENTRIES]]", "\n\nENTRIESPLACEHOLDER\n\n").replace("[[STATS]]", "\n\nSTATSPLACEHOLDER\n\n")
    body = re.sub(r"\[\[TPL ([\w-]+)\]\]", lambda m: f"\n\nTPLPLACEHOLDER:{m.group(1)}\n\n", body)
    content = md(body)
    # heading ids + toc
    toc = []

    def hid(m):
        tag, inner = m.group(1), m.group(2)
        i = slugify(inner)
        toc.append((tag, re.sub(r"<[^>]+>", "", inner), i))
        return f'<{tag} id="{i}">{inner}</{tag}>'
    content = re.sub(r"<(h2)>(.*?)</h2>", hid, content)
    if has_list:
        content = content.replace("<p>TABLEPLACEHOLDER</p>", table_html(p)).replace("<p>ENTRIESPLACEHOLDER</p>", entries_html(p))
    content = content.replace("<p>STATSPLACEHOLDER</p>", stats_html(p))
    content = re.sub(r"<p>TPLPLACEHOLDER:([\w-]+)</p>", lambda m: tpl_html(p, m.group(1)), content)
    # first blockquote = short answer box
    content = content.replace("<blockquote>", '<blockquote class="answer">', 1)
    faqs = p.get("faqs", [])
    faq_html = ""
    if faqs:
        faq_html = '<h2 id="faq">FAQ</h2>' + "".join(f'<h3>{esc(f["q"])}</h3>{md(f["a"])}' for f in faqs)
        toc.append(("h2", "FAQ", "faq"))
    sources = p.get("sources", [])
    src_html = ""
    if sources:
        src_html = '<div class="sources"><h4>Sources</h4><ol>' + "".join(f'<li><a href="{esc(s["url"])}" rel="nofollow noopener" target="_blank">{esc(s["title"])}</a></li>' for s in sources) + "</ol></div>"
    # toc: h2s, plus entries nested under the list heading
    toc_items = ""
    for tag, text, i in toc:
        toc_items += f'<li><a href="#{i}">{esc(text)}</a></li>'
        if has_list and p.get("list_heading") and slugify(p["list_heading"]) == i:
            toc_items += '<li class="sub"><ol>' + "".join(f'<li><a href="#{slugify(e["name"])}">{n}. {esc(e["name"])}</a></li>' for n, e in enumerate(p["entries"], 1)) + "</ol></li>"
    related_svc = "".join(f'<a class="icard" href="/services/{s}/"><b>{SERVICES[s][0]}</b><small>{SERVICES[s][1]}</small><span>→</span></a>' for s in p.get("services", []))
    others = [o for o in posts if o["slug"] != p["slug"]][:3]
    related_posts = "".join(card(o) for o in others)

    # schema
    img_abs = BASE + p["image"]
    graph = [
        {"@type": "BlogPosting", "@id": url + "#article", "headline": p["title"], "description": p["description"], "image": img_abs,
         "datePublished": str(p["date"]), "dateModified": str(p["updated"]), "mainEntityOfPage": url, "articleSection": cat_name,
         "author": {"@type": "Organization", "name": p.get("author", "Morning Telos"), "url": BASE + "/"},
         "publisher": {"@type": "Organization", "name": "Morning Telos", "url": BASE + "/"}},
        {"@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Blog", "item": BASE + "/blog/"},
            {"@type": "ListItem", "position": 2, "name": cat_name, "item": f"{BASE}/blog/category/{p['category']}/"},
            {"@type": "ListItem", "position": 3, "name": p["title"], "item": url}]},
    ]
    if faqs:
        graph.append({"@type": "FAQPage", "mainEntity": [{"@type": "Question", "name": f["q"], "acceptedAnswer": {"@type": "Answer", "text": f["a"]}} for f in faqs]})
    if has_list:
        graph.append({"@type": "ItemList", "name": p["title"], "itemListElement": [
            {"@type": "ListItem", "position": n, "name": e["name"], "url": e["url"]} for n, e in enumerate(p["entries"], 1)]})
    schema = f'<script type="application/ld+json">{json.dumps({"@context": "https://schema.org", "@graph": graph})}</script>\n'

    page = head(f'{p["title"]} | Morning Telos', p["description"], url, schema) + f'''<main id="top" class="blog-post">
  <header class="post-hero">
    <div class="wrap post-hero-grid">
      <div>
        <nav class="crumbs" aria-label="Breadcrumb"><a href="/blog/">Blog</a><span>›</span><a class="tag" href="/blog/category/{p["category"]}/">{esc(cat_name)}</a></nav>
        <h1>{esc(p["title"])}</h1>
        <p class="dek">{esc(p["description"])}</p>
        <div class="byline"><span class="av">{MARK}</span><span><b>{esc(p.get("author", "Morning Telos"))}</b><small>Updated {fmt_date(p["updated"])} / {p["read"]} min read</small></span></div>
        {share_bar(url, p["title"])}
      </div>
      <div class="post-art"><img src="{p["image"]}" alt="{esc(p.get("image_alt", ""))}" width="1200" height="900"></div>
    </div>
  </header>
  <div class="wrap post-grid">
    <article class="prose">
      {content}
      {faq_html}
      {src_html}
    </article>
    <aside class="post-side">
      <div class="toc"><div class="toc-h"><b>On this page</b><small>{p["read"]} min read</small></div><ol>{toc_items}</ol></div>
      <div class="side-cta"><b>Want systems that run while you sleep?</b><p>Book a free 30-minute Telos Session. We'll find your highest-leverage first move.</p><a class="btn" href="/book/">Book a Telos Session →</a></div>
    </aside>
  </div>
  <section class="post-cta wrap"><div><h2>Want systems that run <span class="clay">while you sleep?</span></h2><p>Morning Telos builds software and AI automation for founders, operators and decision makers.</p></div><a class="btn btn-dark btn-lg" href="/book/">Book a Telos Session <span class="arr">→</span></a></section>
  {f'<section class="istrip wrap"><h2 class="big">Related <span class="clay">services.</span></h2><div class="igrid">{related_svc}</div></section>' if related_svc else ''}
  {f'<section class="more wrap"><h2 class="big">More from <span class="clay">the blog.</span></h2><div class="pgrid">{related_posts}</div></section>' if related_posts else ''}
</main>
''' + FOOTER
    out = SITE / "blog" / p["slug"] / "index.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(page)


def card(p, big=False):
    cat = CATEGORIES[p["category"]][0]
    return (f'<a class="pcard{" big" if big else ""}" href="/blog/{p["slug"]}/" data-cat="{p["category"]}"><span class="pimg"><img src="{p["image"]}" alt="" loading="lazy" width="1200" height="900"></span>'
            f'<span class="pbody"><span class="pcat">{esc(cat)}</span><b>{esc(p["title"])}</b>{"<small>" + esc(p["description"]) + "</small>" if big else ""}'
            f'<span class="pmeta">{fmt_date(p["updated"])} · {p["read"]} min read</span></span></a>')


def build_index(posts, cat=None):
    if cat:
        name, blurb = CATEGORIES[cat]
        title, h1, url = f"{name} | Morning Telos Blog", name, f"{BASE}/blog/category/{cat}/"
        listed = [p for p in posts if p["category"] == cat]
    else:
        title, h1, url, blurb = "The Morning Telos Blog | AI Automation Guides, Costs & Agency Picks", "The Morning Telos Blog", f"{BASE}/blog/", "Plain-English guides to AI automation: what to automate, what it costs, and who to hire."
        listed = posts
    used = [c for c in CATEGORIES if any(p["category"] == c for p in posts)]
    chips = f'<a class="bchip{"" if cat else " on"}" href="/blog/">All</a>' + "".join(f'<a class="bchip{" on" if c == cat else ""}" href="/blog/category/{c}/">{esc(CATEGORIES[c][0])}</a>' for c in used)
    featured = card(listed[0], big=True) if listed and not cat else ""
    grid = "".join(card(p) for p in (listed[1:] if featured else listed))
    schema = f'<script type="application/ld+json">{json.dumps({"@context": "https://schema.org", "@type": "Blog" if not cat else "CollectionPage", "name": h1, "url": url, "publisher": {"@type": "Organization", "name": "Morning Telos", "url": BASE + "/"}})}</script>\n'
    page = head(title, blurb, url, schema) + f'''<main id="top" class="blog-index">
  <header class="bi-hero wrap">
    {'<nav class="crumbs" aria-label="Breadcrumb"><a href="/blog/">Blog</a><span>›</span><span>' + esc(h1) + '</span></nav>' if cat else ''}
    <h1>{esc(h1)}</h1>
    <p class="dek">{esc(blurb)}</p>
    <div class="chips">{chips}</div>
  </header>
  <section class="wrap">{featured}<div class="pgrid">{grid}</div></section>
  <section class="post-cta wrap"><div><h2>Get new guides <span class="clay">in your inbox.</span></h2><p>One practical email when we publish. No spam.</p></div><a class="btn btn-dark btn-lg" href="mailto:meet@morningtelos.com?subject=Subscribe%20to%20the%20blog">Subscribe <span class="arr">→</span></a></section>
</main>
''' + FOOTER
    out = SITE / ("blog/category/" + cat if cat else "blog") / "index.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(page)


def build_rss(posts):
    items = "".join(f'<item><title>{esc(p["title"])}</title><link>{BASE}/blog/{p["slug"]}/</link><guid>{BASE}/blog/{p["slug"]}/</guid>'
                    f'<pubDate>{dt.datetime.combine(dt.date.fromisoformat(str(p["date"])), dt.time(9)).strftime("%a, %d %b %Y %H:%M:%S +0000")}</pubDate><description>{esc(p["description"])}</description></item>' for p in posts)
    (SITE / "blog" / "rss.xml").write_text(f'<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>Morning Telos Blog</title><link>{BASE}/blog/</link><description>AI automation guides, costs and agency picks.</description>{items}</channel></rss>\n')


def build_sitemap():
    urls = []
    for f in sorted(SITE.rglob("index.html")):
        rel = f.parent.relative_to(SITE).as_posix()
        if rel.startswith("demo"):
            continue
        urls.append("" if rel == "." else rel + "/")
    urls.sort(key=lambda u: (u.count("/"), u))
    (SITE / "sitemap.xml").write_text('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + "".join(f"  <url><loc>{BASE}/{u}</loc></url>\n" for u in urls) + "</urlset>\n")
    return len(urls)


if __name__ == "__main__":
    posts = load_posts()
    for p in posts:
        build_post(p, posts)
        print("post", p["slug"], f'{p["read"]} min')
    build_index(posts)
    for c in CATEGORIES:
        if any(p["category"] == c for p in posts):
            build_index(posts, c)
    build_rss(posts)
    print("sitemap urls", build_sitemap())
