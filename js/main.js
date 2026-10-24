/* Sagar M S — base behavior. Progressive enhancement only: every feature below improves a page
   that is already complete HTML + CSS. Classic script; relies on js/data.js and js/core.js. */
(function () {
  'use strict';

  var P = window.Portfolio;
  if (!P || !P.data || !P.data.profile) return;

  var root = document.documentElement;
  var healthy = true;

  function $(selector, scope) { return (scope || document).querySelector(selector); }
  function $$(selector, scope) { return Array.prototype.slice.call((scope || document).querySelectorAll(selector)); }

  function mq(query) {
    try { return window.matchMedia(query); } catch (e) { return { matches: false }; }
  }

  function listen(query, fn) {
    if (query.addEventListener) query.addEventListener('change', fn);
    else if (query.addListener) query.addListener(fn);
  }

  // A failing feature must not take the others down. If a critical one fails, `js-ready` is
  // withheld and the head failsafe falls back to the plain, fully visible page.
  function run(fn, critical) {
    try { fn(); } catch (error) {
      if (critical) healthy = false;
      if (window.console && console.error) console.error('[portfolio] ' + (fn.name || 'task'), error);
    }
  }

  /* One passive scroll/resize listener feeds every scroll-driven feature (scroll-spy, timeline). */
  var scrollTasks = [];
  var scrollQueued = false;

  function onScroll(fn) { scrollTasks.push(fn); }

  function flushScroll() {
    scrollQueued = false;
    scrollTasks.forEach(function (fn) { run(fn); });
  }

  function queueScroll() {
    if (scrollQueued) return;
    scrollQueued = true;
    window.requestAnimationFrame(flushScroll);
  }

  // Scroll handlers compare cached page offsets with scrollY. Offsets are re-measured (reads only, in one batch)
  // when the viewport or the page height changes, never inside a scroll frame.
  var measureTasks = [];
  var measureQueued = false;

  function onMeasure(fn) { measureTasks.push(fn); }

  // Offset-based, so a reveal transform that is still pending does not skew the numbers.
  function pageTop(el) {
    var y = 0;
    for (var node = el; node; node = node.offsetParent) y += node.offsetTop;
    return y;
  }

  function flushMeasure() {
    measureQueued = false;
    measureTasks.forEach(function (fn) { run(fn); });
    queueScroll();
  }

  function queueMeasure() {
    if (measureQueued) return;
    measureQueued = true;
    window.requestAnimationFrame(flushMeasure);
  }

  window.addEventListener('scroll', queueScroll, { passive: true });
  window.addEventListener('resize', queueMeasure);
  window.addEventListener('load', queueMeasure);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(queueMeasure);
  if ('ResizeObserver' in window) {
    // The page grows when a project opens or the pipeline stage lays out.
    new ResizeObserver(queueMeasure).observe(document.body);
  }

  /* ---------- Theme toggle ---------- */

  function initTheme() {
    var button = $('[data-theme-toggle]');
    if (!button) return;
    button.addEventListener('click', function (event) {
      var box = button.getBoundingClientRect();
      var origin = event.detail
        ? { x: event.clientX, y: event.clientY }
        : { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      // Looked up at click time on purpose: a module may have wrapped Portfolio.applyTheme.
      P.applyTheme(P.theme === 'dark' ? 'light' : 'dark', origin);
    });
  }

  /* ---------- Live Bangalore clock ---------- */

  // India observes no daylight saving, so a fixed +05:30 offset is exact (and avoids loading Intl time-zone data).
  function initClock() {
    var timeEl = $('[data-clock]');
    var wrap = timeEl && timeEl.closest('.chip__time-wrap');
    if (!timeEl || !wrap) return;

    function pad(n) { return (n < 10 ? '0' : '') + n; }

    function tick() {
      var ist = new Date(Date.now() + 330 * 60000);
      timeEl.textContent = pad(ist.getUTCHours()) + ':' + pad(ist.getUTCMinutes());
      window.setTimeout(tick, 60000 - (Date.now() % 60000) + 50); // re-sync at each minute boundary
    }
    wrap.hidden = false;
    tick();
  }

  /* ---------- Masthead: menu, scroll-spy, progress ---------- */

  function initMasthead() {
    var masthead = $('#masthead');
    var menuButton = $('[data-menu-toggle]');
    var index = $('#index');
    if (!masthead || !index) return;

    var behind = $$('main, .footer'); // made inert while the menu is open, so Tab cannot slip behind the overlay
    var openedAt = 0;

    function isOpen() { return index.classList.contains('is-open'); }

    function setMenu(open, restoreFocus) {
      if (open === isOpen()) return;
      index.classList.toggle('is-open', open);
      behind.forEach(function (el) { el.inert = open; });
      if (open) openedAt = window.pageYOffset;
      if (menuButton) {
        menuButton.setAttribute('aria-expanded', String(open));
        menuButton.setAttribute('aria-label', open ? 'Close menu' : 'Menu');
        if (open) { var first = $('.index__link', index); if (first) first.focus(); }
        else if (restoreFocus) menuButton.focus();
      }
    }

    // Tab and Shift+Tab cycle through the masthead while the menu is open.
    function trap(event) {
      if (event.key !== 'Tab' || !isOpen()) return;
      var stops = $$('a[href], button', masthead).filter(function (el) { return !el.hidden && el.offsetParent !== null; });
      if (!stops.length) return;
      var first = stops[0];
      var last = stops[stops.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      else if (!masthead.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
    }

    if (menuButton) {
      menuButton.addEventListener('click', function () { setMenu(!isOpen()); });
      index.addEventListener('click', function (event) { if (event.target.closest('a')) setMenu(false); });
      document.addEventListener('click', function (event) {
        // The dimmed page under the panel is a pseudo-element of the index, so a tap below the panel counts as outside.
        var below = event.target === index && event.clientY > index.getBoundingClientRect().bottom;
        if (isOpen() && (below || !masthead.contains(event.target))) setMenu(false);
      });
      document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && isOpen()) setMenu(false, true);
        else trap(event);
      });
      listen(mq('(min-width: 1100px)'), function () { setMenu(false); });
      // Any other way of moving through the page (palette jump, terminal, hash change) also puts the menu away.
      P.on('navigate', function () { setMenu(false); });
      P.on('palette', function (detail) { if (detail && detail.open) setMenu(false); });
      window.addEventListener('hashchange', function () { setMenu(false); });
    }

    var links = $$('.index__link', index);
    var sections = links.map(function (link) { return document.getElementById(link.getAttribute('href').slice(1)); });
    var tops = [];
    var docHeight = 0;
    var primed = false;

    // A section's heading sits one top padding below the section's own edge. Only the sections' own boxes are read,
    // never the headings inside them: a section that is not drawn yet (see "cv" in core.js) has no inner geometry,
    // and asking for it would lay the whole section out.
    function measure() {
      primed = true;
      tops = sections.map(function (section) {
        if (!section) return Infinity;
        var style = window.getComputedStyle(section);
        return pageTop(section) + (parseFloat(style.paddingTop) || 0) + (parseFloat(style.borderTopWidth) || 0);
      });
      docHeight = root.scrollHeight;
    }
    onMeasure(measure);

    var bar = $('.masthead__progress-bar', masthead);
    var currentNo = $('.masthead__current-no');
    var currentLabel = $('.masthead__current-label');
    var active = -2;

    function update() {
      if (!primed) measure();
      var y = window.pageYOffset;
      var scrollable = docHeight - window.innerHeight;
      if (bar) bar.style.transform = 'scaleX(' + (scrollable > 0 ? Math.min(1, y / scrollable).toFixed(4) : '0') + ')';

      // A long scroll with the menu open means the visitor has moved on: close it.
      if (isOpen() && Math.abs(y - openedAt) > 80) setMenu(false);

      var line = y + window.innerHeight * 0.45;
      var next = -1;
      tops.forEach(function (top, i) { if (top <= line) next = i; });
      if (window.innerHeight + y >= docHeight - 4) next = sections.length - 1;
      if (next === active) return;
      active = next;

      links.forEach(function (link, i) {
        if (i === next) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      });
      // Small screens name the section you are in; on the hero there is nothing to name.
      if (currentNo && currentLabel) {
        currentNo.textContent = next < 0 ? '' : $('.index__no', links[next]).textContent;
        currentLabel.textContent = next < 0 ? '' : links[next].lastChild.textContent;
      }
      P.emit('section', { id: next < 0 ? 'top' : links[next].getAttribute('href').slice(1) });
    }

    onScroll(update);
    return update; // first call happens after load (below), by which time every module has subscribed; it measures first
  }

  /* ---------- In-page links: one offset-aware scroll path ---------- */

  function initAnchors() {
    document.addEventListener('click', function (event) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      var link = event.target.closest('a[href^="#"]');
      if (!link) return;
      var id = link.getAttribute('href').slice(1);
      try { id = decodeURIComponent(id); } catch (e) { return; }
      var target = id && document.getElementById(id);
      if (!target) return;
      event.preventDefault();
      if (target.classList.contains('project')) openProject(target);
      P.scrollToSection(id);
    });
  }

  /* ---------- A hash set outside the page's own links ---------- */

  // The address bar and the history buttons make the browser scroll to the target itself, on a page where the sections
  // far below may still have placeholder heights (see "cv" in core.js). When that is so, the sections above the target
  // are drawn and the target is aligned again, with the browser's own rules (scroll-margin and scroll-padding).
  function initHashAim() {
    window.addEventListener('hashchange', function () {
      var id = '';
      try { id = decodeURIComponent(window.location.hash.slice(1)); } catch (e) { return; }
      var target = id && document.getElementById(id);
      if (target && P.materialize(target)) {
        try { target.scrollIntoView({ block: 'start', behavior: 'instant' }); } catch (e) { target.scrollIntoView(); }
      }
    });
  }

  /* ---------- Scroll reveal ---------- */

  function initReveal() {
    if (!('IntersectionObserver' in window) || P.reduced) return;
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.remove('reveal--pending');
        observer.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.04 });

    // Only blocks still below the fold are hidden, so nothing visible ever flashes. A section that starts below the fold
    // is judged by its own edge: nothing inside it is measured (that would draw it, see "cv" in core.js).
    try {
      var fold = window.innerHeight;
      $$('.reveal').forEach(function (el) {
        var section = el.closest('main > .section');
        if ((section && section.getBoundingClientRect().top > fold) || el.getBoundingClientRect().top > fold) {
          el.classList.add('reveal--pending');
          observer.observe(el);
        }
      });
    } catch (error) {
      $$('.reveal--pending').forEach(function (el) { el.classList.remove('reveal--pending'); });
      throw error;
    }
  }

  /* ---------- Projects index (accordion) ---------- */

  var openProject = function () {};

  function initProjects() {
    var items = $$('.project');
    var toggleAll = $('[data-projects-toggle]');
    // hidden="until-found" lets Ctrl+F open a collapsed panel; browsers without it get plain hidden.
    var canFind = 'onbeforematch' in document.body;
    var timers = [];

    function isOpen(item) { return item.classList.contains('is-open'); }

    function hide(panel) {
      if (canFind) panel.setAttribute('hidden', 'until-found');
      else panel.hidden = true;
    }

    function refresh() {
      if (toggleAll) toggleAll.textContent = items.every(isOpen) ? 'Collapse all' : 'Expand all';
    }

    function setOpen(item, open, instant) {
      var i = items.indexOf(item);
      var panel = $('.project__panel', item);
      if (isOpen(item) === open && !instant) return;
      window.clearTimeout(timers[i]);

      if (instant) {
        item.classList.add('is-instant');
        window.requestAnimationFrame(function () {
          window.requestAnimationFrame(function () { item.classList.remove('is-instant'); });
        });
      }
      if (open) {
        panel.removeAttribute('hidden');
        void panel.offsetHeight; // flush, so the 0fr -> 1fr transition starts from the collapsed state
      }
      item.classList.toggle('is-open', open);
      $('.project__toggle', item).setAttribute('aria-expanded', String(open));

      if (!open) {
        if (instant || P.reduced) hide(panel);
        else timers[i] = window.setTimeout(function () { hide(panel); }, 340);
      }
      refresh();
      P.emit('project', { id: item.getAttribute('data-project'), open: open });
    }

    items.forEach(function (item) {
      var button = $('.project__toggle', item);
      var panel = $('.project__panel', item);
      button.setAttribute('aria-expanded', String(isOpen(item))); // the markup ships expanded (no-JS state)
      if (!isOpen(item)) hide(panel);
      button.addEventListener('click', function () { setOpen(item, !isOpen(item)); });
      panel.addEventListener('beforematch', function () { setOpen(item, true, true); });
    });

    openProject = function (item) { setOpen(item, true); };

    if (toggleAll) {
      toggleAll.hidden = false;
      toggleAll.addEventListener('click', function () {
        var open = !items.every(isOpen);
        items.forEach(function (item) { setOpen(item, open); });
      });
      refresh();
    }

    // A link to #project-... (typed, shared, or followed from another page) opens that row, not just scrolls to it.
    function fromHash() {
      var id = '';
      try { id = decodeURIComponent(window.location.hash.slice(1)); } catch (e) { return; }
      var item = id && document.getElementById(id);
      if (item && items.indexOf(item) > -1) setOpen(item, true, true);
    }
    fromHash();
    window.addEventListener('hashchange', fromHash);
  }

  /* ---------- Skills -> work filter ---------- */

  function initSkills() {
    var skillsEl = $('.skills');
    var bar = $('[data-skillbar]');
    var status = $('[data-skill-status]');
    var linksBox = $('[data-skill-links]');
    var clearButton = $('[data-skill-clear]');
    var rows = $$('.project[data-tech], .entry[data-tech]');
    if (!skillsEl || !bar || !status || !linksBox || !clearButton || !rows.length) return;

    var idle = status.textContent;
    var names = [];
    var buttons = [];
    var current = null;
    var used = {}; // lower-case technology -> the rows that name it, built once from data-tech

    rows.forEach(function (row) {
      row.getAttribute('data-tech').toLowerCase().split('|').forEach(function (name) {
        (used[name] = used[name] || []).push(row);
      });
    });

    function find(skill) { return used[skill.toLowerCase()] || []; }

    function isProject(row) { return row.classList.contains('project'); }

    function canonical(skill) {
      for (var i = 0; i < names.length; i += 1) if (names[i].toLowerCase() === skill.toLowerCase()) return names[i];
      return skill;
    }

    function count(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

    function sentence(skill, hits) {
      if (!hits.length) return skill + ' is on my skills list, but it is not named in a specific project or role.';
      var projects = hits.filter(isProject).length;
      var parts = [];
      if (projects) parts.push(count(projects, 'project'));
      if (hits.length - projects) parts.push(count(hits.length - projects, 'role'));
      return skill + ' appears in ' + parts.join(' and ') + '.';
    }

    // Skills that appear in at least one project or role become toggles; the rest stay plain text.
    $$('[data-skill]').forEach(function (term) {
      var skill = term.getAttribute('data-skill');
      names.push(skill);
      if (!find(skill).length) return;
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'term';
      button.setAttribute('aria-pressed', 'false');
      button.setAttribute('data-term', skill);
      button.textContent = term.textContent;
      term.textContent = '';
      term.appendChild(button);
      buttons.push(button);
    });

    function clearPreview() { rows.forEach(function (row) { row.classList.remove('is-preview'); }); }

    // Clear hides itself: hand focus to the skill it was clearing (or the status line) so a keyboard or
    // screen-reader visitor keeps their place instead of dropping to the top of the document.
    function restoreFocus(skill) {
      var target = null;
      buttons.forEach(function (button) { if (skill && button.getAttribute('data-term') === skill) target = button; });
      if (!target) { status.setAttribute('tabindex', '-1'); target = status; }
      target.focus({ preventScroll: true });
    }

    function apply(detail) {
      var raw = detail && detail.skill ? String(detail.skill).trim() : '';
      var skill = raw ? canonical(raw) : null;
      var previous = current;
      var hadFocus = document.activeElement === clearButton;
      current = skill;
      clearPreview();

      rows.forEach(function (row) {
        row.classList.remove('is-match');
        var old = $('[data-badge]', row);
        if (old) old.parentNode.removeChild(old);
      });
      buttons.forEach(function (button) {
        button.setAttribute('aria-pressed', String(!!skill && button.getAttribute('data-term') === skill));
      });
      linksBox.textContent = '';
      clearButton.hidden = !skill;

      if (!skill) {
        status.textContent = idle;
        if (hadFocus) restoreFocus(previous);
        return;
      }

      var hits = find(skill);
      hits.forEach(function (row) {
        var title = $('.project__title, .entry__title', row);
        var link = document.createElement('a');
        var badge = document.createElement('span');

        link.href = '#' + row.id;
        link.textContent = title.textContent.trim();
        linksBox.appendChild(link);

        badge.className = 'badge';
        badge.setAttribute('data-badge', '');
        badge.textContent = 'Uses ' + skill;
        title.appendChild(badge);
        row.classList.add('is-match');
      });
      status.textContent = sentence(skill, hits);
    }

    skillsEl.addEventListener('click', function (event) {
      var button = event.target.closest('.term');
      if (!button) return;
      var skill = button.getAttribute('data-term');
      P.emit('skill', { skill: current === skill ? null : skill, source: 'skills' });
    });
    clearButton.addEventListener('click', function () { P.emit('skill', { skill: null, source: 'skills' }); });
    linksBox.addEventListener('click', function (event) {
      var link = event.target.closest('a');
      var row = link && document.getElementById(link.getAttribute('href').slice(1));
      if (row && isProject(row)) openProject(row);
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && current && !$('dialog[open]')) P.emit('skill', { skill: null, source: 'keyboard' });
    });

    // Hovering or focusing a skill previews where it is used, without selecting it.
    function preview(skill) {
      clearPreview();
      if (current || !skill) return;
      find(skill).forEach(function (row) { row.classList.add('is-preview'); });
    }
    skillsEl.addEventListener('pointerover', function (event) {
      if (event.pointerType !== 'mouse') return;
      var button = event.target.closest('.term');
      preview(button && button.getAttribute('data-term'));
    });
    skillsEl.addEventListener('pointerleave', clearPreview);
    skillsEl.addEventListener('focusin', function (event) {
      var button = event.target.closest('.term');
      preview(button && button.getAttribute('data-term'));
    });
    skillsEl.addEventListener('focusout', clearPreview);

    P.on('skill', apply);
    bar.hidden = false;
  }

  /* ---------- LeetCode dot matrix ---------- */

  // The figure itself ("100+") is real text in the markup and never changes; only the 100 dots light up, once the
  // block is mostly in view. Nothing animates when the block is already on screen, or under reduced motion.
  function initCountUp() {
    var block = $('[data-count-block]');
    var counter = block && $('[data-count]', block);
    var dots = block ? $$('.dots i', block) : [];
    if (!counter || !dots.length || P.reduced || !('IntersectionObserver' in window)) return;
    var section = block.closest('main > .section');
    if (!(section && section.getBoundingClientRect().top > window.innerHeight) && block.getBoundingClientRect().top < window.innerHeight) return;

    var target = Number(counter.getAttribute('data-count'));
    var lit = 0;
    var elapsed = 0;
    var DURATION = 1200;
    var stopFrame = function () {};
    var failsafe = 0;
    var finished = false;

    function show(n) {
      for (; lit < n && lit < dots.length; lit += 1) dots[lit].classList.add('is-on');
    }

    function finish() {
      if (finished) return;
      finished = true;
      window.clearTimeout(failsafe);
      stopFrame();
      observer.disconnect();
      block.classList.remove('is-armed');
    }

    // The unlit state is set now, while the block is off-screen, so the finished grid is never seen first.
    block.classList.add('is-armed');

    var observer = new IntersectionObserver(function (entries) {
      if (!entries[0].isIntersecting) return;
      observer.disconnect();
      failsafe = window.setTimeout(finish, DURATION + 2500);
      stopFrame = P.frame(function (dt) {
        elapsed += dt;
        var t = Math.min(1, elapsed / DURATION);
        show(Math.round(target * (1 - Math.pow(1 - t, 3))));
        if (t >= 1) finish();
      }, { el: block });
    }, { threshold: 0.8 });
    observer.observe(block);

    window.addEventListener('beforeprint', finish);
  }

  /* ---------- Experience timeline rail ---------- */

  function initTimeline() {
    var timeline = $('[data-timeline]');
    var entries = timeline ? $$('.entry', timeline) : [];
    if (!entries.length) return;

    var boxes = [];
    var written = []; // the last value each entry received: entries far above or below the line are not touched again

    // Entries are read only while their section is drawn (see "cv" in core.js); until then they keep their unlit start,
    // which is what an entry far below the reading line gets anyway. The section reports when it is drawn (initCv).
    function measure() {
      boxes = P.drawn(timeline) ? entries.map(function (entry) { return { top: pageTop(entry), height: entry.offsetHeight || 1 }; }) : [];
    }

    function update() {
      if (!boxes.length) return;
      var line = window.pageYOffset + window.innerHeight * 0.6;
      entries.forEach(function (entry, i) {
        var box = boxes[i];
        var done = P.reduced || box.top < line;
        var progress = (P.reduced ? 1 : Math.min(1, Math.max(0, (line - box.top) / box.height))).toFixed(3);
        var key = progress + (done ? 'L' : '-');
        if (written[i] === key) return;
        written[i] = key;
        entry.style.setProperty('--p', progress);
        entry.classList.toggle('is-lit', done);
      });
    }

    measure();
    onMeasure(measure);
    update();
    timeline.classList.add('is-drawing');
    onScroll(update);
  }

  /* ---------- Copy email ---------- */

  var uaPlatform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.userAgent || '';
  var isMac = /Mac|iPhone|iPad/.test(uaPlatform);
  var emailLink = $('[data-email]');
  var copyButton = $('[data-copy-email]');
  var copyTimer = 0;

  // Clipboard API first; a temporary textarea + execCommand where it is missing (file://, plain http).
  function copyText(text) {
    function legacy() {
      var previous = document.activeElement;
      var field = document.createElement('textarea');
      field.value = text;
      field.setAttribute('readonly', '');
      field.className = 'sr-only';
      document.body.appendChild(field);
      field.select();
      field.setSelectionRange(0, text.length);
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(field);
      if (previous && previous.focus) previous.focus();
      return ok ? Promise.resolve() : Promise.reject(new Error('copy failed'));
    }
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).catch(legacy);
    return legacy();
  }

  function markCopied() {
    if (!copyButton) return;
    var label = $('.copy__label', copyButton);
    copyButton.classList.add('is-copied');
    copyButton.setAttribute('aria-label', 'Email address copied');
    label.textContent = 'Copied';
    window.clearTimeout(copyTimer);
    copyTimer = window.setTimeout(function () {
      copyButton.classList.remove('is-copied');
      copyButton.setAttribute('aria-label', 'Copy email address');
      label.textContent = 'Copy';
    }, 2000);
  }

  function copyEmail() {
    if (!emailLink) return;
    var email = emailLink.getAttribute('data-email');
    copyText(email).then(
      function () { markCopied(); P.toast('Email address copied'); },
      function () {
        // Select the address so Ctrl+C / long-press finishes the job; the Email button stays the explicit mailto route.
        var range = document.createRange();
        range.selectNodeContents(emailLink);
        var selection = window.getSelection();
        if (selection) { selection.removeAllRanges(); selection.addRange(range); }
        P.toast('Press ' + (isMac ? 'Cmd' : 'Ctrl') + '+C to copy');
      }
    );
  }

  function initCopy() {
    if (!copyButton) return;
    copyButton.hidden = false;
    copyButton.addEventListener('click', copyEmail);
  }

  /* ---------- Command registry entries (sections, actions, links) ---------- */

  var registered = false;

  function registerActions() {
    if (registered) return;
    registered = true;
    var data = P.data;
    // Technology names are not section keywords: each skill and each project is its own searchable entry (below), so
    // "docker" lists Docker and the project using it, not four section jumps.
    var KEYWORDS = {
      about: ['bio', 'summary', 'who', 'languages', 'interests'],
      experience: ['work', 'jobs', 'career', 'intern'].concat(data.roles.map(function (role) { return role.org; })),
      projects: ['work', 'apps', 'case studies'],
      skills: ['stack', 'tech', 'tools', 'filter'],
      education: ['college', 'degree', 'gpa', 'school', 'polytechnic'],
      achievements: ['achievements', 'practice', 'credentials', 'leetcode', 'coding', 'certifications', 'certificates', 'coursework', 'codingbat'],
      contact: ['email', 'hire', 'reach', 'links']
    };

    $$('.index__link').forEach(function (link) {
      var id = link.getAttribute('href').slice(1);
      P.registerAction({
        id: 'go-' + id,
        group: 'Sections',
        label: link.lastChild.textContent,
        hint: $('.index__no', link).textContent,
        keywords: KEYWORDS[id],
        run: function () { P.scrollToSection(id); }
      });
      if (id === 'projects' && document.getElementById('how-i-ship')) {
        P.registerAction({
          id: 'go-how-i-ship',
          group: 'Sections',
          label: 'How I ship',
          hint: 'in Projects',
          keywords: ['deploy', 'pipeline', 'architecture'],
          run: function () { P.scrollToSection('how-i-ship'); }
        });
      }
    });

    if (emailLink) {
      P.registerAction({
        id: 'copy-email',
        group: 'Actions',
        label: 'Copy email address',
        hint: emailLink.getAttribute('data-email'),
        keywords: ['mail', 'clipboard'],
        run: copyEmail
      });
    }
    if (data.links && data.links.resume) {
      P.registerAction({
        id: 'open-resume',
        group: 'Actions',
        label: 'Open resume (PDF)',
        hint: 'new tab',
        keywords: ['cv', 'curriculum vitae', 'download', 'pdf', 'hire', 'recruiter'],
        run: function () { window.open(data.links.resume.url, '_blank', 'noopener,noreferrer'); }
      });
    }
    P.registerAction({
      id: 'toggle-theme',
      group: 'Actions',
      label: function () { return 'Switch to ' + (P.theme === 'dark' ? 'light' : 'dark') + ' theme'; },
      keywords: ['dark', 'light', 'mode', 'appearance'],
      run: function () { P.applyTheme(P.theme === 'dark' ? 'light' : 'dark'); }
    });

    if (emailLink) {
      P.registerAction({
        id: 'send-email',
        group: 'Elsewhere',
        label: 'Email',
        hint: 'opens your mail app',
        keywords: ['mailto', 'hire', 'contact'],
        run: function () { window.location.href = 'mailto:' + emailLink.getAttribute('data-email'); }
      });
    }
    $$('[data-link]').forEach(function (link) {
      P.registerAction({
        id: 'open-' + link.getAttribute('data-link').toLowerCase(),
        group: 'Elsewhere',
        label: link.getAttribute('data-link'),
        hint: link.hostname,
        keywords: ['profile', 'link'],
        run: function () { window.open(link.href, '_blank', 'noopener,noreferrer'); }
      });
    });

    // Searchable, not browsable: every skill and project is findable by name ("dock" -> Docker, Docker Compose and the
    // project that uses them), but they stay out of the list until something is typed. Built from Portfolio.data.
    var seenSkill = {};
    data.skills.forEach(function (group) {
      if (group.kind !== 'tech') return;
      group.items.forEach(function (name) {
        if (seenSkill[name]) return;
        seenSkill[name] = true;
        P.registerAction({
          id: 'skill-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          group: 'Skills',
          label: 'Skill: ' + name,
          hint: group.label,
          keywords: ['filter', 'uses'],
          queryOnly: true,
          run: function () {
            P.emit('skill', { skill: name, source: 'palette' });
            P.scrollToSection('skills');
          }
        });
      });
    });
    data.projects.forEach(function (project) {
      var row = document.getElementById('project-' + project.id);
      if (!row) return;
      P.registerAction({
        id: 'project-' + project.id,
        group: 'Projects',
        label: 'Project: ' + project.title,
        hint: project.dates,
        keywords: (project.tech || []).concat(['case study']),
        queryOnly: true,
        run: function () { openProject(row); P.scrollToSection(row.id); }
      });
    });
  }

  /* ---------- Command palette (Ctrl/Cmd + K) ---------- */

  function initPalette() {
    var dialog = $('#palette');
    if (!dialog || typeof dialog.showModal !== 'function') return;

    var input = $('.palette__input', dialog);
    var list = $('.palette__list', dialog);
    var empty = $('.palette__empty', dialog);
    var count = $('#palette-count');
    var GROUPS = ['Sections', 'Skills', 'Projects', 'Actions', 'Elsewhere'];
    var CAP = { Skills: 5, Projects: 4 };   // per-group cap while searching (best match first)
    var shown = [];
    var active = 0;

    function resolve(action) {
      return {
        group: action.group,
        label: typeof action.label === 'function' ? action.label() : action.label,
        hint: action.hint,
        keywords: action.keywords,
        queryOnly: action.queryOnly,
        run: action.run
      };
    }

    // Every query word must appear somewhere; label matches rank first.
    function rank(entry, words) {
      var label = entry.label.toLowerCase();
      var haystack = (label + ' ' + entry.keywords.join(' ') + ' ' + entry.hint + ' ' + entry.group).toLowerCase();
      var score = 0;
      for (var i = 0; i < words.length; i += 1) {
        if (haystack.indexOf(words[i]) === -1) return -1;
        score += label.indexOf(words[i]) === 0 ? 0 : label.indexOf(' ' + words[i]) > -1 ? 1 : label.indexOf(words[i]) > -1 ? 2 : 3;
      }
      return score;
    }

    // Groups are headings, not a ranking: the group holding the best match goes first (ties keep the fixed order),
    // so an exact "GitHub" or "Email" is the first row and Enter acts on it.
    function groupOrder(entries) {
      return GROUPS.map(function (group, g) {
        var best = Infinity;
        entries.forEach(function (entry) { if (entry.group === group && entry.score < best) best = entry.score; });
        return { group: group, g: g, best: best };
      }).sort(function (a, b) { return a.best - b.best || a.g - b.g; });
    }

    function render() {
      var query = input.value.trim().toLowerCase();
      var words = query ? query.split(/\s+/) : [];
      var entries = P.actions().map(resolve).map(function (entry, i) {
        entry.order = i;
        entry.score = rank(entry, words);
        return entry;
      }).filter(function (entry) { return entry.score > -1 && (words.length || !entry.queryOnly); });

      list.textContent = '';
      shown = [];
      groupOrder(entries).forEach(function (slot) {
        var group = slot.group;
        var g = slot.g;
        var inGroup = entries.filter(function (entry) { return entry.group === group; });
        if (!inGroup.length) return;
        inGroup.sort(function (a, b) { return a.score - b.score || a.order - b.order; });
        if (CAP[group] && inGroup.length > CAP[group]) inGroup = inGroup.slice(0, CAP[group]);

        var wrap = document.createElement('div');
        var heading = document.createElement('div');
        wrap.className = 'palette__group';
        wrap.setAttribute('role', 'group');
        wrap.setAttribute('aria-labelledby', 'palette-group-' + g);
        heading.className = 'palette__heading';
        heading.id = 'palette-group-' + g;
        heading.setAttribute('role', 'presentation');
        heading.textContent = group;
        wrap.appendChild(heading);

        inGroup.forEach(function (entry) {
          var i = shown.length;
          var item = document.createElement('div');
          var label = document.createElement('span');
          var aside = document.createElement('span');
          var hint = document.createElement('span');
          var enter = document.createElement('kbd');
          item.id = 'palette-option-' + i;
          item.className = 'palette__item';
          item.setAttribute('role', 'option');
          item.setAttribute('aria-selected', String(i === active));
          label.className = 'palette__label';
          label.textContent = entry.label;
          aside.className = 'palette__aside';
          hint.className = 'palette__hint';
          hint.textContent = entry.hint;
          enter.className = 'palette__enter';
          enter.setAttribute('aria-hidden', 'true');
          enter.textContent = '↵';
          aside.appendChild(hint);
          aside.appendChild(enter);
          item.appendChild(label);
          item.appendChild(aside);
          item.addEventListener('mousemove', function () { if (active !== i) setActive(i); });
          item.addEventListener('click', function () { choose(i); });
          wrap.appendChild(item);
          shown.push(entry);
        });
        list.appendChild(wrap);
      });

      active = Math.min(active, Math.max(shown.length - 1, 0));
      setActive(active);
      empty.hidden = shown.length > 0;
      input.setAttribute('aria-expanded', String(shown.length > 0));
      empty.textContent = 'No matches for “' + input.value.trim() + '”';
      count.textContent = shown.length ? shown.length + (shown.length === 1 ? ' result' : ' results') : 'No matches';
    }

    function setActive(i) {
      var options = $$('.palette__item', list);
      if (!options.length) { input.removeAttribute('aria-activedescendant'); return; }
      active = (i + options.length) % options.length;
      options.forEach(function (option, n) { option.setAttribute('aria-selected', String(n === active)); });
      input.setAttribute('aria-activedescendant', options[active].id);
      options[active].scrollIntoView({ block: 'nearest' });
    }

    // Close first so focus returns to the page, then run: a jump then moves focus to its section.
    function choose(i) {
      var entry = shown[i];
      if (!entry) return;
      dialog.close();
      window.setTimeout(function () { run(entry.run); }, 0);
    }

    function open() {
      if (dialog.open) return;
      registerActions();
      input.value = '';
      active = 0;
      render();
      // Touch screens: the dialog itself takes focus (the field is inert for that moment), so the on-screen keyboard
      // does not open over the list until the visitor taps the field.
      if (P.coarse) input.inert = true;
      dialog.showModal();
      if (P.coarse) { input.inert = false; dialog.tabIndex = -1; dialog.focus({ preventScroll: true }); } else input.focus();
      P.emit('palette', { open: true });
    }

    input.addEventListener('input', function () { active = 0; render(); });
    input.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowDown') { event.preventDefault(); setActive(active + 1); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(active - 1); }
      // Home and End move the caret while there is a query to edit; they jump through the list when it is empty (or with Ctrl/Cmd).
      else if ((event.key === 'Home' || event.key === 'End') && (!input.value || event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        setActive(event.key === 'Home' ? 0 : shown.length - 1);
      }
      else if (event.key === 'Enter') { event.preventDefault(); choose(active); }
    });
    dialog.addEventListener('click', function (event) { if (event.target === dialog) dialog.close(); });
    dialog.addEventListener('close', function () { P.emit('palette', { open: false }); });

    document.addEventListener('keydown', function (event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (dialog.open) dialog.close(); else open();
      }
    });

    $$('[data-palette-open]').forEach(function (button) {
      button.hidden = false;
      button.addEventListener('click', open);
    });
    $$('[data-kbd]').forEach(function (kbd) { kbd.textContent = isMac ? '⌘ K' : 'Ctrl K'; });
  }

  /* ---------- Effects that load on approach ---------- */

  // The two heaviest effect scripts (the skills graph and the project illustrations, about 90 KB) are not on the
  // load path: an element carrying data-fx-src fetches its script once it is within about a screen and a half of
  // the viewport. The stylesheets stay in the head (small, and they reserve each effect's layout), and the markup
  // is complete without the script. Without IntersectionObserver they load straight away.
  function initLazyFx() {
    var hooks = $$('[data-fx-src]');
    if (!hooks.length) return;

    function load(hook) {
      var script = document.createElement('script');
      script.src = hook.getAttribute('data-fx-src');
      script.async = true;
      // The stack map reserves its box before its script arrives; if the script never does, hand the space back.
      script.onerror = function () {
        var figure = $('[data-fx="constellation"]');
        if (figure && /constellation/.test(script.src)) figure.setAttribute('data-fx-failed', '');
      };
      document.body.appendChild(script);
    }

    if (!('IntersectionObserver' in window)) { hooks.forEach(load); return; }
    // The section that holds a hook is watched, not the hook: a section far below the viewport is not drawn (see "cv" in
    // core.js), and nothing inside an undrawn section intersects anything.
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        observer.unobserve(entry.target);
        (entry.target.hasAttribute('data-fx-src') ? [entry.target] : $$('[data-fx-src]', entry.target)).forEach(load);
      });
    }, { rootMargin: '1200px 0px' });
    var watched = [];
    hooks.forEach(function (hook) {
      var target = hook.closest('main > .section') || hook;
      if (watched.indexOf(target) < 0) { watched.push(target); observer.observe(target); }
    });
  }

  /* ---------- Sections drawn on approach ---------- */

  // Sections far below the viewport are not drawn until they come near (content-visibility, css/styles.css). When one is
  // drawn its real height replaces a placeholder, so every position measured against the page is read again.
  function initCv() {
    $$('main > .section, .footer').forEach(function (section) {
      section.addEventListener('contentvisibilityautostatechange', function (event) { if (!event.skipped) queueMeasure(); });
    });
  }

  /* ---------- Go ---------- */

  var measureSpy = function () {};

  // Synchronous and cheap: only what the first interaction can need.
  run(initTheme);
  run(function masthead() { measureSpy = initMasthead(); }, true);
  run(initProjects, true);
  run(initAnchors);
  run(initHashAim);
  run(initCopy);
  run(initPalette);
  run(initLazyFx);
  run(initCv);

  // Everything else waits for the load event, then runs as small idle tasks (never one long task).
  // Measuring starts after first paint, when layout is already computed, so nothing forces it.
  var later = [
    function measureScrollSpy() { measureSpy(); },
    initReveal,
    initTimeline,
    initCountUp,
    registerActions,
    initSkills,
    initClock
  ];

  function runLater() {
    if (!later.length) return;
    var fn = later.shift();
    P.whenIdle(function () { run(fn); runLater(); }, 300);
  }

  if (document.readyState === 'complete') runLater();
  else window.addEventListener('load', runLater);

  if (healthy) root.classList.add('js-ready');

  if (window.console && console.log) {
    console.log('%cSagar M S%c  Plain HTML, CSS and JavaScript, no frameworks. Say hello: 2005sagarms@gmail.com',
      'font: italic 600 14px Georgia, serif; color: #A9361A', 'font: 12px monospace');
  }
}());
