/* js/fx/gallery.js — GALLERY module.
   The "selected work" wall at the head of Projects. The tiles are plain links in the markup (each one opens its row in the
   list below: js/main.js handles the click), so nothing here is needed for the first paint or for the page to work. This
   script adds what makes the wall feel handled:
     - hover or keyboard focus on a tile: a gentle tilt toward the cursor (a few degrees), slow parallax on the cover, a soft
       spotlight, and "awake" state, which js/fx/project-art.js turns into the cover's animation (event 'art-wake');
     - hovering a row of the list below lights its cover instead of the floating preview card (event 'row-link', see
       project-art.js), and hovering a cover tints its row;
     - below 1100 px the wall is a snap carousel: arrows, a counter, arrow-key roving; on touch the centered cover wakes;
     - a skill picked in the Skills section marks the covers whose project uses it.
   All of it stands down for reduced motion, coarse pointers (no tilt) and the low quality tier. */
(function () {
  'use strict';

  var P = window.Portfolio;
  var gallery = document.querySelector('[data-fx="gallery"]');
  if (!P || !gallery) return;

  var started = false;
  function boot() {
    if (started) return;
    started = true;
    try { init(); } catch (error) {
      gallery.setAttribute('data-fx-failed', '');
      if (window.console && console.error) console.error('[portfolio] gallery', error);
    }
  }

  // The section is watched, not the wall: a section far below the viewport is not drawn yet (see "cv" in core.js), and
  // nothing inside an undrawn section intersects anything.
  var host = gallery.closest('main > .section') || gallery;
  if ('IntersectionObserver' in window) {
    var near = new IntersectionObserver(function (entries) {
      if (!entries.some(function (entry) { return entry.isIntersecting; })) return;
      near.disconnect();
      P.whenIdle(boot, 800);
    }, { rootMargin: '1000px 0px' });
    near.observe(host);
  } else {
    window.addEventListener('load', function () { P.whenIdle(boot, 1500); });
  }

  function init() {
    function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
    function r2(v) { return Math.round(v * 100) / 100; }
    function pad(n) { return (n < 10 ? '0' : '') + n; }

    var wall = gallery.querySelector('.gallery__wall');
    var nav = gallery.querySelector('[data-gallery-nav]');
    var byId = {};
    var tiles = [].slice.call(gallery.querySelectorAll('.gallery__item')).map(function (li) {
      var id = li.getAttribute('data-project');
      var t = {
        li: li, id: id, kind: id,
        link: li.querySelector('.gallery__tile'),
        plate: li.querySelector('.gallery__plate'),
        cover: li.querySelector('.gallery__cover'),
        spot: li.querySelector('.gallery__spot'),
        row: document.getElementById('project-' + id),
        hover: false, focus: false, linked: false, current: false, awake: false,
        u: 0, v: 0, cu: 0, cv: 0, mx: 50, my: 35, sx: 50, sy: 35, tilting: false
      };
      byId[id] = t;
      return t;
    });
    if (!wall || !tiles.length) return;

    // Tilt, parallax and the moving spotlight: fine pointers, motion allowed, a healthy frame rate.
    function fancy() { return !P.reduced && !P.coarse && P.quality >= 0.5; }

    /* ---------- state: hot (a tile is hovered, focused or its row is) and awake (its cover plays) ---------- */

    function refresh(t) {
      var hot = t.hover || t.focus || t.linked;
      var awake = hot || t.current;
      t.li.classList.toggle('is-hot', hot);
      if (t.row) t.row.classList.toggle('is-linked', t.hover || t.focus);
      if (awake === t.awake) return;
      t.awake = awake;
      t.li.classList.toggle('is-awake', awake);
      P.emit('art-wake', { kind: t.kind, on: awake });
    }

    /* ---------- tilt, parallax, spotlight: one shared-loop subscription, only while something is moving ---------- */

    var unsub = null;
    function kick() { if (!unsub) unsub = P.frame(step); }

    function settle(t) {
      t.plate.style.transform = '';
      t.cover.style.transform = '';
      t.spot.style.removeProperty('--mx');
      t.spot.style.removeProperty('--my');
      t.li.classList.remove('is-tilting');
      t.tilting = false;
    }

    function step(dt) {
      var k = 1 - Math.exp(-dt / 150);
      var busy = false;
      tiles.forEach(function (t) {
        var live = t.hover && fancy();
        var tu = live ? t.u : 0, tv = live ? t.v : 0;
        t.cu += (tu - t.cu) * k;
        t.cv += (tv - t.cv) * k;
        t.sx += (t.mx - t.sx) * k * 1.6;
        t.sy += (t.my - t.sy) * k * 1.6;
        var moving = Math.abs(tu - t.cu) + Math.abs(tv - t.cv) > 0.004 || (live && Math.abs(t.mx - t.sx) + Math.abs(t.my - t.sy) > 0.15);
        if (!moving && !live) { if (t.tilting) settle(t); return; }
        if (!t.tilting) { t.tilting = true; t.li.classList.add('is-tilting'); }
        busy = busy || moving;
        t.plate.style.transform = 'perspective(900px) rotateX(' + r2(-t.cv * 2.4) + 'deg) rotateY(' + r2(t.cu * 3.2) + 'deg)';
        t.cover.style.transform = 'translate3d(' + r2(-t.cu * 6) + 'px,' + r2(-t.cv * 4) + 'px,0) scale(1.05)';
        t.spot.style.setProperty('--mx', r2(t.sx) + '%');
        t.spot.style.setProperty('--my', r2(t.sy) + '%');
      });
      if (!busy && unsub) { unsub(); unsub = null; }
    }

    function aim(t, event) {
      if (!fancy()) return;
      var box = t.plate.getBoundingClientRect();
      if (!box.width) return;
      var x = (event.clientX - box.left) / box.width, y = (event.clientY - box.top) / box.height;
      t.u = clamp(x * 2 - 1, -1, 1);
      t.v = clamp(y * 2 - 1, -1, 1);
      t.mx = clamp(x * 100, -20, 120);
      t.my = clamp(y * 100, -20, 120);
      kick();
    }

    tiles.forEach(function (t) {
      t.li.addEventListener('pointerenter', function (event) {
        if (event.pointerType === 'touch') return;
        t.hover = true;
        aim(t, event);
        t.sx = t.mx;   // the spotlight appears under the cursor, then follows it
        t.sy = t.my;
        refresh(t);
      });
      t.li.addEventListener('pointermove', function (event) { if (t.hover) aim(t, event); });
      t.li.addEventListener('pointerleave', function () {
        if (!t.hover) return;
        t.hover = false;
        t.u = t.v = 0;
        refresh(t);
        if (t.tilting) kick();
      });
      t.li.addEventListener('focusin', function (event) {
        var visible = true;
        try { visible = event.target.matches(':focus-visible'); } catch (error) { visible = true; }
        if (visible) { t.focus = true; refresh(t); }
      });
      t.li.addEventListener('focusout', function (event) {
        if (t.li.contains(event.relatedTarget)) return;
        t.focus = false;
        refresh(t);
      });
    });

    /* ---------- the carousel (below 1100 px): arrows, counter, arrow-key roving ---------- */

    var count = nav && nav.querySelector('[data-gallery-now]');
    var prev = nav && nav.querySelector('[data-gallery-step="-1"]');
    var next = nav && nav.querySelector('[data-gallery-step="1"]');
    var inView = false;
    var navQueued = false;

    function tileStep() { return tiles.length > 1 ? tiles[1].li.offsetLeft - tiles[0].li.offsetLeft : wall.clientWidth; }
    function scrolls() { return wall.scrollWidth > wall.clientWidth + 2; }

    function indexNow() {
      var max = wall.scrollWidth - wall.clientWidth, x = wall.scrollLeft;
      if (max <= 2) return 0;
      if (x >= max - 2) return tiles.length - 1;
      return clamp(Math.round(x / (tileStep() || 1)), 0, tiles.length - 1);
    }

    function syncNav() {
      navQueued = false;
      var carousel = scrolls();
      var i = indexNow();
      if (nav) {
        nav.hidden = !carousel;
        if (count) count.textContent = pad(i + 1);
        if (prev) prev.setAttribute('aria-disabled', String(wall.scrollLeft <= 2));
        if (next) next.setAttribute('aria-disabled', String(wall.scrollLeft >= wall.scrollWidth - wall.clientWidth - 2));
      }
      // Touch has no hover: the cover that is centered in the carousel is the one that plays.
      tiles.forEach(function (t, j) {
        var current = P.coarse && !P.reduced && carousel && inView && j === i;
        if (current === t.current) return;
        t.current = current;
        refresh(t);
      });
    }
    function queueNav() {
      if (navQueued) return;
      navQueued = true;
      window.requestAnimationFrame(syncNav);
    }

    wall.addEventListener('scroll', queueNav, { passive: true });
    window.addEventListener('resize', queueNav);
    if ('ResizeObserver' in window) new ResizeObserver(queueNav).observe(wall);

    [prev, next].forEach(function (button) {
      if (!button) return;
      button.addEventListener('click', function () {
        if (button.getAttribute('aria-disabled') === 'true') return;
        wall.scrollBy({ left: Number(button.getAttribute('data-gallery-step')) * tileStep(), behavior: P.reduced ? 'auto' : 'smooth' });
      });
    });

    wall.addEventListener('keydown', function (event) {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      var from = -1;
      tiles.forEach(function (t, i) { if (t.li.contains(document.activeElement)) from = i; });
      if (from < 0) return;
      var to = event.key === 'ArrowRight' ? from + 1 : event.key === 'ArrowLeft' ? from - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? tiles.length - 1 : -1;
      if (to < 0 || to >= tiles.length || to === from) return;
      event.preventDefault();
      tiles[to].link.focus();
    });

    /* ---------- first view: hanging the work (tiles that start below the fold arrive one after another) ---------- */

    // Armed only while the wall is still out of view, so nothing that is already on screen ever blinks.
    var arm = 'IntersectionObserver' in window && !P.reduced && (!P.drawn(gallery) || gallery.getBoundingClientRect().top > window.innerHeight);
    if (arm) gallery.classList.add('is-armed');
    var entered = !arm;
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          inView = entry.isIntersecting;
          if (inView && !entered) {
            entered = true;
            gallery.classList.add('is-in');
            window.setTimeout(function () { gallery.classList.remove('is-armed', 'is-in'); }, 1100);
          }
          queueNav();
        });
      }, { threshold: 0.25 }).observe(gallery);
    }

    /* ---------- the rest of the page: rows, hovered rows, the skills filter ---------- */

    P.on('project', function (detail) {
      var t = detail && byId[detail.id];
      if (t) t.li.classList.toggle('is-open', !!detail.open);
    });
    P.on('row-link', function (detail) {
      var t = detail && byId[detail.id];
      if (!t) return;
      t.linked = !!detail.on;
      refresh(t);
    });

    function applySkill(detail) {
      var skill = detail && detail.skill ? String(detail.skill).toLowerCase() : '';
      var any = false;
      tiles.forEach(function (t) {
        var tech = t.row ? (t.row.getAttribute('data-tech') || '').toLowerCase().split('|') : [];
        var hit = !!skill && tech.indexOf(skill) > -1;
        any = any || hit;
        t.li.classList.toggle('is-match', hit);
      });
      gallery.classList.toggle('has-skill', any);
    }
    P.on('skill', applySkill);
    var chosen = document.querySelector('[data-term][aria-pressed="true"]');
    if (chosen) applySkill({ skill: chosen.getAttribute('data-term') });
    tiles.forEach(function (t) { if (t.row && t.row.classList.contains('is-open')) t.li.classList.add('is-open'); });

    syncNav();
    gallery.setAttribute('data-fx-ready', '');
  }
}());
