"""Extra service pages: AI lead generation, AI agents, CRM & sales automation.
Imported by build_service.py, which adds these to PAGES."""


def make(ns):
    viz_resp, viz_chat, viz_data, viz_week = ns["viz_resp"], ns["viz_chat"], ns["viz_data"], ns["viz_week"]
    VIZ_YOU, VIZ_TOOLS, CHECK, cut = ns["VIZ_YOU"], ns["VIZ_TOOLS"], ns["CHECK"], ns["cut"]
    SIG_CSS = ns["SIG_CSS"]

    # ---------- signature: outbound pipeline board ----------
    cols = [("Prospects", 1240, [("Reyes Dental", "Owner · Austin"), ("Park Fitness", "Founder · Denver"), ("Chen Studio", "CEO · Seattle")]),
            ("Contacted", 380, [("Okafor Logistics", "COO · Atlanta"), ("Patel CPA", "Partner · Dallas")]),
            ("Replied", 46, [("Brightline HVAC", "Owner · Phoenix"), ("Nova Clinics", "Ops lead · Miami")]),
            ("Booked", 14, [("Summit Legal", "Managing partner · Boston")])]
    kan = ""
    for ci, (name, n, cards) in enumerate(cols):
        cc = "".join(f'<div class="kc" style="--dl:{.3 + ci*.35 + k*.15:.2f}s"><b>{a}</b><small>{b}</small>{"<span class=\"pill ok\">Call booked</span>" if name=="Booked" else ""}</div>' for k, (a, b) in enumerate(cards))
        kan += f'<div class="kcol"><h5>{name} <span class="countup" data-to="{n}">0</span></h5>{cc}</div>'
    LEAD_SIG = f'''  <section class="sig" id="demo">
    <div class="wrap">
      <div class="head">
        <h2 class="big rv">Prospects in. <span class="clay">Meetings out.</span></h2>
        <p class="lead rv" style="--d:.1s">An example outbound pipeline. AI finds the right companies, writes a note to each one, and moves replies straight onto your calendar.</p>
      </div>
      <div class="app kan draw rv rv-s">
        <div class="app-bar"><i></i><i></i><i></i><span class="ttl">example · outbound pipeline</span><span class="clock"><span class="dot-live"></span>running</span></div>
        <div class="kan-body">{kan}</div>
      </div>
      <p class="onote rv">Sample data. Real campaigns are built around your ideal customer.</p>
    </div>
  </section>

'''
    # ---------- signature: agent run log ----------
    steps = [("Searched the web and Google Maps", "62 clinics found", "0:04"), ("Checked each website", "20 opening a second location", "0:41"),
             ("Found the owner's name and email", "20 of 20 verified", "1:12"), ("Wrote a personal note for each", "based on their news", "1:58"),
             ("Saved drafts to HubSpot", "waiting for your review", "2:06")]
    sl = "".join(f'<li style="--dl:{.5 + k*.45:.2f}s"><span class="bx">{CHECK}</span><span><b>{a}</b><em>{b}</em></span><time>{t}</time></li>' for k, (a, b, t) in enumerate(steps))
    AGENT_SIG = f'''  <section class="sig" id="demo">
    <div class="wrap">
      <div class="head">
        <h2 class="big rv">Give it a job. <span class="clay">Watch it work.</span></h2>
        <p class="lead rv" style="--d:.1s">An example research agent. One plain-English task, done end to end in minutes, with every step logged for your team to check.</p>
      </div>
      <div class="app runlog draw rv rv-s">
        <div class="app-bar"><i></i><i></i><i></i><span class="ttl">example · research agent</span><span class="clock"><span class="dot-live"></span>run complete</span></div>
        <div class="run-body">
          <div class="run-task"><small>Task</small><p>Find dental clinics in Austin opening a second location. Get the owner's email and draft a short, personal note to each one.</p><div class="run-tools"><span>Web search</span><span>Maps</span><span>Email finder</span><span>HubSpot</span></div></div>
          <div class="run-steps"><small>Steps</small><ul>{sl}</ul><div class="run-out"><span class="countup" data-to="20">0</span> drafts ready for review</div></div>
        </div>
      </div>
      <p class="onote rv">Sample run. Every agent we build has limits, logs and a human check where it matters.</p>
    </div>
  </section>

'''
    CRM_SIG = cut("  <!-- 6. DEMO -->", "  <!-- 7. ANCIENT -->").replace(
        'Systems that run <span class="clay">while you sleep.</span>', 'Follow-up that <span class="clay">never forgets.</span>')
    import re
    CRM_SIG = re.sub(r'<p class="lead rv" style="--d:.16s">.*?</p>', '<p class="lead rv" style="--d:.16s">An example of CRM automation. A lead comes in at 2 AM, gets a reply, and lands in your pipeline with the next step booked.</p>', CRM_SIG, count=1, flags=re.S)

    MORE_CSS = SIG_CSS + '''
  .kan-body { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; padding: 18px; min-height: 360px; }
  .kcol { background: var(--ivory); border: 1px solid var(--line); border-radius: 12px; padding: 12px; display: grid; gap: 8px; align-content: start; }
  .kcol h5 { font-family: var(--mono); font-weight: 500; font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: var(--ink-4); display: flex; justify-content: space-between; margin-bottom: 4px; }
  .kcol h5 span { color: var(--ink); }
  .kcol:last-child { background: #fff4ee; border-color: var(--clay-soft); }
  .kcol:last-child h5 span { color: var(--clay); }
  .kc { background: var(--white); border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; font-size: 13px; opacity: 0; transform: translateX(-14px); transition: opacity .5s var(--dl), transform .6s var(--ease) var(--dl); }
  .kan.in .kc { opacity: 1; transform: none; }
  .kc b { display: block; font-weight: 600; } .kc small { display: block; color: var(--ink-3); font-size: 12px; margin: 2px 0 0; }
  .kc .pill { margin-top: 8px; }
  .run-body { display: grid; grid-template-columns: 1fr 1.3fr; min-height: 380px; }
  .run-task { padding: 24px; border-right: 1px solid var(--line); background: var(--ivory); }
  .run-task small, .run-steps small { display: block; font-family: var(--mono); font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-4); margin-bottom: 10px; }
  .run-task p { font-family: var(--serif); font-size: 24px; line-height: 1.3; }
  .run-tools { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 20px; }
  .run-tools span { font-size: 12px; padding: 4px 10px; border-radius: 99px; background: var(--white); border: 1px solid var(--line); color: var(--ink-3); }
  .run-steps { padding: 24px; }
  .run-steps ul { list-style: none; display: grid; gap: 12px; }
  .run-steps li { display: grid; grid-template-columns: 22px 1fr auto; gap: 12px; align-items: start; opacity: 0; transform: translateY(8px); transition: opacity .5s var(--dl), transform .6s var(--ease) var(--dl); }
  .runlog.in .run-steps li { opacity: 1; transform: none; }
  .run-steps .bx { width: 22px; height: 22px; border-radius: 6px; background: var(--clay); display: grid; place-items: center; margin-top: 2px; }
  .run-steps .bx svg { width: 11px; height: 11px; stroke: #fff; fill: none; stroke-width: 3; }
  .run-steps b { display: block; font-weight: 600; font-size: 15px; } .run-steps em { font-style: normal; font-size: 13px; color: var(--ink-3); }
  .run-steps time { font-family: var(--mono); font-size: 11px; color: var(--ink-4); margin-top: 4px; }
  .run-out { margin-top: 18px; display: inline-block; padding: 8px 14px; border-radius: 99px; background: var(--ink); color: var(--ivory); font-size: 14px; opacity: 0; transition: opacity .5s 2.9s; }
  .runlog.in .run-out { opacity: 1; }
  @media (max-width: 1000px) { .kan-body { grid-template-columns: repeat(2, 1fr); } .run-body { grid-template-columns: 1fr; } .run-task { border-right: 0; border-bottom: 1px solid var(--line); } }
  @media (max-width: 640px) { .kan-body { grid-template-columns: 1fr; } }
'''
    return [
        dict(
            slug="ai-lead-generation", name="AI lead generation", service_type="AI lead generation",
            title="AI Lead Generation Agency for B2B | Morning Telos",
            desc="AI lead generation for B2B founders. We build outbound and inbound systems that find the right prospects, write personal outreach, and book meetings on your calendar.",
            h1=("A pipeline that", "fills itself."), h1_label="AI lead generation that fills your pipeline",
            lead="An AI lead generation agency for founders and sales teams. We build systems that find the right prospects, write outreach that sounds like you, and put booked meetings on your calendar.",
            second_cta=("See the pipeline", "demo"), proof="Free 30-minute call. We map your ideal customer.",
            img="archer.webp", img_alt="Marble statue of a young Greek archer drawing a bow with a golden arrow",
            chips=[("Prospects found", "matched to your ICP"), ("Emails sent", "personal, not spam"), ("Reply detected", "routed to sales"), ("Meeting booked", "on your calendar")],
            stall_head='Pipeline dries up <span class="clay">when founders get busy.</span>',
            stall_lead="Most growing businesses depend on referrals and the founder's own outreach. When the founder gets busy, new deals stop coming in.",
            meter=("Pipeline risk", "26,50,74,92", ["Steady", "Lumpy", "Empty"]),
            problems=[
                ('<path d="M3 20h18"/><path d="M5 15l4-6 4 3 6-8"/>', "Growth depends on referrals", "Good months and empty months, with no way to turn the tap on.",
                 viz_week([("Jan", 80), ("Feb", 20), ("Mar", 65), ("Apr", 10), ("May", 45)], "Example: deals per month when growth depends on referrals.")),
                ('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1"/>', "Outreach to the wrong people", "Bought lists and spray-and-pray emails burn your domain and your reputation.",
                 viz_resp("Generic list", "0.4% reply", "Targeted + personal", "6% reply", "Example reply rates. Relevance does most of the work.")),
                ('<path d="M4 5h16v11H9l-5 4z"/><path d="M12 8v3l2 1"/>', "Replies sit unanswered", "Interested prospects wait days for an answer and go cold.",
                 viz_chat(["Sounds interesting, can we talk?", "What does pricing look like?", "Is next Tuesday good?"], "3 replies waiting since Friday")),
                ('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.5 3.6-7 8-7s8 2.5 8 7"/>', "The founder is the sales team", "Every lead, call and follow-up runs through one person.", VIZ_YOU),
            ],
            cards_head='What we <span class="clay">build.</span>', cards_lead="Outbound and inbound systems that bring in qualified meetings every week.",
            cards=[
                ("Ideal customer research", "AI finds companies that match your best clients, using real signals like hiring, funding and growth.", ["Signals", "Lists", "Scoring"], '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>'),
                ("Contact enrichment", "Verified names, roles and emails for the people who actually make the decision.", ["Verified emails", "Roles", "LinkedIn"], '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>'),
                ("Personal cold email", "Short notes written for each prospect, sent from warmed-up inboxes so they land.", ["Personalized", "Deliverability", "A/B tests"], '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>'),
                ("LinkedIn outreach", "Connection requests and messages that match your email sequence.", ["Sequences", "Profile visits"], '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 10v7M8 7v.5M12 17v-4a2 2 0 0 1 4 0v4M12 10v7"/>'),
                ("Inbound capture", "Website visitors and form fills answered in seconds and qualified by AI.", ["Forms", "Chat", "Instant reply"], '<path d="M4 5h16v11H9l-5 4z"/><path d="M15 10l2 2 4-4"/>'),
                ("Reply handling & booking", "Positive replies sorted, answered and booked straight onto your calendar.", ["Calendly", "CRM sync"], '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
            ],
            signature=LEAD_SIG, css=MORE_CSS,
            outc_head='What we <span class="clay">build toward.</span>',
            outcomes=[(1000, "+", "targeted prospects reached each month"), (5, "% +", "reply rate on personal outreach"), (10, "+", "qualified meetings a month"), (0, "spam", "lists bought or blasted")],
            outc_note="Targets we set with each client. Results depend on your market and offer.",
            how_head='From target list to <span class="clay">booked calls.</span>',
            how_steps=["Define your best customers and the offer that wins them.", "Build the target list, set up inboxes and write the first sequences.", "Launch outreach and inbound capture, and route every reply.", "Test, refine and scale what books the most meetings."],
            faq_title="Lead generation questions",
            faqs=[
                ("Will cold email hurt my domain?", "We send from separate, warmed-up domains and inboxes with careful volume limits, so your main domain stays safe."),
                ("Is it really personal if AI writes it?", "Each note is based on real research about the prospect, like their recent news or hiring. We review the templates with you before anything goes out."),
                ("Who are the leads?", "Companies and decision makers that match your best clients. We agree on the criteria together before we build the list."),
                ("How fast will we see meetings?", "Inbox setup and warm-up take a couple of weeks. Most campaigns start booking calls within the first month after launch."),
                ("Do you handle replies?", "We can route replies to your team, or have AI answer common questions and book calls straight onto your calendar."),
                ("Is it compliant?", "We follow CAN-SPAM and GDPR basics, include opt-outs, and only contact business addresses."),
            ],
            final_line="Tell us who your best customers are. We'll show you how to find a thousand more like them.",
        ),
        dict(
            slug="ai-agents", name="AI agents", service_type="Custom AI agent development",
            title="Custom AI Agent Development Agency | Morning Telos",
            desc="Custom AI agent development for founders and operators. We build AI agents that research, reach out, support customers and run operations inside your tools.",
            h1=("AI agents that do", "real jobs."), h1_label="Custom AI agents that do real jobs",
            lead="A custom AI agent development agency. We build agents that research, write, answer customers and run back-office tasks inside your tools, with clear limits and a human check where it matters.",
            second_cta=("Watch an agent work", "demo"), proof="Free 30-minute call. We pick your first agent.",
            img="owl.webp", img_alt="Marble statue of a young Greek man with a brass mechanical owl perched on his arm",
            chips=[("Research agent", "62 companies checked"), ("Support agent", "answered in 8 sec"), ("Ops agent", "invoices matched"), ("Human review", "where it matters")],
            stall_head='Chatbots talk. <span class="clay">Agents should work.</span>',
            stall_lead="Most AI tools stop at answering questions. The real hours are in the multi-step jobs your team still does by hand.",
            meter=("Manual work left", "24,48,72,92", ["Light", "Heavy", "Stuck"]),
            problems=[
                ('<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>', "Research eats whole afternoons", "Finding, checking and summarizing information across dozens of tabs.",
                 viz_resp("By hand", "3h 20m", "Research agent", "2 min", "Example time for one research task.")),
                ('<path d="M4 5h16v10H9l-5 4z"/><path d="M9 9h6M9 12h3"/>', "Chatbots that only chat", "They answer questions but can't look up an order, issue a refund or book a call.",
                 viz_chat(["Where is my order?", "Sorry, I can't check that.", "Can I change my booking?", "Please contact support."], "0 problems solved")),
                ('<rect x="3" y="4" width="8" height="11" rx="1.5"/><rect x="13" y="9" width="8" height="11" rx="1.5"/>', "Multi-step jobs across tools", "Read the email, check the CRM, update the sheet, reply. Every single time.",
                 viz_data(["Email", "CRM", "Sheets", "Slack"], "Done", '<circle cx="20" cy="20" r="12"/><path d="M14 20l4 4 8-8"/>')),
                ('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M14 17.5h7M17.5 14v7" stroke-dasharray="2 2"/>', "AI tools nobody trusts", "Pilots with no limits, no logs and no way to check the work.", VIZ_TOOLS),
            ],
            cards_head='Agents we <span class="clay">build.</span>', cards_lead="Each agent is scoped to one real job, connected to your tools, and watched once it is live.",
            cards=[
                ("Research agents", "Find companies, people and facts, check sources, and hand back a clean summary.", ["Web search", "Enrichment", "Reports"], '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>'),
                ("Outreach agents", "Write and send personal messages, and follow up until there is an answer.", ["Email", "LinkedIn", "SMS"], '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>'),
                ("Support agents", "Answer customers on chat, email and phone, and take real actions like refunds and rebooking.", ["Chat", "Voice", "Help desk"], '<path d="M5 13v-2a7 7 0 0 1 14 0v2"/><rect x="3" y="12" width="4" height="6" rx="2"/><rect x="17" y="12" width="4" height="6" rx="2"/>'),
                ("Operations agents", "Match invoices, update records and move work between tools on their own.", ["Finance", "Inventory", "Admin"], '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="12" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M8.5 6H12a3 3 0 0 1 3 3v1M8.5 18H12a3 3 0 0 0 3-3v-1"/>'),
                ("Internal knowledge agents", "Answer your team's questions from your docs, SOPs and past work.", ["Docs", "Slack", "Notion"], '<path d="M4 4h12l4 4v12H4z"/><path d="M8 12h8M8 16h5"/>'),
                ("Guardrails & monitoring", "Clear limits, logs of every step, and a human check on anything risky.", ["Approvals", "Logs", "Alerts"], '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>'),
            ],
            signature=AGENT_SIG, css=MORE_CSS,
            outc_head='What we <span class="clay">build toward.</span>',
            outcomes=[(1, "job", "per agent, scoped clearly"), (100, "%", "of steps logged and reviewable"), (24, "/7", "working, nights and weekends"), (10, "+ hrs", "back each week per agent")],
            outc_note="Targets we set with each client during the Telos Audit. Results depend on the job.",
            how_head='From one task to <span class="clay">a working agent.</span>',
            how_steps=["Pick one repeatable job that costs your team real hours.", "Map every step, tool and decision. Set the limits and the human checks.", "Build the agent, connect it to your tools and test it on real work.", "Watch its runs, improve its results and add the next agent."],
            faq_title="AI agent questions",
            faqs=[
                ("What is the difference between an AI agent and a chatbot?", "A chatbot answers questions. An agent takes actions: it looks things up, uses your tools and finishes multi-step jobs."),
                ("Which AI models do you use?", "We pick the best model for each job, such as Claude, OpenAI or Gemini, and can switch as models improve."),
                ("Can an agent make mistakes?", "Yes, so we design for it: clear limits, logs of every step, and a human approval on anything risky or customer-facing."),
                ("What tools can agents use?", "Email, CRM, calendar, help desk, spreadsheets, databases and most tools with an API."),
                ("How long does it take to build one?", "A focused first agent usually goes live in a few weeks, including testing on real work."),
                ("Who owns the agent?", "You do. It runs in your accounts, with your data, under your control."),
            ],
            final_line="Tell us the job your team is tired of doing. We'll show you what an agent could take off their plate.",
        ),
        dict(
            slug="crm-sales-automation", name="CRM &amp; sales automation", service_type="CRM and sales automation",
            title="CRM & Sales Automation Agency | Morning Telos",
            desc="CRM and sales automation for founders and sales teams. We automate lead routing, enrichment, follow-up and reporting in HubSpot, Salesforce, Pipedrive and more.",
            h1=("Follow-up that", "never forgets."), h1_label="CRM and sales automation with follow-up that never forgets",
            lead="A CRM and sales automation agency for founders and sales teams. We set up routing, enrichment, follow-ups and reporting in the CRM you already use, so no deal slips through the cracks.",
            second_cta=("Watch it work", "demo"), proof="Free 30-minute call. We review your pipeline.",
            img="hermes.webp", img_alt="Marble statue of a young Hermes with a winged helmet and golden caduceus",
            chips=[("Lead routed", "to the right rep"), ("Contact enriched", "role, company, size"), ("Follow-up sent", "day 3, on time"), ("Pipeline report", "every Monday")],
            stall_head='Deals slip <span class="clay">between the cracks.</span>',
            stall_lead="Most lost deals are never really lost. Someone just forgot to follow up, or the lead sat in the wrong inbox.",
            meter=("Deals at risk", "25,50,72,90", ["Tight", "Leaky", "Losing"]),
            problems=[
                ('<path d="M4 5h16v11H9l-5 4z"/><path d="M12 8v3l2 1"/>', "Follow-ups get forgotten", "Most deals need several touches. Most reps stop after one or two.",
                 viz_week([("1st", 100), ("2nd", 60), ("3rd", 30), ("4th", 12), ("5th", 5)], "Example: share of leads that get each follow-up when it is done by hand.")),
                ('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', "Leads land in the wrong place", "New leads sit in a shared inbox until someone notices.",
                 viz_resp("Shared inbox", "1d 6h", "Auto-routed", "2 min", "Example time before the right rep sees a new lead.")),
                ('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11"/>', "A CRM full of bad data", "Missing fields, duplicates and stale stages make every report a guess.",
                 viz_chat(["Dana Reyes — no email", "dana reyes (duplicate)", "Stage: ??? since March", "Company: n/a"], "38% of records incomplete")),
                ('<path d="M7 3h8l4 4v14H7z"/><path d="M15 3v4h4"/><path d="M10 17v-3M13 17v-5M16 17v-2"/>', "Reporting by hand", "Monday mornings spent exporting the pipeline into a spreadsheet.",
                 viz_data(["HubSpot", "Calls", "Email", "Sheets"], "Report", '<path d="M10 30V18M20 30V10M30 30v-8"/>')),
            ],
            cards_head='What we <span class="clay">automate.</span>', cards_lead="Built inside the CRM you already use, so your team keeps one place to work.",
            cards=[
                ("Lead routing", "Every new lead goes to the right person in seconds, by region, size or product.", ["Round robin", "Rules", "Alerts"], '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="12" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M8.5 6H12a3 3 0 0 1 3 3v1M8.5 18H12a3 3 0 0 0 3-3v-1"/>'),
                ("Enrichment", "Company, role, size and links filled in automatically for every contact.", ["Firmographics", "Dedupe"], '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>'),
                ("Follow-up sequences", "Timed emails, tasks and reminders that run until the lead replies or says no.", ["Email", "Tasks", "SMS"], '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>'),
                ("Pipeline hygiene", "Stale deals flagged, stages updated and duplicates merged automatically.", ["Clean data", "Stage rules"], '<path d="M4 7h16M4 12h10M4 17h6"/><path d="M17 15l2 2 3-4"/>'),
                ("AI call & meeting notes", "Calls summarized, next steps logged and the CRM updated without typing.", ["Transcripts", "Next steps"], '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>'),
                ("Sales reporting", "Live pipeline, forecast and rep activity, delivered to Slack every Monday.", ["Dashboards", "Forecasts", "Slack"], '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
            ],
            signature=CRM_SIG, css=MORE_CSS,
            outc_head='What we <span class="clay">build toward.</span>',
            outcomes=[(2, "min", "or less for a lead to reach the right rep"), (5, "+", "follow-ups for every open lead"), (100, "%", "of new contacts enriched"), (0, "hrs", "spent building the Monday report")],
            outc_note="Targets we set with each client during the Telos Audit. Results depend on your sales process.",
            how_head='From messy CRM to <span class="clay">a pipeline that runs.</span>',
            how_steps=["Walk us through how a lead becomes a customer today.", "Audit the CRM, clean the data and map every handoff.", "Build routing, enrichment, follow-ups and reports inside your CRM.", "Track what closes, tune the sequences and add the next automation."],
            faq_title="CRM automation questions",
            faqs=[
                ("Which CRMs do you work with?", "HubSpot, Salesforce, Pipedrive, Close, GoHighLevel and most CRMs with an API."),
                ("Do we need to switch CRMs?", "Usually not. We build inside the CRM you already use. If it truly can't do the job, we'll tell you and help you move."),
                ("Can you clean up our existing data?", "Yes. We dedupe, fill missing fields and fix stages as part of the setup."),
                ("Will follow-ups feel robotic?", "We write sequences in your voice, keep them short, and stop them the moment someone replies."),
                ("How long does setup take?", "Most CRM automation projects go live in two to four weeks, starting with the parts that lose the most deals."),
                ("Can AI update the CRM after calls?", "Yes. We connect your call or meeting tool so summaries and next steps land in the CRM automatically."),
            ],
            final_line="Show us your pipeline. We'll find the deals slipping through and the automations that catch them.",
        ),
    ]
