/* js/fx/terminal.js — TERMINAL + DELIGHT. Three independent enhancements, each isolated so one failing
   never takes the others (or the static page) down:
     1. the theme switch reveals the new theme as a circle (View Transitions API),
     2. section headlines slide up line by line as they scroll into view,
     3. a small dev terminal (Ctrl+`, footer button, or palette) that answers from Portfolio.data.
   Classic script, no dependencies; every fact printed comes from Portfolio.data. */
(function () {
  'use strict';

  var P = window.Portfolio;
  if (!P || !P.data || !P.data.profile) return;

  var root = document.documentElement;
  var data = P.data;

  function $(selector, scope) { return (scope || document).querySelector(selector); }
  function $$(selector, scope) { return Array.prototype.slice.call((scope || document).querySelectorAll(selector)); }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  // A failing feature is reported (like the base does) but cannot stop the others.
  function guard(fn, mark) {
    try { fn(); } catch (error) {
      if (mark) mark.setAttribute('data-fx-failed', '');
      window.setTimeout(function () { throw error; });
    }
  }

  /* ---------- 1. Theme reveal: wrap Portfolio.applyTheme in a View Transition ---------- */

  function themeReveal() {
    if (typeof document.startViewTransition !== 'function') return;

    var original = P.applyTheme;
    var running = null;
    var wanted = null;   // the theme the in-flight transition is heading to

    function cleanup() {
      root.classList.remove('is-theme-vt');
      root.style.removeProperty('--vt-x');
      root.style.removeProperty('--vt-y');
      root.style.removeProperty('--vt-r');
    }

    // Circle center: the click that asked, else the theme toggle, else the masthead corner.
    function circle(point) {
      var w = window.innerWidth;
      var h = window.innerHeight;
      var x;
      var y;
      if (point && isFinite(point.x) && isFinite(point.y)) {
        x = point.x;
        y = point.y;
      } else {
        var button = $('[data-theme-toggle]');
        var box = button && button.getBoundingClientRect();
        if (box && box.width) { x = box.left + box.width / 2; y = box.top + box.height / 2; }
        else { x = w - 32; y = 28; }
      }
      return { x: x, y: y, r: Math.ceil(Math.hypot(Math.max(x, w - x), Math.max(y, h - y))) };
    }

    P.applyTheme = function (theme, point) {
      theme = theme === 'dark' ? 'dark' : 'light';
      function apply() { original.call(P, theme, point); }

      // A second request mid-flight: finish the first at once, then apply the latest plainly. A toggle that
      // read the not-yet-updated theme asks for the in-flight target again; that means "flip back".
      if (running) {
        if (P.theme !== wanted && theme === wanted) theme = wanted === 'dark' ? 'light' : 'dark';
        wanted = theme;
        try { running.skipTransition(); } catch (e) { /* already finished */ }
        running = null;
        cleanup();
        return apply();
      }
      if (theme === P.theme || P.reduced || P.saveData || P.quality < 0.6 || document.hidden) return apply();
      wanted = theme;

      var c = circle(point);
      root.style.setProperty('--vt-x', c.x.toFixed(1) + 'px');
      root.style.setProperty('--vt-y', c.y.toFixed(1) + 'px');
      root.style.setProperty('--vt-r', c.r + 'px');
      root.classList.add('is-theme-vt');

      var transition;
      try { transition = document.startViewTransition(function () { theme = wanted; apply(); }); } catch (e) { cleanup(); return apply(); }
      running = transition;
      function end() {
        if (running !== transition) return;
        running = null;
        cleanup();
      }
      transition.ready.catch(function () { /* skipped: expected when a second toggle arrives */ });
      transition.finished.then(end, end);
      // The callback is what really changes the theme; make sure it happened whatever the browser did.
      transition.updateCallbackDone.catch(function () { theme = wanted; if (P.theme !== theme) apply(); });
    };
  }

  /* ---------- 2. Headline reveal: lines slide up out of a mask as they enter the viewport ---------- */

  function headlines() {
    if (P.reduced || !('IntersectionObserver' in window)) return;

    var BLANK = '[ \t\r\n\f]'; // ASCII whitespace only: an NBSP stays inside its word
    var WORD = new RegExp('[^ \t\r\n\f]+', 'g');
    var SPLIT = new RegExp('(' + BLANK + '+)');
    var ONLY_BLANK = new RegExp('^' + BLANK + '+$');

    // Where each word starts in the plain text: [x, y] relative to the heading (one Range per word).
    function plainWords(heading) {
      var box = heading.getBoundingClientRect();
      var walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
      var out = [];
      var range = document.createRange();
      while (walker.nextNode()) {
        var node = walker.currentNode;
        var match;
        WORD.lastIndex = 0;
        while ((match = WORD.exec(node.nodeValue))) {
          range.setStart(node, match.index);
          range.setEnd(node, match.index + match[0].length);
          var rect = range.getBoundingClientRect();
          out.push([rect.left - box.left, rect.top - box.top]);
        }
      }
      return out;
    }

    function wrappedWords(heading) {
      var box = heading.getBoundingClientRect();
      return $$('.hl__w', heading).map(function (word) {
        var rect = word.getBoundingClientRect();
        return [rect.left - box.left, rect.top - box.top];
      });
    }

    // Wrap every word as <span.hl__w><span.hl__i>word</span></span>.
    function wrap(heading) {
      var walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
      var nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      nodes.forEach(function (node) {
        var fragment = document.createDocumentFragment();
        node.nodeValue.split(SPLIT).forEach(function (part) {
          if (!part) return;
          if (ONLY_BLANK.test(part)) { fragment.appendChild(document.createTextNode(part)); return; }
          var outer = el('span', 'hl__w');
          outer.appendChild(el('span', 'hl__i', part));
          fragment.appendChild(outer);
        });
        node.parentNode.replaceChild(fragment, node);
      });
      heading.classList.add('hl');
    }

    // Word boxes lose kerning at their edges (a comma before a space, say), so a wrapped line can run a
    // pixel or two wider than plain text. Close each gap exactly; give up if the lines would differ at all.
    function align(heading, plain) {
      var now = wrappedWords(heading);
      var words = $$('.hl__w', heading);
      if (now.length !== plain.length) return false;
      for (var i = 0; i < now.length; i += 1) {
        if (Math.abs(now[i][1] - plain[i][1]) > 2) return false;
      }
      for (var k = 0; k < now.length - 1; k += 1) {
        if (Math.abs(now[k + 1][1] - now[k][1]) > 2) continue; // last word of a line
        var gap = (plain[k + 1][0] - plain[k][0]) - (now[k + 1][0] - now[k][0]);
        if (Math.abs(gap) > 6) return false;
        if (Math.abs(gap) > 0.05) words[k].style.marginRight = gap.toFixed(2) + 'px';
      }
      return true;
    }

    function reveal(heading) {
      var line = -1;
      var top = null;
      var inLine = 0;
      var last = 0;
      $$('.hl__w', heading).forEach(function (word) {
        var y = word.offsetTop;
        if (top === null || Math.abs(y - top) > 4) { line += 1; top = y; inLine = 0; }
        var delay = line * 95 + inLine * 22 + (word.parentNode.tagName === 'EM' ? 80 : 0);
        word.firstChild.style.setProperty('--d', delay + 'ms');
        last = Math.max(last, delay);
        inLine += 1;
      });
      heading.classList.add('is-in');
      window.setTimeout(function () { heading.classList.add('is-done'); }, last + 900);
    }

    var revealObserver = null;
    var armed = [];

    // Measure, change, measure again: a headline whose lines would differ in any way is left as plain text.
    function armOne(heading) {
      if (heading.classList.contains('hl') || heading.getBoundingClientRect().top < window.innerHeight) return; // never touch what is in view
      var height = heading.getBoundingClientRect().height;
      var plain = plainWords(heading);
      var saved = heading.innerHTML;
      wrap(heading);
      if (align(heading, plain) && Math.abs(heading.getBoundingClientRect().height - height) <= 0.5) {
        armed.push(heading);
        revealObserver.observe(heading);
      } else {
        heading.innerHTML = saved;
        heading.classList.remove('hl');
      }
    }

    function setup() {
      revealObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          revealObserver.unobserve(entry.target);
          reveal(entry.target);
        });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0 });

      // Arm each headline only when it is a screen or two away, one at a time, in idle time.
      var armObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          armObserver.unobserve(entry.target);
          P.whenIdle(function () { guard(function () { armOne(entry.target); }); }, 500);
        });
      }, { rootMargin: '0px 0px 160% 0px', threshold: 0 });
      $$('.section__title').forEach(function (heading) { armObserver.observe(heading); });

      window.addEventListener('beforeprint', function () {
        armed.forEach(function (heading) { revealObserver.unobserve(heading); heading.classList.add('is-in', 'is-done'); });
      });
    }

    // After load and when idle: this must never compete with the first paint.
    function schedule() { P.whenIdle(function () { guard(setup); }, 600); }
    if (document.readyState === 'complete') schedule();
    else window.addEventListener('load', schedule);
  }

  /* ---------- 3. The terminal: a launcher here, the command engine in terminal-shell.js ---------- */

  function launcher(dialog) {
    var openers = $$('[data-terminal-open]');
    var here = document.currentScript && document.currentScript.src;       // the engine sits next to this file
    var src = here ? here.split('?')[0].replace(/[^/]*$/, 'terminal-shell.js') : 'js/fx/terminal-shell.js';
    var shell = null;
    var state = 'idle';        // idle -> loading -> ready | failed
    var waiting = [];
    var section = '';
    var hintTimer = 0;         // "Loading terminal..." after a short wait; must not outlive the load

    function fail() {
      state = 'failed';
      window.clearTimeout(hintTimer);
      waiting = [];
      dialog.setAttribute('data-fx-failed', '');
      openers.forEach(function (button) { button.hidden = true; });
      P.toast('The terminal could not load.');
    }

    function load(then) {
      if (state === 'ready') { then(shell); return; }
      if (state === 'failed') return;
      if (then) waiting.push(then);
      if (state === 'loading') return;
      state = 'loading';
      var script = document.createElement('script');
      script.src = src;
      script.onload = function () {
        try { shell = P.shell ? P.shell(dialog, section) : null; } catch (error) { shell = null; window.setTimeout(function () { throw error; }); }
        if (!shell) { fail(); return; }
        state = 'ready';
        var queued = waiting;
        waiting = [];
        queued.forEach(function (fn) { fn(shell); });
      };
      script.onerror = fail;
      document.head.appendChild(script);
    }

    // Likely soon (hovering the footer button, the palette open, the footer in sight): fetch quietly, do not open.
    function warm() { if (state === 'idle') load(null); }

    function open() {
      if (dialog.open || document.querySelector('dialog[open]')) return;
      // On a slow link the engine takes a moment: say so instead of staying silent.
      window.clearTimeout(hintTimer);
      if (state !== 'ready') hintTimer = window.setTimeout(function () { P.toast('Loading terminal...'); }, 350);
      load(function (api) { window.clearTimeout(hintTimer); api.open(); });
    }

    // Ctrl+` or Alt+` opens it. A bare printable key is never a page-wide shortcut (WCAG 2.1.4): the footer
    // button, the palette and #terminal are the other ways in.
    document.addEventListener('keydown', function (event) {
      if (event.defaultPrevented || event.repeat || event.isComposing) return;
      if (event.metaKey || event.shiftKey || !(event.ctrlKey !== event.altKey)) return;
      if (event.code !== 'Backquote' && event.key !== '`') return;
      if ($('dialog[open]')) return;
      event.preventDefault();
      open();
    });

    P.registerAction({
      id: 'open-terminal',
      group: 'Actions',
      label: 'Open terminal',
      hint: P.coarse ? 'in the footer' : 'shortcut: Ctrl + `',
      keywords: ['shell', 'console', 'cli', 'command line', 'dev', 'neofetch', 'sudo', 'easter egg'],
      run: open
    });

    P.on('palette', function (detail) { if (detail && detail.open) warm(); });
    P.on('section', function (detail) {
      section = detail && detail.id && detail.id !== 'top' ? '/' + detail.id : '';
      if (detail && detail.id === 'contact') P.whenIdle(warm, 1500);
    });

    // Shown last: if anything above failed, the button stays hidden and the footer is simply the plain footer.
    openers.forEach(function (button) {
      button.addEventListener('click', open);
      ['pointerenter', 'focus', 'touchstart'].forEach(function (type) { button.addEventListener(type, warm, { passive: true }); });
      button.hidden = false;
    });

    // #terminal in the address bar opens it (handy for sharing the egg).
    function fromHash() { if (window.location.hash === '#terminal') P.whenIdle(open, 300); }
    window.addEventListener('hashchange', fromHash);
    fromHash();
  }

  guard(themeReveal);
  guard(headlines);
  var dialogEl = $('[data-fx="terminal"]');
  if (dialogEl && typeof dialogEl.showModal === 'function') {
    guard(function () { launcher(dialogEl); }, dialogEl);
  }
}());
