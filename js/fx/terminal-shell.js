/* js/fx/terminal-shell.js — the terminal's command engine. js/fx/terminal.js fetches this file the first time the
   terminal is wanted (Ctrl+backtick, the footer button, the palette, #terminal) or when that looks likely, so the visitors
   who never open it never download it. Every fact printed comes from Portfolio.data. */
(function () {
  'use strict';

  var P = window.Portfolio;
  if (!P || !P.data || !P.data.profile) return;

  var data = P.data;

  function $(selector, scope) { return (scope || document).querySelector(selector); }
  function $$(selector, scope) { return Array.prototype.slice.call((scope || document).querySelectorAll(selector)); }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function terminal(dialog, section) {
    var log = $('.tty__log', dialog);
    var form = $('.tty__form', dialog);
    var input = $('.tty__input', dialog);
    var promptText = $('.tty__ps-text', dialog);
    var promptLabel = $('.tty__ps-label', dialog);
    var ghostEl = $('.tty__ghost', dialog);
    var chipsEl = $('.tty__chips', dialog);
    var closeButton = $('.tty__close', dialog);
    var tabButton = $('.tty__tab', dialog);
    var bar = $('.tty__bar', dialog);
    if (!log || !form || !input || !promptText || !ghostEl || !chipsEl || !closeButton || !bar) return;

    var links = data.links;
    var profile = data.profile;

    var state = { mode: 'cmd', busy: false, closing: false, greeted: false, ran: false };
    var timers = [];
    var afterClose = null;
    var history = [];
    var cursor = 0;
    var draft = '';
    var ghost = '';
    var block = null;
    var pendingAuth = null; // the "authenticating" line of a sudo prompt that has not resolved yet
    var seq = 0;
    var listing = null; // last Tab-completion list printed, so a third Tab does not print it again
    var cwd = section || ''; // the section being read, shown in the title bar like a working directory
    var holdCwd = 0;     // until this time, scroll-spy section events do not move the working directory
    var whoEl = $('.tty__who', dialog);

    try { history = JSON.parse(window.sessionStorage.getItem('term.history')) || []; } catch (e) { history = []; }
    history = Array.isArray(history) ? history.filter(function (item) { return typeof item === 'string'; }).slice(-50) : [];
    cursor = history.length;

    /* ---------- Output helpers ---------- */

    function later(fn, ms) {
      var id = window.setTimeout(function () {
        timers.splice(timers.indexOf(id), 1);
        fn();
      }, ms);
      timers.push(id);
      return id;
    }

    function stopTimers() {
      timers.forEach(function (id) { window.clearTimeout(id); });
      timers = [];
    }

    function startBlock() {
      block = el('div', 't-block');
      seq = 0;
      log.appendChild(block);
      while (log.children.length > 140) log.removeChild(log.firstChild);
      return block;
    }

    function resume(target) { block = target; seq = 0; }

    function add(node) {
      node.style.setProperty('--i', String(seq));
      seq += 1;
      block.appendChild(node);
      return node;
    }

    function S(text, className) { return el('span', className, text); }

    function A(url, text) {
      var a = el('a', 't-a', text);
      a.href = url;
      if (/^https?:/.test(url) || /\.pdf$/i.test(url)) {   // profiles and the resume PDF open in a new tab
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.appendChild(el('span', 'sr-only', ' (opens in a new tab)'));
      }
      return a;
    }

    function fill(parent, parts) {
      [].concat(parts).forEach(function (part) {
        if (part === null || part === undefined) return;
        parent.appendChild(typeof part === 'string' ? document.createTextNode(part) : part);
      });
      return parent;
    }

    // A line made of text and spans: L(['Type ', S('help', 't-acc')], 't-dim').
    function L(parts, className) {
      return add(fill(el('div', 't-line' + (className ? ' ' + className : '')), parts === '' ? [] : parts));
    }

    function gap() { return add(el('div', 't-line t-gap')); }

    function bullet(text) { return add(el('div', 't-line t-li', text)); }

    function kv(key, value, keyClass, width) {
      var row = el('div', 't-line t-kv');
      if (width) row.style.setProperty('--kw', width);
      if (parseInt(width, 10) > 12) row.className += ' t-kv--wide'; // long keys stack above their value on phones
      row.appendChild(el('span', 't-k' + (keyClass ? ' ' + keyClass : ''), key));
      row.appendChild(fill(el('span', 't-v'), value));
      return add(row);
    }

    function scrollEnd(target, instant) {
      var max = log.scrollHeight - log.clientHeight;
      if (max <= 0) return;
      var top = max;
      // A tall answer is read from its first line, not its last.
      if (target && target.offsetHeight > log.clientHeight - 40) top = Math.min(max, Math.max(0, target.offsetTop - 16));
      log.scrollTo({ top: top, behavior: (instant || P.reduced || !dialog.open) ? 'auto' : 'smooth' });
    }

    function echo(prompt, text) {
      var b = startBlock();
      var row = el('div', 't-cmd');
      row.appendChild(el('span', 't-ps', prompt + ' '));
      row.appendChild(document.createTextNode(text));
      b.appendChild(row);
      return b;
    }

    /* ---------- Facts, formatted ---------- */

    function techGroups() { return data.skills.filter(function (group) { return group.kind === 'tech'; }); }

    function allSkills() {
      return techGroups().reduce(function (all, group) { return all.concat(group.items); }, []);
    }

    function pick(names) {
      var known = allSkills();
      return names.filter(function (name) { return known.indexOf(name) > -1; });
    }

    function monthsSince(label) {
      var match = /^([A-Za-z]{3})\w*\s+(\d{4})$/.exec(label || '');
      var index = match ? 'jan feb mar apr may jun jul aug sep oct nov dec'.split(' ').indexOf(match[1].toLowerCase()) : -1;
      if (index < 0) return null;
      var now = new Date();
      return Math.max(0, (now.getFullYear() - Number(match[2])) * 12 + now.getMonth() - index);
    }

    function uptime() {
      var n = monthsSince(profile.since);
      if (n === null) return 'since ' + profile.since;
      var text = n < 1 ? 'under a month' : n === 1 ? '1 month' : n < 24 ? n + ' months' : Math.floor(n / 12) + ' years, ' + (n % 12) + ' months';
      return text + ' (since ' + profile.since + ')';
    }

    function findProject(query) {
      var q = String(query || '').toLowerCase();
      var n = parseInt(q, 10);
      var found = null;
      data.projects.forEach(function (project) {
        if (found) return;
        if (String(n) === q && project.no === n) found = project;
        else if (project.id === q || (q.length > 2 && project.title.toLowerCase().indexOf(q) > -1)) found = project;
      });
      return found;
    }

    function sectionIds() {
      var ids = ['top'].concat(data.sections.map(function (section) { return section.id; }));
      if (document.getElementById('how-i-ship')) ids.push('how-i-ship');
      return ids;
    }

    /* ---------- Commands ---------- */

    var CMDS = {};
    var ORDER = [];
    var ALIAS = {
      '?': 'help', man: 'help', ll: 'ls', dir: 'ls', cd: 'goto', cls: 'clear', quit: 'exit', logout: 'exit', bye: 'exit',
      cert: 'certs', certifications: 'certs', edu: 'education', exp: 'experience', work: 'experience',
      project: 'projects', skill: 'skills', repos: 'links', mail: 'contact', hello: 'whoami', hi: 'whoami', cv: 'resume'
    };

    function def(name, usage, desc, run, extra) {
      var entry = { name: name, usage: usage, desc: desc, run: run };
      Object.keys(extra || {}).forEach(function (key) { entry[key] = extra[key]; });
      CMDS[name] = entry;
      ORDER.push(name);
    }

    function visibleNames() { return ORDER.filter(function (name) { return !CMDS[name].hidden; }); }

    function has(object, key) { return Object.prototype.hasOwnProperty.call(object, key); }

    function lookup(word) {
      var name = String(word || '').toLowerCase();
      if (has(ALIAS, name)) name = ALIAS[name];
      return has(CMDS, name) ? CMDS[name] : null;
    }

    function usage(name, extra) {
      L([S('usage: ', 't-dim'), CMDS[name].usage].concat(extra ? [S('   ' + extra, 't-dim')] : []));
    }

    function levenshtein(a, b) {
      var row = [];
      var i;
      var j;
      for (j = 0; j <= b.length; j += 1) row[j] = j;
      for (i = 1; i <= a.length; i += 1) {
        var prev = row[0];
        row[0] = i;
        for (j = 1; j <= b.length; j += 1) {
          var tmp = row[j];
          row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
          prev = tmp;
        }
      }
      return row[b.length];
    }

    function notFound(word) {
      var lower = word.toLowerCase();
      var limit = lower.length <= 4 ? 1 : 2;
      var best = null;
      var score = limit + 1;
      visibleNames().forEach(function (name) {
        var d = levenshtein(lower, name);
        if (d < score) { score = d; best = name; }
      });
      var line = [S('command not found: ' + word, 't-err'), best ? ' - did you mean ' : ' - try ', S(best || 'help', 't-acc')];
      if (best) line.push('? Or try help');
      L(line);
    }

    // -- help
    def('help', 'help [command]', 'list commands', function (args) {
      if (args[0]) {
        var cmd = lookup(args[0]);
        if (!cmd) return notFound(args[0]);
        L(S(cmd.usage, 't-h'));
        L(cmd.desc, 't-dim');
        return undefined;
      }
      L('Commands', 't-h');
      visibleNames().forEach(function (name) {
        var cmd = CMDS[name];
        kv(cmd.usage, cmd.desc, 't-acc', '16ch');
      });
      gap();
      L(['Tab completes. ', S('↑ ↓', 't-acc'), ' recall. Ctrl+L clears. Esc closes.'], 't-dim');
      L('A few commands are not listed. Poke around.', 't-dim');
      return undefined;
    }, { args: function () { return visibleNames(); } });

    // -- identity
    def('whoami', 'whoami', 'who is this?', function () {
      L(profile.name, 't-h');
      L(profile.role + ' at ' + profile.employer + ' since ' + profile.since + '. ' + profile.location + '.');
      L(profile.tagline, 't-dim');
    });

    function printAbout() {
      L(profile.summary);
      gap();
      kv('Based in', profile.location, null, '10ch');
      kv('Languages', profile.languages.join(', '), null, '10ch');
      kv('Interests', data.interests.join(', '), null, '10ch');
    }
    def('about', 'about', 'summary, languages, interests', printAbout);

    def('experience', 'experience', 'roles and what I did in them', function () {
      data.roles.forEach(function (role, i) {
        if (i) gap();
        L([S(role.title, 't-h'), ' at ', S(role.org, 't-h')]);
        L(role.dates + (role.note ? ' · ' + role.note : ''), 't-dim');
        role.bullets.forEach(bullet);
        L('Tech: ' + role.tech.join(', '), 't-dim');
      });
    });

    function repoLink(project) { return A(project.repo, project.repo.replace('https://', '')); }

    function printProjectList() {
      data.projects.forEach(function (project) {
        var lines = [
          S(project.title, 't-h t-blk'),
          S(project.dates + ' · ' + (project.stack || project.tech).join(', '), 't-dim t-blk')
        ];
        if (project.repo) { var link = repoLink(project); link.className += ' t-blk'; lines.push(link); }
        kv(('0' + project.no).slice(-2), lines, 't-acc', '4ch');
      });
    }

    function printProject(project) {
      L([S(('0' + project.no).slice(-2) + '  ', 't-acc'), S(project.title, 't-h')]);
      L(project.dates, 't-dim');
      L(project.what);
      project.bullets.forEach(bullet);
      L('Tech: ' + (project.stack || project.tech).join(', '), 't-dim');
      if (project.repo) L([S('Source: ', 't-dim'), repoLink(project)]);
    }

    def('projects', 'projects [n]', 'the four projects, or one in detail', function (args) {
      if (!args.length) {
        printProjectList();
        gap();
        L(['Try ', S('projects 2', 't-acc'), ' for details.'], 't-dim');
        return;
      }
      var project = findProject(args.join(' '));
      if (!project) {
        L(S('projects: no such project: ' + args.join(' '), 't-err'));
        L(['Pick 1-' + data.projects.length + ', or one of: ', data.projects.map(function (p) { return p.id; }).join(', ')], 't-dim');
        return;
      }
      printProject(project);
    }, { args: function () { return data.projects.map(function (project) { return project.id; }); } });

    function printSkills() {
      data.skills.forEach(function (group, i) {
        if (i) gap();
        L(group.label, 't-acc');
        L(group.display, 't-ind');
      });
    }

    function whereUsed(skill) {
      var lower = skill.toLowerCase();
      var found = [];
      data.roles.forEach(function (role) {
        if (role.tech.some(function (t) { return t.toLowerCase() === lower; })) found.push(role.title + ' at ' + role.org);
      });
      data.projects.forEach(function (project) {
        if (project.tech.some(function (t) { return t.toLowerCase() === lower; })) found.push(project.title);
      });
      return found;
    }

    def('skills', 'skills [tech]', 'the toolkit, or where one tool is used', function (args) {
      if (!args.length) {
        printSkills();
        gap();
        L(['Try ', S('skills docker', 't-acc'), ' to see where something is used.'], 't-dim');
        return;
      }
      var query = args.join(' ').toLowerCase();
      var name = null;
      allSkills().forEach(function (item) { if (!name && item.toLowerCase() === query) name = item; });
      if (!name) {
        L(S('skills: nothing called "' + args.join(' ') + '" on the list', 't-err'));
        L('Run skills on its own to see everything.', 't-dim');
        return;
      }
      var where = whereUsed(name);
      if (!where.length) { L(name + ' is on the skills list, but it is not named in a specific project or role.'); return; }
      L([S(name, 't-h'), ' appears in ' + where.length + (where.length === 1 ? ' place' : ' places') + ':']);
      where.forEach(bullet);
    }, {
      args: function () {
        return allSkills().filter(function (item) { return item.indexOf(' ') < 0; });
      }
    });

    def('education', 'education', 'degrees and scores', function () {
      data.education.forEach(function (item, i) {
        if (i) gap();
        L(item.school, 't-h');
        if (item.degree) L(item.degree);
        L(item.years + ' · ' + item.scoreLabel + ' ' + item.score, 't-dim');
      });
    });

    def('certs', 'certs', 'certifications', function () {
      data.certifications.forEach(function (name, i) { kv(String(i + 1).padStart(2, '0'), name, 't-acc', '4ch'); });
    });

    def('achievements', 'achievements', 'coding profiles and practice', function () {
      data.achievements.forEach(function (item) {
        var line = item.metric ? item.metric + ' ' + item.text.charAt(0).toLowerCase() + item.text.slice(1) : item.text;
        kv(item.label, line, 't-acc', '10ch');
      });
    });

    function linkRows() {
      ['email', 'github', 'linkedin', 'leetcode', 'resume'].forEach(function (key) {
        kv(links[key].label, A(links[key].url, links[key].display), 't-acc', '10ch');
      });
    }
    def('links', 'links', 'email, profiles and resume', linkRows);

    def('contact', 'contact', 'how to reach Sagar', function () {
      L('Say hello.', 't-h');
      linkRows();
      kv('Based in', profile.location, 't-acc', '10ch');
      gap();
      L(['Short on time? ', S('resume', 't-acc'), ' opens the PDF in a new tab.'], 't-dim');
    });

    def('resume', 'resume', 'open the resume (PDF)', function () {
      var link = links.resume;
      L([S('opening ', 't-dim'), A(link.url, 'resume (PDF)')]);
      window.open(link.url, '_blank', 'noopener,noreferrer');
    });

    // -- navigation and system
    var OPEN_TARGETS = ['github', 'linkedin', 'leetcode', 'email', 'resume'];
    def('open', 'open <target>', OPEN_TARGETS.join(' | '), function (args) {
      if (!args[0]) { usage('open', OPEN_TARGETS.join(' | ')); return; }
      var key = args[0].toLowerCase() === 'mail' ? 'email' : args[0].toLowerCase();
      if (OPEN_TARGETS.indexOf(key) < 0) {
        L([S('open: unknown target "' + args[0] + '"', 't-err'), ' - try ' + OPEN_TARGETS.join(', ')]);
        return;
      }
      var link = links[key];
      L([S('opening ', 't-dim'), A(link.url, key === 'resume' ? 'resume (PDF)' : link.display)]);
      if (key === 'email') window.location.href = link.url;
      else window.open(link.url, '_blank', 'noopener,noreferrer');
    }, { args: function () { return OPEN_TARGETS; } });

    def('goto', 'goto <section>', 'jump to a section (or cd)', function (args, text) {
      var ids = sectionIds();
      var q = (args[0] || '').toLowerCase().replace(/^#/, '');
      if (!q && /^cd\b/i.test(text)) q = '~'; // a bare cd goes home
      if (!q) { usage('goto', ids.join(' | ')); return; }
      var isCd = /^cd\b/i.test(text);
      var home = q === '..' || q === '~' || q === '/' || q === 'top';
      if (isCd && home) { // moving around the virtual tree does not scroll the page
        cwd = '';
        holdCwd = Date.now() + 1500;
        refreshWho();
        L('/home/sagar/portfolio', 't-dim');
        return;
      }
      var id = q === 'home' || home ? 'top' : null;
      var number = /^\d{1,2}$/.test(q) ? ('0' + q).slice(-2) : null;
      ids.forEach(function (candidate) { if (!id && candidate === q) id = candidate; });
      data.sections.forEach(function (section) {
        if (!id && (section.no === number || section.label.toLowerCase() === q)) id = section.id;
      });
      if (!id) {
        L([S('goto: no section "' + args[0] + '"', 't-err'), ' - try ' + ids.join(', ')]);
        return;
      }
      L([S('→ ', 't-acc'), id === 'top' ? 'top of the page' : id]);
      cwd = id === 'top' ? '' : '/' + id;
      holdCwd = Date.now() + 1500; // the scroll-spy passes other sections on the way: ignore it meanwhile
      afterClose = function () { P.scrollToSection(id); };
      later(close, 260);
    }, { args: sectionIds });

    def('theme', 'theme <mode>', 'light | dark | toggle', function (args) {
      var current = P.theme;
      var want = (args[0] || '').toLowerCase();
      if (!want) { L(['theme: ', S(current, 't-h'), S('   (try theme light | dark | toggle)', 't-dim')]); return; }
      if (want === 'toggle') want = current === 'dark' ? 'light' : 'dark';
      if (want !== 'light' && want !== 'dark') {
        L([S('theme: unknown mode "' + args[0] + '"', 't-err'), ' - try light, dark or toggle']);
        return;
      }
      if (want === current) { L('already ' + current + '.', 't-dim'); return; }
      L([S('→ ', 't-acc'), want]);
      var box = input.getBoundingClientRect();
      P.applyTheme(want, { x: box.left + 18, y: box.top + box.height / 2 });
    }, { args: function () { return ['light', 'dark', 'toggle']; } });

    var FILES = ['about.txt', 'stack.txt', 'projects.txt'];
    def('ls', 'ls', 'list the virtual files', function () {
      var row = add(el('div', 't-line t-files'));
      FILES.forEach(function (name) { row.appendChild(el('span', null, name)); });
    });

    def('cat', 'cat <file>', 'print a virtual file', function (args) {
      if (!args[0]) { usage('cat', 'try ls'); return; }
      var name = args[0].toLowerCase();
      if (/^resume(\.pdf)?$/.test(name) && CMDS.resume) { CMDS.resume.run([]); return; }   // a real file: open it
      if (name.indexOf('.') < 0) name += '.txt';
      if (FILES.indexOf(name) < 0) { L([S('cat: ' + args[0] + ': no such file', 't-err'), ' - try ls']); return; }
      if (name === 'about.txt') printAbout();
      else if (name === 'stack.txt') printSkills();
      else data.projects.forEach(function (project, i) { if (i) gap(); printProject(project); });
    }, { args: function () { return FILES; } });

    // -- neofetch: an identity card, pixel monogram + real facts
    var SPRITE = ['.#####.', '##...##', '##.....', '.#####.', '.....##', '##...##', '.#####.'];

    function monogram() {
      var ns = 'http://www.w3.org/2000/svg';
      var svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('class', 't-logo');
      svg.setAttribute('viewBox', '0 0 7 7');
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('focusable', 'false');
      svg.setAttribute('shape-rendering', 'crispEdges');
      SPRITE.forEach(function (row, y) {
        for (var x = 0; x < row.length; x += 1) {
          if (row.charAt(x) !== '#') continue;
          var cell = document.createElementNS(ns, 'rect');
          cell.setAttribute('x', String(x));
          cell.setAttribute('y', String(y));
          cell.setAttribute('width', '1');
          cell.setAttribute('height', '1');
          cell.setAttribute('class', 't-px');
          cell.style.setProperty('--k', String((x * 3 + y * 5) % 17));
          svg.appendChild(cell);
        }
      });
      return svg;
    }

    def('neofetch', 'neofetch', 'identity card', function () {
      var edu = data.education[0];
      var leet = data.achievements[0];
      var card = el('div', 't-line t-fetch');
      var info = el('div', 't-info');
      var title = 'sagar@portfolio';
      info.appendChild(el('div', null)).appendChild(S(title, 't-acc t-h'));
      info.appendChild(el('div', 't-dim', new Array(title.length + 1).join('-')));
      [
        ['Role', profile.role],
        ['Employer', profile.employer],
        ['Uptime', uptime()],
        ['Location', profile.location],
        ['Speaks', profile.languages.join(', ')],
        ['Stack', pick(['Java', 'Python', 'JavaScript', 'Node.js', 'PHP']).join(', ')],
        ['Cloud', pick(['AWS', 'Docker', 'Nginx', 'CI/CD']).join(', ')],
        ['AI/ML', pick(['PyTorch', 'AWS Rekognition']).join(', ')],
        ['Editor', pick(['VS Code']).join(', ')],
        ['School', edu.school],
        ['Practice', leet.label + ' ' + leet.metric + ' problems']
      ].forEach(function (pair) {
        if (!pair[1]) return;
        var row = el('div', 't-kv');
        row.style.setProperty('--kw', '9ch');
        row.appendChild(el('span', 't-k t-acc', pair[0]));
        row.appendChild(el('span', null, pair[1]));
        info.appendChild(row);
      });
      var swatches = el('div', 't-swatches');
      swatches.setAttribute('aria-hidden', 'true');
      for (var i = 0; i < 6; i += 1) swatches.appendChild(el('span', 't-sw'));
      info.appendChild(swatches);
      card.appendChild(monogram());
      card.appendChild(info);
      add(card);
    });

    def('clear', 'clear', 'clear the screen (Ctrl+L)', function () { /* handled in execute */ });

    def('history', 'history', 'commands from this session', function () {
      if (!history.length) { L('nothing yet.', 't-dim'); return; }
      history.forEach(function (item, i) { kv(String(i + 1), item, 't-dim', '4ch'); });
    });

    def('exit', 'exit', 'close the terminal (Esc)', function () {
      L('logout', 't-dim');
      later(close, 140);
    });

    // -- the rest is play
    def('echo', 'echo <text>', 'repeat after me', function (args) { L(args.join(' ')); }, { hidden: true });

    def('pwd', 'pwd', 'where am I?', function () { L('/home/sagar/portfolio' + cwd); }, { hidden: true });

    def('coffee', 'coffee', 'brew one', function () {
      var cup = add(el('div', 't-line t-cup'));
      cup.appendChild(S('   ( (\n', 't-steam'));
      cup.appendChild(S('    ) )\n', 't-steam'));
      cup.appendChild(document.createTextNode('  ........\n  |      |]\n  \\      /\n   `----\''));
      L('Brewed. Fuel for the next deploy.', 't-dim');
    }, { hidden: true });

    def('rm', 'rm', 'remove files', function (args) {
      if (/-\w*r/.test(args.join(' ')) || args.join(' ').indexOf('/') > -1) L('nice try.', 't-h');
      else L('rm: this portfolio is read-only.', 't-dim');
    }, { hidden: true });

    def('sudo', 'sudo <command>', 'run as superuser', function (args) {
      var rest = args.join(' ').toLowerCase().replace(/\s+/g, ' ');
      if (!args.length) { L('usage: sudo <command>', 't-dim'); return; }
      if (args[0].toLowerCase() === 'hire') {
        if (!/^hire sagar/.test(rest)) { L(['sudo: hire who? ', S('sudo hire sagar', 't-acc')]); return; }
        startPassword();
        return;
      }
      if (args[0].toLowerCase() === 'rm') { L('nice try.', 't-h'); return; }
      L('sudo: permission denied. This portfolio is read-only.', 't-dim');
    }, {
      hidden: true,
      args: function (previous) {
        if (!previous.length) return ['hire'];
        return previous.length === 1 && previous[0].toLowerCase() === 'hire' ? ['sagar'] : [];
      }
    });

    /* ---------- sudo hire sagar: a fake password prompt, then a real mail ---------- */

    function setPrompt(visible, label) {
      promptText.textContent = visible;
      if (promptLabel) promptLabel.textContent = label;
    }

    function startPassword() {
      state.mode = 'password';
      setPrompt('[sudo] password for recruiter:', 'sudo password for recruiter (any text works)');
      input.placeholder = 'any password works';
      input.value = '';
      L('(this is a joke: type anything, it is never stored or sent)', 't-dim');
      updateGhost();
    }

    function endPassword() {
      if (state.mode !== 'password') return;
      state.mode = 'cmd';
      setPrompt('$', 'Command');
      input.placeholder = state.ran ? '' : 'type help';
      input.value = '';
      updateGhost();
    }

    // Closing mid-"authenticating" must not leave a dangling bar: end it with a visible outcome.
    function cancelAuth() {
      if (!pendingAuth) return;
      var auth = pendingAuth;
      pendingAuth = null;
      if (auth.bar.parentNode) auth.bar.parentNode.removeChild(auth.bar);
      resume(auth.block);
      L('authentication canceled.', 't-dim');
    }

    function finishPassword(typed) {
      var dots = new Array(Math.min(Math.max(typed.length, 1), 14) + 1).join('•');
      var b = echo('[sudo] password for recruiter:', dots);
      endPassword();
      input.value = '';
      state.busy = true;
      input.readOnly = true;
      resume(b);

      var bar2 = el('span', 't-bar');
      bar2.setAttribute('aria-hidden', 'true');
      for (var i = 0; i < 24; i += 1) {
        var cell = el('i');
        cell.style.setProperty('--k', String(i));
        bar2.appendChild(cell);
      }
      L([S('authenticating ', 't-dim'), bar2]);
      scrollEnd(b);
      pendingAuth = { block: b, bar: bar2 };

      var grant = P.reduced ? 0 : 24 * 34 + 120;
      later(function () {
        pendingAuth = null;
        resume(b);
        add(el('div', 't-line t-grant t-ok', 'Access granted.'));
        L('Here is the address:');
        var row = L([A(links.email.url, links.email.display), '  ']);
        var copy = el('button', 'tty__copy', 'Copy');
        copy.type = 'button';
        copy.addEventListener('click', function () {
          var done = function () { copy.textContent = 'Copied'; P.toast('Address copied.'); };
          try {
            window.navigator.clipboard.writeText(links.email.display).then(done, function () { P.toast(links.email.display); });
          } catch (e) { P.toast(links.email.display); }
        });
        row.appendChild(copy);
        L('Click the address to open your mail app.', 't-dim');
        scrollEnd(b);
        state.busy = false;
        input.readOnly = false;
      }, grant);
    }

    /* ---------- Running a line ---------- */

    function remember(text) {
      if (history[history.length - 1] !== text) history.push(text);
      if (history.length > 50) history.shift();
      cursor = history.length;
      try { window.sessionStorage.setItem('term.history', JSON.stringify(history)); } catch (e) { /* private mode: kept in memory */ }
    }

    function clearScreen() {
      log.textContent = '';
      block = null;
    }

    function execute(raw) {
      var text = raw.trim();
      var b = echo('$', raw);
      listing = null;
      state.ran = true;
      input.placeholder = '';
      if (text) {
        remember(text);
        var words = text.split(/\s+/);
        var cmd = lookup(words[0]);
        if (cmd && cmd.name === 'clear') {
          clearScreen();
          return;
        }
        try {
          if (cmd) cmd.run(words.slice(1), text);
          else notFound(words[0]);
        } catch (error) {
          L(S('internal error: ' + error.message, 't-err'));
          window.setTimeout(function () { throw error; });
        }
      }
      scrollEnd(b);
    }

    function submit() {
      if (state.busy) return;
      var value = input.value;
      if (state.mode === 'password') { finishPassword(value); return; }
      input.value = '';
      cursor = history.length;
      updateGhost();
      execute(value);
    }

    // Quick-command chips and the first-run greeting: type the command out, then run it.
    function typeAndRun(text) {
      if (state.busy) return;
      endPassword();
      input.value = '';
      cursor = history.length;
      if (P.reduced) { input.value = text; updateGhost(); submit(); return; }
      state.busy = true;
      var n = 0;
      (function step() {
        n += 1;
        input.value = text.slice(0, n);
        updateGhost();
        if (n < text.length) { later(step, 24); return; }
        later(function () { state.busy = false; submit(); }, 150);
      }());
    }

    /* ---------- Completion ---------- */

    function candidates(value) {
      var ends = /\s$/.test(value);
      var tokens = value.trim() ? value.trim().split(/\s+/) : [];
      if (ends || !tokens.length) tokens.push('');
      var index = tokens.length - 1;
      var token = tokens[index];
      var pool = [];
      if (index === 0) pool = visibleNames();
      else {
        var cmd = lookup(tokens[0]);
        pool = cmd && cmd.args ? cmd.args(tokens.slice(1, index)) : [];
      }
      var lower = token.toLowerCase();
      return {
        token: token,
        base: value.slice(0, value.length - token.length),
        list: pool.filter(function (item) { return item.toLowerCase().indexOf(lower) === 0 && item.toLowerCase() !== lower; })
      };
    }

    function commonPrefix(list) {
      var prefix = list[0];
      list.forEach(function (item) {
        while (item.toLowerCase().indexOf(prefix.toLowerCase()) !== 0) prefix = prefix.slice(0, -1);
      });
      return prefix;
    }

    // What the ghost text would add: a past command first, else the first completion.
    function suggestion(value) {
      if (state.mode !== 'cmd' || !value.trim()) return '';
      for (var i = history.length - 1; i >= 0; i -= 1) {
        if (history[i].length > value.length && history[i].indexOf(value) === 0) return history[i].slice(value.length);
      }
      var c = candidates(value);
      return c.list.length ? c.list[0].slice(c.token.length) + ' ' : '';
    }

    function caretAtEnd() { return input.selectionStart === input.value.length && input.selectionEnd === input.value.length; }

    function updateGhost() {
      ghost = caretAtEnd() ? suggestion(input.value) : '';
      ghostEl.textContent = '';
      if (ghost) {
        ghostEl.appendChild(el('span', 'tty__ghost-pad', input.value));
        ghostEl.appendChild(document.createTextNode(ghost.replace(/ $/, '')));
        // Never let a suggestion collide with a scrolled-out field.
        if (input.scrollWidth > input.clientWidth) { ghostEl.textContent = ''; ghost = ''; }
      }
      if (tabButton) tabButton.hidden = !(ghost && P.coarse);
    }

    function acceptGhost() {
      if (!ghost) return false;
      input.value += ghost;
      var n = input.value.length;
      input.setSelectionRange(n, n);
      updateGhost();
      return true;
    }

    function onTab(event) {
      var value = input.value;
      if (state.mode !== 'cmd' || !value.trim()) return; // empty line: Tab simply moves focus on
      event.preventDefault();
      var c = candidates(value);
      if (!c.list.length) { acceptGhost(); return; }
      if (c.list.length === 1) { input.value = c.base + c.list[0] + ' '; }
      else {
        var prefix = commonPrefix(c.list);
        if (prefix.length > c.token.length) input.value = c.base + prefix;
        else {
          var key = c.list.join('|');
          if (listing !== key) {
            listing = key;
            var b = echo('$', value);
            var row = add(el('div', 't-line t-files t-hint'));
            c.list.forEach(function (item) { row.appendChild(el('span', null, item)); });
            scrollEnd(b);
          }
        }
      }
      var n = input.value.length;
      input.setSelectionRange(n, n);
      updateGhost();
    }

    function recall(direction) {
      if (!history.length) return;
      if (cursor === history.length) draft = input.value;
      cursor = Math.max(0, Math.min(history.length, cursor + direction));
      input.value = cursor === history.length ? draft : history[cursor];
      var n = input.value.length;
      input.setSelectionRange(n, n);
      updateGhost();
    }

    function interrupt() {
      var typed = state.mode === 'password' ? '' : input.value;
      var b = echo(promptText.textContent, typed + '^C');
      if (state.mode === 'password') endPassword();
      input.value = '';
      cursor = history.length;
      updateGhost();
      scrollEnd(b);
    }

    /* ---------- Opening and closing ---------- */

    var sheetQuery = window.matchMedia ? window.matchMedia('(max-width: 720px)') : { matches: false };
    var viewport = window.visualViewport;

    // On phones the sheet rides above the on-screen keyboard.
    function syncViewport() {
      if (!dialog.open || !viewport) return;
      if (!sheetQuery.matches || viewport.scale > 1.02) {
        dialog.style.removeProperty('--vv-h');
        dialog.style.removeProperty('--vv-b');
        dialog.classList.remove('is-tight');
        return;
      }
      var bottom = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      dialog.style.setProperty('--vv-h', viewport.height + 'px');
      dialog.style.setProperty('--vv-b', bottom + 'px');
      dialog.classList.toggle('is-tight', viewport.height < 460);
    }

    function greet() {
      if (state.greeted) return;
      state.greeted = true;
      startBlock();
      L([S(profile.name, 't-h'), S(' - portfolio terminal', 't-dim')]);
      L('Not a real shell: every answer comes from this page.', 't-dim');
      L(['Type ', S('help', 't-acc'), ' to see commands. Tab completes, ', S('↑', 't-acc'), ' recalls.'], 't-dim');
      ['help', 'neofetch', 'projects', 'contact', 'sudo hire sagar'].forEach(function (text) {
        var chip = el('button', 'tty__chip', text);
        chip.type = 'button';
        chip.addEventListener('click', function () {
          typeAndRun(text);
          if (!P.coarse) input.focus({ preventScroll: true });
        });
        chipsEl.appendChild(chip);
      });
    }

    // The title bar reads like a shell prompt whose directory is the section on screen.
    function refreshWho() { if (whoEl) whoEl.textContent = 'sagar@portfolio:~' + cwd; }
    P.on('section', function (detail) {
      if (Date.now() < holdCwd) return;
      cwd = detail && detail.id && detail.id !== 'top' ? '/' + detail.id : '';
      if (dialog.open) refreshWho();
    });

    function open() {
      if (dialog.open || state.closing || $('dialog[open]')) return;
      dialog.classList.remove('is-closing');
      refreshWho();
      dialog.showModal();
      greet();
      syncViewport();
      // On touch screens the keyboard would cover half the sheet: the visitor taps the prompt when ready.
      if (!P.coarse) input.focus({ preventScroll: true });
      else log.focus({ preventScroll: true });
      scrollEnd(null, true);
      P.emit('terminal', { open: true });
    }

    function finishClose() {
      state.closing = false;
      dialog.classList.remove('is-closing');
      if (dialog.open) dialog.close();
    }

    function close() {
      if (!dialog.open || state.closing) return;
      stopTimers();
      cancelAuth();
      state.busy = false;
      input.readOnly = false;
      endPassword();
      if (P.reduced) { finishClose(); return; }
      state.closing = true;
      dialog.classList.add('is-closing');
      window.setTimeout(finishClose, 170);
    }

    dialog.addEventListener('close', function () {
      stopTimers();
      cancelAuth();
      state.busy = false;
      state.closing = false;
      input.readOnly = false;
      endPassword();
      dialog.classList.remove('is-closing', 'is-dragging', 'is-tight');
      dialog.style.removeProperty('--drag');
      dialog.style.removeProperty('--vv-h');
      dialog.style.removeProperty('--vv-b');
      if (window.location.hash === '#terminal') {
        try { window.history.replaceState(null, '', window.location.pathname + window.location.search); } catch (e) { /* hash stays */ }
      }
      P.emit('terminal', { open: false });
      var next = afterClose;
      afterClose = null;
      if (next) window.setTimeout(next, 0);
    });

    // Esc: cancel a pending password first, otherwise close with the exit animation.
    dialog.addEventListener('cancel', function (event) {
      event.preventDefault();
      if (state.mode === 'password' && !state.busy) { interrupt(); return; }
      close();
    });

    // Backdrop click closes, but a text selection dragged out of the card must not.
    var downOnBackdrop = false;
    dialog.addEventListener('pointerdown', function (event) { downOnBackdrop = event.target === dialog; });
    dialog.addEventListener('click', function (event) {
      if (event.target === dialog && downOnBackdrop) close();
    });

    closeButton.addEventListener('click', close);

    // The page behind stays put: only the output scrolls (wheel and touch never chain to the page).
    function keepPage(event) {
      if (!event.target.closest || !event.target.closest('.tty__log')) event.preventDefault();
    }
    dialog.addEventListener('wheel', keepPage, { passive: false });
    dialog.addEventListener('touchmove', keepPage, { passive: false });

    // Ctrl/Cmd+K belongs to the command palette: hand over cleanly instead of stacking two dialogs.
    dialog.addEventListener('keydown', function (event) {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k') {
        stopTimers();
        finishClose();
        return;
      }
      // Tab wraps inside the dialog: the prompt is last, so one more Tab returns to the close button.
      if (event.key === 'Tab' && !event.defaultPrevented && !event.ctrlKey && !event.metaKey && !event.altKey) {
        var items = Array.prototype.slice.call(dialog.querySelectorAll('button, a[href], input, [tabindex="0"]')).filter(function (node) {
          return !node.disabled && !node.hidden && node.getClientRects().length;
        });
        if (items.length) {
          var firstItem = items[0];
          var lastItem = items[items.length - 1];
          var active = document.activeElement;
          var outside = !dialog.contains(active) || active === dialog;
          if (event.shiftKey && (active === firstItem || outside)) { event.preventDefault(); lastItem.focus(); return; }
          if (!event.shiftKey && (active === lastItem || outside)) { event.preventDefault(); firstItem.focus(); return; }
        }
      }
      // Typing with focus on the output or the card itself goes to the prompt.
      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && !event.isComposing &&
          !event.target.closest('input, button, a')) {
        input.focus({ preventScroll: true });
      }
    });

    if (viewport) {
      viewport.addEventListener('resize', syncViewport);
      viewport.addEventListener('scroll', syncViewport);
    }

    /* ---------- Input wiring ---------- */

    form.addEventListener('submit', function (event) { event.preventDefault(); submit(); });
    form.addEventListener('click', function (event) {
      if (event.target.closest && !event.target.closest('button')) input.focus({ preventScroll: true });
    });

    input.addEventListener('input', function () {
      if (state.mode === 'password') {
        input.value = new Array(input.value.length + 1).join('•');
        return;
      }
      cursor = history.length;
      listing = null;
      updateGhost();
    });

    input.addEventListener('keydown', function (event) {
      if (event.isComposing) return;
      var key = event.key;
      var plain = !event.ctrlKey && !event.metaKey && !event.altKey;
      if (key === 'Tab' && !event.shiftKey && plain) { onTab(event); return; }
      if ((key === 'ArrowUp' || key === 'ArrowDown') && state.mode === 'cmd') {
        event.preventDefault();
        recall(key === 'ArrowUp' ? -1 : 1);
        return;
      }
      if ((key === 'ArrowRight' || key === 'End') && plain && !event.shiftKey && ghost && caretAtEnd()) {
        event.preventDefault();
        acceptGhost();
        return;
      }
      if (event.ctrlKey && !event.metaKey && !event.altKey && key.length === 1) {
        var c = key.toLowerCase();
        var selected = input.selectionStart !== input.selectionEnd;
        if (c === 'c' && !selected) { event.preventDefault(); interrupt(); }
        else if (c === 'l') { event.preventDefault(); clearScreen(); }
        else if (c === 'u') { event.preventDefault(); input.value = ''; updateGhost(); }
        else if (c === 'd' && !input.value) { event.preventDefault(); execute('exit'); }
      }
    });

    // Only the caret moving matters for the ghost; keep it honest after clicks and arrows.
    input.addEventListener('keyup', function (event) {
      if (event.key === 'ArrowLeft' || event.key === 'Home') updateGhost();
    });
    input.addEventListener('click', updateGhost);

    if (tabButton) {
      tabButton.addEventListener('click', function () { acceptGhost(); input.focus({ preventScroll: true }); });
    }

    // A click on the output focuses the prompt, unless the visitor is selecting text.
    log.addEventListener('click', function (event) {
      if (event.target.closest('a, button') || String(window.getSelection())) return;
      if (!P.coarse) input.focus({ preventScroll: true });
    });

    /* ---------- Bottom sheet: drag the title bar down to dismiss ---------- */

    var drag = { id: null, y: 0, dy: 0, t: 0 };

    bar.addEventListener('pointerdown', function (event) {
      if (!sheetQuery.matches || event.target.closest('button') || drag.id !== null) return;
      drag.id = event.pointerId;
      drag.y = event.clientY;
      drag.dy = 0;
      drag.t = event.timeStamp;
      try { bar.setPointerCapture(event.pointerId); } catch (e) { /* capture is a nicety */ }
      dialog.classList.add('is-dragging');
    });
    bar.addEventListener('pointermove', function (event) {
      if (event.pointerId !== drag.id) return;
      drag.dy = Math.max(0, event.clientY - drag.y);
      dialog.style.setProperty('--drag', drag.dy + 'px');
    });
    function release(event) {
      if (event.pointerId !== drag.id) return;
      var velocity = drag.dy / Math.max(1, event.timeStamp - drag.t);
      drag.id = null;
      dialog.classList.remove('is-dragging');
      if (event.type !== 'pointercancel' && (drag.dy > 110 || (drag.dy > 30 && velocity > 0.5))) close();
      else dialog.style.removeProperty('--drag');
    }
    bar.addEventListener('pointerup', release);
    bar.addEventListener('pointercancel', release);

    return { open: open, close: close };
  }

  // The launcher in terminal.js calls this once, when the terminal is first wanted.
  P.shell = terminal;
}());
