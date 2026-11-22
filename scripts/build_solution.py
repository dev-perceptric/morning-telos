#!/usr/bin/env python3
"""Builds the industry pages at site/solutions/<slug>/: the AI team, told for one kind of business.
Uses the shared page builder in build_service.py. Usage: python3 scripts/build_solution.py"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import build_service as B  # noqa: E402

CHECK = B.CHECK


def ba(rows, head, lead):
    before = "".join(f'<li style="--i:{k}"><time>{t}</time><span>{a}</span><em class="m">{h}</em></li>' for k, (t, a, h, _) in enumerate(rows))
    after = "".join((f'<li class="free" style="--i:{k}"><time>{t}</time><span>{b[1:].strip()}</span><em class="f">your time</em></li>' if b.startswith("•")
                     else f'<li style="--i:{k}"><time>{t}</time><span>{b}</span><em class="a">AI team</em></li>') for k, (t, _, _, b) in enumerate(rows))
    return f'''  <section class="ba-sec wrap">
    <div class="head">
      <h2 class="big rv">{head}</h2>
      <p class="lead rv" style="--d:.1s">{lead}</p>
    </div>
    <div class="ba rv rv-s" data-s="before">
      <div class="ba-top">
        <div class="ba-tog" role="group" aria-label="Compare the day"><i aria-hidden="true"></i><button type="button" data-v="before" aria-pressed="true">Before</button><button type="button" data-v="after" aria-pressed="false">After</button></div>
        <span class="ba-note"><b class="bn-b">Most of the day goes to busywork</b><b class="bn-a">Busywork handled. Your time back.</b></span>
      </div>
      <div class="ba-lists"><ul class="ba-l before">{before}</ul><ul class="ba-l after">{after}</ul></div>
    </div>
  </section>

'''


def flow(head, lead, ttl, chan, who, msg, t0, steps, out, outsub, note):
    li = "".join(f'<li style="--dl:{.6 + k*.5:.2f}s"><span class="fn">0{k+1}</span><span><b>{a}</b><em>{b}</em></span><time>{t}</time></li>' for k, (a, b, t) in enumerate(steps))
    return f'''  <section class="sig" id="demo">
    <div class="wrap">
      <div class="head">
        <h2 class="big rv">{head}</h2>
        <p class="lead rv" style="--d:.1s">{lead}</p>
      </div>
      <div class="app flow draw rv rv-s">
        <div class="app-bar"><i></i><i></i><i></i><span class="ttl">example · {ttl}</span><span class="clock"><span class="dot-live"></span>{t0}</span></div>
        <div class="flow-body">
          <div class="flow-msg"><small>Incoming · {chan}</small><div class="bubble"><b>{who}</b><p>{msg}</p><time>{t0}</time></div></div>
          <ol class="flow-steps">{li}</ol>
          <div class="flow-out"><span class="ck">{CHECK}</span><b>{out}</b><small>{outsub}</small></div>
        </div>
      </div>
      <p class="onote rv">{note}</p>
    </div>
  </section>

'''


IC = {
    "chat": '<path d="M4 5h16v11H9l-5 4z"/><path d="M15 10l2 2 4-4"/>',
    "cal": '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    "phone": '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
    "doc": '<path d="M7 3h8l4 4v14H7z"/><path d="M15 3v4h4"/><path d="M10 13h6M10 17h4"/>',
    "star": '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
    "chart": '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    "flow": '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="12" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M8.5 6H12a3 3 0 0 1 3 3v1M8.5 18H12a3 3 0 0 0 3-3v-1"/>',
    "mail": '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
    "user": '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
    "clock": '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    "box": '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>',
    "shield": '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
    "search": '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    "money": '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>',
}

def G(icon):
    return f'<g transform="translate(8 8)">{icon}</g>'


SOL_CSS = B.SIG_CSS + '''
  .ba-sec { padding: 40px 0 120px; }
  .ba-sec .head { display: grid; grid-template-columns: 1.2fr 1fr; gap: 48px; align-items: end; margin-bottom: 36px; }
  .ba { border-radius: 18px; border: 1px solid var(--line); box-shadow: 0 40px 80px -50px rgba(46,41,38,.5); padding: 22px 26px 26px; background: var(--ivory-3); transition: background .6s; }
  .ba[data-s="after"] { background: var(--white); }
  .ba-top { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 18px; flex-wrap: wrap; }
  .ba-tog { position: relative; display: inline-grid; grid-template-columns: 1fr 1fr; padding: 4px; border-radius: 99px; background: var(--white); border: 1px solid var(--line-2); }
  .ba-tog i { position: absolute; top: 4px; bottom: 4px; left: 4px; width: calc(50% - 4px); border-radius: 99px; background: var(--ink); transition: transform .45s var(--ease), background .45s; }
  .ba[data-s="after"] .ba-tog i { transform: translateX(100%); background: var(--clay); }
  .ba-tog button { position: relative; z-index: 1; padding: 9px 22px; font-size: 14px; font-weight: 500; border-radius: 99px; color: var(--ink-3); transition: color .3s; }
  .ba[data-s="before"] .ba-tog button[data-v="before"], .ba[data-s="after"] .ba-tog button[data-v="after"] { color: #fff; }
  .ba-note { position: relative; font-size: 14px; color: var(--ink-3); min-width: 260px; text-align: right; height: 20px; }
  .ba-note b { position: absolute; right: 0; font-weight: 500; transition: opacity .4s, transform .4s var(--ease); white-space: nowrap; }
  .ba-note .bn-a { color: var(--clay); opacity: 0; transform: translateY(6px); }
  .ba[data-s="after"] .bn-b { opacity: 0; transform: translateY(-6px); }
  .ba[data-s="after"] .bn-a { opacity: 1; transform: none; }
  .ba-lists { display: grid; }
  .ba-l { grid-area: 1 / 1; list-style: none; display: grid; gap: 8px; }
  .ba-l li { display: grid; grid-template-columns: 76px 1fr auto; gap: 14px; align-items: center; padding: 13px 16px; border-radius: 12px; background: rgba(255,255,255,.6); border: 1px solid var(--line); font-size: 15px;
    transition: opacity .45s var(--ease) calc(var(--i) * .07s), transform .5s var(--ease) calc(var(--i) * .07s); }
  .ba-l.after li { background: var(--ivory); }
  .ba-l.after li.free { background: #fff4ee; border-color: var(--clay-soft); }
  .ba[data-s="before"] .ba-l.after li { opacity: 0; transform: translateY(10px); pointer-events: none; }
  .ba[data-s="after"] .ba-l.before li { opacity: 0; transform: translateY(-10px); pointer-events: none; }
  .ba time { font-family: var(--mono); font-size: 12px; color: var(--ink-4); }
  .ba em { font-style: normal; font-family: var(--mono); font-size: 11px; padding: 3px 9px; border-radius: 99px; white-space: nowrap; }
  .ba em.m { background: rgba(46,41,38,.07); color: var(--ink-3); }
  .ba em.a { background: rgba(95,163,106,.14); color: #3f7d4a; }
  .ba em.f { background: var(--clay); color: #fff; }
  .flow-body { display: grid; grid-template-columns: 1fr 1.4fr 1fr; gap: 0; min-height: 380px; }
  .flow-msg { padding: 24px; border-right: 1px solid var(--line); background: var(--ivory); }
  .flow-msg small, .flow-steps::before { display: block; font-family: var(--sans); font-weight: 600; font-size: 10.5px; letter-spacing: .04em; text-transform: uppercase; color: var(--ink-4); margin-bottom: 12px; }
  .bubble { background: var(--white); border: 1px solid var(--line); border-radius: 16px 16px 16px 4px; padding: 14px 16px; opacity: 0; transform: translateY(12px) scale(.96); transition: opacity .5s .2s, transform .6s cubic-bezier(.3,1.5,.5,1) .2s; }
  .flow.in .bubble { opacity: 1; transform: none; }
  .bubble b { display: block; font-size: 14px; } .bubble p { font-size: 15px; margin: 6px 0 8px; color: var(--ink-2); } .bubble time { font-family: var(--mono); font-size: 11px; color: var(--ink-4); }
  .flow-steps { list-style: none; padding: 24px; border-right: 1px solid var(--line); display: grid; gap: 12px; align-content: start; position: relative; }
  .flow-steps::before { content: "Agent"; }
  .flow-steps li { display: grid; grid-template-columns: 30px 1fr auto; gap: 12px; align-items: start; opacity: 0; transform: translateX(-10px); transition: opacity .5s var(--dl), transform .6s var(--ease) var(--dl); }
  .flow.in .flow-steps li { opacity: 1; transform: none; }
  .fn { width: 30px; height: 30px; border-radius: 50%; background: var(--clay); color: #fff; display: grid; place-items: center; font-family: var(--mono); font-size: 11px; }
  .flow-steps b { display: block; font-weight: 600; font-size: 15px; } .flow-steps em { font-style: normal; font-size: 13px; color: var(--ink-3); }
  .flow-steps time { font-family: var(--mono); font-size: 11px; color: var(--ink-4); margin-top: 5px; }
  .flow-out { padding: 24px; display: grid; align-content: center; justify-items: start; gap: 8px; opacity: 0; transform: scale(.94); transition: opacity .5s 3.1s, transform .6s cubic-bezier(.3,1.5,.5,1) 3.1s; }
  .flow.in .flow-out { opacity: 1; transform: none; }
  .flow-out .ck { width: 48px; height: 48px; border-radius: 14px; background: var(--clay); display: grid; place-items: center; box-shadow: 0 14px 30px -12px rgba(217,119,87,.9); }
  .flow-out .ck svg { width: 22px; height: 22px; stroke: #fff; fill: none; stroke-width: 2.5; }
  .flow-out b { font-family: var(--serif); font-weight: 500; font-size: 30px; line-height: 1.1; } .flow-out small { font-size: 14px; color: var(--ink-3); }
  @media (max-width: 1000px) { .ba-sec .head { grid-template-columns: 1fr; gap: 18px; } .flow-body { grid-template-columns: 1fr; } .flow-msg, .flow-steps { border-right: 0; border-bottom: 1px solid var(--line); } }
  @media (max-width: 640px) { .ba { padding: 16px 12px 18px; } .ba-l li { grid-template-columns: 50px 1fr; font-size: 14px; padding: 10px 12px; } .ba em { display: none; } .ba-note { display: none; } .ba-sec { padding-bottom: 80px; } }
'''

# ---------------------------------------------------------------------------
# Industry pages: the AI team, told for one kind of business. Every claim has to match what the app does
# (web/src/lib/team.ts): email, calendar, CRM, help desk, social posts, search and website pages, with the owner's OK.
# No phone answering, texting or DMs: the team doesn't do those.
import build_agent as A  # noqa: E402

PAGES = []
ROLE = {x["key"]: x["role_long"] for x in A.AGENTS}
NAME = {k: f"{n} {t}" for k, n, t, r, s in A.TEAM}
AG_IC = {"alexander": IC["chart"], "midas": IC["money"], "irene": IC["chat"], "cleo": IC["cal"], "cyrus": IC["mail"],
         "leo": IC["star"], "theseus": IC["search"], "archon": IC["doc"]}
STEPS = ["<h3>Tell them about you</h3>", "<h3>Connect your tools</h3>", "<h3>Set the rules</h3>", "<h3>Let them work</h3>"]
SHARED_FAQS = [
    ("Will anything go out without my OK?", "No. Every email, post, invite and page waits for your approval. Once a teammate earns your trust, you can let it work on its own."),
    ("How much does it cost?", "It's free for 14 days, and you don't need a card. After that, Starter is $49 a month and Pro is $149 a month."),
]


def page(**kw):
    kw.setdefault("section", "solutions")
    kw.setdefault("crumb", "<b>Solutions</b>")
    kw.setdefault("css", SOL_CSS)
    kw.setdefault("outc_head", 'What your team <span class="clay">is built for.</span>')
    kw.setdefault("outc_note", "What the AI team is built to do. Results depend on your business.")
    PAGES.append(kw)


def ind(slug, name, audience, title, desc, h1, lead, img, img_alt, chips, stall, problems, day, cards, demo, faqs, final, short):
    """One industry page. cards: (agent, line, tags). demo: (head, lead, ttl, chan, who, msg, t0, steps, out, outsub)."""
    stall_head, stall_lead, meter = stall
    rows, day_head = day
    page(
        slug=slug, name=name, service_type=f"AI employees for {short}", audience=audience, title=title, desc=desc,
        h1=h1, h1_label=f"AI employees for {short}", lead=lead,
        second_cta=("Meet the team", "team"), proof="14 days free. You approve everything before it goes out.",
        img=img, img_alt=img_alt, chips=chips,
        stall_head=stall_head, stall_lead=stall_lead, meter=meter, problems=problems,
        after_stall=ba(rows, day_head, "Switch to After to see the same day with your AI team on the busywork."),
        cards_head=f'Your AI team for <span class="clay">{short}.</span>',
        cards_lead="Eight teammates, each with one job. Here's what they take off your plate.",
        cards=[(f'{NAME[k]}<small class="crole">{ROLE[k]}</small>', line, tags, AG_IC[k]) for k, line, tags in cards],
        signature=flow(*demo, "Sample conversation. Names and numbers are made up."),
        outcomes=[(8, "teammates", "who learn your business once"), (0, "emails", "sent without your OK"), (24, "/7", "watching your inbox and calendar"), (14, "days", "free, no card needed")],
        how_head='Hire your team in <span class="clay">four steps.</span>', step_names=STEPS,
        how_steps=["Share your services, your prices and the way you like things done. The whole team learns it once.",
                   "Link your email, calendar, CRM and social accounts in a few clicks.",
                   "Decide what needs your OK and what each teammate can handle alone.",
                   "Tag a teammate in chat or let them spot the work. They report back every week."],
        before_faq=A.team_strip(None, f'Meet your <span class="clay">AI team.</span>'),
        faq_title=f"Questions from {short}", faqs=faqs + SHARED_FAQS, final_line=final,
    )


SOL_CSS += "\n  .acard h3 small.crole { display: block; margin-top: 4px; font-family: var(--sans); font-size: 12px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--orange-ink); }\n"

ind("clinics", "Dental &amp; medical clinics", "Dental and medical clinics",
    "AI Employees for Dental & Medical Clinics | Morning Telos",
    "An AI team for dental and medical clinics. Answer patient emails, fill the schedule, send reminders, ask for reviews and keep new patients coming.",
    ("Your front desk,", "with backup."),
    "An AI team for dental and medical clinics. They answer patient emails, book visits into your calendar, send reminders and ask happy patients for reviews, so your staff can focus on the people in the chair.",
    "in_clinic.webp", "Marble statue of a young Greek man wearing a brass stethoscope",
    [("Irene answered 9 emails", "from your office policies"), ("Cleo booked a cleaning", "Tue 9:30 AM"), ("Reminder sent", "for tomorrow's visits"), ("Leo posted", "a tip for new patients")],
    ('The front desk <span class="clay">never stops.</span>',
     "Patients check in, the inbox fills up and the schedule has gaps. Your team can't be in three places at once.",
     ("Front desk load", "25,50,74,92", ["Calm", "Busy", "Overrun"])),
    [(IC["chat"], "The same questions all day", "Do you take my insurance? What time do you open? Your staff types the same answers again and again.",
      B.viz_chat(["Do you take Delta Dental?", "What time do you open?", "Do you take Delta Dental?", "Can I move my cleaning?"], "×46 this week")),
     (IC["cal"], "Gaps in the schedule", "A no-show or a late cancel leaves an empty chair you can't fill.",
      B.viz_week([("Mon", 30), ("Tue", 55), ("Wed", 20), ("Thu", 70), ("Fri", 45)], "Example: empty slots from no-shows each day.")),
     (IC["star"], "Happy patients never review", "They love the visit, then forget to tell Google about it.",
      B.viz_resp("Ask by hand", "rarely", "Ask after every visit", "always", "Reviews bring in the next patient.")),
     (IC["search"], "New patients pick someone else", "People search for a dentist near them, and the clinic with the better site gets the call.", B.VIZ_YOU)],
    ([("8:00", "Answer emails from last night", "45 min", "Irene's replies are drafted and waiting for your OK"),
      ("9:30", "Book visits between check-ins", "constant", "Cleo offers open times and sends the invites"),
      ("11:00", "Remind patients about tomorrow", "1 hr", "Reminder emails already went out"),
      ("13:00", "Write a post for social media", "skipped", "Leo's posts are planned for the week"),
      ("15:00", "Ask happy patients for reviews", "forgotten", "Review requests drafted after each visit"),
      ("17:00", "Catch up on the inbox", "late", "• Time for patients and the team")],
     'A front desk day, <span class="clay">before and after.</span>'),
    [("irene", "Answers patient emails from your office policies, and sends anything medical or urgent straight to your staff.", ["Gmail", "Outlook"]),
     ("cleo", "Finds open times, books visits and sends reminder emails before every appointment.", ["Google Calendar", "Calendly"]),
     ("cyrus", "Reminds patients when a checkup is due and welcomes new patients with a friendly email.", ["Recalls", "Welcome emails"]),
     ("leo", "Posts helpful tips and team moments, so your practice feels familiar before the first visit.", ["Instagram", "Facebook"]),
     ("theseus", "Finds what patients search for in your area, like &ldquo;emergency dentist near me&rdquo;.", ["Google", "AI answers"]),
     ("archon", "Builds pages for each service you offer, with a clear way to book.", ["WordPress", "Framer"])],
    ('A patient emails at 9 PM. <span class="clay">A reply is ready by 9:01.</span>', "Irene reads the email, Cleo finds a slot, and the reply waits for your OK in the morning. One tap and it's sent.",
     "after-hours email", "Email", "Maria L.", "Hi, my tooth has been hurting since yesterday. Can I come in this week?", "9:02 PM",
     [("Irene read the email", "marked it as urgent for your staff", "0:03"), ("Cleo checked the calendar", "Wed 8:30 AM is open", "0:09"), ("Irene drafted a reply", "offering Wed 8:30 AM", "0:41"), ("Sent after your OK", "invite and reminder set", "8:02 AM")],
     "Reply sent", "Wed 8:30 AM offered · follow-up set"),
    [("Does it work with our practice software?", "Your team works through email, Google Calendar or Calendly, and your CRM. If your practice software syncs with Google Calendar or sends email, they can work alongside it."),
     ("What about patient health details?", "Keep medical records in your practice software. Use your AI team for the front office work around them, like emails, scheduling, reminders and marketing."),
     ("Can it handle urgent cases?", "Irene flags anything urgent or medical and hands it to your staff with a short summary. She never gives medical advice."),
     ("Will patients know it's AI?", "You choose how your team signs its emails. Many clinics sign as the front desk and review every reply before it goes out.")],
    "Tell your AI team about your clinic. See how much of the front desk they can take on in your first week.",
    "clinics")

ind("home-services", "Home services", "HVAC, plumbing, roofing and home service companies",
    "AI Employees for HVAC, Plumbing & Home Service Companies | Morning Telos",
    "An AI team for HVAC, plumbing, roofing and home service companies. Reply to every lead, follow up on quotes, book jobs and keep customers coming back.",
    ("Stay on the job.", "Leads get answered."),
    "An AI team for HVAC, plumbing, roofing and home service companies. They reply to new leads, follow up on every quote, book jobs into your calendar and remind customers about tune-ups, while you're out in the field.",
    "in_home.webp", "Marble statue of a young Greek man resting a brass wrench on his shoulder",
    [("Midas replied to a lead", "while you were on a roof"), ("Quote follow-up", "day 3, needs you"), ("Cleo booked a job", "Thu 2 PM"), ("Cyrus drafted", "the fall tune-up email")],
    ('Jobs slip away <span class="clay">while you\'re on a ladder.</span>',
     "The first company to get back to a customer usually wins the job. That's hard when your hands are full.",
     ("Jobs at risk", "26,50,74,92", ["Booked", "Leaky", "Losing"])),
    [(IC["clock"], "Leads wait until tonight", "A form comes in at 10 AM. You see it at 8 PM, and they already hired someone.",
      B.viz_resp("Reply tonight", "10 hrs", "Midas drafts", "minutes", "Example time before a lead hears back.")),
     (IC["money"], "Quotes go quiet", "You send a price and never follow up. The job goes to whoever called back.",
      B.viz_chat(["Quote sent: $6,400", "No reply", "Still no reply", "They went with someone else"], "0 follow-ups sent")),
     (IC["cal"], "Scheduling by email tag", "Back-and-forth messages just to find a time that works.",
      B.viz_chat(["Can you come Thursday?", "Morning or afternoon?", "Does 2 PM work?", "Sorry, just saw this"], "5 emails to book 1 job")),
     (IC["star"], "No one comes back", "Tune-ups, reviews and repeat work never get asked for.",
      B.viz_data(["Jobs done", "Invoices", "Reviews", "Plans"], "Repeat work", G(IC["star"])))],
    ([("7:30", "Read last night's leads and forms", "40 min", "Midas already drafted every reply"),
      ("10:00", "Miss new leads while on a job", "4 waiting", "Replies wait for your one-tap OK"),
      ("12:30", "Chase quotes from last week", "skipped", "Day 3 follow-ups drafted for you"),
      ("15:00", "Email back and forth to book", "6 emails", "Cleo offers open times and sends the invite"),
      ("19:00", "Write the tune-up promo", "never", "Cyrus has it ready for your OK"),
      ("20:30", "Catch up on email at the kitchen table", "1.5 hrs", "• Evening off with your family")],
     'A field day, <span class="clay">before and after.</span>'),
    [("midas", "Replies to every new lead, follows up on quotes on day 3, 7 and 14, and keeps your CRM current.", ["Gmail", "HubSpot", "Jobber leads"]),
     ("cleo", "Finds open times, books jobs and sends reminder emails the day before.", ["Google Calendar", "Calendly"]),
     ("irene", "Answers customer questions about hours, service areas and warranties from your notes.", ["Gmail", "Outlook"]),
     ("cyrus", "Sends tune-up reminders and seasonal offers to past customers.", ["Tune-ups", "Win-back"]),
     ("leo", "Posts your before-and-after photos and team stories every week.", ["Facebook", "Instagram"]),
     ("theseus", "Finds what people in your area search for, like &ldquo;AC repair near me&rdquo;.", ["Google", "AI answers"])],
    ('A lead at noon. <span class="clay">A reply by 12:02.</span>', "Midas reads the form, Cleo finds an opening, and the reply waits for your OK. You approve it from the truck.",
     "new lead", "Web form", "James R.", "AC not cooling, unit is about 3 years old. Can someone come out this week?", "12:00 PM",
     [("Midas read the lead", "AC repair, 3-year-old unit", "0:20"), ("Cleo checked the calendar", "Thu 2 PM is open", "0:45"), ("Midas drafted a reply", "offering Thu 2 PM", "1:30"), ("Sent after your OK", "added to your leads list", "1:52")],
     "Reply sent", "Thu 2 PM offered · follow-up set"),
    [("Does it work with ServiceTitan, Jobber or Housecall Pro?", "Your team works through your email, calendar and CRM. When your field software sends leads or bookings by email or to Google Calendar, they pick them up there."),
     ("Can it quote prices?", "Midas only shares prices you gave him or that are in the deal. Final quotes always go to you first."),
     ("Do I need new software?", "No. Your team works inside the email, calendar and accounts you already use."),
     ("What about emergencies?", "Your team flags urgent requests right away, so you can call the customer yourself.")],
    "Forward your AI team the last lead you didn't get to. See the reply Midas writes.",
    "home service companies")

ind("real-estate", "Real estate", "Real estate agents and brokerages",
    "AI Employees for Real Estate Agents & Brokerages | Morning Telos",
    "An AI team for real estate agents and brokerages. Reply to every buyer and seller, book showings, keep your sphere warm and market your listings.",
    ("Never let a buyer", "go cold again."),
    "An AI team for real estate agents and brokerages. They reply to new buyer and seller leads, book showings, keep your past clients warm and market every listing, while you're out showing homes.",
    "in_estate.webp", "Marble statue of a young Greek man holding a small brass house",
    [("Midas replied to a buyer", "within minutes"), ("Cleo booked a showing", "Sat 11 AM"), ("Leo posted", "your new listing"), ("Cyrus sent", "the monthly market update")],
    ('Leads go cold <span class="clay">during showings.</span>',
     "You're with a client for three hours. Meanwhile, a new buyer emailed two other agents too.",
     ("Leads going cold", "24,48,72,92", ["Hot", "Cooling", "Gone"])),
    [(IC["clock"], "The fastest agent wins", "Buyers reach out to several agents at once and go with the first one who replies.",
      B.viz_resp("Reply after showings", "4 hrs", "Midas drafts", "minutes", "Example time before a lead hears back.")),
     (IC["user"], "Your sphere forgets you", "Past clients would refer you, but you haven't been in touch in a year.",
      B.viz_week([("Jan", 90), ("Apr", 60), ("Jul", 40), ("Oct", 20), ("Dec", 10)], "Example: past clients you've kept in touch with.")),
     (IC["cal"], "Showing schedules are a mess", "Buyers, sellers and other agents all trying to agree on a time.",
      B.viz_chat(["Can we see it Saturday?", "Seller prefers Sunday", "What about 11?", "Can we push to 1?"], "7 emails for 1 showing")),
     (IC["star"], "Listings need marketing", "Every new listing needs posts, emails and a page, on top of everything else.", B.VIZ_YOU)],
    ([("8:00", "Reply to overnight inquiries", "45 min", "Midas's replies are ready for your OK"),
      ("10:00", "Coordinate showing times", "1 hr", "Cleo offers times and sends invites"),
      ("12:00", "Miss leads during a showing", "3 waiting", "Every lead already has a reply waiting"),
      ("14:00", "Post the new listing", "rushed", "Leo has the posts drafted"),
      ("16:00", "Write the market update", "skipped", "Cyrus has it ready to send"),
      ("19:00", "Update the CRM", "never", "• Dinner without your phone")],
     'An agent\'s day, <span class="clay">before and after.</span>'),
    [("midas", "Replies to buyer and seller leads in minutes and follows up until there's a meeting.", ["Zillow leads", "Gmail", "CRM"]),
     ("cleo", "Books showings and listing appointments around your calendar.", ["Google Calendar", "Calendly"]),
     ("cyrus", "Keeps your sphere warm with market updates and check-ins.", ["Newsletters", "Past clients"]),
     ("leo", "Posts new listings, open houses and sold homes in your voice.", ["Instagram", "Facebook"]),
     ("archon", "Builds pages for neighborhoods and listings that people search for.", ["Your website"]),
     ("alexander", "Tells you which leads are hot and plans your week around them.", ["Pipeline", "Weekly plan"])],
    ('A buyer emails at 7 PM. <span class="clay">A reply by 7:02.</span>', "Midas reads the inquiry, Cleo finds a showing time, and the reply waits for your OK.",
     "new buyer lead", "Email", "Priya S.", "Is the house on Oak Street still available? We'd love to see it this weekend.", "7:00 PM",
     [("Midas read the lead", "buyer, pre-approved, Oak Street", "0:15"), ("Cleo checked the calendar", "Sat 11 AM is open", "0:40"), ("Midas drafted a reply", "offering Sat 11 AM", "1:20"), ("Sent after your OK", "lead saved with next step", "1:48")],
     "Reply sent", "Sat 11 AM offered · follow-up set"),
    [("Does it work with my CRM?", "Your team works with HubSpot, Pipedrive and Salesforce. With no CRM, Midas keeps a simple leads list for you."),
     ("Can it handle leads from Zillow or Realtor.com?", "Yes, when those leads arrive in your email. Midas reads them and drafts a reply right away."),
     ("Will it give out property details?", "Only what you share with the team or what's in the listing. It never guesses about a home."),
     ("Can my whole team use it?", "Yes. Invite your agents to the same workspace so everyone can see the work and approve it.")],
    "Forward your AI team a buyer lead from this week. See how fast Midas replies.",
    "real estate agents")

ind("law-firms", "Law firms", "Law firms",
    "AI Employees for Law Firms | Morning Telos",
    "An AI team for law firms. Reply to new client inquiries, book consultations, keep clients updated and grow your practice, with your OK on every message.",
    ("More consultations.", "Less admin."),
    "An AI team for law firms. They reply to new client inquiries, book consultations, answer routine questions from your notes and keep your firm visible online. Every message waits for your OK.",
    "in_law.webp", "Marble statue of a young Greek man holding the scales of justice",
    [("Midas replied", "to a new inquiry"), ("Cleo booked a consult", "Mon 10 AM"), ("Irene answered", "a status question"), ("Theseus found", "12 searches to win")],
    ('Billable hours <span class="clay">lost to the inbox.</span>',
     "Intake emails, scheduling and status questions eat the hours you should be billing.",
     ("Admin load", "26,50,74,92", ["Light", "Heavy", "Crushing"])),
    [(IC["clock"], "Inquiries wait for days", "Potential clients email three firms. The first to reply gets the consultation.",
      B.viz_resp("Reply when free", "2 days", "Midas drafts", "minutes", "Example time before an inquiry hears back.")),
     (IC["chat"], "Where's my case?", "Clients email for updates, and each answer pulls you out of real work.",
      B.viz_chat(["Any update on my case?", "Did you get my documents?", "When is the hearing?", "Any update?"], "×18 this week")),
     (IC["cal"], "Consults by phone tag", "Booking one consultation takes four emails and a missed call.",
      B.viz_week([("Mon", 40), ("Tue", 60), ("Wed", 35), ("Thu", 75), ("Fri", 50)], "Example: hours lost to scheduling each day.")),
     (IC["search"], "Clients can't find you", "People ask Google and ChatGPT for a lawyer near them. Your firm isn't in the answer.", B.VIZ_YOU)],
    ([("8:30", "Read new inquiries", "45 min", "Midas sorted them and drafted replies"),
      ("10:00", "Book consultations", "1 hr", "Cleo offers times and sends invites"),
      ("12:00", "Answer status emails", "1 hr", "Irene drafted answers from your notes"),
      ("14:00", "Follow up on cold inquiries", "skipped", "Follow-ups waiting for your OK"),
      ("16:00", "Write a blog post", "never", "Theseus has the topics people search"),
      ("18:00", "Catch up on email", "late", "• Billable work, done on time")],
     'A firm\'s day, <span class="clay">before and after.</span>'),
    [("midas", "Replies to every inquiry, asks your intake questions and follows up until a consult is booked.", ["Gmail", "Outlook", "CRM"]),
     ("cleo", "Books consultations and sends reminders, always with the time zone.", ["Google Calendar", "Calendly"]),
     ("irene", "Answers routine questions from your notes and hands legal questions straight to you.", ["Email", "Help desk"]),
     ("theseus", "Finds what people search for in your practice area and city.", ["Google", "AI answers"]),
     ("archon", "Builds practice-area pages with a clear way to book a consult.", ["Your website"]),
     ("cyrus", "Sends past clients a friendly note now and then, so referrals keep coming.", ["Newsletters", "Referrals"])],
    ('An inquiry at 8 PM. <span class="clay">A reply by 8:02.</span>', "Midas reads the inquiry, asks your intake questions and offers a consult time. You approve it in the morning.",
     "new client inquiry", "Web form", "Daniel K.", "I was in a car accident last week and the other driver's insurance isn't calling back. Can you help?", "8:00 PM",
     [("Midas read the inquiry", "personal injury, last week", "0:20"), ("Cleo checked the calendar", "Mon 10 AM is open", "0:50"), ("Midas drafted a reply", "intake questions + Mon 10 AM", "1:40"), ("Sent after your OK", "lead saved with next step", "8:05 AM")],
     "Reply sent", "Mon 10 AM offered · follow-up set"),
    [("Will it give legal advice?", "No. Your team never gives legal advice. Irene hands every legal question to you with a short summary."),
     ("Is client information kept private?", "Your workspace is private to your firm, and other customers can never see your data. You choose which accounts to connect."),
     ("Does it work with Clio or MyCase?", "Your team works through email, calendar and your CRM. When your case software sends email or syncs to your calendar, they work alongside it."),
     ("Can it run conflict checks?", "No. Conflict checks stay with your team. Midas collects the names you need to run them.")],
    "Forward your AI team an inquiry you haven't answered. See the reply Midas writes.",
    "law firms")

ind("ecommerce", "E-commerce", "E-commerce and Shopify brands",
    "AI Employees for Shopify & E-commerce Brands | Morning Telos",
    "An AI team for Shopify and e-commerce brands. Answer customer emails, send campaigns, post on social, win back past buyers and build store pages.",
    ("Support that answers", "while you ship."),
    "An AI team for Shopify and e-commerce brands. They answer customer emails, send campaigns to your list, post on social and build store pages, so you can focus on products and growth.",
    "in_shop.webp", "Marble statue of a young Greek man carrying a shopping bag",
    [("Irene answered 14 emails", "where's my order"), ("Cyrus drafted", "the weekend sale email"), ("Leo scheduled", "5 product posts"), ("Archon built", "a new collection page")],
    ('Support grows <span class="clay">faster than sales.</span>',
     "Every order brings questions. More orders means more hours in the inbox.",
     ("Inbox pressure", "28,52,74,93", ["Calm", "Busy", "Drowning"])),
    [(IC["chat"], "Where is my order?", "The same shipping and return questions, all day long.",
      B.viz_chat(["Where is my order?", "Can I return this?", "Where is my order?", "Do you ship to Canada?"], "×120 this week")),
     (IC["mail"], "Your list sits idle", "Thousands of past buyers and no time to write the next email.",
      B.viz_week([("Jan", 85), ("Mar", 60), ("May", 45), ("Jul", 30), ("Sep", 20)], "Example: repeat buyers when nobody emails them.")),
     (IC["star"], "Social takes all day", "Every product needs posts, captions and good timing.",
      B.viz_resp("Posting yourself", "8 h/wk", "Leo plans", "1 approval", "Example time spent on social each week.")),
     (IC["doc"], "Store pages fall behind", "New collections launch with thin pages that nobody finds.", B.VIZ_TOOLS)],
    ([("8:00", "Answer overnight emails", "1.5 hrs", "Irene's replies are ready for your OK"),
      ("10:00", "Look up order status", "constant", "Answers drafted from your policies"),
      ("12:00", "Write the weekend sale email", "2 hrs", "Cyrus wrote it and sent you a test"),
      ("14:00", "Post on Instagram", "skipped", "Leo's posts are scheduled"),
      ("16:00", "Update collection pages", "never", "Archon built the page as a hidden draft"),
      ("18:00", "Still in the inbox", "late", "• Time for products and growth")],
     'A store\'s day, <span class="clay">before and after.</span>'),
    [("irene", "Answers shipping, sizing and return questions from your policies, and hands refunds to you.", ["Gmail", "Zendesk", "Help Scout"]),
     ("cyrus", "Writes launches, sales and win-back emails, and sends them after you approve a test.", ["Campaigns", "Win-back"]),
     ("leo", "Plans and schedules product posts at the best times.", ["Instagram", "TikTok", "Facebook"]),
     ("archon", "Builds store pages and blog posts on Shopify, hidden until you approve.", ["Shopify"]),
     ("theseus", "Finds what shoppers search for and plans content around it.", ["Google", "AI answers"]),
     ("alexander", "Answers questions about the business and plans your week.", ["Weekly plan", "Reports"])],
    ('A customer emails at 11 PM. <span class="clay">An answer is ready by 11:01.</span>', "Irene reads the email, checks your shipping policy and drafts a friendly reply for your OK.",
     "customer email", "Email", "Hannah P.", "Hi! I ordered a sweater last week and haven't gotten a shipping update. Is it on the way?", "11:00 PM",
     [("Irene read the email", "shipping question, order last week", "0:10"), ("Checked your policy", "ships in 3 to 5 days", "0:25"), ("Drafted a reply", "friendly, with next steps", "0:50"), ("Sent after your OK", "marked as answered", "8:01 AM")],
     "Customer answered", "in your voice · after your OK"),
    [("Does it work with Shopify?", "Yes. Archon builds pages and blog posts on Shopify, and they stay hidden until you approve. He never touches products, orders, customers or discounts."),
     ("Can Irene see order details?", "She answers from your policies, your notes and what the customer wrote. For order-specific details, she asks you."),
     ("Will Cyrus spam my list?", "No. He only emails people who bought from you or signed up, and he sends a few at a time from your own inbox."),
     ("Can it handle refunds?", "Irene hands every refund request to you with a short summary, so you decide.")],
    "Show your AI team the question you answer most. See how Irene handles it.",
    "online stores")

ind("accounting", "Accounting firms", "Accounting and bookkeeping firms",
    "AI Employees for Accounting & Bookkeeping Firms | Morning Telos",
    "An AI team for accounting and bookkeeping firms. Chase documents by email, answer client questions, book meetings and grow your firm.",
    ("Stop chasing", "documents."),
    "An AI team for accounting and bookkeeping firms. They remind clients about missing documents, answer routine questions, book meetings and keep new clients coming, so your team can do the real accounting.",
    "in_acct.webp", "Marble statue of a young Greek man holding a brass abacus",
    [("Reminder sent", "9 documents still missing"), ("Irene answered", "a when-will-it-be-done email"), ("Cleo booked", "a year-end review"), ("Theseus found", "searches to win")],
    ('Busy season <span class="clay">runs your life.</span>',
     "The work is the easy part. Chasing clients, answering emails and booking meetings is what keeps you up late.",
     ("Workload", "30,52,74,94", ["Steady", "Busy", "Busy season"])),
    [(IC["box"], "Documents never arrive", "You email clients for receipts again and again, and wait.",
      B.viz_chat(["Reminder: W-2 still missing", "Reminder: bank statements", "Reminder: W-2 still missing", "Any update?"], "9 of 14 still missing")),
     (IC["chat"], "When will it be done?", "Clients email for status updates, and each one pulls you off real work.",
      B.viz_resp("Answer each one", "1 hr/day", "Irene drafts", "minutes", "Example time spent on status emails.")),
     (IC["cal"], "Meetings by email tag", "Booking a review takes five emails and two reschedules.",
      B.viz_week([("Wk 1", 25), ("Wk 2", 30), ("Wk 3", 45), ("Wk 4", 95), ("Close", 100)], "Example: workload across the month.")),
     (IC["user"], "No time to grow", "You'd take on more clients, but nobody has time to follow up on referrals.", B.VIZ_YOU)],
    ([("8:30", "Email clients for missing documents", "1 hr", "Reminders drafted for every client who owes one"),
      ("10:00", "Answer status emails", "1 hr", "Irene drafted answers from your notes"),
      ("11:30", "Book year-end reviews", "45 min", "Cleo sent invites with open times"),
      ("14:00", "Follow up on a referral", "skipped", "Midas replied and booked an intro call"),
      ("16:00", "Write the client newsletter", "never", "Cyrus has it ready for your OK"),
      ("17:00", "Prep for month-end", "late nights", "• Advisory work and new clients")],
     'A firm\'s day, <span class="clay">before and after.</span>'),
    [("irene", "Reminds clients about missing documents and answers status questions from your notes.", ["Gmail", "Outlook"]),
     ("cleo", "Books reviews and onboarding calls, and sends reminders.", ["Google Calendar", "Calendly"]),
     ("midas", "Replies to referrals and new leads, and follows up until there's a call.", ["Leads", "CRM"]),
     ("cyrus", "Sends tax deadline reminders and newsletters to your client list.", ["Deadlines", "Newsletters"]),
     ("theseus", "Finds what business owners in your area search for, like &ldquo;bookkeeper near me&rdquo;.", ["Google", "AI answers"]),
     ("alexander", "Plans your week around deadlines and tells you what slipped.", ["Weekly plan", "Alerts"])],
    ('9 documents missing. <span class="clay">Reminders ready by 9:01.</span>', "Irene checks who still owes what and drafts friendly reminders. You approve them all at once.",
     "document reminders", "Email", "Lee Family Bakery", "Year-end checklist: 9 of 14 documents still missing.", "Mon 9:00 AM",
     [("Irene checked the list", "9 documents still missing", "Mon"), ("Drafted a friendly reminder", "with the exact list", "Mon"), ("Sent after your OK", "6 documents arrived", "Thu"), ("Followed up on the rest", "after your OK", "Fri")],
     "Documents coming in", "14 of 14 by next week"),
    [("Does it work with QuickBooks or Xero?", "Your team works through email, calendar and your CRM. They don't post entries to your books, so your ledgers stay in your hands."),
     ("Is client financial data safe?", "Your workspace is private to your firm, and other customers can never see your data. You choose which accounts to connect."),
     ("Will it annoy my clients?", "No. Reminders are friendly and spaced out, and you approve each one before it goes."),
     ("Can it answer tax questions?", "No. Irene answers routine status questions and hands anything technical to your team.")],
    "Tell your AI team which clients still owe documents. See the reminders Irene writes.",
    "accounting firms")

ind("fitness", "Fitness studios &amp; gyms", "Fitness studios and gyms",
    "AI Employees for Gyms & Fitness Studios | Morning Telos",
    "An AI team for gyms and fitness studios. Reply to every inquiry, follow up with trial members, win back members who stopped coming and fill your classes.",
    ("More members.", "Less front desk."),
    "An AI team for gyms and fitness studios. They reply to new inquiries, follow up with trial members, win back members who stopped coming and keep your social feed full, so your coaches can focus on coaching.",
    "in_fit.webp", "Marble statue of a young Greek athlete holding a bronze discus",
    [("Midas replied", "to a trial inquiry"), ("Cyrus drafted", "a we-miss-you email"), ("Leo posted", "Saturday's class"), ("Cleo booked", "an intro session")],
    ('Members slip away <span class="clay">without a word.</span>',
     "New leads ask once and never hear back. Members stop coming, and nobody notices until they cancel.",
     ("Churn risk", "25,50,74,92", ["Loyal", "Drifting", "Leaving"])),
    [(IC["chat"], "Inquiries answered too late", "People ask about prices at night and join the gym that replies first.",
      B.viz_resp("Reply next day", "14 hrs", "Midas drafts", "minutes", "Example time to answer a new inquiry.")),
     (IC["user"], "Trials that never convert", "Trial visitors get no follow-up after their first class.",
      B.viz_week([("Day 1", 100), ("Day 3", 45), ("Day 7", 20), ("Day 14", 10), ("Day 30", 5)], "Example: trial visitors still being followed up.")),
     (IC["clock"], "Members drift off", "Attendance drops for weeks before anyone reaches out.",
      B.viz_chat(["Last visit: 18 days ago", "Last visit: 24 days ago", "Last visit: 31 days ago", "Cancelled membership"], "no one reached out")),
     (IC["star"], "The feed goes silent", "You know you should post, but classes come first.", B.VIZ_YOU)],
    ([("6:00", "Answer last night's emails", "40 min", "Midas's replies are ready for your OK"),
      ("9:00", "Follow up with trial visitors", "45 min", "Day 2 follow-ups drafted"),
      ("12:00", "Book intro sessions", "constant", "Cleo offers times and sends invites"),
      ("15:00", "Reach out to members who stopped coming", "never", "Cyrus has the win-back email ready"),
      ("17:00", "Post on Instagram", "skipped", "Leo's posts are scheduled"),
      ("20:00", "Still on email", "late", "• Time to coach and train")],
     'A studio day, <span class="clay">before and after.</span>'),
    [("midas", "Replies to every inquiry and follows up with trial visitors until they join.", ["Email", "Web forms"]),
     ("cleo", "Books intro sessions and tours, and sends reminders.", ["Google Calendar", "Calendly"]),
     ("cyrus", "Welcomes new members and wins back the ones who stopped coming.", ["Welcome", "Win-back"]),
     ("leo", "Posts classes, member wins and coach tips every week.", ["Instagram", "TikTok"]),
     ("irene", "Answers questions about prices, schedules and freezes from your policies.", ["Gmail", "Outlook"]),
     ("theseus", "Finds what people search for, like &ldquo;pilates near me&rdquo;.", ["Google", "AI answers"])],
    ('An inquiry at 10 PM. <span class="clay">A reply by 10:02.</span>', "Midas reads the inquiry, Cleo finds an intro slot, and the reply waits for your OK.",
     "new inquiry", "Web form", "Chris M.", "How much is a membership? Do you have a free trial class?", "10:00 PM",
     [("Midas read the inquiry", "price and trial question", "0:15"), ("Cleo checked the schedule", "Sat 9 AM class has room", "0:40"), ("Midas drafted a reply", "prices + Sat 9 AM trial", "1:20"), ("Sent after your OK", "lead saved for follow-up", "6:05 AM")],
     "Reply sent", "Sat 9 AM trial offered"),
    [("Does it work with Mindbody or Glofox?", "Your team works through email, calendar and your CRM. When your gym software sends leads by email, Midas picks them up there."),
     ("Can it reply to Instagram DMs?", "Not yet. Leo plans and posts your content, and Midas replies to leads that come in by email or web form."),
     ("Will it share prices?", "Only the prices you give the team. It never makes up a deal or a discount."),
     ("Can it help with retention?", "Yes. Cyrus writes win-back emails for members who stopped coming, and you approve them first.")],
    "Tell your AI team about your studio. See how Midas answers your next inquiry.",
    "gyms and fitness studios")

ind("logistics", "Logistics &amp; distribution", "Logistics, freight and distribution companies",
    "AI Employees for Logistics & Distribution Companies | Morning Telos",
    "An AI team for logistics, freight and distribution companies. Reply to quote requests fast, answer shipment emails, follow up with prospects and win more lanes.",
    ("Freight moves.", "So should your inbox."),
    "An AI team for logistics, freight and distribution companies. They reply to quote requests, answer routine shipment emails, follow up with prospects and keep your pipeline moving.",
    "in_logi.webp", "Marble statue of a young Greek man carrying a wooden crate",
    [("Midas replied", "to a quote request"), ("Irene answered", "a delivery question"), ("Quote follow-up", "day 3, needs you"), ("Alexander flagged", "3 cold prospects")],
    ('Your inbox <span class="clay">never sleeps.</span>',
     "Quote requests, status questions and follow-ups pile up across time zones.",
     ("Inbox pressure", "28,52,74,93", ["Calm", "Busy", "Drowning"])),
    [(IC["money"], "Slow quotes lose loads", "Shippers send the same request to five brokers. The fastest reply wins.",
      B.viz_resp("Reply later", "5 hrs", "Midas drafts", "minutes", "Example time before a shipper hears back.")),
     (IC["chat"], "Where's my shipment?", "The same status questions, from every customer, all day.",
      B.viz_chat(["Where's my load?", "ETA on PO 4471?", "Where's my load?", "Did it deliver?"], "×60 this week")),
     (IC["user"], "Prospects go cold", "You meet a shipper, send one email, then lose track.",
      B.viz_week([("Wk 1", 100), ("Wk 2", 50), ("Wk 3", 25), ("Wk 4", 10), ("Wk 5", 5)], "Example: prospects still being followed up.")),
     (IC["chart"], "No clear picture", "Your pipeline lives in emails and spreadsheets.", B.VIZ_TOOLS)],
    ([("7:00", "Answer overnight emails", "1 hr", "Irene and Midas drafted replies"),
      ("9:00", "Reply to quote requests", "constant", "Replies waiting for your OK"),
      ("11:00", "Answer status questions", "1.5 hrs", "Irene answered from your notes"),
      ("14:00", "Follow up with prospects", "skipped", "Midas's follow-ups are drafted"),
      ("16:00", "Update the CRM", "never", "Every lead logged with a next step"),
      ("18:00", "Still in the inbox", "late", "• Time for customers and carriers")],
     'A brokerage day, <span class="clay">before and after.</span>'),
    [("midas", "Replies to quote requests, follows up with prospects and keeps your CRM current.", ["Gmail", "HubSpot", "Salesforce"]),
     ("irene", "Answers routine shipment questions from your notes and hands problems to you.", ["Email", "Help desk"]),
     ("cleo", "Books calls with shippers and carriers across time zones.", ["Google Calendar", "Calendly"]),
     ("alexander", "Tells you which accounts need attention and plans your week.", ["Pipeline", "Weekly plan"]),
     ("cyrus", "Sends updates and check-ins to past and current shippers.", ["Newsletters", "Check-ins"]),
     ("theseus", "Finds what shippers search for and plans content to get you found.", ["Google", "AI answers"])],
    ('A quote request at 6 AM. <span class="clay">A reply by 6:02.</span>', "Midas reads the request, pulls your notes on the lane and drafts a reply for your OK.",
     "quote request", "Email", "Atlas Foods", "Need a rate for 2 dry van loads, Dallas to Atlanta, pickup Thursday.", "6:00 AM",
     [("Midas read the request", "2 loads, Dallas to Atlanta", "0:20"), ("Checked your notes", "lane and past rates", "0:45"), ("Drafted a reply", "asks for details, offers a call", "1:30"), ("Sent after your OK", "lead saved with next step", "7:02 AM")],
     "Shipper answered", "before the competition"),
    [("Does it work with my TMS?", "Your team works through email, calendar and your CRM. When your TMS sends updates by email, they can work with them there."),
     ("Can it give rates?", "Midas only shares rates you give him. Every quote goes to you before it's sent."),
     ("Can it track shipments?", "No. Irene answers from your notes and what's in the email, and asks you for live tracking details."),
     ("Will it work across time zones?", "Yes. Cleo gives every time with its time zone, so nobody misses a call.")],
    "Forward your AI team a quote request. See how fast Midas replies.",
    "logistics companies")

ind("agencies", "Marketing agencies", "Marketing agencies",
    "AI Employees for Marketing Agencies | Morning Telos",
    "An AI team for marketing agencies. Reply to new leads, plan client content, write posts and emails, build pages and keep your own marketing going.",
    ("More clients.", "Same team."),
    "An AI team for marketing agencies. They reply to new leads, draft posts and emails, plan content from real searches and build pages, so your team spends its time on strategy and clients.",
    "in_mktg.webp", "Marble statue of a young Greek woman holding a brass megaphone",
    [("Midas replied", "to a new lead"), ("Leo drafted", "next week's posts"), ("Theseus found", "30 searches to win"), ("Archon built", "a landing page")],
    ('Your own marketing <span class="clay">comes last.</span>',
     "You're great at marketing for clients. Your own posts, emails and follow-ups wait until Friday night.",
     ("Team load", "28,52,74,94", ["Steady", "Stretched", "Burned out"])),
    [(IC["clock"], "Leads wait for the account team", "A great lead emails on Monday and hears back on Thursday.",
      B.viz_resp("Reply when free", "3 days", "Midas drafts", "minutes", "Example time before a lead hears back.")),
     (IC["doc"], "Drafts eat the week", "Captions, emails and blog drafts for every client, every week.",
      B.viz_week([("Mon", 60), ("Tue", 75), ("Wed", 80), ("Thu", 90), ("Fri", 95)], "Example: hours spent on first drafts.")),
     (IC["search"], "Content without data", "Topics come from guesses instead of real searches.",
      B.viz_data(["Google", "ChatGPT", "Competitors", "Trends"], "Content plan", G(IC["search"]))),
     (IC["star"], "Your own feed is quiet", "The cobbler's children have no shoes.", B.VIZ_YOU)],
    ([("9:00", "Reply to new leads", "45 min", "Midas's replies are ready for your OK"),
      ("10:30", "Write first drafts of posts", "3 hrs", "Leo's drafts are waiting for edits"),
      ("13:00", "Research blog topics", "1 hr", "Theseus has the keyword list"),
      ("15:00", "Build a landing page", "half a day", "Archon built a draft for review"),
      ("17:00", "Post for the agency", "skipped", "Leo scheduled your own posts too"),
      ("19:00", "Catch up on email", "late", "• Strategy and client time")],
     'An agency day, <span class="clay">before and after.</span>'),
    [("midas", "Replies to new leads, books discovery calls and follows up on proposals.", ["Gmail", "HubSpot", "Pipedrive"]),
     ("leo", "Plans and drafts posts in each brand's voice, ready for your team to polish.", ["Instagram", "LinkedIn", "TikTok"]),
     ("theseus", "Builds content plans from real searches and checks AI visibility.", ["Keywords", "AI answers"]),
     ("archon", "Builds landing pages on Framer, Webflow or WordPress.", ["Framer", "Webflow", "WordPress"]),
     ("cyrus", "Drafts newsletters and campaigns for your agency.", ["Campaigns", "Newsletters"]),
     ("alexander", "Plans the week and tells you what slipped across every account.", ["Weekly plan", "Reports"])],
    ('A lead at 4 PM. <span class="clay">A reply by 4:02.</span>', "Midas reads the lead, Cleo finds a discovery slot, and the reply waits for your OK.",
     "new lead", "Web form", "Bloom Bakery", "We need help with Instagram and our website. What do you charge?", "4:00 PM",
     [("Midas read the lead", "social + website, small bakery", "0:15"), ("Cleo checked the calendar", "Tue 11 AM is open", "0:40"), ("Midas drafted a reply", "next steps + Tue 11 AM", "1:20"), ("Sent after your OK", "added to your pipeline", "1:45")],
     "Reply sent", "Tue 11 AM offered · follow-up set"),
    [("Can I use it for my clients' work?", "Yes. Your team can draft posts, plans and pages for clients. Each workspace holds one business's brand and tools, so many agencies start with their own."),
     ("Will the drafts sound generic?", "No. Each teammate learns the brand voice from your notes and the drafts you approve, and you edit anything before it goes out."),
     ("Does it replace my team?", "No. It takes first drafts and follow-ups, so your people spend more time on strategy and clients."),
     ("Which site builders does Archon support?", "Framer, Webflow, WordPress, WordPress.com and Shopify.")],
    "Tell your AI team about your agency. See what they take off your plate in the first week.",
    "marketing agencies")

ind("saas", "SaaS &amp; startups", "SaaS companies and startups",
    "AI Employees for SaaS Companies & Startups | Morning Telos",
    "An AI team for SaaS companies and startups. Reply to leads, answer support, run email and social, rank on Google and in AI answers, and ship landing pages.",
    ("Run lean.", "Grow like a big team."),
    "An AI team for SaaS companies and startups. They reply to leads, answer support emails, run your newsletters and social, and get you found on Google and in AI answers, without new hires.",
    "in_saas.webp", "Marble statue of a young Greek man holding a glowing laptop",
    [("Midas replied", "to a demo request"), ("Irene answered", "a billing question"), ("Theseus says", "ChatGPT now names you"), ("Cyrus drafted", "the launch email")],
    ('Founders do <span class="clay">every job.</span>',
     "Sales, support, marketing and the product. Something always gets dropped.",
     ("Founder load", "30,52,74,94", ["Focused", "Stretched", "Burned out"])),
    [(IC["clock"], "Demo requests wait", "A hot lead asks for a demo, and you're deep in code until tonight.",
      B.viz_resp("Reply tonight", "8 hrs", "Midas drafts", "minutes", "Example time before a lead hears back.")),
     (IC["chat"], "Support pulls you off the product", "Every how-do-I email is a context switch.",
      B.viz_chat(["How do I reset my password?", "Can I change plans?", "Is there an API?", "How do I reset my password?"], "×35 this week")),
     (IC["search"], "AI answers name your rivals", "Buyers ask ChatGPT for tools like yours. It names someone else.",
      B.viz_data(["ChatGPT", "Perplexity", "Gemini", "Google"], "Your name", G(IC["search"]))),
     (IC["mail"], "Launches with no noise", "You ship a feature and nobody hears about it.", B.VIZ_YOU)],
    ([("8:00", "Reply to demo requests", "45 min", "Midas's replies are ready for your OK"),
      ("10:00", "Answer support emails", "1.5 hrs", "Irene drafted answers from your docs"),
      ("13:00", "Write the launch email", "skipped", "Cyrus has it ready with a test send"),
      ("15:00", "Post about the launch", "never", "Leo scheduled the posts"),
      ("17:00", "Write an SEO page", "someday", "Theseus planned it, Archon built it"),
      ("20:00", "Finally code", "late", "• Deep work on the product")],
     'A founder\'s day, <span class="clay">before and after.</span>'),
    [("midas", "Replies to demo requests and trial signups, and follows up until there's a call.", ["Gmail", "HubSpot", "Calendly"]),
     ("irene", "Answers support emails from your docs and hands bugs and refunds to you.", ["Zendesk", "Help Scout", "Gmail"]),
     ("theseus", "Tracks how AI tools talk about you and plans content to win those answers.", ["ChatGPT", "Google"]),
     ("cyrus", "Writes launch emails, onboarding emails and newsletters.", ["Launches", "Onboarding"]),
     ("leo", "Shares launches and wins on social, in your voice.", ["LinkedIn", "X"]),
     ("archon", "Builds landing pages and comparison pages on your site.", ["Framer", "Webflow"])],
    ('A demo request at 3 PM. <span class="clay">A reply by 3:02.</span>', "Midas reads the request, Cleo finds a demo slot, and the reply waits for your OK.",
     "demo request", "Web form", "Sam at Northwind", "We're a team of 40 looking for a better way to track projects. Can we see a demo?", "3:00 PM",
     [("Midas read the request", "40-person team, project tracking", "0:15"), ("Cleo checked the calendar", "Thu 1 PM is open", "0:40"), ("Midas drafted a reply", "questions + Thu 1 PM", "1:20"), ("Sent after your OK", "added to HubSpot", "1:45")],
     "Reply sent", "Thu 1 PM offered · follow-up set"),
    [("What is AI visibility?", "How often tools like ChatGPT name your product when buyers ask for a recommendation. Theseus checks it and plans content to show up more."),
     ("Can Irene handle technical support?", "She answers from your docs and notes. Bugs and anything technical go to you with a summary."),
     ("Does it work with our CRM?", "Yes. Your team works with HubSpot, Pipedrive and Salesforce."),
     ("Is it worth it for a small team?", "That's who it's built for. One workspace gives you sales, support and marketing help without new hires.")],
    "Forward your AI team a demo request. See how fast Midas replies.",
    "SaaS teams")

ind("insurance", "Insurance agencies", "Insurance agencies and brokers",
    "AI Employees for Insurance Agencies & Brokers | Morning Telos",
    "An AI team for insurance agencies and brokers. Reply to quote requests, follow up on every quote, remind clients about renewals and get more referrals.",
    ("Quotes out fast.", "Renewals on time."),
    "An AI team for insurance agencies and brokers. They reply to quote requests, follow up on every quote, remind clients about renewals and keep referrals coming, with your OK on every message.",
    "in_ins.webp", "Marble statue of a young Greek man holding a bronze shield",
    [("Midas replied", "to a quote request"), ("Quote follow-up", "day 7, needs you"), ("Cyrus drafted", "30-day renewal reminders"), ("Cleo booked", "a policy review")],
    ('Quotes go out. <span class="clay">Follow-ups don\'t.</span>',
     "Most policies are won on the second or third touch. Most agencies stop after the first.",
     ("Quotes at risk", "26,50,74,92", ["Bound", "Waiting", "Lost"])),
    [(IC["clock"], "Quote requests wait", "Shoppers ask three agencies. The first to reply usually wins.",
      B.viz_resp("Reply tomorrow", "20 hrs", "Midas drafts", "minutes", "Example time before a shopper hears back.")),
     (IC["money"], "Quotes left hanging", "You send a quote, then never follow up.",
      B.viz_chat(["Quote sent: auto + home", "No reply", "Still no reply", "Bought from another agent"], "0 follow-ups sent")),
     (IC["clock"], "Renewals sneak up", "Clients shop around because nobody reached out before renewal.",
      B.viz_week([("90 days", 10), ("60 days", 20), ("30 days", 40), ("7 days", 80), ("Renewal", 100)], "Example: clients contacted before renewal.")),
     (IC["user"], "Referrals never get asked for", "Happy clients would send friends. Nobody asks.", B.VIZ_YOU)],
    ([("8:30", "Reply to quote requests", "1 hr", "Midas's replies are ready for your OK"),
      ("10:00", "Follow up on open quotes", "skipped", "Day 3 and day 7 follow-ups drafted"),
      ("12:00", "Answer policy questions", "1 hr", "Irene answered from your notes"),
      ("14:00", "Book policy reviews", "45 min", "Cleo sent invites with open times"),
      ("16:00", "Send renewal reminders", "forgotten", "Cyrus drafted 30-day reminders"),
      ("18:00", "Ask for referrals", "never", "• Time to grow the book")],
     'An agency day, <span class="clay">before and after.</span>'),
    [("midas", "Replies to quote requests and follows up on every quote until it's bound or closed.", ["Gmail", "Outlook", "CRM"]),
     ("cyrus", "Sends renewal reminders and asks happy clients for referrals.", ["Renewals", "Referrals"]),
     ("cleo", "Books policy reviews and sends reminders.", ["Google Calendar", "Calendly"]),
     ("irene", "Answers routine questions from your notes and hands claims and coverage questions to you.", ["Email", "Help desk"]),
     ("theseus", "Finds what people search for, like &ldquo;home insurance agent near me&rdquo;.", ["Google", "AI answers"]),
     ("alexander", "Tells you which quotes and renewals need you this week.", ["Pipeline", "Weekly plan"])],
    ('A quote request at 7 PM. <span class="clay">A reply by 7:02.</span>', "Midas reads the request, asks the right questions and drafts a reply for your OK.",
     "quote request", "Web form", "Tom & Ana R.", "We just bought a house and want to bundle home and auto. Can you send a quote?", "7:00 PM",
     [("Midas read the request", "home + auto bundle, new house", "0:15"), ("Listed what's needed", "address, cars, drivers", "0:40"), ("Drafted a reply", "questions + call times", "1:20"), ("Sent after your OK", "lead saved with next step", "8:02 AM")],
     "Quote started", "details on the way"),
    [("Will it quote prices?", "No. Midas collects the details you need and drafts replies. Quotes and prices always come from you."),
     ("Can it answer coverage questions?", "No. Irene hands coverage and claims questions to you with a short summary."),
     ("Does it work with my agency software?", "Your team works through email, calendar and your CRM. When your agency software sends email, they can work with it there."),
     ("Is client data private?", "Your workspace is private to your agency, and other customers can never see your data.")],
    "Forward your AI team a quote request. See the reply Midas writes.",
    "insurance agencies")

ind("recruiting", "Recruiting &amp; staffing", "Recruiting and staffing firms",
    "AI Employees for Recruiting & Staffing Firms | Morning Telos",
    "An AI team for recruiting and staffing firms. Reply to clients and candidates, book interviews, follow up on every role and win new business.",
    ("Fill roles faster.", "Answer everyone."),
    "An AI team for recruiting and staffing firms. They reply to client and candidate emails, book interviews, follow up on every open role and help you win new accounts.",
    "in_rec.webp", "Marble statue of a young Greek woman holding a brass magnifying glass",
    [("Cleo booked", "3 interviews"), ("Midas replied", "to a new client"), ("Irene answered", "a candidate question"), ("Leo posted", "2 open roles")],
    ('Great candidates <span class="clay">don\'t wait.</span>',
     "The best people are off the market in days. Slow scheduling and slow replies lose them.",
     ("Pipeline risk", "26,50,74,92", ["Moving", "Stalled", "Lost"])),
    [(IC["cal"], "Interview scheduling chaos", "Candidates, hiring managers and time zones. Every interview takes five emails.",
      B.viz_chat(["Does Tuesday work?", "Manager is out Tuesday", "How about Thursday 2 PM?", "Can we do 4 PM ET?"], "6 emails for 1 interview")),
     (IC["chat"], "Candidates hear nothing", "Applicants email for updates and never get one.",
      B.viz_resp("Reply when free", "4 days", "Irene drafts", "minutes", "Example time before a candidate hears back.")),
     (IC["user"], "New clients slip away", "A hiring manager reaches out, and you're too busy to follow up.",
      B.viz_week([("Wk 1", 100), ("Wk 2", 55), ("Wk 3", 30), ("Wk 4", 15), ("Wk 5", 5)], "Example: prospects still being followed up.")),
     (IC["star"], "Roles need promoting", "Every new job needs posts and emails to reach the right people.", B.VIZ_YOU)],
    ([("8:30", "Schedule interviews", "1.5 hrs", "Cleo booked them across time zones"),
      ("10:30", "Answer candidate emails", "1 hr", "Irene drafted kind, clear replies"),
      ("12:00", "Follow up with a new client", "skipped", "Midas replied and booked a call"),
      ("14:00", "Post open roles", "rushed", "Leo scheduled the posts"),
      ("16:00", "Update the CRM", "never", "Every lead logged with a next step"),
      ("18:00", "Catch up on email", "late", "• Time for candidates and clients")],
     'A recruiter\'s day, <span class="clay">before and after.</span>'),
    [("cleo", "Books interviews across calendars and time zones, and sends reminders.", ["Google Calendar", "Calendly"]),
     ("irene", "Answers candidate questions kindly and hands offers and sensitive topics to you.", ["Gmail", "Outlook"]),
     ("midas", "Replies to new client inquiries and follows up until there's a call.", ["CRM", "Gmail"]),
     ("leo", "Posts open roles and placement wins on social.", ["LinkedIn", "Facebook"]),
     ("cyrus", "Sends job alerts and updates to your candidate and client lists.", ["Job alerts", "Newsletters"]),
     ("alexander", "Tells you which roles are stuck and plans your week.", ["Pipeline", "Weekly plan"])],
    ('A candidate says yes. <span class="clay">Invite ready by 2:02.</span>', "Cleo checks the hiring manager's calendar, offers times and drafts the invite for your OK.",
     "interview scheduling", "Email", "Jordan T.", "Thanks for reaching out! I'd love to interview for the operations manager role.", "2:00 PM",
     [("Cleo read the reply", "candidate is interested", "0:10"), ("Checked both calendars", "Thu 2 PM ET works", "0:35"), ("Drafted the invite", "with time zone and details", "1:10"), ("Sent after your OK", "reminders set for both", "1:50")],
     "Invite sent", "Thu 2 PM ET · reminders set"),
    [("Does it work with my ATS?", "Your team works through email, calendar and your CRM. When your ATS sends email or syncs to your calendar, they work alongside it."),
     ("Can it screen candidates?", "No. Hiring decisions stay with you. Your team handles scheduling, replies and follow-ups."),
     ("Can it handle time zones?", "Yes. Cleo always gives the time zone with every time she offers."),
     ("Will candidates get generic replies?", "No. Irene writes in your voice, and you approve every reply until you trust her.")],
    "Tell your AI team which interviews you need booked this week. See how fast Cleo moves.",
    "recruiting firms")

# Lines in the shared parts that still speak for the old agency.
SWAP = [('<div class="free">Free · 30 min</div>', '<div class="free">Free for 14 days</div>'),
        ("<b>For founders, operators and decision makers.</b>", "<b>Built for owners who wear every hat.</b>"),
        ('aria-label="Tools we build with"', 'aria-label="Tools your team works with"'),
        ("Built on the tools you already run", "Works inside the tools you already use")]

if __name__ == "__main__":
    for p in PAGES:
        B.build(p)
        out = B.ROOT / p["section"] / p["slug"] / "index.html"
        html = out.read_text()
        for a, b in SWAP:
            html = html.replace(a, b)
        out.write_text(html)
