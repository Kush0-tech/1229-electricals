(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const h = (tag, attrs = {}, kids = []) => {
    const e = document.createElement(tag);
    for (const k in attrs) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'text') e.textContent = attrs[k];
      else e.setAttribute(k, attrs[k]);
    }
    [].concat(kids).forEach(c => c && e.append(c));
    return e;
  };
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- theme ---------- */
  $('#themeBtn').addEventListener('click', () => {
    const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('theme', t); } catch (e) {}
    $('meta[name=theme-color]').content = t === 'dark' ? '#0b0b0c' : '#f5f1ea';
  });

  /* ---------- frame sequence ---------- */
  const TOTAL = 120;
  const frames = new Array(TOTAL);
  const loaded = [];
  const order = [];
  [8, 4, 2, 1].forEach((st, pass, arr) => {
    for (let i = 0; i < TOTAL; i += st) if (!order.includes(i)) order.push(i);
  });
  const coarse = order.filter(i => i % 8 === 0);
  let coarseDone = 0, contentReady = false, started = false;
  const pad = n => String(n + 1).padStart(3, '0');

  function loadFrame(i) {
    return new Promise(res => {
      const im = new Image();
      im.decoding = 'async';
      im.onload = () => { frames[i] = im; res(i); };
      im.onerror = () => res(i);
      im.src = `/frames/f${pad(i)}.webp`;
    });
  }
  async function loadAll() {
    // coarse pass first: hero is scrub-ready quickly
    await Promise.all(coarse.map(i => loadFrame(i).then(() => {
      coarseDone++;
      const pct = Math.round((coarseDone / coarse.length) * 100);
      $('#loaderFill').style.width = pct + '%';
      $('#loaderPct').textContent = pct;
    })));
    tryStart();
    // fill the rest in small batches so it never blocks scrolling
    const rest = order.filter(i => !frames[i]);
    for (let k = 0; k < rest.length; k += 6) {
      await Promise.all(rest.slice(k, k + 6).map(loadFrame));
    }
  }

  /* ---------- canvas ---------- */
  const cv = $('#cv'), ctx = cv.getContext('2d', { alpha: false });
  let cw = 0, ch = 0, lastDrawn = -1;
  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const r = cv.getBoundingClientRect();
    cw = Math.max(1, Math.round(r.width * dpr));
    ch = Math.max(1, Math.round(r.height * dpr));
    cv.width = cw; cv.height = ch; lastDrawn = -1;
  }
  function nearest(i) {
    if (frames[i]) return frames[i];
    for (let d = 1; d < TOTAL; d++) {
      if (frames[i - d]) return frames[i - d];
      if (frames[i + d]) return frames[i + d];
    }
    return null;
  }
  function draw(i) {
    const im = nearest(i);
    if (!im) return;
    const s = Math.max(cw / im.naturalWidth, ch / im.naturalHeight);
    const w = im.naturalWidth * s, hh = im.naturalHeight * s;
    ctx.drawImage(im, (cw - w) / 2, (ch - hh) / 2, w, hh);
  }

  /* ---------- hero scroll ---------- */
  const hero = $('#hero');
  let chapEls = [], chapAt = [], activeCh = -1, cur = 0, target = 0, prog = 0;
  function onScroll() {
    const top = hero.offsetTop, len = hero.offsetHeight - innerHeight;
    prog = clamp((scrollY - top) / len, 0, 1);
    target = prog * (TOTAL - 1);
    $('#prog').style.transform = `scaleX(${prog})`;
    $('#cue').style.opacity = prog > 0.015 ? 0 : 1;
    let idx = -1;
    chapAt.forEach((a, k) => { if (prog >= a) idx = k; });
    if (idx !== activeCh) {
      chapEls.forEach((e, k) => e.classList.toggle('on', k === idx));
      activeCh = idx;
    }
    const past = scrollY > top + len - 40;
    $('#nav').classList.toggle('solid', past);
    $('#waBtn').classList.toggle('show', past);
  }
  function loop() {
    cur += (target - cur) * (reduce ? 1 : 0.14);
    if (Math.abs(target - cur) < 0.01) cur = target;
    const f = Math.round(cur);
    if (f !== lastDrawn && started) { draw(f); lastDrawn = f; }
    requestAnimationFrame(loop);
  }

  function tryStart() {
    if (started || coarseDone < coarse.length || !contentReady) return;
    started = true;
    resize(); onScroll(); cur = target; draw(Math.round(cur)); lastDrawn = Math.round(cur);
    const L = $('#loader');
    L.classList.add('done');
    document.body.classList.remove('loading');
    setTimeout(() => L.remove(), 900);
    initReveal();
  }
  setTimeout(() => { contentReady = true; tryStart(); }, 7000); // safety net

  /* ---------- content ---------- */
  async function getContent() {
    const get = async (u, ms) => {
      const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
      try { const r = await fetch(u, { signal: c.signal }); if (!r.ok) throw 0; return await r.json(); }
      finally { clearTimeout(t); }
    };
    try { const d = await get('/api/content', 3500); if (d && d.packages) return d; } catch (e) {}
    return get('/content.default.json', 8000);
  }

  function render(c) {
    const b = c.brand;
    document.documentElement.style.setProperty('--acc', b.accent || '#ff5a1f');
    document.title = `${b.name} | Solar, Electrical, Ceilings, Gweru`;

    // chapters
    const box = $('#chapters');
    c.hero.chapters.forEach((x, k) => {
      const t = h(k === 0 ? 'h1' : 'h2', { text: x.title });
      box.append(h('div', { class: 'ch' }, [h('p', { class: 'eyebrow', text: x.kicker }), t, h('p', { class: 't', text: x.text })]));
    });
    chapEls = [...box.children]; chapAt = c.hero.chapters.map((x, k) => x.at ?? k / c.hero.chapters.length);

    // about
    $('#aboutTitle').textContent = c.about.title;
    $('#aboutText').textContent = c.about.text;
    $('#mission').textContent = c.about.mission;
    $('#vision').textContent = c.about.vision;
    $('#promise').textContent = c.about.promise;

    // packages
    const grid = $('#pkgGrid'), sel = $('#svcSel');
    sel.append(h('option', { text: 'General enquiry', value: 'General enquiry' }));
    c.packages.forEach((p, k) => {
      const m = p.media || [];
      const mk = (x, cls) => {
        if (!x) return null;
        if (x.type === 'video') {
          const v = h('video', { class: cls, muted: '', loop: '', playsinline: '', preload: 'metadata', 'aria-hidden': 'true' });
          v.muted = true; v.src = x.src; if (x.poster) v.poster = x.poster; v.dataset.auto = '1';
          return v;
        }
        return h('img', { class: cls, src: x.src, alt: x.alt || p.title, loading: 'lazy', decoding: 'async' });
      };
      const card = h('button', { class: 'pk reveal', type: 'button', 'aria-label': `Open ${p.title}` }, [
        h('div', { class: 'pk-m' }, [mk(m[0], 'a'), mk(m[1], 'b'), h('span', { class: 'pk-n', text: p.tag || String(k + 1).padStart(2, '0') })]),
        h('div', { class: 'pk-t' }, [h('h3', { text: p.title }), h('p', { text: p.blurb }), h('span', { class: 'go', text: 'View details →' })])
      ]);
      card.addEventListener('click', () => openModal(p));
      grid.append(card);
      sel.append(h('option', { text: p.title, value: p.title }));
    });

    // pulse & perfection
    const pp = c.pulse;
    $('#pulseTitle').textContent = pp.pulseTitle; $('#pulseText').textContent = pp.pulseText;
    $('#perfTitle').textContent = pp.perfectionTitle; $('#perfText').textContent = pp.perfectionText;
    $('#imgPulse').src = pp.imgPulse; $('#imgPerf').src = pp.imgPerfection;

    // values
    c.values.forEach((v, k) => {
      $('#valGrid').append(h('div', { class: 'val reveal' }, [h('small', { text: String(k + 1).padStart(2, '0') }), h('h3', { text: v.title }), h('p', { text: v.text })]));
    });

    // contact
    $('#payTitle').textContent = c.payments.title; $('#payText').textContent = c.payments.text;
    const cl = $('#contactList');
    b.phones.forEach(ph => cl.append(h('li', {}, [h('span', { text: 'Call' }), h('a', { href: 'tel:' + ph.replace(/\s/g, ''), text: ph })])));
    cl.append(h('li', {}, [h('span', { text: 'Visit' }), h('a', { href: 'https://maps.google.com/?q=' + encodeURIComponent(b.address), target: '_blank', rel: 'noopener', text: b.address })]));
    if (b.social) cl.append(h('li', {}, [h('span', { text: 'Social' }), h('a', { href: '#', text: '@' + b.social })]));
    $('#waBtn').href = `https://wa.me/${b.whatsapp}?text=${encodeURIComponent('Hi 1229 Electricals, I would like a quote.')}`;
    $('#footLegal').textContent = '© ' + new Date().getFullYear() + ' ' + b.legal;
    $('#footAddr').textContent = b.address;

    observeCards();
  }

  /* ---------- cards: autoplay video + flip on mobile ---------- */
  function observeCards() {
    const io = new IntersectionObserver(es => es.forEach(e => {
      const v = e.target.querySelector('video');
      if (v) e.isIntersecting ? v.play().catch(() => {}) : v.pause();
      e.target._vis = e.isIntersecting;
    }), { threshold: 0.35 });
    document.querySelectorAll('.pk').forEach(c => io.observe(c));
    if (matchMedia('(hover: none)').matches && !reduce) {
      setInterval(() => document.querySelectorAll('.pk').forEach(c => { if (c._vis) c.classList.toggle('flip'); }), 3200);
    }
  }

  /* ---------- modal ---------- */
  const modal = $('#modal');
  function openModal(p) {
    const gal = $('#mGal'), dots = $('#mDots');
    gal.replaceChildren(); dots.replaceChildren(); gal.scrollLeft = 0;
    (p.media || []).forEach((x, k) => {
      let el;
      if (x.type === 'video') {
        el = h('video', { muted: '', loop: '', playsinline: '', autoplay: '', preload: 'auto' });
        el.muted = true; el.src = x.src; if (x.poster) el.poster = x.poster;
      } else el = h('img', { src: x.src, alt: x.alt || p.title, decoding: 'async' });
      gal.append(el); dots.append(h('i', { class: k ? '' : 'on' }));
    });
    dots.style.display = (p.media || []).length > 1 ? 'flex' : 'none';
    $('#mTag').textContent = p.tag || '';
    $('#mTitle').textContent = p.title;
    $('#mBlurb').textContent = p.blurb;
    $('#mFeat').replaceChildren(...(p.features || []).map(f => h('li', { text: f })));
    $('#mCta').onclick = e => { e.preventDefault(); modal.close(); $('#svcSel').value = p.title; scrollToEl('#quote'); };
    modal.showModal();
    window.lenis && window.lenis.stop();
    gal.querySelectorAll('video').forEach(v => v.play().catch(() => {}));
  }
  $('#mGal').addEventListener('scroll', () => {
    const g = $('#mGal'), k = Math.round(g.scrollLeft / g.clientWidth);
    [...$('#mDots').children].forEach((d, i) => d.classList.toggle('on', i === k));
  }, { passive: true });
  $('#mClose').addEventListener('click', () => modal.close());
  modal.addEventListener('click', e => { if (e.target === modal) modal.close(); });
  modal.addEventListener('close', () => { window.lenis && window.lenis.start(); $('#mGal').querySelectorAll('video').forEach(v => v.pause()); });

  /* ---------- reveal + parallax ---------- */
  function initReveal() {
    const io = new IntersectionObserver(es => es.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }), { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    document.querySelectorAll('.reveal').forEach((el, i) => { el.style.transitionDelay = (i % 3) * 70 + 'ms'; io.observe(el); });
  }
  function parallax() {
    document.querySelectorAll('.pp-side').forEach(s => {
      const r = s.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) return;
      const k = (r.top + r.height / 2 - innerHeight / 2) / innerHeight;
      s.firstElementChild.style.transform = `translate3d(0,${(-k * 60).toFixed(1)}px,0)`;
    });
  }

  /* ---------- smooth scroll ---------- */
  function scrollToEl(sel) {
    const el = $(sel); if (!el) return;
    window.lenis ? window.lenis.scrollTo(el, { offset: -10 }) : el.scrollIntoView({ behavior: 'smooth' });
  }
  document.querySelectorAll('a[href^="#"]').forEach(a => a.addEventListener('click', e => {
    const id = a.getAttribute('href'); if (id.length > 1 && $(id)) { e.preventDefault(); scrollToEl(id); }
  }));
  if (window.Lenis && !reduce) {
    const lenis = window.lenis = new Lenis({ lerp: 0.1, wheelMultiplier: 0.9 });
    lenis.on('scroll', () => { onScroll(); parallax(); });
    const raf = t => { lenis.raf(t); requestAnimationFrame(raf); };
    requestAnimationFrame(raf);
  } else addEventListener('scroll', () => { onScroll(); parallax(); }, { passive: true });
  addEventListener('resize', () => { resize(); onScroll(); });

  /* ---------- form ---------- */
  $('#leadForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, msg = $('#formMsg'), d = Object.fromEntries(new FormData(f));
    if (!d.name.trim() || !d.phone.trim()) { msg.textContent = 'Please add your name and phone number.'; return; }
    msg.textContent = 'Sending…';
    try {
      const r = await fetch('/api/lead', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(d) });
      if (!r.ok) throw 0;
      msg.textContent = 'Thank you. We will contact you shortly.'; f.reset();
    } catch (err) {
      msg.textContent = 'Could not send right now. Please use WhatsApp or call us.';
    }
  });

  /* ---------- boot ---------- */
  loop();
  loadAll();
  getContent().then(c => { render(c); contentReady = true; tryStart(); }).catch(() => { contentReady = true; tryStart(); });
})();
