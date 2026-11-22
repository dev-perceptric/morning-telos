#!/usr/bin/env python3
"""The shared page builder behind the industry pages (build_solution.py) and the AI team pages (build_agent.py).

It has no pages of its own: those scripts call build(). The homepage is the source for the head, nav and footer,
and scripts/shared_parts.html holds the logo strip, steps, ribbons and final call to action.
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
# Tool logos, steps, lead demo, ribbons and final call to action come from scripts/shared_parts.html, so homepage copy changes don't change these pages.
P = (pathlib.Path(__file__).resolve().parent / "shared_parts.html").read_text()


def part(a, b):
    i = P.index(a)
    return P[i:P.index(b, i)] if b else P[i:]


LOGOS = part("  <!-- LOGOS -->", "  <!-- 5. HOW -->")
HOW = part("  <!-- 5. HOW -->", "  <!-- 6. DEMO -->")
RIBBONS = part("  <!-- RIBBONS -->", "  <!-- 9. FINAL -->")
FINAL = part("  <!-- 9. FINAL -->", "<!-- VIZ -->")
FOOTER = H[H.index("</main>"):]
AVS = re.search(r'<div class="avs".*?</div>', H, re.S).group(0)
VIZ_YOU = re.search(r'<div class="viz viz-you".*?</svg>\s*</div>', P, re.S).group(0)
VIZ_TOOLS = re.search(r'<div class="viz viz-tools".*?Nothing connects</span></div>', P, re.S).group(0)
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
      <div class="faq-side rv"><h2 class="big">{title}</h2><a href="mailto:meet@morningtelos.com">Ask us directly <span>→</span></a></div>
      <div class="faq-list">
{q}      </div>
    </div>
  </section>

'''


def build(p):
    head = re.sub(r"<title>.*?</title>", f"<title>{p['title']}</title>", HEAD)
    head = re.sub(r'<meta name="description" content="[^"]*">', f'<meta name="description" content="{p["desc"]}">', head)
    section = p["section"]
    url = f"https://morningtelos.com/{section}/{p['slug']}/"
    schema = {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [{"@type": "Question", "name": a, "acceptedAnswer": {"@type": "Answer", "text": b}} for a, b in p["faqs"]]}
    svc = {"@context": "https://schema.org", "@type": "Service", "name": p["name"], "serviceType": p["service_type"], "provider": {"@type": "Organization", "name": "Morning Telos", "url": "https://morningtelos.com/"}, "url": url}
    if p.get("audience"):
        svc["audience"] = {"@type": "BusinessAudience", "audienceType": p["audience"]}
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
        <div class="crumb rv"><a href="/">Home</a> / {p["crumb"]} / {p["name"]}</div>
        <h1 aria-label="{p["h1_label"]}">
          {h1.strip()}
        </h1>
        <p class="lead rv" style="--d:.55s">{p["lead"]}</p>
        <div class="hero-ctas rv" style="--d:.7s">
          <a class="btn btn-dark btn-lg mag" href="https://chat.morningtelos.com/#signup">Start free trial <span class="arr">→</span></a>
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
    page = head + hero + LOGOS + stall + p.get("after_stall", "") + auto + p["signature"] + outc + how + p.get("before_faq", "") + RIBBONS + faq_block(p["faq_title"], p["faqs"]) + final + FOOTER
    out = ROOT / section / p["slug"] / "index.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(page)
    print("wrote", out.relative_to(ROOT.parent), len(page))


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
  .kpi small, .chart small, .tbl small, .rep-chart small, .rep-list small { display: block; font-family: var(--sans); font-weight: 600; font-size: 10.5px; letter-spacing: .04em; text-transform: uppercase; color: var(--ink-4); margin-bottom: 8px; }
  .kpi b { font-family: var(--serif); font-weight: 500; font-size: 34px; line-height: 1; }
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
  .rep-big { display: block; font-family: var(--serif); font-weight: 500; font-size: 56px; line-height: 1; margin-bottom: 18px; }
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

