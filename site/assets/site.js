/* Morning Telos shared site script. Every block checks that its section exists,
   so the same file runs on the homepage and on every service page. */
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

  /* hero intro */
  const hero = $('#hero');
  if (hero) requestAnimationFrame(() => setTimeout(() => hero.classList.add('go'), 80));
  $$('.chip').forEach((c, i) => setTimeout(() => { c.classList.add('on'); setTimeout(() => c.classList.add('float'), 800); }, reduce ? 0 : 1300 + i * 450));

  /* reveal on scroll */
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .18, rootMargin: '0px 0px -6% 0px' });
  $$('.rv, .giant, .final-card, .draw').forEach(el => io.observe(el));

  function countTo(el, to, suffix = '%') {
    const from = parseInt(el.textContent) || 0, t0 = performance.now();
    (function f(t) { const k = Math.min(1, (t - t0) / 600); el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))) + suffix; if (k < 1) requestAnimationFrame(f); })(t0);
  }

  /* scroll-driven effects */
  const bar = $('.progress'), nav = $('#nav'), telos = $('#telos'), telosPin = $('#telosPin');
  const how = $('#how'), steps = $('#steps'), stepEls = steps ? $$('.step', steps) : [];
  const forge = $('#forge'), sl = $('#stallList');
  const strainBox = $('.strain'), strainNum = $('#strainNum');
  let ticking = false;

  function onScroll() {
    const y = scrollY, h = document.documentElement.scrollHeight - innerHeight;
    if (bar) bar.style.setProperty('--sp', h > 0 ? y / h : 0);
    if (nav) nav.classList.toggle('scrolled', y > 8);

    if (telos) {
      const tr = telos.getBoundingClientRect();
      const tp = clamp(-tr.top / (tr.height - innerHeight));
      telos.style.setProperty('--p', reduce ? 1 : tp.toFixed(3));
      if (telosPin) telosPin.classList.toggle('done', tp > .92);
    }

    if (how && steps && stepEls.length) {
      const hr = how.getBoundingClientRect();
      let hp;
      if (how.firstElementChild && getComputedStyle(how.firstElementChild).position === 'sticky') {
        hp = clamp(-hr.top / (hr.height - innerHeight) / .82);
      } else {
        const sr = steps.getBoundingClientRect();
        hp = clamp((innerHeight * .75 - sr.top) / (sr.height + innerHeight * .25));
      }
      steps.style.setProperty('--hp', hp.toFixed(3));
      let lit = 0;
      stepEls.forEach((s, i) => { const on = hp >= i / (stepEls.length - 1) - .02; s.classList.toggle('lit', on); if (on) lit = i + 1; });
      const sn = $('#stepNow'); if (sn) sn.textContent = String(Math.max(1, lit)).padStart(2, '0');
    }

    if (forge) {
      const fr = forge.getBoundingClientRect();
      forge.style.setProperty('--py', reduce ? '0px' : ((fr.top + fr.height / 2 - innerHeight / 2) * -0.08).toFixed(1) + 'px');
    }

    if (sl) {
      const items = $$('.sitem', sl), mark = innerHeight * .55;
      let active = -1;
      items.forEach((it, k) => { if (it.getBoundingClientRect().top < mark) active = k; });
      items.forEach((it, k) => { it.classList.toggle('on', k === active); it.classList.toggle('past', k < active); });
      const lr = sl.getBoundingClientRect();
      sl.style.setProperty('--sf', Math.max(0, Math.min(lr.height - 64, mark - lr.top - 32)) + 'px');
      if (strainBox && strainNum) {
        const levels = (strainBox.dataset.levels || '28,54,79,96').split(',').map(Number);
        const strain = active < 0 ? 0 : levels[Math.min(active, levels.length - 1)];
        strainBox.style.setProperty('--st', strain + '%');
        strainBox.classList.toggle('hot', active >= 2);
        if (strainNum.dataset.v != strain) { strainNum.dataset.v = strain; countTo(strainNum, strain); }
      }
    }
    ticking = false;
  }
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
  addEventListener('resize', onScroll); onScroll();


  /* nav dropdown + mobile menu */
  $$('.dd').forEach(dd => {
    const b = $('.dd-btn', dd);
    b.addEventListener('click', e => { e.stopPropagation(); const o = dd.classList.toggle('open'); b.setAttribute('aria-expanded', o); });
  });
  document.addEventListener('click', e => { $$('.dd.open').forEach(dd => { if (!dd.contains(e.target)) { dd.classList.remove('open'); $('.dd-btn', dd).setAttribute('aria-expanded', 'false'); } }); });
  const mb = $('.menu-btn');
  if (mb && nav) mb.addEventListener('click', () => {
    const o = nav.classList.toggle('menu-open'); mb.setAttribute('aria-expanded', o); $('.mnav', nav).setAttribute('aria-hidden', !o);
  });
  $$('.mnav a').forEach(a => a.addEventListener('click', () => nav && nav.classList.remove('menu-open')));


  /* before/after toggle */
  $$('.ba').forEach(box => {
    const btns = $$('.ba-tog button', box); let touched = false;
    const set = v => { box.dataset.s = v; btns.forEach(b => b.setAttribute('aria-pressed', b.dataset.v === v)); };
    btns.forEach(b => b.addEventListener('click', () => { touched = true; set(b.dataset.v); }));
    new IntersectionObserver((es, o) => es.forEach(e => {
      if (!e.isIntersecting) return; o.disconnect();
      setTimeout(() => { if (!touched) set('after'); }, reduce ? 0 : 1600);
    }), { threshold: .55 }).observe(box);
  });

  /* pointer effects */
  if (!reduce && matchMedia('(hover: hover)').matches) {
    $$('.tilt').forEach(c => {
      c.addEventListener('pointermove', e => {
        const r = c.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        c.style.setProperty('--mx', x * 100 + '%'); c.style.setProperty('--my', y * 100 + '%');
        c.style.transform = `perspective(900px) rotateX(${(.5 - y) * 6}deg) rotateY(${(x - .5) * 8}deg) translateY(-4px)`;
      });
      c.addEventListener('pointerleave', () => { c.style.transform = ''; });
    });
    $$('.mag').forEach(b => {
      b.addEventListener('pointermove', e => { const r = b.getBoundingClientRect(); b.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * .18}px, ${(e.clientY - r.top - r.height / 2) * .28}px)`; });
      b.addEventListener('pointerleave', () => { b.style.transform = ''; });
    });
    const stage = $('#stage');
    if (hero && stage) hero.addEventListener('pointermove', e => {
      const x = e.clientX / innerWidth - .5, y = e.clientY / innerHeight - .5;
      $$('.chip', stage).forEach((c, i) => { c.style.translate = `${x * (10 + i * 6)}px ${y * (8 + i * 5)}px`; });
      const st = $('.statue', stage); if (st) st.style.translate = `${x * -10}px ${y * -6}px`;
    });
  }

  /* rotating word in headline (words come from data-words, comma separated) */
  const rot = $('#rot');
  if (rot && !reduce) {
    const words = (rot.dataset.words || 'founders,business owners,operators,decision makers').split(','); let wi = 0;
    setInterval(() => {
      rot.classList.add('out');
      setTimeout(() => { wi = (wi + 1) % words.length; rot.textContent = words[wi]; rot.classList.remove('out'); rot.classList.add('pre'); void rot.offsetWidth; rot.classList.remove('pre'); }, 420);
    }, 2600);
  }

  /* FAQ accordion */
  $$('.qa button').forEach(b => b.addEventListener('click', () => {
    const q = b.parentElement, open = !q.classList.contains('open');
    $$('.qa.open').forEach(o => { o.classList.remove('open'); $('button', o).setAttribute('aria-expanded', 'false'); });
    if (open) { q.classList.add('open'); b.setAttribute('aria-expanded', 'true'); }
  }));

  /* typed quote */
  const quote = $('#quote');
  if (quote) {
    const full = quote.dataset.text; let typed = false;
    new IntersectionObserver((es, o) => es.forEach(e => {
      if (!e.isIntersecting || typed) return; typed = true; o.disconnect();
      if (reduce) { quote.textContent = full; return; }
      let i = 0; const cur = '<span class="cur"></span>';
      (function t() { quote.innerHTML = full.slice(0, i) + cur; if (i++ < full.length) setTimeout(t, full[i - 1] === ',' ? 160 : 26); })();
    }), { threshold: .5 }).observe(quote);
  }

  /* lead-response demo */
  const demo = $('#demo'), app = $('#app');
  if (demo && app) {
    const clock = $('#clock'), reply = $('#reply'), secsEl = $('#secs'), unread = $('#unread'), agentState = $('#agentState');
    const lis = $$('.tasks li', demo);
    const msg = "Hi Dana, thanks for reaching out! We have openings Tuesday at 10:00 and Thursday at 2:00. I've held Tuesday 10:00 for you. Reply to confirm or pick another time.";
    let timers = [], running = false, inView = false;
    const at = (ms, fn) => timers.push(setTimeout(fn, ms));
    const fmt = s => `2:00:${String(s).padStart(2, '0')} AM`;
    const base = demo.className.replace(/\bs\d\b/g, '').trim();
    function reset() {
      timers.forEach(clearTimeout); timers = [];
      demo.className = base; lis.forEach(l => l.classList.remove('done'));
      reply.innerHTML = ''; clock.textContent = fmt(0); secsEl.textContent = '0'; unread.textContent = '0 new'; agentState.textContent = 'Waiting for messages';
    }
    function play() {
      reset(); running = true;
      let sec = 0; const tick = setInterval(() => { if (sec < 44) { sec++; clock.textContent = fmt(sec); secsEl.textContent = sec; } }, 160);
      timers.push(tick);
      at(600, () => { demo.classList.add('s1'); unread.textContent = '1 new'; agentState.innerHTML = 'Working<span class="think"><i></i><i></i><i></i></span>'; });
      at(1500, () => lis[0].classList.add('done'));
      at(2400, () => lis[1].classList.add('done'));
      at(2900, () => { let i = 0; (function t() { reply.innerHTML = msg.slice(0, i) + '<span class="cur"></span>'; if (i++ < msg.length) timers.push(setTimeout(t, 14)); })(); });
      at(5600, () => { lis[2].classList.add('done'); reply.innerHTML = msg; });
      at(6600, () => { lis[3].classList.add('done'); demo.classList.add('s5'); unread.textContent = '0 new'; });
      at(7400, () => { demo.classList.add('s6'); agentState.textContent = 'Done · waiting for the next one'; clearInterval(tick); clock.textContent = fmt(44); secsEl.textContent = '44'; });
      at(13500, () => { if (inView) play(); else running = false; });
    }
    new IntersectionObserver(es => es.forEach(e => { inView = e.isIntersecting; if (inView && !running && !reduce) play(); }), { threshold: .2 }).observe(app);
    const rp = $('#replay'); if (rp) rp.addEventListener('click', play);
    if (reduce) { demo.classList.add('s1', 's5', 's6'); lis.forEach(l => l.classList.add('done')); reply.textContent = msg; secsEl.textContent = '44'; clock.textContent = fmt(44); }
  }

  /* count-up stats: <b class="countup" data-to="40" data-suffix="%">0%</b> */
  const cio = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return; cio.unobserve(e.target);
    const el = e.target, to = +el.dataset.to, suf = el.dataset.suffix || '';
    if (reduce) { el.textContent = to + suf; return; }
    countTo(el, to, suf);
  }), { threshold: .6 });
  $$('.countup').forEach(el => cio.observe(el));
})();
