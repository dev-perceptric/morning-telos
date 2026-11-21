#!/usr/bin/env python3
"""Builds one landing page per AI employee.

Usage: python3 scripts/build_agent.py
Writes site/ai-employees/<slug>/index.html for every agent in AGENTS.
Reuses build_service.build(), so the nav, logos, steps, ribbons, final
call to action and footer all come from site/index.html.
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import build_service as bs  # noqa: E402
from build_service import viz_resp, viz_chat, viz_data, viz_week, VIZ_YOU, VIZ_TOOLS  # noqa: E402

ROOT = bs.ROOT
SECTION = "ai-employees"

# ---------- icons (24x24, stroked) ----------
I = dict(
    mail='<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
    cal='<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    clock='<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    user='<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
    chat='<path d="M4 5h16v10H9l-5 4z"/><path d="M9 9h6M9 12h3"/>',
    chart='<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    up='<path d="M4 18l6-6 4 4 6-8"/><path d="M15 8h5v5"/>',
    search='<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    warn='<path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17v.5"/>',
    doc='<path d="M7 3h8l4 4v14H7z"/><path d="M15 3v4h4"/><path d="M10 12h6M10 16h4"/>',
    grid='<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    target='<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1"/>',
    send='<path d="M3 11l18-8-8 18-2-8z"/>',
    heart='<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',
    photo='<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 8"/>',
    hammer='<path d="M14 6l4 4-8 8H6v-4z"/><path d="M4 20h16"/>',
    page='<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 13h8M8 16h5"/>',
    money='<circle cx="12" cy="12" r="9"/><path d="M15 9h-4a2 2 0 0 0 0 4h2a2 2 0 0 1 0 4H9M12 6v2M12 16v2"/>',
    list='<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    shield='<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
    bell='<path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>',
    spark='<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6"/>',
)
BIG = dict(  # 40x40 icons for viz_data
    chart='<path d="M8 32V18M17 32V8M26 32V22M34 32H6"/>',
    crm='<rect x="7" y="9" width="26" height="22" rx="3"/><path d="M7 16h26M14 16v15"/>',
    cal='<rect x="6" y="9" width="28" height="24" rx="3"/><path d="M6 16h28M13 5v6M27 5v6"/>',
)


# ---------- the team ----------
# key, name, title, role, slug, image height, alt text
TEAM = [
    ("alexander", "Alexander", "the Emperor", "Chief of Staff", "ai-chief-of-staff"),
    ("midas", "Midas", "the Merchant", "Sales", "ai-sales-rep"),
    ("irene", "Irene", "the Peacemaker", "Support", "ai-customer-support"),
    ("cleo", "Cleo", "the Timekeeper", "Scheduling", "ai-scheduling-assistant"),
    ("cyrus", "Cyrus", "the Messenger", "Email", "ai-email-marketing"),
    ("leo", "Leo", "the Storyteller", "Social", "ai-social-media-manager"),
    ("theseus", "Theseus", "the Librarian", "SEO", "ai-seo-specialist"),
    ("archon", "Archon", "the Builder", "Website Builder", "ai-website-builder"),
]
IMG_H = dict(alexander=974, midas=955, irene=926, cleo=924, cyrus=910, leo=890, theseus=912, archon=900)


def team_strip(current):
    """The rest of the team as a wheel of full statues. Scrolling spins it, and the name below follows the front one.
    site/assets/site.js (block "team wheel") drives it. Without JS it is a row you can swipe."""
    roles = {x["key"]: x["role_long"] for x in AGENTS}
    i0 = next(i for i, x in enumerate(TEAM) if x[0] == current)
    rest = TEAM[i0 + 1:] + TEAM[:i0]
    items = ''.join(
        f'<a class="roul-item" href="/{SECTION}/{slug}/" data-name="{n} {t}" data-role="AI {roles[k]}" data-first="{n}">'
        f'<img src="/img/team/{k}.webp" alt="{n} {t}, AI {roles[k]}" width="900" height="{IMG_H[k]}" loading="lazy" draggable="false">'
        f'<span class="roul-cap"><b>{n} {t}</b><small>AI {roles[k]}</small></span></a>'
        for k, n, t, r, slug in rest)
    dots = ''.join(f'<button class="roul-dot" type="button" aria-label="Show {n} {t}"></button>' for k, n, t, r, slug in rest)
    k, n, t, r, slug = rest[0]
    return f'''  <section class="roul" id="team" style="--n:{len(rest)}">
    <div class="roul-pin">
      <div class="wrap roul-head">
        <h2 class="big rv">Meet the rest of <span class="clay">the team.</span></h2>
        <p class="roul-hint">Scroll to spin</p>
      </div>
      <div class="roul-stage">{items}<i class="roul-floor" aria-hidden="true"></i></div>
      <div class="wrap roul-info">
        <button class="roul-btn" type="button" data-step="-1" aria-label="Previous teammate"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button>
        <div class="roul-name" aria-live="polite"><small>AI {roles[k]}</small><b>{n} {t}</b><a href="/{SECTION}/{slug}/">Meet {n} &rarr;</a></div>
        <button class="roul-btn" type="button" data-step="1" aria-label="Next teammate"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></button>
      </div>
      <div class="roul-dots">{dots}</div>
    </div>
  </section>

'''


def signature(a):
    k, n = a["key"], a["name"]
    msgs, dl = "", 0.3
    for m in a["chat"]:
        if m[0] == "you":
            msgs += f'<div class="msg you" style="--dl:{dl:.2f}s"><span class="b">{m[1]}</span></div>'
        elif m[0] == "ag":
            msgs += f'<div class="msg" style="--dl:{dl:.2f}s"><img class="fav" src="/img/team/{k}-face.webp" alt=""><div><small>{n}</small><span class="b">{m[1]}</span></div></div>'
        else:
            _, title, body, btns = m
            b = ''.join(f'<span{" class=\"ok\"" if j == 0 else ""}>{x}</span>' for j, x in enumerate(btns))
            msgs += (f'<div class="msg" style="--dl:{dl:.2f}s"><img class="fav" src="/img/team/{k}-face.webp" alt=""><div><small>{n}</small>'
                     f'<div class="apcard"><div class="aphead"><b>{title}</b><span class="tag">Needs your OK</span></div>'
                     f'<div class="apbody">{body}</div><div class="apbtns">{b}</div></div></div></div>')
        dl += 0.7
    p = a["profile"]
    tools = ''.join(f'<span>{t}</span>' for t in p["tools"])
    return f'''  <section class="agsig" id="demo">
    <div class="wrap">
      <div class="head">
        <h2 class="big rv">{a["sig_head"]}</h2>
        <p class="lead rv" style="--d:.1s">{a["sig_lead"]}</p>
      </div>
      <div class="agsig-grid">
        <aside class="pcard rv">
          <div class="top"><img src="/img/team/{k}-face.webp" alt="{n}" width="64" height="64"><div><span class="role">AI {a["role_long"]}</span><h3>{n} {a["title_word"]}</h3></div></div>
          <dl>
            <div><dt>Good at</dt><dd>{p["good"]}</dd></div>
            <div><dt>Works in</dt><dd class="tools">{tools}</dd></div>
            <div><dt>Says</dt><dd class="quote">&ldquo;{p["says"]}&rdquo;</dd></div>
            <div><dt>Fun fact</dt><dd>{p["fact"]}</dd></div>
          </dl>
        </aside>
        <div class="app chat draw rv rv-s">
          <div class="app-bar"><i></i><i></i><i></i><span class="ttl">example · chat with {n}</span><span class="clock"><span class="dot-live"></span>online</span></div>
          <div class="chat-body">{msgs}</div>
        </div>
      </div>
      <p class="onote rv">Example chat. Names and numbers are made up.</p>
    </div>
  </section>

'''


CSS = '''
  .hero.svc .statue { mix-blend-mode: normal; -webkit-mask-image: linear-gradient(to bottom, #000 84%, transparent 100%); mask-image: linear-gradient(to bottom, #000 84%, transparent 100%); }
  .hero .crumb b { color: var(--clay); font-weight: 500; }
  .agsig { padding: 40px 0 120px; }
  .agsig .head { display: grid; grid-template-columns: 1.2fr 1fr; gap: 48px; align-items: end; margin-bottom: 40px; }
  .agsig-grid { display: grid; grid-template-columns: 340px 1fr; gap: 24px; align-items: start; }
  .pcard { border: 1px solid var(--line); border-radius: 16px; background: var(--white); padding: 24px; }
  .pcard .top { display: flex; gap: 14px; align-items: center; margin-bottom: 20px; padding-bottom: 20px; border-bottom: 1px solid var(--line); }
  .pcard img { width: 64px; height: 64px; border-radius: 50%; object-fit: cover; border: 1px solid var(--line); flex: none; }
  .pcard h3 { font-family: var(--serif); font-weight: 400; font-size: 25px; line-height: 1.15; }
  .pcard .role { font-family: var(--mono); font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--clay); }
  .pcard dl { display: grid; gap: 16px; }
  .pcard dt { font-family: var(--mono); font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-4); margin-bottom: 5px; }
  .pcard dd { font-size: 15px; line-height: 1.5; color: var(--ink-2); }
  .pcard .quote { font-family: var(--serif); font-size: 21px; font-style: italic; color: var(--ink); }
  .pcard .tools { display: flex; flex-wrap: wrap; gap: 6px; }
  .pcard .tools span { font-size: 12.5px; border: 1px solid var(--line); border-radius: 99px; padding: 3px 10px; background: var(--ivory); }
  .chat-body { padding: 24px; display: grid; gap: 16px; min-height: 400px; align-content: start; background: var(--ivory); }
  .msg { display: flex; gap: 10px; align-items: flex-start; opacity: 0; transform: translateY(10px); transition: opacity .5s var(--dl), transform .6s var(--ease) var(--dl); }
  .chat.in .msg { opacity: 1; transform: none; }
  .msg.you { justify-content: flex-end; }
  .msg .fav { width: 34px; height: 34px; border-radius: 50%; object-fit: cover; flex: none; border: 1px solid var(--line); }
  .msg small { display: block; font-size: 12px; font-weight: 600; margin-bottom: 4px; color: var(--ink-2); }
  .msg .b { display: inline-block; max-width: 540px; padding: 11px 15px; border-radius: 14px; font-size: 14.5px; line-height: 1.5; background: var(--white); border: 1px solid var(--line); }
  .msg.you .b { background: var(--ink); color: var(--ivory); border-color: var(--ink); }
  .apcard { max-width: 540px; border: 1px solid var(--line); border-radius: 14px; background: var(--white); overflow: hidden; box-shadow: 0 14px 30px -22px rgba(20,20,19,.4); }
  .aphead { display: flex; justify-content: space-between; gap: 10px; align-items: center; padding: 10px 14px; border-bottom: 1px solid var(--line); font-size: 13.5px; }
  .aphead .tag { font-family: var(--mono); font-size: 10px; letter-spacing: .06em; text-transform: uppercase; color: var(--clay); background: rgba(217,119,87,.1); padding: 3px 8px; border-radius: 99px; white-space: nowrap; }
  .apbody { padding: 12px 14px; font-size: 14px; line-height: 1.55; color: var(--ink-2); }
  .apbtns { display: flex; gap: 8px; padding: 0 14px 14px; flex-wrap: wrap; }
  .apbtns span { font-size: 13px; font-weight: 600; padding: 7px 12px; border-radius: 8px; border: 1px solid var(--line); }
  .apbtns span.ok { background: var(--clay); color: #fff; border-color: var(--clay); }
  /* team wheel: a row you can swipe without JS; site.js adds .live and spins it as you scroll */
  .roul { position: relative; padding: 20px 0 100px; }
  .roul-head { display: flex; justify-content: space-between; align-items: end; gap: 20px; }
  .roul-hint { font-family: var(--mono); font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-4); display: none; transition: opacity .6s; }
  .roul-stage { display: flex; gap: 20px; overflow-x: auto; scroll-snap-type: x mandatory; padding: 28px 16px 8px; }
  .roul-item { flex: none; width: 240px; scroll-snap-align: center; color: inherit; text-decoration: none; text-align: center; }
  .roul-item img { width: 100%; height: 300px; object-fit: contain; object-position: center bottom; display: block; }
  .roul-cap b { display: block; font-family: var(--serif); font-weight: 400; font-size: 21px; margin-top: 10px; }
  .roul-cap small { font-size: 13px; color: var(--ink-3); }
  .roul-floor, .roul-info, .roul-dots { display: none; }
  .roul.live { height: calc(100vh + var(--n) * 42vh); padding: 0; }
  .roul.live.still { height: auto; }
  .roul.live .roul-pin { position: sticky; top: 0; height: 100vh; height: 100svh; display: grid; grid-template-rows: auto 1fr auto auto; padding: 96px 0 28px; overflow: hidden; }
  .roul.live.still .roul-pin { position: relative; height: auto; min-height: 640px; }
  .roul.live .roul-hint { display: block; }
  .roul.live .roul-stage { display: block; position: relative; overflow: visible; padding: 0; margin: 18px 0 8px; min-height: 260px; }
  .roul.live .roul-item { position: absolute; left: 50%; bottom: 0; top: 0; width: auto; transform-origin: 50% 100%; will-change: transform, opacity; -webkit-tap-highlight-color: transparent; }
  .roul.live .roul-item img { height: 100%; width: auto; max-width: none; user-select: none; }
  .roul.live .roul-cap { display: none; }
  .roul.live .roul-floor { display: block; position: absolute; left: 50%; bottom: -14px; width: min(520px, 70vw); height: 46px; transform: translateX(-50%); background: radial-gradient(closest-side, rgba(20,20,19,.16), transparent); pointer-events: none; }
  .roul.live .roul-info { display: flex; align-items: center; justify-content: center; gap: 28px; }
  .roul-name { min-width: 0; width: min(520px, 100%); text-align: center; transition: opacity .25s, transform .35s var(--ease); }
  .roul-name.swap { opacity: 0; transform: translateY(10px); }
  .roul-name small { display: block; font-family: var(--mono); font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: var(--clay); }
  .roul-name b { display: block; font-family: var(--serif); font-weight: 400; font-size: clamp(32px, 3.8vw, 52px); line-height: 1.1; letter-spacing: -.02em; margin: 6px 0 8px; }
  .roul-name a { font-size: 15px; font-weight: 600; color: var(--ink); text-decoration: none; border-bottom: 1px solid var(--clay); padding-bottom: 2px; }
  .roul-name a:hover { color: var(--clay); }
  .roul-btn { flex: none; width: 52px; height: 52px; border-radius: 50%; border: 1px solid var(--line-2); background: var(--white); display: grid; place-items: center; cursor: pointer; transition: border-color .2s, transform .2s; }
  .roul-btn:hover { border-color: var(--ink); transform: scale(1.05); }
  .roul-btn svg { width: 20px; height: 20px; fill: none; stroke: var(--ink); stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
  .roul.live .roul-dots { display: flex; justify-content: center; gap: 8px; margin-top: 18px; }
  .roul-dot { width: 8px; height: 8px; padding: 0; border-radius: 99px; border: 0; background: var(--line-2); cursor: pointer; transition: width .3s var(--ease), background .3s; }
  .roul-dot.on { width: 26px; background: var(--clay); }
  @media (max-width: 1000px) { .agsig .head { grid-template-columns: 1fr; gap: 18px; } .agsig-grid { grid-template-columns: 1fr; } }
  @media (max-width: 640px) { .roul.live { height: calc(100vh + var(--n) * 32vh); } .roul.live .roul-pin { padding: 84px 0 20px; } .roul-head { display: block; } .roul-hint { margin-top: 8px; } .roul.live .roul-info { gap: 12px; } .roul-btn { width: 44px; height: 44px; } .chat-body { padding: 16px; min-height: 0; } .agsig { padding-bottom: 80px; } }
'''


# ---------- copy for each agent ----------
AGENTS = [
    dict(
        key="alexander", role_long="Chief of Staff", service_type="AI chief of staff",
        title="AI Chief of Staff for Small Business | Alexander | Morning Telos",
        desc="Meet Alexander, your AI chief of staff. He reads every tool you connect, answers questions with real numbers, plans your week and hands work to the right AI teammate.",
        h1=("Alexander runs", "your empire."), h1_label="Alexander, the AI chief of staff who runs your empire",
        lead="Alexander is your AI chief of staff. He watches every tool you connect, answers questions with real numbers, plans your week with you and hands each task to the right teammate.",
        img_alt="Marble statue of Alexander the Emperor in a gold laurel wreath and sunglasses, holding a glowing orb of circuits",
        chips=[("Monday briefing", "sent"), ("Task handed to Midas", "follow up with Dana"), ("Revenue question", "answered"), ("Your week", "5 priorities set")],
        stall_head='When everything runs <span class="clay">through you.</span>',
        stall_lead="You are the only one who sees the whole business. So every question, every task and every decision waits on you.",
        meter=("Owner load", "30,52,74,94", ["Fine", "Stretched", "Burned out"]),
        problems=[
            (I["user"], "Every question lands on you", "Where is that deal? Did the client pay? Your team asks you because nobody else can see it all.", VIZ_YOU),
            (I["grid"], "Your numbers live in ten tools", "Sales in the CRM, money in Stripe, meetings in the calendar. One answer means opening five tabs.",
             viz_data(["CRM", "Stripe", "Gmail", "Calendar", "Sheets"], "One answer", BIG["chart"])),
            (I["cal"], "Weeks start without a plan", "Monday fills up with whatever is loudest, and the work that grows the business slides again.",
             viz_week([("Mon", 90), ("Tue", 75), ("Wed", 85), ("Thu", 70), ("Fri", 95)], "Example: hours spent on urgent work.")),
            (I["chat"], "Tasks fall between people", "You ask for a follow-up in passing. A week later, nobody sent it.",
             viz_chat(["Can someone follow up with Dana?", "Did the quote go out?", "Who is posting this week?", "Did we answer that review?"], "4 tasks, no owner")),
        ],
        cards_head='What Alexander <span class="clay">does.</span>',
        cards_lead="He sees across every tool and every teammate, so you get answers and a plan without the digging.",
        cards=[
            ("Answers with real numbers", "Ask anything about the business. He checks your connected tools and replies with the facts.", ["Revenue", "Pipeline", "Bookings"], I["chart"]),
            ("Hands off tasks", "Tell him what you need. He picks the right teammate and tracks it until it is done.", ["Midas", "Irene", "Cleo"], I["send"]),
            ("Plans your week", "Every Monday he lays out what matters most and who does each part.", ["Priorities", "Owners", "Dates"], I["cal"]),
            ("Weekly report", "A short report on what moved, why it moved and what your team got done.", ["Wins", "Risks", "Next steps"], I["doc"]),
            ("Spots what slipped", "An unpaid invoice or a lead with no reply? He notices and tells you.", ["Alerts", "Follow-ups"], I["bell"]),
            ("Read-only by design", "Alexander looks but never touches. He can't send, change or delete anything.", ["Safe", "No sends"], I["shield"]),
        ],
        sig_head='Ask him <span class="clay">anything.</span>',
        sig_lead="Alexander answers from your own tools, then gets the right teammate moving.",
        profile=dict(good="Seeing the whole business at once and keeping the team on track.", tools=["Every tool you connect"],
                     says="The empire is in order.", fact="Reads every report before breakfast. Has never touched a send button."),
        chat=[
            ("you", "How did we do this week?"),
            ("ag", "Good week. Revenue is $18,400, up 12% from last week. Three quotes are still open, and the oldest is 6 days old."),
            ("ag", "I asked Midas to follow up with Dana Reyes today. Want me to plan next week?"),
            ("you", "Yes, plan it."),
            ("card", "Next week's plan", "1. Close the Reyes quote (Midas)<br>2. Answer 4 open reviews (Irene)<br>3. Post 3 times on Instagram (Leo)", ["Approve", "Edit"]),
        ],
        outc_head='What Alexander <span class="clay">is built for.</span>',
        outcomes=[(1, "chat", "to ask anything about your business"), (7, "teammates", "he can hand work to"), (1, "plan", "for your week, every Monday"), (0, "changes", "made to your tools by him")],
        outc_note="What Alexander is built to do. He reads your tools and never changes them.",
        how_head='Hire Alexander in <span class="clay">four steps.</span>',
        step_names=["Hire", "Connect", "Ask", "Lead"],
        how_steps=["Start a free trial and say hi to Alexander in chat.", "Connect the tools you already use, like Gmail, Stripe and your CRM.",
                   "Ask your first question. He answers and suggests who should act.", "Each week he plans with you and keeps the whole team on track."],
        faq_title="Questions about Alexander",
        faqs=[
            ("What is an AI chief of staff?", "An AI teammate that sees across your business tools, answers questions, plans your week and hands work to the right person. Alexander does that for small business owners."),
            ("Can Alexander send emails or change things?", "No. Alexander is read-only. When something needs doing, he hands it to the teammate for that job, and they ask for your OK before anything goes out."),
            ("What tools can he see?", "Any tool you connect to Morning Telos, like Gmail, Outlook, Google Calendar, your CRM and Stripe. He only sees what you connect."),
            ("How is this different from ChatGPT?", "ChatGPT doesn't know your business. Alexander reads your own tools, remembers what you tell him and works with a team that can act on it."),
            ("Is my data safe?", "Your workspace is private to your business. Other customers can never see your data, and you can disconnect a tool at any time."),
            ("Do I need the other AI employees?", "No, but Alexander gets more done with them. He hands sales to Midas, support to Irene and scheduling to Cleo."),
        ],
        final_line="Ask Alexander one question about your business. See what he finds.",
    ),
    dict(
        key="midas", role_long="Sales Rep", service_type="AI sales representative",
        title="AI Sales Rep for Small Business | Midas | Morning Telos",
        desc="Meet Midas, your AI sales rep. He replies to new leads, books the call, follows up every quote and keeps your CRM up to date. Nothing goes out until you approve it.",
        h1=("Midas turns leads", "into gold."), h1_label="Midas, the AI sales rep who turns leads into gold",
        lead="Midas is your AI sales rep. He replies to new leads fast, books the call, follows up every quote and keeps your CRM current. Nothing goes out until you approve it.",
        img_alt="Marble statue of Midas the Merchant with an earbud, flipping a glowing gold coin above brass scales",
        chips=[("New lead", "reply drafted"), ("Quote follow-up", "day 3, needs you"), ("Call booked", "Thu 10:00 AM"), ("CRM", "updated")],
        stall_head='Leads go cold <span class="clay">while you work.</span>',
        stall_lead="You're on a job or with a client. By the time you reply, the lead has already called someone else.",
        meter=("Leads going cold", "22,46,70,92", ["Warm", "Cooling", "Lost"]),
        problems=[
            (I["clock"], "Slow replies lose the job", "Most people hire whoever answers first. A reply tomorrow is often too late.",
             viz_resp("Reply tomorrow", "18 h", "Midas drafts", "minutes", "Fast replies win more jobs.")),
            (I["money"], "Quotes sent, then silence", "You send a price and never hear back. Nobody follows up, so the deal fades.",
             viz_chat(["Quote sent: $4,200", "No reply", "Still no reply", "They went with someone else"], "0 follow-ups sent")),
            (I["list"], "The CRM is out of date", "Notes live in your head and your inbox. The pipeline never matches reality.",
             viz_data(["Gmail", "Calls", "Calendar", "Notes", "Forms"], "Your CRM", BIG["crm"])),
            (I["user"], "You are the whole sales team", "Every reply, quote and follow-up waits for you to find time.", VIZ_YOU),
        ],
        cards_head='What Midas <span class="clay">does.</span>',
        cards_lead="He works every lead from first message to signed deal, in your voice.",
        cards=[
            ("Replies to new leads", "He drafts a reply to every new lead within minutes, with your prices and your tone.", ["Email", "Web forms"], I["mail"]),
            ("Books the call", "He finds open times in your calendar and sends the invite once you approve.", ["Google Calendar", "Calendly"], I["cal"]),
            ("Follows up every quote", "Day 3, day 7, day 14. No quote gets forgotten.", ["Follow-ups", "Reminders"], I["send"]),
            ("Keeps your CRM current", "He adds new leads and logs every email and next step.", ["HubSpot", "Pipedrive", "Salesforce"], I["list"]),
            ("Tracks every lead", "His Leads tab shows each lead, the next step and the date. No CRM needed.", ["Leads tab", "Next steps"], I["target"]),
            ("Never makes things up", "He quotes only your real prices and never promises a discount you didn't approve.", ["Your prices", "Your rules"], I["shield"]),
        ],
        sig_head='A lead comes in. <span class="clay">Midas is on it.</span>',
        sig_lead="He writes the reply, you tap approve, and the lead hears back while they're still looking.",
        profile=dict(good="Fast replies, friendly follow-ups and never letting a quote go cold.", tools=["Gmail", "Outlook", "Calendly", "HubSpot", "Pipedrive"],
                     says="Every lead is gold.", fact="Flips a coin for luck. Never uses it to set prices."),
        chat=[
            ("ag", "New lead from your website. Dana Reyes wants a quote for a kitchen remodel."),
            ("card", "Reply to Dana Reyes", "Hi Dana, thanks for reaching out! We'd love to help with your kitchen. Are you free Thursday at 10 AM or Friday at 2 PM for a quick call?", ["Approve and send", "Edit", "Skip"]),
            ("you", "Approve."),
            ("ag", "Sent. I added Dana to your leads and set a follow-up for Monday if she doesn't reply."),
        ],
        outc_head='What Midas <span class="clay">is built for.</span>',
        outcomes=[(24, "/7", "watching for new leads"), (0, "emails", "sent without your OK"), (3, "follow-ups", "planned for every open quote"), (1, "list", "of every lead and next step")],
        outc_note="What Midas is built to do. Results depend on your leads and your market.",
        how_head='Hire Midas in <span class="clay">four steps.</span>',
        step_names=["Hire", "Connect", "Approve", "Autopilot"],
        how_steps=["Start a free trial and meet Midas in chat.", "Connect your email, your calendar and your CRM if you have one.",
                   "Approve his first replies and follow-ups with one tap.", "Once you trust him, let him run on autopilot."],
        faq_title="Questions about Midas",
        faqs=[
            ("What is an AI sales rep?", "An AI teammate that answers new leads, books calls, follows up on quotes and keeps your CRM up to date. Midas does all of that for small businesses."),
            ("Will Midas send emails without asking me?", "No. Every email waits for your OK. Later, if you want, you can move him to autopilot so he sends on his own."),
            ("What does he connect to?", "Gmail or Outlook for email, Google Calendar or Calendly for calls, and HubSpot, Pipedrive or Salesforce for your CRM."),
            ("I don't have a CRM. Is that OK?", "Yes. Midas keeps a Leads tab with every lead, the next step and the date. For many small businesses, that is all the CRM they need."),
            ("Will he make up prices or promises?", "No. He quotes only prices you gave him or that are in the deal. He never invents a discount, a date or a promise."),
            ("Will it sound like a robot?", "He writes in your voice, using your past emails and the notes you give him. You can edit any draft before it goes out."),
        ],
        final_line="Forward Midas your last unanswered lead. See the reply he writes.",
    ),
    dict(
        key="irene", role_long="Customer Support", service_type="AI customer support agent",
        title="AI Customer Support Agent for Small Business | Irene | Morning Telos",
        desc="Meet Irene, your AI customer support agent. She answers customers from your own knowledge in Gmail, Outlook, Zendesk or Help Scout, and hands hard cases to you.",
        h1=("Irene keeps your", "customers happy."), h1_label="Irene, the AI customer support agent who keeps your customers happy",
        lead="Irene is your AI customer support agent. She answers customer emails from your own knowledge, turns repeat questions into an FAQ and hands refunds and upset customers to you.",
        img_alt="Smiling marble statue of Irene the Peacemaker wearing a headset, with her hand on her heart",
        chips=[("Customer email", "answered"), ("Refund request", "sent to you"), ("FAQ", "3 new answers"), ("Inbox", "sorted")],
        stall_head='Support eats <span class="clay">your whole day.</span>',
        stall_lead="The same questions arrive every day. Every answer pulls you away from the work that pays.",
        meter=("Inbox pressure", "28,50,72,93", ["Calm", "Busy", "Drowning"]),
        problems=[
            (I["chat"], "Same questions, every day", "Hours, prices, where's my order. You type the same answers over and over.",
             viz_chat(["What are your hours?", "Do you take insurance?", "Where is my order?", "What are your hours?"], "12 repeats this week")),
            (I["clock"], "Customers wait for replies", "A slow answer turns a simple question into a bad review.",
             viz_resp("Reply when free", "9 h", "Irene drafts", "minutes", "Waiting customers leave.")),
            (I["warn"], "Hard cases get lost", "An upset customer hides between twenty easy emails, and you find it too late.",
             viz_week([("Mon", 30), ("Tue", 55), ("Wed", 40), ("Thu", 70), ("Fri", 85)], "Example: unread emails by day.")),
            (I["user"], "Only you know the answers", "Your policies live in your head, so nobody else can help.", VIZ_YOU),
        ],
        cards_head='What Irene <span class="clay">does.</span>',
        cards_lead="She answers from what you know, kindly and fast, and knows when to call you.",
        cards=[
            ("Answers customer emails", "She writes replies from your knowledge, in your voice, ready for your OK.", ["Gmail", "Outlook"], I["mail"]),
            ("Works your help desk", "She drafts answers to tickets where your team already works.", ["Zendesk", "Help Scout"], I["chat"]),
            ("Sorts the inbox daily", "Every morning she splits the inbox into what she can answer and what needs you.", ["Sorted", "Flagged"], I["list"]),
            ("Hands hard cases to you", "Refunds, legal questions and upset customers go straight to you.", ["Refunds", "Complaints"], I["heart"]),
            ("Builds your FAQ", "Questions she sees again and again become clear answers you can post.", ["FAQ", "Knowledge"], I["doc"]),
            ("Never guesses", "If your knowledge doesn't have the answer, she asks you instead of making one up.", ["Your policies", "No guessing"], I["shield"]),
        ],
        sig_head='Your inbox, <span class="clay">handled with care.</span>',
        sig_lead="Irene answers the easy ones and brings you the ones that need a human touch.",
        profile=dict(good="Calm, kind answers and knowing when a customer needs you.", tools=["Gmail", "Outlook", "Zendesk", "Help Scout", "Slack"],
                     says="Leave it with me.", fact="Remembers every customer's name. Has never lost her temper."),
        chat=[
            ("ag", "Four new customer emails this morning. I drafted three answers. One is a refund request, so that one is yours."),
            ("card", "Reply to Mark Chen", "Hi Mark, we're open 8 to 6 on weekdays and 9 to 1 on Saturday. You can book online any time. See you soon!", ["Approve and send", "Edit"]),
            ("you", "Send it. What's the refund about?"),
            ("ag", "Jen says her order arrived damaged. I put her photos and order number in your inbox so you can decide."),
        ],
        outc_head='What Irene <span class="clay">is built for.</span>',
        outcomes=[(24, "/7", "reading new customer emails"), (0, "replies", "sent without your OK"), (1, "inbox", "sorted every morning"), (100, "%", "of answers from your own knowledge")],
        outc_note="What Irene is built to do. She answers only from what you teach her.",
        how_head='Hire Irene in <span class="clay">four steps.</span>',
        step_names=["Hire", "Connect", "Approve", "Autopilot"],
        how_steps=["Start a free trial and meet Irene in chat.", "Connect your inbox or help desk and add your policies.",
                   "Approve her first replies and correct anything she gets wrong.", "Let her handle the easy ones on autopilot."],
        faq_title="Questions about Irene",
        faqs=[
            ("What is an AI customer support agent?", "An AI teammate that reads customer messages and writes answers from your own information. Irene does that and sends hard cases to you."),
            ("Where does Irene get her answers?", "From the Knowledge and Memory you give her, plus what the customer wrote. If the answer isn't there, she asks you."),
            ("What does she connect to?", "Gmail or Outlook for email, Zendesk or Help Scout for tickets, and Slack for your team."),
            ("What happens with angry customers or refunds?", "Irene hands refunds, legal questions and upset customers straight to you, with a summary so you can reply fast."),
            ("Will she reply without my OK?", "No. Every reply waits for your approval until you choose to put her on autopilot."),
            ("Can she learn our policies?", "Yes. Add your policies, prices and FAQs to Knowledge. She uses them for every answer and gets better as you correct her."),
        ],
        final_line="Show Irene the question you answer most. See how she would reply.",
    ),
    dict(
        key="cleo", role_long="Scheduling Assistant", service_type="AI scheduling assistant",
        title="AI Scheduling Assistant for Small Business | Cleo | Morning Telos",
        desc="Meet Cleo, your AI scheduling assistant. She finds open times in Google Calendar or Calendly, books meetings and sends invites and reminders after you approve.",
        h1=("Cleo keeps every", "hour in order."), h1_label="Cleo, the AI scheduling assistant who keeps every hour in order",
        lead="Cleo is your AI scheduling assistant. She finds open times, books meetings and sends invites and reminders, so you stop playing email tag.",
        img_alt="Marble statue of Cleo the Timekeeper holding a gold pocket watch and a desk calendar",
        chips=[("Meeting booked", "Fri 3:00 PM"), ("Reminder", "sent"), ("Double booking", "avoided"), ("Your week", "at a glance")],
        stall_head='Scheduling steals <span class="clay">hours every week.</span>',
        stall_lead="Back-and-forth emails, no-shows and double bookings. Small things that add up fast.",
        meter=("Calendar chaos", "24,48,70,90", ["Calm", "Messy", "Chaos"]),
        problems=[
            (I["chat"], "Email tag to find a time", "Five emails to book one call. Then someone asks to move it.",
             viz_chat(["Does Tuesday work?", "Tuesday is full. Wednesday?", "Morning or afternoon?", "Can we do next week?"], "5 emails, 0 meetings")),
            (I["bell"], "No-shows waste your day", "People forget. Without a reminder, the slot sits empty.",
             viz_week([("Mon", 40), ("Tue", 65), ("Wed", 35), ("Thu", 80), ("Fri", 55)], "Example: empty slots from no-shows.")),
            (I["warn"], "Double bookings", "Two calendars, one of you. Something always overlaps.",
             viz_resp("Booking by hand", "15 min", "Cleo checks", "1 step", "Every offer checked against your calendar.")),
            (I["user"], "Your week is a mystery", "You don't know what's coming until it's already here.", VIZ_YOU),
        ],
        cards_head='What Cleo <span class="clay">does.</span>',
        cards_lead="She runs your calendar like clockwork and never books over another meeting.",
        cards=[
            ("Finds open times", "She checks your calendar and offers times that really work, always with the time zone.", ["Google Calendar", "Calendly"], I["cal"]),
            ("Books meetings", "She sends the invite as soon as you approve it.", ["Invites", "Time zones"], I["send"]),
            ("Sends reminders", "Reminder emails go out before meetings, so people show up.", ["Reminders", "Fewer no-shows"], I["bell"]),
            ("Follows up on forms", "When a form reply lands in your inbox, she follows up and offers a time.", ["Forms", "Follow-ups"], I["doc"]),
            ("Plans your week", "A clear look at your week every Monday, with what to prepare.", ["Your week", "Prep notes"], I["list"]),
            ("Never double books", "She checks your calendar before every offer and never invents a guest or a place.", ["Checked", "Accurate"], I["shield"]),
        ],
        sig_head='Tell her who. <span class="clay">She finds when.</span>',
        sig_lead="Cleo checks your calendar, offers real open times and sends the invite once you say yes.",
        profile=dict(good="Finding the perfect time and making sure people show up.", tools=["Google Calendar", "Calendly", "Gmail", "Outlook"],
                     says="Right on time.", fact="Has never been late. Not once."),
        chat=[
            ("you", "Book a 30 minute call with Sam Patel next week."),
            ("ag", "You're free Tuesday at 10 AM, Wednesday at 2 PM or Friday at 3 PM (Eastern). Should I offer all three?"),
            ("you", "Yes, offer all three."),
            ("card", "Invite to Sam Patel", "Hi Sam, would one of these work for a 30 minute call? Tue 10 AM, Wed 2 PM or Fri 3 PM (ET). Just reply with the one you like.", ["Approve and send", "Edit"]),
        ],
        outc_head='What Cleo <span class="clay">is built for.</span>',
        outcomes=[(0, "double bookings", "she checks before every offer"), (0, "invites", "sent without your OK"), (1, "look", "at your whole week, every Monday"), (24, "/7", "answering booking requests")],
        outc_note="What Cleo is built to do. She works from your real calendar.",
        how_head='Hire Cleo in <span class="clay">four steps.</span>',
        step_names=["Hire", "Connect", "Approve", "Autopilot"],
        how_steps=["Start a free trial and meet Cleo in chat.", "Connect Google Calendar or Calendly, plus your email.",
                   "Approve her first invites and reminders.", "Let her book and remind on autopilot."],
        faq_title="Questions about Cleo",
        faqs=[
            ("What is an AI scheduling assistant?", "An AI teammate that finds open times, books meetings and sends reminders for you. Cleo does that from your own calendar."),
            ("What calendars does Cleo work with?", "Google Calendar and Calendly, plus Gmail or Outlook for invites and reminders."),
            ("Can she double book me?", "No. She checks your calendar before she offers a time and never books over another meeting."),
            ("Does she handle time zones?", "Yes. Every time she offers comes with its time zone."),
            ("Will she send invites without asking?", "No. Every invite and reminder waits for your OK until you put her on autopilot."),
            ("Can she cut down on no-shows?", "She sends reminder emails before meetings, which helps people remember to show up."),
        ],
        final_line="Tell Cleo who you need to meet this week. She'll find the time.",
    ),
    dict(
        key="cyrus", role_long="Email Marketer", service_type="AI email marketing",
        title="AI Email Marketing for Small Business | Cyrus | Morning Telos",
        desc="Meet Cyrus, your AI email marketer. He writes campaigns, welcome emails and win-back emails in your voice and sends them from your own Gmail or Outlook after you approve.",
        h1=("Cyrus delivers", "every message."), h1_label="Cyrus, the AI email marketer who delivers every message",
        lead="Cyrus is your AI email marketer. He writes campaigns, welcome emails and win-back emails in your voice, then sends them from your own inbox after you approve.",
        img_alt="Marble statue of Cyrus the Messenger in a wide hat, with a bronze raven carrying a sealed letter",
        chips=[("Campaign", "written"), ("Test email", "sent to you"), ("Welcome series", "ready"), ("Win-back email", "drafted")],
        stall_head='Your list is <span class="clay">sitting idle.</span>',
        stall_lead="You have past customers who liked you. Without regular emails, they forget you exist.",
        meter=("List going cold", "25,48,72,92", ["Warm", "Fading", "Forgotten"]),
        problems=[
            (I["mail"], "No time to write emails", "A good campaign takes hours. So it never gets written.",
             viz_resp("Writing it yourself", "3 h", "Cyrus drafts", "minutes", "The campaign you never send earns nothing.")),
            (I["user"], "Past customers forget you", "They would buy again. Nobody reminds them.",
             viz_week([("Jan", 90), ("Mar", 70), ("May", 50), ("Jul", 35), ("Sep", 20)], "Example: repeat customers when nobody emails them.")),
            (I["chat"], "New signups hear nothing", "Someone joins your list and hears nothing for months.",
             viz_chat(["New signup: Ana", "New signup: Priya", "New signup: Tom", "New signup: Jordan"], "0 welcome emails sent")),
            (I["grid"], "Email tools are a chore", "Templates, lists and settings. Another app to learn.", VIZ_TOOLS),
        ],
        cards_head='What Cyrus <span class="clay">does.</span>',
        cards_lead="He writes the emails your customers want to open and sends them the right way.",
        cards=[
            ("Writes campaigns", "Offers, news and updates written in your voice, ready for your OK.", ["Campaigns", "Your voice"], I["mail"]),
            ("Welcome series", "New subscribers get a warm hello and a reason to buy.", ["Welcome", "Onboarding"], I["heart"]),
            ("Win-back emails", "Past customers get a friendly nudge to come back.", ["Win-back", "Repeat sales"], I["up"]),
            ("Sends from your inbox", "Emails go out from your own Gmail or Outlook, a few at a time.", ["Gmail", "Outlook"], I["send"]),
            ("Test first", "You get a test email and approve the campaign before it goes to your list.", ["Test send", "Approval"], I["shield"]),
            ("Clean lists only", "He emails only people who know you or asked to hear from you. Never a bought list.", ["Opt-in", "No spam"], I["list"]),
        ],
        sig_head='Tell him the news. <span class="clay">He writes the letter.</span>',
        sig_lead="Cyrus drafts the campaign, sends you a test, and mails your list once you approve.",
        profile=dict(good="Emails people actually open, sent the right way from your own inbox.", tools=["Gmail", "Outlook"],
                     says="Your letters have flown.", fact="His raven has never lost a letter."),
        chat=[
            ("you", "Write an email about our fall tune-up special. 15% off until Nov 30."),
            ("ag", "Here's a draft for your 412 past customers. I'll send you a test first."),
            ("card", "Campaign: Fall tune-up special", "<b>Subject:</b> Your furnace called. It wants a tune-up.<br><br>Hi Ana, cold weather is coming. Book a tune-up before Nov 30 and save 15%.", ["Send me a test", "Edit"]),
            ("ag", "Test sent to your inbox. Approve it and I'll send to the list a few at a time."),
        ],
        outc_head='What Cyrus <span class="clay">is built for.</span>',
        outcomes=[(1, "test", "email to you before every campaign"), (0, "campaigns", "sent without your OK"), (0, "bought lists", "ever"), (100, "%", "sent from your own inbox")],
        outc_note="What Cyrus is built to do. Results depend on your list and your offer.",
        how_head='Hire Cyrus in <span class="clay">four steps.</span>',
        step_names=["Hire", "Connect", "Approve", "Send"],
        how_steps=["Start a free trial and meet Cyrus in chat.", "Connect Gmail or Outlook and pick your list.",
                   "Read the test email and approve the campaign.", "He sends it from your inbox, a few at a time."],
        faq_title="Questions about Cyrus",
        faqs=[
            ("What is AI email marketing?", "An AI teammate writes your marketing emails and sends them for you. Cyrus writes in your voice and sends from your own inbox."),
            ("Where do the emails come from?", "Your own Gmail or Outlook. Customers see your name and your address."),
            ("Can I see the email before it goes out?", "Yes. Cyrus sends you a test email first, and the campaign goes out only after you approve it."),
            ("Who does he email?", "Only people who know your business or asked to hear from it. He never uses a bought list."),
            ("Why does he send a few at a time?", "Sending slowly from your own inbox helps keep your emails out of spam folders."),
            ("Can he write welcome and win-back emails?", "Yes. He writes welcome emails for new subscribers and win-back emails for past customers."),
        ],
        final_line="Tell Cyrus what you want to announce. He'll write the email.",
    ),
    dict(
        key="leo", role_long="Social Media Manager", service_type="AI social media manager",
        title="AI Social Media Manager for Small Business | Leo | Morning Telos",
        desc="Meet Leo, your AI social media manager. He plans, writes and schedules your posts for Instagram, Facebook, TikTok and more, and reports what works.",
        h1=("Leo tells your", "story every day."), h1_label="Leo, the AI social media manager who tells your story every day",
        lead="Leo is your AI social media manager. He plans a full week of posts, writes them in your voice, schedules them at the best times and tells you what works.",
        img_alt="Smiling marble statue of Leo the Storyteller juggling Instagram, Facebook and TikTok icons",
        chips=[("This week", "7 posts planned"), ("Instagram post", "needs you"), ("Best time", "Tue 6:00 PM"), ("Monday report", "sent")],
        stall_head='Social media <span class="clay">falls off first.</span>',
        stall_lead="You know you should post. But something is always more urgent, so the feed goes silent.",
        meter=("Feed going stale", "22,46,70,92", ["Fresh", "Stale", "Silent"]),
        problems=[
            (I["cal"], "Posting when you remember", "A burst of posts, then nothing for a month.",
             viz_week([("Wk 1", 90), ("Wk 2", 15), ("Wk 3", 4), ("Wk 4", 60), ("Wk 5", 6)], "Example: posts per week without a plan.")),
            (I["chat"], "Staring at a blank caption", "What do I even post? So you skip it.",
             viz_chat(["What should I post today?", "Is this photo good?", "What hashtags?", "Maybe tomorrow..."], "0 posts this week")),
            (I["grid"], "Too many apps", "Every network has its own app, its own sizes and its own rules.",
             viz_data(["Instagram", "Facebook", "TikTok", "LinkedIn", "YouTube"], "One calendar", BIG["cal"])),
            (I["chart"], "No idea what works", "You post and hope. Nobody tells you which posts brought customers.",
             viz_resp("Guessing", "never", "Leo's report", "weekly", "Know what to post more of.")),
        ],
        cards_head='What Leo <span class="clay">does.</span>',
        cards_lead="He keeps your feed full and your voice steady, without you living on your phone.",
        cards=[
            ("Plans your week", "A full calendar of posts built around your goal.", ["Calendar", "Topics"], I["cal"]),
            ("Writes every post", "Captions in your voice, sized right for each network.", ["Captions", "Hashtags"], I["doc"]),
            ("Schedules at the best times", "Posts go out when your audience is most likely to see them.", ["Scheduling", "Best times"], I["clock"]),
            ("You approve each post", "Approve or skip each post with one tap before it goes live.", ["Approve", "Skip"], I["shield"]),
            ("Works toward a goal", "Set a goal like 1,000 followers by spring. He plans the posts to get there.", ["Goals", "Progress"], I["target"]),
            ("Monday report", "What worked, what didn't and what to post next.", ["Results", "Next steps"], I["chart"]),
        ],
        sig_head='Pick a goal. <span class="clay">Leo plans the posts.</span>',
        sig_lead="He sets a target, writes the week, and you approve or skip each post.",
        profile=dict(good="Turning everyday work into posts people stop scrolling for.", tools=["Instagram", "Facebook", "TikTok"],
                     says="Gather round. I've got a story.", fact="Can juggle three networks at once. Literally."),
        chat=[
            ("you", "I want more followers on Instagram."),
            ("ag", "Let's aim for 1,000 followers by March. I'll post 3 times a week: tips, before-and-after photos and team stories. Here's Tuesday's post."),
            ("card", "Instagram · Tue 6:00 PM", "Before and after: this kitchen went from 1985 to 2026 in 9 days. Swipe to see the change. Thinking about your own? Link in bio.", ["Approve", "Edit", "Skip"]),
            ("ag", "Approved posts go out at the best time. I'll report back Monday."),
        ],
        outc_head='What Leo <span class="clay">is built for.</span>',
        outcomes=[(7, "days", "of posts planned at a time"), (0, "posts", "published without your OK"), (1, "report", "every Monday"), (1, "calendar", "for every network")],
        outc_note="What Leo is built to do. Growth depends on your goal, your posts and your audience.",
        how_head='Hire Leo in <span class="clay">four steps.</span>',
        step_names=["Hire", "Connect", "Approve", "Grow"],
        how_steps=["Start a free trial and meet Leo in chat.", "Connect your social accounts and pick a goal.",
                   "Approve or skip each post he writes.", "He schedules them and reports every Monday."],
        faq_title="Questions about Leo",
        faqs=[
            ("What is an AI social media manager?", "An AI teammate that plans, writes and schedules your social posts. Leo does that in your voice and reports what works."),
            ("Which networks does Leo post to?", "Instagram, Facebook, TikTok and the other networks you connect."),
            ("Will he post without my OK?", "No. Every post waits for you to approve or skip it, unless you put him on autopilot."),
            ("How does he learn my voice?", "From your brand notes, your website and the posts you approve. You can edit any post."),
            ("How often will he post?", "You choose. He suggests a schedule that fits your goal, like three times a week."),
            ("Does he tell me what's working?", "Yes. Every Monday he sends a short report on your results and what to post next."),
        ],
        final_line="Tell Leo your goal for social media. He'll plan your first week.",
    ),
    dict(
        key="theseus", role_long="SEO Specialist", service_type="AI SEO specialist",
        title="AI SEO Specialist for Small Business | Theseus | Morning Telos",
        desc="Meet Theseus, your AI SEO specialist. He finds the keywords people search, plans your content, tracks rankings and checks how you show up in AI answers like ChatGPT.",
        h1=("Theseus gets you", "found."), h1_label="Theseus, the AI SEO specialist who gets you found",
        lead="Theseus is your AI SEO specialist. He finds what your customers search for, plans what to write and tracks how you show up on Google and in AI answers.",
        img_alt="Smiling marble statue of Theseus the Librarian in round glasses, with his hand on an open atlas",
        chips=[("Keywords", "42 found"), ("Content plan", "8 pages"), ("ChatGPT", "now names you"), ("Rankings", "tracked weekly")],
        stall_head='Customers search. <span class="clay">They don&rsquo;t find you.</span>',
        stall_lead="Every day, people ask Google and ChatGPT for a business like yours. If you don't show up, a competitor does.",
        meter=("Visibility gap", "26,50,72,92", ["Found", "Hidden", "Invisible"]),
        problems=[
            (I["search"], "You don't know what people search", "You guess at keywords and write pages nobody looks for.",
             viz_chat(["plumber near me", "emergency plumber open now", "water heater repair cost", "best plumber in town"], "which ones matter?")),
            (I["spark"], "AI answers skip you", "More people ask ChatGPT for a recommendation. It names other businesses.",
             viz_resp("Your business", "not named", "Competitor", "named 3x", "AI answers are the new first page.")),
            (I["doc"], "No plan for content", "Blog posts happen once a year, with no link to what people want.",
             viz_week([("Q1", 10), ("Q2", 4), ("Q3", 25), ("Q4", 4), ("Q1", 6)], "Example: pages published without a plan.")),
            (I["user"], "SEO feels like a dark art", "Agencies send reports you can't read. You're not sure what you pay for.", VIZ_YOU),
        ],
        cards_head='What Theseus <span class="clay">does.</span>',
        cards_lead="He maps how customers search and tells you exactly what to do next.",
        cards=[
            ("Finds keywords", "The real searches your customers type, with how many people search each one.", ["Keywords", "Search volume"], I["search"]),
            ("Plans your content", "A clear list of pages and posts to write, in order of value.", ["Content plan", "Priorities"], I["list"]),
            ("Checks AI visibility", "He asks AI tools like ChatGPT about your field and tracks if they name you.", ["ChatGPT", "AI answers"], I["spark"]),
            ("Wins AI prompts", "He finds the questions where AI names your rivals and plans how to win them.", ["Prompts", "Competitors"], I["target"]),
            ("Tracks rankings", "See where you rank on Google and how it changes week to week.", ["Google", "Trends"], I["up"]),
            ("Reports in plain English", "No jargon. What changed, why it changed and what to do next.", ["Reports", "Next steps"], I["doc"]),
        ],
        sig_head='He knows where <span class="clay">they&rsquo;re looking.</span>',
        sig_lead="Theseus finds the searches worth winning and turns them into a plan Archon can build.",
        profile=dict(good="Mapping how customers search and finding the shortest path to them.", tools=["Google", "ChatGPT", "Arrowsterr"],
                     says="I found where they're looking.", fact="Has read every map ever made. Still asks for directions."),
        chat=[
            ("you", "How do people find a plumber in Austin?"),
            ("ag", "I found 42 searches worth going after. The top two are &ldquo;emergency plumber austin&rdquo; (1,900 a month) and &ldquo;water heater repair austin&rdquo; (880 a month)."),
            ("ag", "I also asked ChatGPT for the best plumber in Austin. It named three businesses, but not you. Here's my plan to fix that."),
            ("card", "Content plan · 8 pages", "1. Emergency plumber in Austin<br>2. Water heater repair in Austin<br>3. How much does a plumber cost in Austin?", ["Approve plan", "Edit"]),
        ],
        outc_head='What Theseus <span class="clay">is built for.</span>',
        outcomes=[(1, "content plan", "built from real searches"), (2, "places", "tracked: Google and AI answers"), (1, "list", "of AI prompts to win"), (0, "jargon", "in his reports")],
        outc_note="What Theseus is built to do. SEO takes time, and results depend on your market.",
        how_head='Hire Theseus in <span class="clay">four steps.</span>',
        step_names=["Hire", "Brief", "Plan", "Rank"],
        how_steps=["Start a free trial and meet Theseus in chat.", "Tell him your business, your area and your top services.",
                   "Review his keyword list and content plan.", "Archon builds the pages, and Theseus tracks the results."],
        faq_title="Questions about Theseus",
        faqs=[
            ("What is an AI SEO specialist?", "An AI teammate that finds what customers search for, plans your content and tracks where you rank. Theseus also tracks how AI tools like ChatGPT talk about you."),
            ("What is AI visibility?", "How often AI tools like ChatGPT name your business when people ask for a recommendation. Theseus checks it and helps you show up more."),
            ("Does Theseus write the pages too?", "He plans them. Archon, the website builder, writes and builds the pages from his plan."),
            ("Do I need to know SEO?", "No. Theseus explains everything in plain English and tells you what to do next."),
            ("How long until I see results?", "SEO takes time, often a few months. Theseus tracks your progress every week so you can see it move."),
            ("Can he replace an SEO agency?", "For many small businesses, yes. Theseus does the research and planning an agency would, at any hour."),
        ],
        final_line="Tell Theseus your top service and your town. He'll show you what people search.",
    ),
    dict(
        key="archon", role_long="Website Builder", service_type="AI website builder",
        title="AI Website Builder for Small Business | Archon | Morning Telos",
        desc="Meet Archon, your AI website builder. He plans and writes pages people search for and builds them on your own Framer, Webflow, WordPress or Shopify site. Nothing goes live until you approve it.",
        h1=("Archon builds", "your website."), h1_label="Archon, the AI website builder who builds your website",
        lead="Archon is your AI website builder. He writes pages people search for, with clear calls to book, and builds them on your own site. Nothing goes live until you approve it.",
        img_alt="Smiling marble statue of Archon the Builder in a leather apron, holding a hammer and a glowing website",
        chips=[("New page", "ready to review"), ("Brand", "matched"), ("WordPress", "connected"), ("Published", "after your OK")],
        stall_head='Your website <span class="clay">stopped working for you.</span>',
        stall_lead="It looked great at launch. Now it's out of date, and every change means waiting on a developer.",
        meter=("Site going stale", "24,48,72,92", ["Fresh", "Dated", "Broken"]),
        problems=[
            (I["hammer"], "Every change needs a developer", "A new page takes weeks and a quote.",
             viz_resp("Developer", "3 weeks", "Archon", "one chat", "Pages that wait don't sell.")),
            (I["search"], "Pages nobody searches for", "Your site says what you want to say, but not what customers type into Google.",
             viz_chat(["Home", "About us", "Our story", "Welcome!"], "0 pages people search for")),
            (I["page"], "No clear way to book", "Visitors read, then leave, because the next step isn't clear.",
             viz_week([("Home", 80), ("About", 50), ("Services", 65), ("Blog", 30), ("Contact", 10)], "Example: visitors who reach each page.")),
            (I["grid"], "Stuck in a builder you don't know", "Framer, WordPress, Shopify. Each one has its own learning curve.", VIZ_TOOLS),
        ],
        cards_head='What Archon <span class="clay">does.</span>',
        cards_lead="He builds on the site you already have, in your brand, and asks before anything goes live.",
        cards=[
            ("Plans the site", "He maps the pages you need based on what customers search.", ["Site plan", "Pages"], I["grid"]),
            ("Writes every page", "Clear copy that answers real searches and asks visitors to book.", ["Copy", "Calls to book"], I["doc"]),
            ("Designs in your brand", "He matches your colors, fonts and style before the first design.", ["Brand", "Layouts"], I["photo"]),
            ("Builds on your site", "Pages go straight onto your own site, where you own them.", ["Framer", "WordPress", "Shopify"], I["hammer"]),
            ("Improves old pages", "He reviews the pages you have and makes them clearer and easier to find.", ["Rewrites", "Fixes"], I["up"]),
            ("You approve first", "Drafts and previews first. Nothing goes live until you say so.", ["Previews", "Approval"], I["shield"]),
        ],
        sig_head='Name the page. <span class="clay">Archon builds it.</span>',
        sig_lead="He writes it, designs it in your brand and puts a draft on your site for you to approve.",
        profile=dict(good="Pages that look like your brand and get people to book.", tools=["Framer", "Webflow", "WordPress", "Shopify"],
                     says="Built to last.", fact="Builds temples on weekends and websites on weekdays."),
        chat=[
            ("you", "We need a page for emergency plumbing."),
            ("ag", "Theseus says &ldquo;emergency plumber austin&rdquo; gets 1,900 searches a month. I'll write a page for it in your brand, with a big Call now button."),
            ("card", "New page · /emergency-plumber-austin", "<b>24/7 Emergency Plumber in Austin</b><br>Burst pipe or flooded basement? Call now and we'll get a plumber to you fast. Call [fill in: your phone number].", ["Approve and publish", "Preview"]),
            ("ag", "It's saved as a draft on your WordPress site. Here's the preview link."),
        ],
        outc_head='What Archon <span class="clay">is built for.</span>',
        outcomes=[(5, "site builders", "Framer, Webflow, WordPress, WordPress.com and Shopify"), (0, "pages", "published without your OK"), (100, "%", "yours: pages live on your own site"), (1, "preview", "before any change goes live")],
        outc_note="What Archon is built to do. He never invents facts, prices or reviews.",
        how_head='Hire Archon in <span class="clay">four steps.</span>',
        step_names=["Hire", "Connect", "Approve", "Publish"],
        how_steps=["Start a free trial and meet Archon in chat.", "Connect your site: Framer, Webflow, WordPress or Shopify.",
                   "Review the preview and approve the page.", "He publishes it, and Theseus tracks how it ranks."],
        faq_title="Questions about Archon",
        faqs=[
            ("What is an AI website builder?", "An AI teammate that plans, writes and builds website pages. Archon builds them on the site you already own."),
            ("Which website builders does Archon work with?", "Framer, Webflow, WordPress, WordPress.com and Shopify."),
            ("Will he change my site without asking?", "No. He shows you what will change and a preview first. Nothing goes live until you approve it."),
            ("Do I need a new website?", "No. Archon works on your current site and adds or improves pages there."),
            ("Can he touch my Shopify products or orders?", "No. On Shopify he works only on pages and blog posts. He never touches products, orders, customers or discounts."),
            ("Where do the page ideas come from?", "From Theseus, the SEO specialist. Every page targets what people really search for."),
        ],
        final_line="Tell Archon which page your site is missing. He'll build a preview.",
    ),
]


CHIPS = {'alexander': '\n  .chip.f1 { left: -4%; top: 74%; } .chip.f3 { left: 2%; top: 88%; }\n', 'midas': '\n  .chip.f1 { left: -4%; top: 84%; } .chip.f4 { right: -2%; top: 10%; }\n', 'cleo': '\n  .chip.f4 { left: -2%; right: auto; top: 86%; }\n', 'cyrus': '\n  .chip.f1 { top: 2%; }\n', 'theseus': '\n  .chip.f3 { left: auto; right: 0; top: 52%; }\n', 'archon': '\n  .chip.f2 { top: 6%; }\n'}


def make(a):
    k = a["key"]
    n, t, r, slug = next((x[1], x[2], x[3], x[4]) for x in TEAM if x[0] == k)
    p = dict(a)
    p.update(
        slug=slug, section=SECTION, name=f"{n} {t}", title_word=t,
        crumb='<b>AI employees</b>',
        second_cta=(f"See {n} work", "demo"), proof="Start free. Approve everything before it goes out.",
        img=f"team/{k}.webp", img_h=IMG_H[k], name_full=f"{n}, AI {a['role_long']}",
        audience="Small business owners", signature=signature(dict(a, name=n, title_word=t)), css=CSS + CHIPS.get(k, ""),
        before_faq=team_strip(k),
    )
    p["name"] = f"{n} {t}"
    return p


def sitemap(urls):
    sm = ROOT / "sitemap.xml"
    x = sm.read_text()
    add = ''.join(f'  <url><loc>{u}</loc></url>\n' for u in urls if u not in x)
    if add:
        sm.write_text(x.replace("</urlset>", add + "</urlset>"))


if __name__ == "__main__":
    urls = []
    for a in AGENTS:
        p = make(a)
        bs.build(p)
        out = ROOT / SECTION / p["slug"] / "index.html"
        html = out.read_text().replace('<div class="free">Free · 30 min</div>', '<div class="free">Free trial</div>')
        out.write_text(html)
        urls.append(f"https://morningtelos.com/{SECTION}/{p['slug']}/")
    sitemap(urls)
