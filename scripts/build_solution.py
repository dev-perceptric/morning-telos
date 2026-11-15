#!/usr/bin/env python3
"""Builds industry solution pages at site/solutions/<slug>/ using the shared
service-page builder. Usage: python3 scripts/build_solution.py"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import build_service as B  # noqa: E402

CHECK = B.CHECK


def ba(rows, head, lead):
    before = "".join(f'<li style="--i:{k}"><time>{t}</time><span>{a}</span><em class="m">{h}</em></li>' for k, (t, a, h, _) in enumerate(rows))
    after = "".join((f'<li class="free" style="--i:{k}"><time>{t}</time><span>{b[1:].strip()}</span><em class="f">your time</em></li>' if b.startswith("•")
                     else f'<li style="--i:{k}"><time>{t}</time><span>{b}</span><em class="a">automated</em></li>') for k, (t, _, _, b) in enumerate(rows))
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


def related(slugs):
    names = {"ai-automation": ("AI &amp; automation", "Workflows that run on their own"), "ai-agents": ("AI agents", "Agents that do real jobs"),
             "ai-lead-generation": ("AI lead generation", "A pipeline that fills itself"), "crm-sales-automation": ("CRM &amp; sales automation", "Follow-up that never forgets"),
             "custom-software": ("Custom software", "Tools built around how you run"), "partnership": ("Ongoing partnership", "Systems that keep improving")}
    cards = "".join(f'<a class="icard rv" style="--d:{k*0.06:.2f}s" href="/services/{s}/"><b>{names[s][0]}</b><small>{names[s][1]}</small><span>→</span></a>' for k, s in enumerate(slugs))
    return f'  <section class="istrip wrap">\n    <h2 class="big rv">The services <span class="clay">behind it.</span></h2>\n    <div class="igrid">{cards}</div>\n  </section>\n\n'


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
  .ba { border-radius: 18px; border: 1px solid var(--line); box-shadow: 0 40px 80px -50px rgba(20,20,19,.5); padding: 22px 26px 26px; background: var(--ivory-3); transition: background .6s; }
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
  .ba em.m { background: rgba(20,20,19,.07); color: var(--ink-3); }
  .ba em.a { background: rgba(95,163,106,.14); color: #3f7d4a; }
  .ba em.f { background: var(--clay); color: #fff; }
  .flow-body { display: grid; grid-template-columns: 1fr 1.4fr 1fr; gap: 0; min-height: 380px; }
  .flow-msg { padding: 24px; border-right: 1px solid var(--line); background: var(--ivory); }
  .flow-msg small, .flow-steps::before { display: block; font-family: var(--mono); font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-4); margin-bottom: 12px; }
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
  .flow-out b { font-family: var(--serif); font-weight: 400; font-size: 30px; line-height: 1.1; } .flow-out small { font-size: 14px; color: var(--ink-3); }
  @media (max-width: 1000px) { .ba-sec .head { grid-template-columns: 1fr; gap: 18px; } .flow-body { grid-template-columns: 1fr; } .flow-msg, .flow-steps { border-right: 0; border-bottom: 1px solid var(--line); } }
  @media (max-width: 640px) { .ba { padding: 16px 12px 18px; } .ba-l li { grid-template-columns: 50px 1fr; font-size: 14px; padding: 10px 12px; } .ba em { display: none; } .ba-note { display: none; } .ba-sec { padding-bottom: 80px; } }
'''

# ---------------------------------------------------------------------------
PAGES = []


def page(**kw):
    kw.setdefault("section", "solutions")
    kw.setdefault("crumb", '<a href="/#solutions">Solutions</a>')
    kw.setdefault("css", SOL_CSS)
    kw.setdefault("outc_head", 'What we <span class="clay">build toward.</span>')
    kw.setdefault("outc_note", "Targets we set with each client during the Telos Audit. Results depend on your business.")
    PAGES.append(kw)


page(
    slug="clinics", name="Dental &amp; medical clinics", service_type="AI automation for dental and medical practices", audience="Dental and medical clinics",
    title="AI Automation for Dental & Medical Practices | Morning Telos",
    desc="AI automation for dental practices and medical clinics. Answer every call, book appointments around the clock, cut no-shows and free your front desk.",
    h1=("A front desk that never", "misses a call."), h1_label="AI automation for dental and medical practices",
    lead="AI automation for dental practices and medical clinics. We answer calls and messages around the clock, book appointments, send reminders and handle the paperwork, so your team can focus on patients.",
    second_cta=("See a booking", "demo"), proof="Free 30-minute call. We find where your front desk loses time.",
    img="in_clinic.webp", img_alt="Marble statue of a young Greek man wearing a brass stethoscope",
    chips=[("Call answered", "after hours"), ("Appointment booked", "Tue 9:30 AM"), ("Reminder sent", "no-show avoided"), ("Recall due", "patients contacted")],
    stall_head='Where the front desk <span class="clay">loses the day.</span>',
    stall_lead="Phones ring while staff check patients in. Every missed call is a patient who books somewhere else.",
    meter=("Front desk load", "25,50,74,92", ["Calm", "Busy", "Overrun"]),
    problems=[
        (IC["phone"], "Missed calls go to competitors", "Calls during lunch, after hours and busy mornings never get answered.",
         B.viz_resp("Missed calls", "1 in 4", "AI receptionist", "0 missed", "Example: share of calls missed on a busy day.")),
        (IC["cal"], "No-shows leave empty chairs", "A missed appointment is lost revenue you can't get back.",
         B.viz_week([("Mon", 30), ("Tue", 55), ("Wed", 20), ("Thu", 70), ("Fri", 45)], "Example: empty chairs from no-shows each day.")),
        (IC["doc"], "Forms and insurance by hand", "Intake forms, insurance checks and records typed in one field at a time.",
         B.viz_data(["Forms", "Insurance", "Email", "Fax"], "Patient file", G(IC["doc"]))),
        (IC["chat"], "The same questions all day", "Hours, prices, insurance and directions, answered over and over.",
         B.viz_chat(["Do you take Delta Dental?", "What time do you open?", "Do you take Delta Dental?", "Can I move my cleaning?"], "×46 today")),
    ],
    after_stall=ba([("8:00", "Return voicemails from last night", "45 min", "Voicemails already answered and booked"),
                    ("9:30", "Phones ringing during check-in", "constant", "AI answers, staff greet patients"),
                    ("11:00", "Call patients to confirm tomorrow", "1 hr", "Confirmations sent by text"),
                    ("13:00", "Lunch calls go to voicemail", "missed", "Lunch calls answered and booked"),
                    ("15:00", "Type intake forms into the system", "1 hr", "Forms filled in before the visit"),
                    ("17:00", "Chase overdue recalls", "45 min", "• Time for patients and the team")],
                   'A front desk day, <span class="clay">before and after.</span>', "Switch to After to see the same day with AI handling the calls, reminders and forms."),
    cards_head='What we automate for <span class="clay">clinics.</span>', cards_lead="Built around your practice software and phone system, so patients get answers fast.",
    cards=[("AI receptionist", "Answers calls and texts 24/7, books, reschedules and answers common questions.", ["Phone", "SMS", "Web chat"], IC["phone"]),
           ("Online booking", "Patients book real open slots from your website, Google and text.", ["Google", "Website", "SMS"], IC["cal"]),
           ("Reminders & no-show recovery", "Smart reminders, confirmations and quick rebooking of cancelled slots.", ["SMS", "Email", "Waitlist"], IC["clock"]),
           ("Digital intake", "Forms and insurance details collected before the visit and saved to the patient file.", ["Forms", "Insurance", "E-sign"], IC["doc"]),
           ("Recall & reactivation", "Patients due for cleanings or checkups contacted until they book.", ["Recalls", "Campaigns"], IC["mail"]),
           ("Reviews", "Happy patients asked for a Google review right after their visit.", ["Google", "Follow-up"], IC["star"])],
    signature=flow('A patient texts at 9 PM. <span class="clay">Booked by 9:01.</span>', "An example of an AI receptionist. The message comes in after hours, the agent checks the schedule, books the slot and sends a reminder.",
                   "after-hours booking", "SMS", "Maria L.", "Hi, my tooth has been hurting since yesterday. Can I come in this week?", "9:02 PM",
                   [("Read the message", "flagged as urgent", "0:03"), ("Checked open slots", "Wed 8:30 AM is free", "0:09"), ("Booked and confirmed", "patient replied yes", "0:41"), ("Added to the schedule", "reminder set for Tue", "0:44")],
                   "Appointment booked", "Wed 8:30 AM · reminder scheduled", "Sample conversation. Built on your scheduling system and your rules."),
    outcomes=[(0, "missed", "calls, nights and weekends included"), (24, "/7", "online and phone booking"), (30, "% fewer", "no-shows with smart reminders"), (10, "+ hrs", "back each week for the front desk")],
    how_head='From first call to <span class="clay">a calmer front desk.</span>',
    how_steps=["Tell us where your front desk loses the most time.", "Map your calls, scheduling and forms. Pick the first fix.", "Connect AI to your phone line and practice software, then test with your team.", "Track booked appointments and no-shows, and keep improving."],
    before_faq=related(["ai-agents", "ai-automation", "crm-sales-automation"]),
    faq_title="Clinic automation questions",
    faqs=[("Does it work with our practice software?", "We connect to common systems like Dentrix, Open Dental, Eaglesoft and many medical EHRs, or work through your booking tool when there's no direct connection."),
          ("Is patient data kept private?", "We build on HIPAA-eligible tools, sign business associate agreements with vendors that offer them, and limit access to what each system needs."),
          ("Will patients know they're talking to AI?", "Yes, it introduces itself as the practice's assistant, and hands off to your staff whenever a patient asks or the case needs a person."),
          ("Can it handle emergencies?", "Urgent messages are flagged and routed to your team right away, with rules you set."),
          ("Can it book into our real schedule?", "Yes. It only offers real open slots and follows your rules for appointment types and lengths."),
          ("How long does setup take?", "Most clinics go live in two to three weeks, starting with after-hours calls and reminders.")],
    final_line="Tell us how many calls your front desk misses. We'll show you how to catch every one.",
)

page(
    slug="home-services", name="Home services", service_type="AI automation for home service businesses", audience="HVAC, plumbing, roofing and home service companies",
    title="AI Automation for HVAC, Plumbing & Home Service Companies | Morning Telos",
    desc="AI automation for HVAC, plumbing, roofing and home service companies. Call back every lead in a minute, send quotes fast and fill your schedule.",
    h1=("Every lead called back", "in a minute."), h1_label="AI automation for HVAC, plumbing and home service companies",
    lead="AI automation for HVAC, plumbing, roofing and home service companies. We answer every call and form, send quotes fast, book jobs and follow up, so your crews stay busy and nothing falls through.",
    second_cta=("See a job booked", "demo"), proof="Free 30-minute call. We find the jobs you're missing.",
    img="in_home.webp", img_alt="Marble statue of a young Greek man resting a brass wrench on his shoulder",
    chips=[("Missed call", "texted back in 30 sec"), ("Quote sent", "same day"), ("Job booked", "Thu 2 PM"), ("Review asked", "after the job")],
    stall_head='Jobs slip away <span class="clay">while you\'re on a roof.</span>',
    stall_lead="The first company to call back usually wins the job. When you're out in the field, that's hard to do.",
    meter=("Jobs at risk", "26,50,74,92", ["Booked", "Leaky", "Losing"]),
    problems=[
        (IC["phone"], "Calls missed in the field", "You can't answer while you're under a sink or up a ladder.",
         B.viz_resp("Call back later", "3h 40m", "Instant text back", "30 sec", "Example time before a lead hears back.")),
        (IC["money"], "Quotes take days", "Estimates wait until evening, and the customer hires someone faster.",
         B.viz_week([("Mon", 40), ("Tue", 65), ("Wed", 50), ("Thu", 80), ("Fri", 90)], "Example: quotes still waiting at the end of each day.")),
        (IC["cal"], "Scheduling by phone tag", "Back-and-forth calls just to find a time that works.",
         B.viz_chat(["Can you come Thursday?", "What about the morning?", "Does 2 PM work?", "Sorry, missed your call"], "6 calls to book 1 job")),
        (IC["star"], "No follow-up after the job", "Reviews, maintenance plans and repeat work never get asked for.",
         B.viz_data(["Jobs done", "Invoices", "Reviews", "Plans"], "Repeat work", G(IC["star"]))),
    ],
    after_stall=ba([("7:30", "Listen to voicemails from last night", "40 min", "Every voicemail texted back and booked"),
                    ("10:00", "Miss calls while on a job", "4 missed", "AI answers and books the next opening"),
                    ("12:30", "Call customers to confirm visits", "45 min", "Confirmations and on-my-way texts sent"),
                    ("15:00", "Phone tag to schedule a quote", "6 calls", "Customer picks a time online"),
                    ("19:00", "Write quotes at the kitchen table", "1.5 hrs", "Quotes drafted from the site photos"),
                    ("20:30", "Forget to ask for reviews", "missed", "• Evening off with your family")],
                   'A field day, <span class="clay">before and after.</span>', "Switch to After to see the same day with AI answering, scheduling and following up."),
    cards_head='What we automate for <span class="clay">home services.</span>', cards_lead="Connected to your field service software, so the office runs while you're on the job.",
    cards=[("Missed-call text back", "Every missed call gets a text in seconds and a way to book.", ["SMS", "Phone"], IC["phone"]),
           ("AI answering & booking", "Answers calls and web forms, qualifies the job and books a slot.", ["Calls", "Forms", "Chat"], IC["cal"]),
           ("Fast quotes", "Quotes drafted from job details and photos, ready for you to approve.", ["Estimates", "Photos"], IC["money"]),
           ("Dispatch updates", "Confirmations, on-my-way texts and job notes sent automatically.", ["SMS", "Crew app"], IC["flow"]),
           ("Reviews & referrals", "Happy customers asked for a Google review right after the job.", ["Google", "Referrals"], IC["star"]),
           ("Maintenance plans", "Customers reminded about tune-ups and renewals before the season starts.", ["Renewals", "Campaigns"], IC["clock"])],
    signature=flow('A missed call at noon. <span class="clay">A booked job by 12:02.</span>', "An example of a missed-call system. The call goes unanswered, the customer gets a text, and the job lands on your schedule.",
                   "missed-call text back", "Missed call", "James R.", "Missed call from (512) 555-0142 · AC not cooling", "12:00 PM",
                   [("Texted back in 30 sec", "“Sorry we missed you! What's going on?”", "0:30"), ("Asked about the job", "AC unit, not cooling, 3 years old", "1:05"), ("Offered times", "customer picked Thu 2 PM", "1:40"), ("Booked in your software", "crew and customer notified", "1:52")],
                   "Job booked", "Thu 2 PM · tech assigned", "Sample conversation. Built on your field service software and service area."),
    outcomes=[(60, "sec", "or less to reply to every lead"), (100, "%", "of missed calls texted back"), (1, "day", "or less to send a quote"), (2, "x", "more Google reviews")],
    how_head='From missed calls to <span class="clay">a full schedule.</span>',
    how_steps=["Tell us how leads come in and where they get lost.", "Map your calls, quotes and scheduling. Pick the first fix.", "Connect AI to your phone and field service software.", "Track booked jobs and reviews, and keep improving."],
    before_faq=related(["ai-agents", "crm-sales-automation", "ai-automation"]),
    faq_title="Home services questions",
    faqs=[("Does it work with ServiceTitan, Jobber or Housecall Pro?", "Yes. We connect to common field service tools, or work through your calendar if you don't use one."),
          ("Will customers know it's AI?", "It introduces itself as your office assistant and hands off to you whenever a customer asks."),
          ("Can it quote prices?", "It can share price ranges you approve and collect job details. Final quotes go to you for a quick review."),
          ("What about emergency calls?", "Emergencies are flagged and forwarded to your on-call tech right away."),
          ("Do we need new phone numbers?", "No. We work with your current number, and set up forwarding only for missed or after-hours calls."),
          ("How fast can we start?", "Missed-call text back can go live within days. Full booking takes two to three weeks.")],
    final_line="Tell us how many calls you miss in a week. We'll show you how to turn them into booked jobs.",
)

page(
    slug="real-estate", name="Real estate", service_type="AI automation for real estate agents and brokerages", audience="Real estate agents and brokerages",
    title="AI Automation for Real Estate Agents & Brokerages | Morning Telos",
    desc="AI automation for real estate agents and brokerages. Reply to every lead in seconds, book showings, nurture buyers and keep your CRM up to date.",
    h1=("Never let a buyer", "go cold."), h1_label="AI automation for real estate agents and brokerages",
    lead="AI automation for real estate agents and brokerages. We reply to every lead in seconds, book showings, nurture buyers and sellers for months, and keep your CRM clean, so you spend your time closing.",
    second_cta=("See a lead handled", "demo"), proof="Free 30-minute call. We review your lead flow.",
    img="in_estate.webp", img_alt="Marble statue of a young Greek man holding a small model house",
    chips=[("Zillow lead", "replied in 20 sec"), ("Showing booked", "Sat 11 AM"), ("Buyer nurtured", "day 45, still warm"), ("CRM updated", "no typing")],
    stall_head='Leads go cold <span class="clay">between showings.</span>',
    stall_lead="Most buyers talk to the first agent who answers. Most leads aren't ready for months, and nobody follows up that long.",
    meter=("Leads going cold", "25,50,74,92", ["Warm", "Cooling", "Cold"]),
    problems=[
        (IC["clock"], "Slow replies to new leads", "Portal leads cool off fast while you're at a showing.",
         B.viz_resp("Reply later", "5 hrs", "AI reply", "20 sec", "Example time to first reply on a portal lead.")),
        (IC["user"], "Long-term leads forgotten", "Buyers who aren't ready yet drift off after a few weeks of silence.",
         B.viz_week([("Wk 1", 100), ("Wk 2", 60), ("Wk 4", 30), ("Wk 8", 12), ("Wk 12", 5)], "Example: share of leads still getting follow-up over time.")),
        (IC["cal"], "Showing scheduling chaos", "Texts, calls and calendars juggled for every showing request.",
         B.viz_chat(["Can we see it Saturday?", "Is 11 or 2 better?", "Can my partner come too?", "Running 10 min late"], "8 texts per showing")),
        (IC["doc"], "Paperwork and CRM updates", "Notes, stages and documents typed in after hours.",
         B.viz_data(["Zillow", "Email", "Texts", "Docs"], "CRM", G(IC["user"]))),
    ],
    after_stall=ba([("8:00", "Reply to overnight portal leads", "1 hr", "Leads answered at 2 AM, showings offered"),
                    ("10:00", "Text back and forth to book showings", "45 min", "Buyers book from your open times"),
                    ("13:00", "Update the CRM after calls", "40 min", "Call notes saved automatically"),
                    ("15:00", "Write listing descriptions", "1 hr", "Drafts ready for your edit"),
                    ("17:00", "Remember who to follow up with", "guesswork", "Nurture runs for every lead"),
                    ("19:00", "Catch up on paperwork", "1 hr", "• Time for clients and closings")],
                   'An agent\'s day, <span class="clay">before and after.</span>', "Switch to After to see the same day with AI handling replies, scheduling and follow-up."),
    cards_head='What we automate for <span class="clay">real estate.</span>', cards_lead="Connected to your CRM and lead sources, so every lead gets a fast reply and a long follow-up.",
    cards=[("Instant lead response", "Every portal, website and ad lead answered in seconds and qualified.", ["Zillow", "Realtor.com", "Website"], IC["chat"]),
           ("Showing scheduling", "Buyers pick a time from your calendar, with reminders sent automatically.", ["Calendar", "SMS"], IC["cal"]),
           ("Long-term nurture", "Personal check-ins and new listings sent until the lead is ready.", ["SMS", "Email", "Listings"], IC["mail"]),
           ("CRM automation", "Notes, stages and tasks updated after every call and message.", ["Follow Up Boss", "kvCORE", "HubSpot"], IC["user"]),
           ("Listing content", "Descriptions, social posts and emails drafted from listing details.", ["MLS", "Social"], IC["doc"]),
           ("Transaction updates", "Deadlines tracked and clients updated at every step to closing.", ["Checklists", "Reminders"], IC["clock"])],
    signature=flow('A lead at 11 PM. <span class="clay">A showing by 11:02.</span>', "An example of instant lead response. A buyer asks about a listing late at night, gets an answer, and books a showing.",
                   "instant lead response", "Zillow", "Priya K.", "Is 214 Oak Street still available? We'd love to see it this weekend.", "11:00 PM",
                   [("Checked the listing", "still active, open Sat", "0:05"), ("Replied with details", "price, HOA, school district", "0:20"), ("Offered showing times", "buyer picked Sat 11 AM", "1:30"), ("Logged in your CRM", "tagged as hot buyer", "1:41")],
                   "Showing booked", "Sat 11 AM · you get a summary at 8 AM", "Sample conversation. Built on your CRM, listings and calendar."),
    outcomes=[(60, "sec", "or less to reply to every lead"), (12, "months", "of follow-up for every lead"), (0, "hrs", "spent typing CRM notes"), (10, "+ hrs", "back each week")],
    how_head='From lead flow to <span class="clay">booked showings.</span>',
    how_steps=["Tell us where your leads come from and where they go cold.", "Map your lead sources, CRM and calendar. Pick the first fix.", "Connect AI to your lead sources and CRM, then test it together.", "Track replies and showings, and keep improving."],
    before_faq=related(["crm-sales-automation", "ai-lead-generation", "ai-agents"]),
    faq_title="Real estate questions",
    faqs=[("Which CRMs do you work with?", "Follow Up Boss, kvCORE, Lofty, HubSpot and most CRMs with an API."),
          ("Will leads know they're talking to AI?", "It introduces itself as your assistant and hands the conversation to you the moment a lead is ready to talk."),
          ("Can it work for a whole brokerage?", "Yes. Leads can be routed to the right agent by area, price range or rotation."),
          ("Does it follow fair housing rules?", "We write the scripts with fair housing in mind and keep the AI to facts about the property and your process."),
          ("Can it write listing descriptions?", "Yes. It drafts descriptions and posts from listing details, and you approve them before they go out."),
          ("How long does setup take?", "Instant lead response can go live within a week. Full nurture and CRM automation take two to three weeks.")],
    final_line="Tell us how many leads you get a month. We'll show you how to keep every one of them warm.",
)

page(
    slug="law-firms", name="Law firms", service_type="AI automation for law firms", audience="Law firms",
    title="AI Automation for Law Firms: Intake, Documents & Client Updates | Morning Telos",
    desc="AI automation for law firms. Automate client intake, conflict checks, document drafting and case updates, so your lawyers spend more time on billable work.",
    h1=("Intake that runs", "itself."), h1_label="AI automation for law firm intake, documents and client updates",
    lead="AI automation for law firms. We automate intake, scheduling, document drafting and client updates, so potential clients get answers fast and your lawyers spend more time on billable work.",
    second_cta=("See an intake", "demo"), proof="Free 30-minute call. We map your intake process.",
    img="in_law.webp", img_alt="Marble statue of a young Greek woman holding golden scales",
    chips=[("Intake screened", "case type matched"), ("Conflict check", "cleared"), ("Consult booked", "Mon 10 AM"), ("Client updated", "case status sent")],
    stall_head='Billable hours lost <span class="clay">to admin.</span>',
    stall_lead="Lawyers spend a large share of the day on work they can't bill. Potential clients wait, and many hire the firm that called back first.",
    meter=("Admin load", "25,50,74,92", ["Light", "Heavy", "Drowning"]),
    problems=[
        (IC["phone"], "Slow intake loses cases", "Potential clients call several firms and sign with the first one that responds.",
         B.viz_resp("Callback", "next day", "AI intake", "2 min", "Example time to respond to a new inquiry.")),
        (IC["doc"], "Documents drafted from scratch", "Engagement letters and routine filings rebuilt by hand every time.",
         B.viz_week([("Mon", 50), ("Tue", 70), ("Wed", 45), ("Thu", 80), ("Fri", 60)], "Example: hours spent on routine drafting each day.")),
        (IC["chat"], "“Any update on my case?”", "Clients call and email for status that could be sent automatically.",
         B.viz_chat(["Any update on my case?", "Did you get my documents?", "When is my next hearing?", "Any update on my case?"], "×21 this week")),
        (IC["search"], "Screening by hand", "Staff spend hours on calls with people who aren't a fit.",
         B.viz_data(["Calls", "Web forms", "Email", "Referrals"], "Qualified", G(IC["shield"]))),
    ],
    after_stall=ba([("8:30", "Return calls from new inquiries", "1 hr", "Inquiries screened overnight, consults booked"),
                    ("10:00", "Run conflict checks by hand", "30 min", "Conflict checks run at intake"),
                    ("11:30", "Draft an engagement letter", "45 min", "Letter drafted from intake answers"),
                    ("14:00", "Answer “any update?” calls", "1 hr", "Status updates sent automatically"),
                    ("16:00", "Chase clients for documents", "40 min", "Reminders sent until docs arrive"),
                    ("17:30", "Enter time and notes", "45 min", "• Billable work and strategy")],
                   'A firm\'s day, <span class="clay">before and after.</span>', "Switch to After to see the same day with AI handling intake, drafting and updates."),
    cards_head='What we automate for <span class="clay">law firms.</span>', cards_lead="Connected to your practice management software, with confidentiality built in.",
    cards=[("AI client intake", "Inquiries answered 24/7, screened by case type and booked for a consult.", ["Calls", "Web", "Chat"], IC["user"]),
           ("Conflict checks", "Names checked against your records at intake, flagged for review.", ["Clio", "MyCase"], IC["shield"]),
           ("Document drafting", "Engagement letters and routine documents drafted from your templates.", ["Templates", "E-sign"], IC["doc"]),
           ("Client updates", "Case milestones and next steps sent to clients automatically.", ["Email", "SMS", "Portal"], IC["mail"]),
           ("Document collection", "Clients reminded until every requested document is uploaded.", ["Uploads", "Reminders"], IC["box"]),
           ("Research assistants", "AI that summarizes files and finds key facts for your team to verify.", ["Summaries", "Search"], IC["search"])],
    signature=flow('An inquiry at 8 PM. <span class="clay">A consult by 8:03.</span>', "An example of AI intake. A potential client reaches out after hours, gets screened, and books a consult.",
                   "after-hours intake", "Web chat", "Daniel M.", "I was in a car accident last week and the insurance company won't pay. Can you help?", "8:00 PM",
                   [("Asked intake questions", "date, injuries, insurance", "1:10"), ("Matched the case type", "personal injury, in your area", "1:25"), ("Ran a conflict check", "no conflicts found", "1:40"), ("Booked a consultation", "Mon 10 AM with an attorney", "2:55")],
                   "Consult booked", "Mon 10 AM · intake summary attached", "Sample conversation. Built on your intake questions and practice areas."),
    outcomes=[(5, "min", "or less to respond to every inquiry"), (100, "%", "of inquiries screened the same way"), (0, "“any update?”", "calls needed for routine status"), (10, "+ hrs", "back each week per lawyer")],
    how_head='From inquiry to <span class="clay">signed client.</span>',
    how_steps=["Tell us how new cases come in and where time is lost.", "Map intake, documents and client updates. Pick the first fix.", "Connect AI to your practice software, with access limited to what's needed.", "Track signed cases and saved hours, and keep improving."],
    before_faq=related(["ai-agents", "ai-automation", "custom-software"]),
    faq_title="Law firm questions",
    faqs=[("Does it work with Clio or MyCase?", "Yes. We connect to common practice management tools, including Clio, MyCase, PracticePanther and Smokeball."),
          ("Is client information kept confidential?", "Systems run in your accounts, with access limited to what each tool needs, and we choose AI providers that don't train on your data."),
          ("Will the AI give legal advice?", "No. It collects information, answers questions about your firm and books consults. Legal advice stays with your attorneys."),
          ("Can it draft documents?", "It drafts routine documents from your templates, and an attorney reviews every draft before it's sent."),
          ("Can it screen out cases we don't take?", "Yes. It follows your criteria, refers out politely, and books only the cases you want."),
          ("How long does setup take?", "AI intake usually goes live in two to three weeks. Document automation follows after.")],
    final_line="Tell us how new cases reach your firm. We'll show you how to sign more of them with less admin.",
)

page(
    slug="ecommerce", name="E-commerce", service_type="AI automation for e-commerce and Shopify brands", audience="E-commerce and Shopify brands",
    title="AI Automation for Shopify & E-commerce Brands | Morning Telos",
    desc="AI automation for Shopify and e-commerce brands. Answer support tickets in seconds, handle orders and returns, win back carts and get daily reports.",
    h1=("Support that answers", "in seconds."), h1_label="AI automation for Shopify and e-commerce brands",
    lead="AI automation for Shopify and e-commerce brands. We answer support tickets in seconds, handle orders and returns, win back abandoned carts and send you clear daily numbers, so you can focus on growth.",
    second_cta=("See a ticket solved", "demo"), proof="Free 30-minute call. We look at your support and ops.",
    img="in_shop.webp", img_alt="Marble statue of a young Greek man carrying shipping boxes on his shoulder",
    chips=[("Ticket solved", "in 8 seconds"), ("Return approved", "label sent"), ("Cart recovered", "$142 order"), ("Daily report", "in Slack at 8 AM")],
    stall_head='Support piles up <span class="clay">as orders grow.</span>',
    stall_lead="More orders means more tickets, returns and spreadsheets. Hiring to keep up eats your margin.",
    meter=("Ops strain", "25,50,74,92", ["Smooth", "Busy", "Buried"]),
    problems=[
        (IC["chat"], "“Where is my order?” all day", "Most tickets ask the same few questions.",
         B.viz_chat(["Where is my order?", "Can I change my size?", "Where is my order?", "How do I return this?"], "×212 this week")),
        (IC["clock"], "Slow replies hurt reviews", "Customers wait hours for an answer and leave a bad review.",
         B.viz_resp("Support inbox", "9 hrs", "AI support", "8 sec", "Example first response time.")),
        (IC["box"], "Returns and order fixes by hand", "Address changes, refunds and exchanges handled one by one.",
         B.viz_data(["Shopify", "Gorgias", "ShipStation", "Stripe"], "Resolved", G(IC["box"]))),
        (IC["chart"], "Numbers in five dashboards", "Sales, ads and inventory checked in different tools every morning.",
         B.viz_week([("Shop", 60), ("Ads", 75), ("Email", 40), ("Stock", 55), ("Sheet", 85)], "Example: time spent each morning pulling numbers.")),
    ],
    after_stall=ba([("8:00", "Pull numbers from five dashboards", "45 min", "Daily report waiting in Slack"),
                    ("9:00", "Answer overnight tickets", "2 hrs", "Most tickets already solved"),
                    ("11:00", "Process returns and exchanges", "1 hr", "Returns approved by your rules"),
                    ("13:00", "Fix address and order changes", "40 min", "Changes made before shipping"),
                    ("15:00", "Email abandoned carts", "30 min", "Cart recovery runs on its own"),
                    ("16:00", "Reorder low stock", "guesswork", "• Product, marketing and growth")],
                   'An operator\'s day, <span class="clay">before and after.</span>', "Switch to After to see the same day with AI handling support, returns and reporting."),
    cards_head='What we automate for <span class="clay">e-commerce.</span>', cards_lead="Connected to your store, help desk and shipping tools, so customers get answers instantly.",
    cards=[("AI support agent", "Answers order, shipping and product questions in seconds, in your brand's voice.", ["Gorgias", "Zendesk", "Chat"], IC["chat"]),
           ("Returns & exchanges", "Returns approved by your rules, labels sent and refunds processed.", ["Loop", "Shopify"], IC["box"]),
           ("Order changes", "Address, size and item changes made before the order ships.", ["Shopify", "ShipStation"], IC["flow"]),
           ("Cart & win-back flows", "Personal follow-ups that bring back carts and past customers.", ["Klaviyo", "SMS"], IC["mail"]),
           ("Inventory alerts", "Low stock flagged and reorders drafted before you sell out.", ["Stock", "Suppliers"], IC["clock"]),
           ("Daily reporting", "Sales, ads and margin in one message every morning.", ["Slack", "Sheets"], IC["chart"])],
    signature=flow('“Where\'s my order?” <span class="clay">Solved in 8 seconds.</span>', "An example of an AI support agent. A customer asks about an order, the agent looks it up and answers with tracking, no human needed.",
                   "AI support agent", "Chat", "Alex T.", "Hey, I ordered on Monday and haven't gotten anything yet. Order #4821.", "2:14 PM",
                   [("Found the order", "#4821 · shipped Tuesday", "0:02"), ("Checked tracking", "out for delivery today", "0:04"), ("Replied with the link", "plus a 10% code for the wait", "0:08"), ("Closed the ticket", "tagged: shipping status", "0:08")],
                   "Ticket solved", "8 seconds · no human needed", "Sample conversation. Built on your store, policies and brand voice."),
    outcomes=[(10, "sec", "or less to answer common tickets"), (70, "%", "of tickets solved without a human"), (24, "/7", "support in your brand's voice"), (1, "report", "every morning with every number")],
    how_head='From busy inbox to <span class="clay">calm operations.</span>',
    how_steps=["Tell us what fills your inbox and your day.", "Review your tickets, returns and reports. Pick the first fix.", "Connect AI to your store and help desk, then test on real tickets.", "Track resolution time and reviews, and keep improving."],
    before_faq=related(["ai-agents", "ai-automation", "partnership"]),
    faq_title="E-commerce questions",
    faqs=[("Does it work with Shopify?", "Yes. We connect to Shopify, WooCommerce and most help desks, shipping and email tools."),
          ("Will it sound like our brand?", "We train it on your policies, past replies and tone, and you approve the voice before launch."),
          ("What about tricky tickets?", "Anything outside your rules, like big refunds or angry customers, goes to your team with a summary."),
          ("Can it process returns and refunds?", "Yes, within limits you set, such as order value or time since delivery."),
          ("How many tickets can it handle?", "As many as come in, day or night. Most brands see the majority of routine tickets solved automatically."),
          ("How long does setup take?", "An AI support agent usually goes live in two to three weeks.")],
    final_line="Tell us what your support inbox looks like on a busy day. We'll show you how much of it AI can solve.",
)

page(
    slug="accounting", name="Accounting firms", service_type="AI automation for accounting and bookkeeping firms", audience="Accounting, CPA and bookkeeping firms",
    title="AI Automation for Accounting & Bookkeeping Firms | Morning Telos",
    desc="AI automation for accounting, CPA and bookkeeping firms. Collect client documents automatically, cut data entry, answer client emails and close the books faster.",
    h1=("Stop chasing clients", "for documents."), h1_label="AI automation for accounting and bookkeeping firms",
    lead="AI automation for accounting, CPA and bookkeeping firms. We collect client documents automatically, pull data out of receipts and statements, answer routine emails and keep work moving, so your team can take on more clients.",
    second_cta=("See documents collected", "demo"), proof="Free 30-minute call. We find your biggest time sinks.",
    img="in_acct.webp", img_alt="Marble statue of a young Greek man holding a brass abacus",
    chips=[("Documents in", "14 of 14 received"), ("Receipts read", "entered in QuickBooks"), ("Client email", "answered"), ("Month closed", "3 days faster")],
    stall_head='Busy season <span class="clay">every month.</span>',
    stall_lead="Most of the work isn't accounting. It's chasing documents, typing numbers and answering the same client emails.",
    meter=("Busywork load", "25,50,74,92", ["Light", "Heavy", "Buried"]),
    problems=[
        (IC["mail"], "Chasing clients for documents", "Emails, calls and reminders just to get statements and receipts.",
         B.viz_chat(["Just following up on your statements", "Reminder: we still need your W-2", "Following up again…", "Any chance you can send those?"], "4 reminders per client")),
        (IC["doc"], "Typing data from receipts", "Numbers copied from PDFs and photos into the books by hand.",
         B.viz_data(["PDFs", "Photos", "Email", "Banks"], "QuickBooks", G(IC["chart"]))),
        (IC["chat"], "Routine client emails", "“When will my return be done?” answered one at a time.",
         B.viz_resp("By hand", "2 days", "AI draft", "5 min", "Example reply time on routine client emails.")),
        (IC["clock"], "Month-end crunch", "Reconciliations and close work pile up in the last few days.",
         B.viz_week([("Wk 1", 25), ("Wk 2", 30), ("Wk 3", 45), ("Wk 4", 95), ("Close", 100)], "Example: workload across the month.")),
    ],
    after_stall=ba([("8:30", "Email clients for missing documents", "1 hr", "Reminders sent until every file arrives"),
                    ("10:00", "Rename and file uploads", "40 min", "Files sorted into the right folders"),
                    ("11:00", "Type receipts into the books", "2 hrs", "Data pulled and entered for review"),
                    ("14:00", "Answer “when will it be done?”", "1 hr", "Status replies drafted and sent"),
                    ("15:30", "Track who still owes what", "45 min", "Live checklist for every client"),
                    ("17:00", "Prep for month-end", "late nights", "• Advisory work and new clients")],
                   'A firm\'s day, <span class="clay">before and after.</span>', "Switch to After to see the same day with AI collecting documents and handling data entry."),
    cards_head='What we automate for <span class="clay">accounting firms.</span>', cards_lead="Connected to your practice and accounting software, with client data kept secure.",
    cards=[("Document collection", "Clients get a checklist and reminders until every document is in.", ["Portal", "Email", "SMS"], IC["box"]),
           ("Data extraction", "Receipts, invoices and statements read and entered for review.", ["QuickBooks", "Xero"], IC["doc"]),
           ("Client email assistant", "Routine questions answered and drafts prepared for the rest.", ["Email", "Status"], IC["mail"]),
           ("Workflow tracking", "Every client's status in one place, with next steps assigned.", ["Karbon", "TaxDome"], IC["flow"]),
           ("Reconciliation help", "Transactions matched and exceptions flagged for your team.", ["Banks", "Ledgers"], IC["money"]),
           ("Client onboarding", "Engagement letters, intake and setup handled automatically.", ["E-sign", "Forms"], IC["user"])],
    signature=flow('14 documents needed. <span class="clay">14 received.</span>', "An example of document collection. The system checks what each client still owes, reminds them, and files everything when it arrives.",
                   "document collection", "Client portal", "Lee Family Bakery", "Year-end checklist: 9 of 14 documents still missing.", "Mon 9:00 AM",
                   [("Sent a friendly checklist", "with a simple upload link", "Mon"), ("Reminded on day 3", "6 documents arrived", "Thu"), ("Read and filed each one", "named and sorted by type", "Thu"), ("Flagged the last item", "1099 from a new client", "Fri")],
                   "All documents in", "14 of 14 · ready for review", "Sample timeline. Built on your checklist, portal and software."),
    outcomes=[(80, "%", "less time chasing documents"), (0, "hrs", "typing data from receipts"), (1, "place", "to see every client's status"), (3, "days", "faster month-end close")],
    how_head='From busy season to <span class="clay">steady work.</span>',
    how_steps=["Tell us where your team spends time that isn't accounting.", "Map documents, data entry and client emails. Pick the first fix.", "Connect AI to your portal and accounting software, then test on real clients.", "Track hours saved and close times, and keep improving."],
    before_faq=related(["ai-automation", "ai-agents", "custom-software"]),
    faq_title="Accounting firm questions",
    faqs=[("Does it work with QuickBooks and Xero?", "Yes, along with practice tools like Karbon, TaxDome, Canopy and most document portals."),
          ("Is client financial data secure?", "Everything runs in your accounts with access limited to what each tool needs, and we use AI providers that don't train on your data."),
          ("Will AI make entries without review?", "No. Extracted data goes into a review step, and your team approves before anything posts."),
          ("Can it remind clients without annoying them?", "Yes. Reminders are friendly, spaced out, and stop the moment the document arrives."),
          ("Can it answer client questions?", "It answers routine status questions and drafts replies for anything that needs an accountant."),
          ("How long does setup take?", "Document collection can go live in about two weeks. Data extraction follows after.")],
    final_line="Tell us how many hours your team spends chasing documents. We'll show you how to get most of them back.",
)


import solutions_more  # noqa: E402
solutions_more.add(globals())

if __name__ == "__main__":
    for p in PAGES:
        B.build(p)
