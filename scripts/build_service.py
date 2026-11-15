#!/usr/bin/env python3
"""Builds service landing pages from shared parts of site/index.html.

Usage: python3 scripts/build_service.py
Writes site/services/<slug>/index.html for every page in PAGES.
The homepage is the source for the nav, logo strip, steps, banners,
final call to action and footer, so edits there flow into every page.
"""
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent / "site"
H = (ROOT / "index.html").read_text()


def cut(a, b):
    i = H.index(a)
    return H[i:H.index(b, i)]


HEAD = H[:H.index("<main")]
LOGOS = cut("  <!-- LOGOS -->", "  <!-- 2. TELOS -->")
HOW = cut("  <!-- 5. HOW -->", "  <!-- 6. DEMO -->")
RIBBONS = cut("  <!-- RIBBONS -->", "  <!-- 8. FAQ -->")
FINAL = cut("  <!-- 9. FINAL -->", "</main>")
FOOTER = H[H.index("</main>"):]
AVS = re.search(r'<div class="avs".*?</div>', H, re.S).group(0)
VIZ_YOU = re.search(r'<div class="viz viz-you".*?</svg>\s*</div>', H, re.S).group(0)
VIZ_TOOLS = re.search(r'<div class="viz viz-tools".*?Nothing connects</span></div>', H, re.S).group(0)
CK = '<span class="ck"><svg viewBox="0 0 16 16"><path d="M3 8.5l3 3 7-7"/></svg></span>'
CHECK = '<svg viewBox="0 0 12 12"><path d="M2 6.5l2.5 2.5L10 3"/></svg>'


def viz_resp(a, av, b, bv, note):
    return (f'<div class="viz viz-resp" aria-hidden="true"><div class="row slow"><span>{a}</span><span class="rtrack"><i></i></span><b>{av}</b></div>'
            f'<div class="row fast"><span>{b}</span><span class="rtrack"><i></i></span><b>{bv}</b></div><div class="lost">{note}</div></div>')


def viz_chat(lines, cnt):
    return '<div class="viz viz-chat" aria-hidden="true">' + ''.join(f'<span class="bub">{x}</span>' for x in lines) + f'<span class="cnt">{cnt}</span></div>'


def viz_data(tiles, target, icon):
    rows = ''.join(f'<div class="dt"><span class="tile">{n}</span><span class="lane"><i style="--dl:{d}s;--du:{u}s"></i></span></div>'
                   for n, d, u in zip(tiles, [0, .8, 1.6, .4, 1.2], [3.2, 4.1, 3.6, 4.6, 3.9]))
    return f'<div class="viz viz-data" aria-hidden="true"><div class="dts">{rows}</div><div class="decide"><svg viewBox="0 0 40 40">{icon}</svg><span>{target}</span></div></div>'


def viz_week(cols, note):
    c = ''.join(f'<div><div class="col"><i style="--h:{h}%;--dl:{k*0.12:.2f}s"></i></div><div class="d">{d}</div></div>' for k, (d, h) in enumerate(cols))
    return f'<div class="viz viz-week" aria-hidden="true">{c}<div class="tot">{note}</div></div>'


def faq_block(title, faqs):
    q = ''.join(f'      <div class="qa rv"><button aria-expanded="false">{a}<span class="pm"></span></button><div class="ans"><div><p>{b}</p></div></div></div>\n' for a, b in faqs)
    return f'''  <section class="faq" id="faq">
    <div class="wrap">
      <div class="faq-side rv"><h2 class="big">{title}</h2><a href="mailto:hello@morningtelos.com">Ask us directly <span>→</span></a></div>
      <div class="faq-list">
{q}      </div>
    </div>
  </section>

'''


def build(p):
    head = re.sub(r"<title>.*?</title>", f"<title>{p['title']}</title>", HEAD)
    head = re.sub(r'<meta name="description" content="[^"]*">', f'<meta name="description" content="{p["desc"]}">', head)
    url = f"https://morningtelos.com/services/{p['slug']}/"
    schema = {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [{"@type": "Question", "name": a, "acceptedAnswer": {"@type": "Answer", "text": b}} for a, b in p["faqs"]]}
    svc = {"@context": "https://schema.org", "@type": "Service", "name": p["name"], "serviceType": p["service_type"], "provider": {"@type": "Organization", "name": "Morning Telos", "url": "https://morningtelos.com/"}, "url": url}
    extra = f'<link rel="canonical" href="{url}">\n<script type="application/ld+json">{json.dumps(schema)}</script>\n<script type="application/ld+json">{json.dumps(svc)}</script>\n<style>{p.get("css", "")}</style>\n'
    head = head.replace('<link rel="stylesheet" href="/assets/site.css">', '<link rel="stylesheet" href="/assets/site.css">\n' + extra)

    l1, l2 = p["h1"]
    words = [(w, False) for w in l1.split()] + [None] + [(w, True) for w in l2.split()]
    h1, d = "", .05
    for w in words:
        if w is None:
            h1 += "<br>\n          "
            continue
        cls = ' class="clay"' if w[1] else ''
        h1 += f'<span class="w"><span style="--d:{d:.2f}s"{cls}>{w[0]}</span></span> '
        d += .08
    chips = ''.join(f'<div class="chip f{k+1}" style="--fd:{[0,1.2,.6,1.8][k]}s">{CK}<span><b>{a}</b><small>{b}</small></span></div>' for k, (a, b) in enumerate(p["chips"]))
    glow = f'<div class="gear-glow" style="--gx:{p["glow"][0]};--gy:{p["glow"][1]}" aria-hidden="true"></div>' if p.get("glow") else ''
    hero = f'''<main id="top">
  <section class="hero svc" id="hero">
    <div class="wrap">
      <div>
        <div class="crumb rv"><a href="/">Home</a> / <a href="/#services">Services</a> / {p["name"]}</div>
        <h1 aria-label="{p["h1_label"]}">
          {h1.strip()}
        </h1>
        <p class="lead rv" style="--d:.55s">{p["lead"]}</p>
        <div class="hero-ctas rv" style="--d:.7s">
          <a class="btn btn-dark btn-lg mag" href="#book">Book a Telos Session <span class="arr">→</span></a>
          <a class="btn btn-ghost btn-lg" href="#{p["second_cta"][1]}">{p["second_cta"][0]}</a>
        </div>
        <div class="hero-proof rv" style="--d:.85s">{AVS}<p><b>For founders, operators and decision makers.</b><br>{p["proof"]}</p></div>
      </div>
      <div class="stage" id="stage">
        <div class="sun"></div>
        <div class="sun-rays"></div>
        <img class="statue" src="/img/{p["img"]}" alt="{p["img_alt"]}" width="900" height="{p.get("img_h", 1125)}">
        {glow}
        {chips}
      </div>
    </div>
  </section>

'''
    items = ''
    for k, (icon, t, desc, viz) in enumerate(p["problems"]):
        items += f'''        <li class="sitem">
          <div class="s-icon"><svg viewBox="0 0 24 24">{icon}</svg></div>
          <div class="s-body"><span class="s-n">0{k+1}</span><h3>{t}</h3><p>{desc}</p>
            {viz}</div>
        </li>
'''
    sh, sl, (mname, levels, ticks) = p["stall_head"], p["stall_lead"], p["meter"]
    stall = f'''  <section class="stall" id="busy">
    <div class="wrap stall-grid">
      <div class="stall-side">
        <h2 class="big rv">{sh}</h2>
        <p class="lead rv" style="--d:.1s">{sl}</p>
        <div class="strain rv" style="--d:.2s" data-levels="{levels}" aria-hidden="true">
          <div class="strain-top"><span>{mname}</span><b id="strainNum">0%</b></div>
          <div class="strain-bar"><i id="strainBar"></i></div>
          <div class="strain-ticks">{''.join(f"<span>{x}</span>" for x in ticks)}</div>
        </div>
      </div>
      <ol class="stall-list" id="stallList">
        <span class="stall-fill" aria-hidden="true"></span>
{items}      </ol>
    </div>
  </section>

'''
    cards = ''.join(f'''<div class="acard rv tilt" style="--d:{k*0.08:.2f}s"><div class="ic"><svg viewBox="0 0 24 24">{ic}</svg></div><h3>{t}</h3><p>{d}</p><ul>{''.join(f"<li>{x}</li>" for x in tags)}</ul></div>'''
                    for k, (t, d, tags, ic) in enumerate(p["cards"]))
    auto = f'''  <section class="auto" id="services">
    <div class="wrap">
      <div class="head">
        <h2 class="big rv">{p["cards_head"]}</h2>
        <p class="lead rv" style="--d:.1s">{p["cards_lead"]}</p>
      </div>
      <div class="sgrid">{cards}</div>
    </div>
  </section>

'''
    cells = ''.join(f'<div class="ocell rv" style="--d:{k*0.08:.2f}s"><b><span class="countup" data-to="{n}">0</span><em>{u}</em></b><span>{t}</span></div>' for k, (n, u, t) in enumerate(p["outcomes"]))
    outc = f'''  <section class="outc wrap">
    <div class="head"><h2 class="big rv">{p["outc_head"]}</h2></div>
    <div class="ogrid">{cells}</div>
    <p class="onote rv">{p["outc_note"]}</p>
  </section>

'''
    how = HOW.replace('We start with <span class="clay">the end.</span>', p["how_head"])
    for old, new in zip(["Define where the business is headed and what is holding it back.",
                         "Map your operations, data, and decisions. Rank the moves with the most leverage.",
                         "Ship software and AI systems into real work, alongside your team.",
                         "Measure, refine, and expand what works, month after month."], p["how_steps"]):
        how = how.replace(old, new)
    if p.get("step_names"):
        for old, new in zip(["<h3>Telos Session</h3>", "<h3>Telos Audit</h3>", "<h3>Build</h3>", "<h3>Compound</h3>"], p["step_names"]):
            how = how.replace(old, new)
    final = FINAL.replace("<p>Tell us where your business is headed and where it is stuck. We'll map your highest-leverage first move.</p>", f"<p>{p['final_line']}</p>")
    page = head + hero + LOGOS + stall + auto + p["signature"] + outc + how + RIBBONS + faq_block(p["faq_title"], p["faqs"]) + final + FOOTER
    out = ROOT / "services" / p["slug"] / "index.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(page)
    print("wrote", out.relative_to(ROOT.parent), len(page))


# ---------- signature sections ----------
SOFTWARE_SIG = '''  <section class="sig" id="demo">
    <div class="wrap">
      <div class="head">
        <h2 class="big rv">One screen for <span class="clay">the whole business.</span></h2>
        <p class="lead rv" style="--d:.1s">An example of what we build: an internal dashboard that pulls orders, customers and stock into one place your team actually uses.</p>
      </div>
      <div class="app dash draw rv rv-s">
        <div class="app-bar"><i></i><i></i><i></i><span class="ttl">example · ops.yourcompany.com</span><span class="clock"><span class="dot-live"></span>live</span></div>
        <div class="dash-body">
          <nav class="dash-nav"><span class="on">Overview</span><span>Orders</span><span>Customers</span><span>Inventory</span><span>Reports</span><span>Team</span></nav>
          <div class="dash-main">
            <div class="kpis">
              <div class="kpi"><small>Revenue this week</small><b>$<span class="countup" data-to="48">0</span>k</b><em>+12% vs last week</em></div>
              <div class="kpi"><small>Open orders</small><b><span class="countup" data-to="312">0</span></b><em>27 ship today</em></div>
              <div class="kpi"><small>On-time delivery</small><b><span class="countup" data-to="98" data-suffix="%">0%</span></b><em>Up from 91%</em></div>
            </div>
            <div class="dash-row">
              <div class="chart"><small>Orders by day</small><div class="cbars">''' + ''.join(f'<i style="--h:{h}%;--dl:{k*0.07:.2f}s"></i>' for k, h in enumerate([40, 55, 48, 62, 70, 66, 82, 78, 90, 86, 95, 100])) + '''</div></div>
              <div class="tbl"><small>Latest orders</small>''' + ''.join(f'<div class="tr" style="--dl:{.6+k*0.18:.2f}s"><span>{a}</span><span class="pill {c}">{b}</span></div>' for k, (a, b, c) in enumerate([("#2041 · Reyes Co.", "Shipped", "ok"), ("#2040 · Park Fitness", "Packing", ""), ("#2039 · Okafor Dental", "Shipped", "ok"), ("#2038 · Chen Studio", "Paid", "")])) + '''</div>
            </div>
          </div>
        </div>
      </div>
      <p class="onote rv">Sample data. Every build is designed around your own workflows.</p>
    </div>
  </section>

'''
PARTNER_SIG = '''  <section class="sig" id="demo">
    <div class="wrap">
      <div class="head">
        <h2 class="big rv">Every month, <span class="clay">something gets better.</span></h2>
        <p class="lead rv" style="--d:.1s">An example of the monthly report you get on a partnership plan: what we fixed, what we shipped, and what comes next.</p>
      </div>
      <div class="app report draw rv rv-s">
        <div class="app-bar"><i></i><i></i><i></i><span class="ttl">example · monthly report</span><span class="clock"><span class="dot-live"></span>all systems running</span></div>
        <div class="rep-body">
          <div class="rep-chart">
            <small>Hours saved per month</small>
            <b class="rep-big"><span class="countup" data-to="64">0</span><em>hrs this month</em></b>
            <svg viewBox="0 0 320 140" preserveAspectRatio="none" aria-hidden="true"><path class="area" d="M0 128 L64 112 L128 96 L192 70 L256 46 L320 18 L320 140 L0 140 Z"/><path class="line" d="M0 128 L64 112 L128 96 L192 70 L256 46 L320 18"/></svg>
            <div class="months"><span>Jun</span><span>Jul</span><span>Aug</span><span>Sep</span><span>Oct</span><span>Nov</span></div>
          </div>
          <div class="rep-list">
            <small>This month</small>
            <ul>''' + ''.join(f'<li style="--dl:{.5+k*0.35:.2f}s"><span class="bx">{CHECK}</span><span><b>{a}</b><em>{b}</em></span></li>' for k, (a, b) in enumerate([("Fixed Stripe sync", "after an API change, same day"), ("Added WhatsApp to the lead agent", "new channel, live"), ("New weekly cash report", "in Slack every Monday"), ("Next: invoice reminders", "planned for December")])) + '''</ul>
          </div>
        </div>
      </div>
      <p class="onote rv">Sample report. Yours tracks the goals we set together.</p>
    </div>
  </section>

'''
SIG_CSS = '''
  .sig { padding: 40px 0 120px; }
  .sig .head { display: grid; grid-template-columns: 1.2fr 1fr; gap: 48px; align-items: end; margin-bottom: 40px; }
  .dash-body { display: grid; grid-template-columns: 180px 1fr; min-height: 420px; }
  .dash-nav { border-right: 1px solid var(--line); padding: 20px 14px; display: grid; align-content: start; gap: 4px; background: var(--ivory); }
  .dash-nav span { font-size: 14px; color: var(--ink-3); padding: 8px 12px; border-radius: 8px; opacity: 0; transform: translateX(-10px); transition: opacity .5s, transform .5s var(--ease); }
  .dash-nav span.on { background: var(--white); color: var(--ink); border: 1px solid var(--line); }
  .dash.in .dash-nav span { opacity: 1; transform: none; }
  .dash-nav span:nth-child(2) { transition-delay: .05s; } .dash-nav span:nth-child(3) { transition-delay: .1s; } .dash-nav span:nth-child(4) { transition-delay: .15s; } .dash-nav span:nth-child(5) { transition-delay: .2s; } .dash-nav span:nth-child(6) { transition-delay: .25s; }
  .dash-main { padding: 22px; display: grid; gap: 16px; align-content: start; }
  .kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  .kpi { border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; background: var(--white); opacity: 0; transform: translateY(10px); transition: opacity .5s .2s, transform .6s .2s var(--ease); }
  .kpi:nth-child(2) { transition-delay: .3s; } .kpi:nth-child(3) { transition-delay: .4s; }
  .dash.in .kpi { opacity: 1; transform: none; }
  .kpi small, .chart small, .tbl small, .rep-chart small, .rep-list small { display: block; font-family: var(--mono); font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-4); margin-bottom: 8px; }
  .kpi b { font-family: var(--serif); font-weight: 400; font-size: 34px; line-height: 1; }
  .kpi em { display: block; font-style: normal; font-size: 12px; color: #3f7d4a; margin-top: 6px; }
  .dash-row { display: grid; grid-template-columns: 1.2fr 1fr; gap: 12px; }
  .chart, .tbl { border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; background: var(--white); }
  .cbars { display: flex; align-items: end; gap: 6px; height: 130px; }
  .cbars i { flex: 1; height: var(--h); border-radius: 4px 4px 2px 2px; background: var(--clay-soft); transform: scaleY(0); transform-origin: bottom; transition: transform .8s var(--ease) calc(.4s + var(--dl)); }
  .cbars i:nth-child(n+9) { background: var(--clay); }
  .dash.in .cbars i { transform: scaleY(1); }
  .tr { display: flex; justify-content: space-between; align-items: center; padding: 9px 0; border-bottom: 1px solid var(--line); font-size: 13px; opacity: 0; transform: translateX(14px); transition: opacity .5s var(--dl), transform .6s var(--ease) var(--dl); }
  .tr:last-child { border-bottom: 0; }
  .dash.in .tr { opacity: 1; transform: none; }
  .rep-body { display: grid; grid-template-columns: 1.2fr 1fr; min-height: 380px; }
  .rep-chart { padding: 24px; border-right: 1px solid var(--line); }
  .rep-big { display: block; font-family: var(--serif); font-weight: 400; font-size: 56px; line-height: 1; margin-bottom: 18px; }
  .rep-big em { font-style: normal; font-family: var(--sans); font-size: 14px; color: var(--ink-3); margin-left: 8px; }
  .rep-chart svg { width: 100%; height: 160px; display: block; overflow: visible; }
  .rep-chart .line { fill: none; stroke: var(--clay); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 420; stroke-dashoffset: 420; transition: stroke-dashoffset 2s var(--ease) .3s; }
  .rep-chart .area { fill: rgba(217,119,87,.12); opacity: 0; transition: opacity 1s 1.4s; }
  .rep-chart circle { fill: var(--clay); opacity: 0; transition: opacity .4s 2.2s; animation: ping2 1.6s ease-out infinite 2.4s; transform-origin: 320px 18px; }
  @keyframes ping2 { 50% { r: 8; } }
  .report.in .line { stroke-dashoffset: 0; } .report.in .area, .report.in circle { opacity: 1; }
  .months { display: flex; justify-content: space-between; margin-top: 8px; font-family: var(--mono); font-size: 11px; color: var(--ink-4); }
  .rep-list { padding: 24px; }
  .rep-list ul { list-style: none; display: grid; gap: 14px; }
  .rep-list li { display: flex; gap: 12px; align-items: flex-start; opacity: 0; transform: translateY(8px); transition: opacity .5s var(--dl), transform .6s var(--ease) var(--dl); }
  .report.in .rep-list li { opacity: 1; transform: none; }
  .rep-list .bx { width: 22px; height: 22px; border-radius: 6px; background: var(--clay); display: grid; place-items: center; flex: none; margin-top: 2px; }
  .rep-list li:last-child .bx { background: var(--ivory-3); }
  .rep-list .bx svg { width: 11px; height: 11px; stroke: #fff; fill: none; stroke-width: 3; }
  .rep-list li:last-child .bx svg { stroke: var(--ink-4); }
  .rep-list b { display: block; font-weight: 600; font-size: 15px; }
  .rep-list em { font-style: normal; font-size: 13px; color: var(--ink-3); }
  @media (max-width: 1000px) { .sig .head { grid-template-columns: 1fr; gap: 18px; } .dash-body, .rep-body { grid-template-columns: 1fr; } .dash-nav { display: none; } .rep-chart { border-right: 0; border-bottom: 1px solid var(--line); } .dash-row { grid-template-columns: 1fr; } }
  @media (max-width: 640px) { .kpis { grid-template-columns: 1fr; } .sig { padding-bottom: 80px; } }
'''

PAGES = [
    dict(
        slug="custom-software", name="Custom software", service_type="Custom business software development",
        title="Custom Business Software Development Agency | Morning Telos",
        desc="Custom software development for small and growing businesses. We build CRMs, internal tools, client portals and dashboards around how your business actually runs.",
        h1=("Software built around", "how you run."), h1_label="Custom business software built around how your business runs",
        lead="A custom software development agency for founders and operators. We build CRMs, internal tools, client portals and dashboards that fit your workflows, so your team stops working around the tools.",
        second_cta=("See an example", "demo"), proof="Free 30-minute call. We map what to build first.",
        img="software.webp", img_h=787, img_alt="Marble statue of a young Greek man holding a glowing laptop", glow=("70%", "62%"),
        chips=[("Orders dashboard", "one source of truth"), ("Client portal", "launched"), ("Spreadsheets", "retired"), ("Team access", "set by role")],
        stall_head='When the tools <span class="clay">stop fitting.</span>',
        stall_lead="Off-the-shelf apps get you started. As you grow, your team spends more time bending the tools than doing the work.",
        meter=("Workaround load", "25,48,72,92", ["Fine", "Messy", "Blocking"]),
        problems=[
            ('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 14h18M9 4v16"/>', "Spreadsheets run the business", "Orders, stock and clients tracked in files with names like final_v7, edited by five people.",
             viz_chat(["Orders_final_v7.xlsx", "Orders_final_v7 (1).xlsx", "Orders_REAL_final.xlsx", "Copy of Orders_final.xlsx"], "which one is right?")),
            ('<path d="M14 6l4 4-8 8H6v-4z"/><path d="M4 20h16"/>', "Tools that don't fit how you work", "Your process has steps the software doesn't, so people fill the gaps by hand.",
             viz_resp("Workarounds", "6 h/wk", "Custom tool", "20 min", "Each workaround is a step someone can forget.")),
            ('<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>', "Data spread across five apps", "Nobody can see the full picture without exporting and stitching files together.",
             viz_data(["CRM", "Stripe", "Sheets", "Shopify", "Email"], "One view", '<rect x="7" y="9" width="26" height="22" rx="3"/><path d="M7 16h26M14 16v15"/>')),
            ('<rect x="4" y="6" width="16" height="12" rx="2"/><path d="M8 10h8M8 14h5"/>', "Paying for seats nobody uses", "Subscriptions stack up for features you don't need and gaps you still fill by hand.",
             viz_week([("CRM", 70), ("PM", 55), ("Forms", 40), ("BI", 85), ("Docs", 35)], "Example: shaded part of each bill goes unused.")),
        ],
        cards_head='What we <span class="clay">build.</span>', cards_lead="Software that fits your business today and grows with it, with AI built in where it helps.",
        cards=[
            ("Custom CRMs", "A CRM shaped around your sales process, with the fields and steps your team actually uses.", ["Pipelines", "Follow-ups", "AI notes"], '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11"/>'),
            ("Internal tools", "Admin panels and back-office apps that replace spreadsheets and manual steps.", ["Approvals", "Inventory", "Scheduling"], '<path d="M14 6l4 4-8 8H6v-4z"/><path d="M4 20h16"/>'),
            ("Client portals", "A branded place for clients to book, pay, upload files and check status.", ["Bookings", "Payments", "Files"], '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>'),
            ("Dashboards", "Live numbers from every tool on one screen, so decisions stop waiting on data.", ["KPIs", "Forecasts", "Alerts"], '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
            ("Web & mobile apps", "Customer-facing apps for products and services that need more than a website.", ["iOS", "Android", "Web"], '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>'),
            ("AI features", "Search, summaries, drafting and smart routing built right into your software.", ["Claude", "OpenAI", "Gemini"], '<rect x="5" y="7" width="14" height="12" rx="3"/><circle cx="10" cy="13" r="1.3"/><circle cx="14" cy="13" r="1.3"/><path d="M12 7V4"/>'),
        ],
        signature=SOFTWARE_SIG, css=SIG_CSS,
        outc_head='What we <span class="clay">build toward.</span>',
        outcomes=[(1, "place", "for your data, one source of truth"), (100, "%", "yours: the code and the data"), (2, "weeks", "per release, so you see progress early"), (0, "workarounds", "for the steps that matter most")],
        outc_note="Targets we set with each client during the Telos Audit. Timelines depend on scope.",
        how_head='From whiteboard to <span class="clay">working software.</span>',
        how_steps=["Walk us through how the business runs and where the tools get in the way.", "Map the workflows, data and users. Scope a first release that pays off fast.", "Design, build and ship in short releases your team uses right away.", "Add features, connect new tools and keep everything fast and secure."],
        faq_title="Custom software questions",
        faqs=[
            ("How do I know if my business needs custom software?", "If your team works around your tools, copies data between apps, or runs key processes in spreadsheets, custom software usually pays for itself. The Telos Session will tell you either way."),
            ("Is custom software expensive?", "We start with the smallest release that solves the biggest problem, so you see value before spending more. After the audit you get a fixed price for each release."),
            ("Who owns the code?", "You do. The code, the data and the accounts belong to your business."),
            ("Can you connect it to the tools we already use?", "Yes. We connect to your CRM, payments, email, accounting and other tools, so data flows in one direction with no copy-paste."),
            ("How long does it take?", "Most first releases ship within a few weeks, then we add features in short cycles. You get a clear timeline after the Telos Audit."),
            ("Can you work with our in-house developers?", "Yes. We can lead the build, work alongside your team, or hand over a clean codebase with documentation."),
        ],
        final_line="Show us the spreadsheet or tool your team fights with. We'll scope the first release worth building.",
    ),
    dict(
        slug="partnership", name="Ongoing partnership", service_type="Managed AI automation services",
        title="Managed AI Automation Agency & Ongoing Support | Morning Telos",
        desc="A managed AI automation agency on a simple monthly plan. We monitor, fix and improve your software and automations, and ship new systems every month.",
        h1=("Systems that keep", "getting better."), h1_label="Managed AI automation and ongoing support on a monthly plan",
        lead="Managed AI automation services for founders and operators. On one monthly plan we monitor everything we build, fix issues fast, and ship new automations every month, so your systems compound instead of decay.",
        second_cta=("See a monthly report", "demo"), proof="Free 30-minute call. We review what you run today.",
        img="atlas.webp", img_alt="Marble statue of a young Greek man carrying a globe of the Earth on his shoulder",
        chips=[("Monitoring", "24/7"), ("Fix shipped", "same day"), ("New automation", "added this month"), ("Monthly report", "sent")],
        stall_head='Systems decay <span class="clay">without an owner.</span>',
        stall_lead="Tools change, APIs update and the business moves on. Without someone watching, good systems slowly stop working.",
        meter=("System decay", "20,44,70,90", ["Healthy", "Slipping", "Broken"]),
        problems=[
            ('<path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17v.5"/>', "Things break after the agency leaves", "An API changes, a field gets renamed, and an automation fails with nobody watching.",
             viz_resp("No support", "9 days", "Partnership", "same day", "Every day broken is leads and orders lost.")),
            ('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.5 3.6-7 8-7s8 2.5 8 7"/>', "Nobody owns improvements", "Every fix and idea lands back on the founder's desk.", VIZ_YOU),
            ('<path d="M4 5h16v10H9l-5 4z"/><path d="M9 9h6M9 12h3"/>', "Good ideas wait months", "The next automation stays on a list because there is no one to build it.",
             viz_chat(["Can we automate invoices?", "What about WhatsApp leads?", "We need a weekly cash report", "Can the CRM do follow-ups?"], "14 ideas in the backlog")),
            ('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M14 17.5h7M17.5 14v7" stroke-dasharray="2 2"/>', "New tools pile up", "Each new app adds another gap between systems.", VIZ_TOOLS),
        ],
        cards_head='What you <span class="clay">get.</span>', cards_lead="One simple monthly plan that covers everything we build for you, and keeps adding to it.",
        cards=[
            ("Monitoring", "We watch every system around the clock and catch failures before your team does.", ["Alerts", "Uptime", "Logs"], '<path d="M3 12h4l3-8 4 16 3-8h4"/>'),
            ("Fast fixes", "When something breaks, we fix it, usually the same day.", ["Same-day target", "Root cause"], '<path d="M14 6l4 4-8 8H6v-4z"/><path d="M4 20h16"/>'),
            ("Monthly improvements", "Every month we make what you have faster, smarter and more useful.", ["Tuning", "New fields", "Better prompts"], '<path d="M4 18l6-6 4 4 6-8"/><path d="M15 8h5v5"/>'),
            ("New automations", "We keep building from your backlog, one high-leverage system at a time.", ["Agents", "Workflows", "Integrations"], '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="12" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M8.5 6H12a3 3 0 0 1 3 3v1M8.5 18H12a3 3 0 0 0 3-3v-1"/>'),
            ("Monthly report", "A clear report of what we fixed, shipped and measured, plus what comes next.", ["Hours saved", "Next steps"], '<path d="M7 3h8l4 4v14H7z"/><path d="M15 3v4h4"/><path d="M10 17v-3M13 17v-5M16 17v-2"/>'),
            ("Strategy check-ins", "Regular calls to review your telos and pick the next moves.", ["Roadmap", "Priorities"], '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1"/>'),
        ],
        signature=PARTNER_SIG, css=SIG_CSS,
        outc_head='What the plan <span class="clay">aims for.</span>',
        outcomes=[(24, "/7", "monitoring of every system we run"), (1, "day", "target to fix anything that breaks"), (30, "days", "between new improvements"), (1, "report", "every month, in plain words")],
        outc_note="Plan targets. Exact terms are set in your partnership agreement.",
        how_head='How the partnership <span class="clay">works.</span>',
        step_names=["<h3>Telos Session</h3>", "<h3>System review</h3>", "<h3>Monthly cycle</h3>", "<h3>Compound</h3>"],
        how_steps=["Tell us what you run today and where the business is headed.", "We review every system, fix the weak spots and set up monitoring.", "Each month we fix, improve and ship the next item from your backlog.", "Your systems get better every month instead of slowly breaking."],
        faq_title="Partnership questions",
        faqs=[
            ("What does the monthly plan include?", "Monitoring, fixes, monthly improvements, new automations from your backlog, a monthly report and regular strategy check-ins."),
            ("Can you support systems another agency built?", "Yes. We start with a system review, fix what is fragile and document everything before taking it over."),
            ("How fast do you fix problems?", "Our target is the same day for anything that breaks. Exact response times are written into your plan."),
            ("Is there a long contract?", "Plans run month to month after an initial period, so you stay because it keeps paying off."),
            ("What if we need a bigger project?", "Larger builds are scoped separately, and your plan covers support once they launch."),
            ("Do we still own everything?", "Yes. Everything runs in your accounts and belongs to your business."),
        ],
        final_line="Tell us what you run today. We'll review it and show you what a month of improvements looks like.",
    ),
]

if __name__ == "__main__":
    for p in PAGES:
        build(p)
