/* window.Portfolio: the small runtime shared by the base page (js/main.js) and the effect modules
   (js/fx/*.js). Classic script, no dependencies, safe to load when everything else fails. */
(function () {
  'use strict';

  var root = document.documentElement;
  var THEME_COLOR = { light: '#f4f0e8', dark: '#171411' };
  var GROUPS = ['Sections', 'Skills', 'Projects', 'Actions', 'Elsewhere'];

  /* ---------- Media queries (live getters) ---------- */

  function media(query) {
    try { return window.matchMedia(query); } catch (e) { return { matches: false }; }
  }

  function listen(query, fn) {
    if (query.addEventListener) query.addEventListener('change', fn);
    else if (query.addListener) query.addListener(fn);
  }

  var reducedQuery = media('(prefers-reduced-motion: reduce)');
  var coarseQuery = media('(hover: none), (pointer: coarse)');
  var darkQuery = media('(prefers-color-scheme: dark)');

  // A failing listener, loop or hook must not stop the others: it is logged with where it came from.
  function report(where, error) {
    if (window.console && console.error) console.error('[portfolio] ' + where, error);
  }

  /* ---------- Events ---------- */

  var handlers = {};

  function on(name, fn) {
    if (typeof fn !== 'function') return;
    (handlers[name] = handlers[name] || []).push(fn);
  }

  function off(name, fn) {
    var list = handlers[name];
    var i = list ? list.indexOf(fn) : -1;
    if (i > -1) list.splice(i, 1);
  }

  function emit(name, detail) {
    (handlers[name] || []).slice().forEach(function (fn) {
      try { fn(detail); } catch (error) { report('"' + name + '" listener', error); }
    });
  }

  /* ---------- Theme ---------- */

  var tokenCache = null;

  function currentTheme() { return root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'; }

  function commitTheme(theme, persist, silent) {
    theme = theme === 'dark' ? 'dark' : 'light';
    root.setAttribute('data-theme', theme);
    tokenCache = null;
    if (persist) {
      try { localStorage.setItem('theme', theme); } catch (e) { /* storage blocked: the choice lasts for this visit */ }
    }
    Array.prototype.forEach.call(document.querySelectorAll('meta[name="theme-color"]'), function (meta) {
      meta.setAttribute('content', THEME_COLOR[theme]);
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-theme-toggle]'), function (button) {
      button.setAttribute('aria-pressed', String(theme === 'dark'));
    });
    if (!silent) emit('theme', { theme: theme });
  }

  // `origin` ({x, y} client coordinates of the toggle) is unused here; modules that wrap this
  // function (View Transitions, say) read it, then call the original.
  function applyTheme(theme, origin) { // eslint-disable-line no-unused-vars
    commitTheme(theme, true, false);
  }

  function storedTheme() {
    try { return localStorage.getItem('theme'); } catch (e) { return null; }
  }

  // Follow the OS live until the visitor makes an explicit choice.
  listen(darkQuery, function (event) {
    if (!storedTheme()) commitTheme(event.matches ? 'dark' : 'light', false, false);
  });

  function tokens() {
    if (!tokenCache) {
      var style = window.getComputedStyle(root);
      var read = function (name) { return style.getPropertyValue(name).trim(); };
      tokenCache = {
        theme: currentTheme(),
        ink: read('--ink'),
        ink2: read('--ink-2'),
        muted: read('--ink-3'),
        paper: read('--paper'),
        paper2: read('--paper-2'),
        line: read('--rule'),
        accent: read('--accent'),
        onAccent: read('--on-accent'),
        inkRgb: read('--ink-rgb'),
        paperRgb: read('--paper-rgb')
      };
    }
    var copy = {};
    Object.keys(tokenCache).forEach(function (key) { copy[key] = tokenCache[key]; });
    return copy;
  }

  /* ---------- Shared frame loop ---------- */

  var subs = [];
  var rafId = 0;
  var lastTime = 0;
  var emaCost = 0;
  var emaDelta = 16.7;
  var measured = 0;
  var quality = 1;
  var LOW_TIER = 0.7; // below this: no grain overlay, effect loops capped at 30 fps, pointer-driven extras may stand down

  // Weak or data-saving devices start calmer; the measured loop then adjusts either way.
  if ((navigator.connection && navigator.connection.saveData) ||
      (navigator.deviceMemory && navigator.deviceMemory <= 2) ||
      (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2)) {
    quality = 0.7;
  }

  function syncTier() { root.classList.toggle('is-lowfx', quality < LOW_TIER); }

  // There is deliberately no load-time benchmark: a synthetic loop on a busy main thread mislabels fast machines.
  // The tier follows real frame cost (see measure) and can rise again as soon as frames are healthy.
  syncTier();

  // The frames around a theme change (view transition, new poster, restyle of the whole page) are not a verdict on
  // the machine: they are left out of the average for a moment.
  var settleUntil = 0;
  on('theme', function () {
    settleUntil = window.performance.now() + 700;
    emaCost = 0;
    emaDelta = 16.7;
  });

  var visibility = 'IntersectionObserver' in window
    ? new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        subs.forEach(function (sub) {
          if (sub.el !== entry.target) return;
          sub.visible = entry.isIntersecting;
          if (!sub.visible) sub.last = 0;
        });
      });
      schedule();
    })
    : null;

  function hasWork() {
    return subs.some(function (sub) { return sub.visible; });
  }

  function schedule() {
    if (rafId || document.hidden || !hasWork()) return;
    lastTime = 0;
    rafId = window.requestAnimationFrame(loop);
  }

  function drop(sub) {
    var i = subs.indexOf(sub);
    if (i < 0) return;
    subs.splice(i, 1);
    if (sub.el && visibility && !subs.some(function (other) { return other.el === sub.el; })) visibility.unobserve(sub.el);
  }

  // Down fast, up slowly: a machine that drops frames gets cheaper effects within a second, and only a long
  // calm stretch brings the detail back.
  function measure(cost, delta) {
    if (window.performance.now() < settleUntil) return;
    emaCost = emaCost * 0.8 + cost * 0.2;
    emaDelta = emaDelta * 0.8 + delta * 0.2;
    measured += 1;
    // Pressure 1 = 6 ms of script per frame or an average frame slower than ~36 fps. It is judged every 6 frames, every 3
    // when frames take twice that: a machine that is far behind should not spend a second of long frames finding out.
    var pressure = Math.max(emaCost / 6, emaDelta / 28);
    if (measured % (pressure > 2 ? 3 : 6)) return;
    if (pressure > 1) quality = Math.max(0.4, quality - 0.05 * Math.min(pressure, 3));
    else if (pressure < 0.7) quality = Math.min(1, quality + 0.02);
    syncTier();
  }

  function loop(time) {
    rafId = 0;
    if (document.hidden) return;
    var started = window.performance.now();
    var delta = lastTime ? Math.min(time - lastTime, 100) : 16.7;
    var ran = false;
    lastTime = time;

    subs.slice().forEach(function (sub) {
      if (!sub.visible) return;
      // On the low tier every loop is held to 30 fps: style, layout and paint cost per frame halves.
      var interval = quality < LOW_TIER ? Math.max(sub.interval, 1000 / 30) : sub.interval;
      if (interval && sub.last && time - sub.last < interval - 1.5) return;
      var elapsed = sub.last ? Math.min(time - sub.last, 100) : delta;
      sub.last = time;
      ran = true;
      try { sub.fn(elapsed, time); } catch (error) {
        drop(sub);
        report('frame loop', error);
      }
    });

    if (ran) measure(window.performance.now() - started, delta);
    if (hasWork()) rafId = window.requestAnimationFrame(loop);
    else lastTime = 0;
  }

  document.addEventListener('visibilitychange', function () { if (!document.hidden) schedule(); });

  function frame(fn, options) {
    options = options || {};
    var sub = {
      fn: fn,
      el: options.el || null,
      interval: options.fps > 0 ? 1000 / options.fps : 0,
      visible: !(options.el && visibility),
      last: 0
    };
    subs.push(sub);
    if (sub.el && visibility) visibility.observe(sub.el);
    schedule();
    return function unsubscribe() { drop(sub); };
  }

  /* ---------- Command registry ---------- */

  var actions = [];

  function registerAction(action) {
    if (!action || !action.id || typeof action.run !== 'function') return;
    var entry = {
      id: String(action.id),
      group: GROUPS.indexOf(action.group) > -1 ? action.group : 'Actions',
      label: action.label || String(action.id),
      hint: action.hint || '',
      keywords: action.keywords || [],
      queryOnly: !!action.queryOnly,   // listed only once the visitor has typed something
      run: action.run
    };
    for (var i = 0; i < actions.length; i += 1) {
      if (actions[i].id === entry.id) { actions[i] = entry; return; }
    }
    actions.push(entry);
  }

  /* ---------- Toast, scrolling, idle ---------- */

  var toastTimer = 0;

  function toast(message) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () { el.classList.remove('is-visible'); }, 2400);
  }

  // A module that changes the page height after load (the "How I ship" stage) registers here, so a jump
  // is measured against the final layout instead of one that is about to grow.
  var preparers = [];

  function prepare(fn) {
    if (typeof fn === 'function') preparers.push(fn);
  }

  // Where an element sits on the page. offsetTop ignores transforms, so a heading that is still mid-reveal
  // (shifted a few pixels by its entrance) measures the same as one that has settled.
  function destination(el, offset) {
    var y = 0;
    for (var node = el; node; node = node.offsetParent) y += node.offsetTop;
    return Math.max(0, y - offset);
  }

  /* Sections that are not drawn yet.
     css/styles.css leaves the sections far below the viewport undrawn (content-visibility: auto: no style, layout or
     paint) until they are within a screen or so of it, which keeps the first screen and every web-font swap cheap. An
     undrawn section only has a placeholder height, and nothing inside it has a position, so code that aims at an exact
     spot asks first: drawn() says whether an element has real geometry, materialize() draws the sections above a target
     once and keeps them drawn (data-cv="done"). Without support, without .js or while the page opens at a #deep-link,
     a reload or back/forward (css leaves the sections alone then) every section counts as drawn. */
  var SECTION_SELECTOR = 'main > .section, .footer';
  var skippable = false;
  try { skippable = !!(window.CSS && CSS.supports && CSS.supports('content-visibility', 'auto')); } catch (e) { skippable = false; }

  function drawn(el) {
    if (!skippable || !el) return true;
    var probe = el.matches && el.matches(SECTION_SELECTOR) ? el.firstElementChild : el;
    if (!probe || !probe.checkVisibility) return true;
    try { return probe.checkVisibility({ contentVisibilityAuto: true }); } catch (e) { return true; }
  }

  // Returns true when it had to draw something.
  function materialize(target) {
    var holder = skippable && target && target.closest ? target.closest(SECTION_SELECTOR) : null;
    if (!holder || !root.classList.contains('js') || root.classList.contains('no-cv')) return false;
    var all = document.querySelectorAll(SECTION_SELECTOR);
    var changed = false;
    for (var i = 0; i < all.length; i += 1) {
      if (all[i].getAttribute('data-cv') !== 'done') { all[i].setAttribute('data-cv', 'done'); changed = true; }
      if (all[i] === holder) break;
    }
    return changed;
  }

  // Late layout changes (a stylesheet or the "How I ship" stage arriving mid-scroll) can move the target after the
  // jump was aimed. Once the scroll has come to rest on the aimed spot, it is re-aimed once; a visitor who has
  // scrolled somewhere else in the meantime is left alone.
  function settle(anchor, offset, aimed) {
    var timer = 0, listening = false;
    function check() {
      window.removeEventListener('scrollend', check);
      window.clearTimeout(timer);
      var now = destination(anchor, offset);
      if (Math.abs(now - aimed) > 3 && Math.abs(window.pageYOffset - aimed) <= 3) {
        window.scrollTo({ top: now, behavior: 'auto' });
      }
    }
    if (reducedQuery.matches) { window.requestAnimationFrame(check); return; }
    if ('onscrollend' in window) { window.addEventListener('scrollend', check); listening = true; }
    timer = window.setTimeout(function () {
      if (listening) window.removeEventListener('scrollend', check);
      check();
    }, 1400);
  }

  // Offset-aware scroll: sections land on their top rule, just under the sticky masthead.
  function scrollToSection(id) {
    id = String(id || '').replace(/^#/, '');
    var target = document.getElementById(id);
    if (!target) return;
    materialize(target);
    preparers.forEach(function (fn) {
      try { fn(); } catch (error) { report('prepare hook', error); }
    });
    emit('navigate', { id: id });
    var anchor = (target.matches('section') && target.querySelector('.section__head')) || target;
    var masthead = document.getElementById('masthead');
    var offset = (masthead ? masthead.offsetHeight : 0) + 16;
    var top = destination(anchor, offset);

    window.scrollTo({ top: top, behavior: reducedQuery.matches ? 'auto' : 'smooth' });
    settle(anchor, offset, top);
    try {
      if (window.location.hash !== '#' + id) window.history.pushState(null, '', '#' + id);
    } catch (e) { /* history API unavailable: skip the hash, the scroll already happened */ }

    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  }

  function whenIdle(fn, timeout) {
    if (window.requestIdleCallback) window.requestIdleCallback(fn, { timeout: timeout || 1200 });
    else window.setTimeout(fn, 50);
  }

  /* ---------- Public API ---------- */

  var Portfolio = {
    data: window.PORTFOLIO_DATA || {},
    on: on,
    off: off,
    emit: emit,
    applyTheme: applyTheme,
    frame: frame,
    // Touch screens render canvases and SVG art at 1x: the pixel count, not the sharpness, is what costs frames there.
    dpr: function (max) {
      var cap = max === undefined ? 1.75 : max;
      if (coarseQuery.matches) cap = Math.min(cap, 1);
      return Math.min(window.devicePixelRatio || 1, cap);
    },
    tokens: tokens,
    registerAction: registerAction,
    actions: function () { return actions.slice(); },
    prepare: prepare,
    drawn: drawn,
    materialize: materialize,
    scrollToSection: scrollToSection,
    toast: toast,
    whenIdle: whenIdle
  };

  Object.defineProperties(Portfolio, {
    reduced: { enumerable: true, get: function () { return reducedQuery.matches; } },
    coarse: { enumerable: true, get: function () { return coarseQuery.matches; } },
    saveData: { enumerable: true, get: function () { return !!(navigator.connection && navigator.connection.saveData); } },
    theme: { enumerable: true, get: currentTheme },
    quality: { enumerable: true, get: function () { return quality; } }
  });

  window.Portfolio = Portfolio;

  // Sync aria-pressed and the theme-color metas with the theme the head script already chose.
  commitTheme(currentTheme(), false, true);

  // Deferred scripts all run before DOMContentLoaded, so every module has subscribed by then.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { emit('ready'); });
  else whenIdle(function () { emit('ready'); });
}());
