#!/usr/bin/env node
/*
 * Portfolio safety net. Zero dependencies, Node 20+.
 *
 *   node scripts/check.mjs            run from the repository root
 *   node scripts/check.mjs <dir>      or point it at a site folder
 *
 * What it guards (all of it is something that works on a Windows/macOS laptop and then breaks, or leaks, once the
 * site is on GitHub Pages):
 *   1. Every relative href / src / poster / srcset / url() / JS asset string resolves to a real file with EXACT-CASE
 *      names. Pages is case-sensitive, laptops are not, so existence is checked against a real directory listing.
 *   2. No root-relative ("/assets/...") URLs, no spaces or capitals in file names under assets/ css/ js/.
 *   3. Privacy: the withheld personal details never appear in any text file.
 *   4. Facts parity: js/data.js (PORTFOLIO_DATA) and index.html cannot silently drift apart.
 *   5. HTML hygiene: target=_blank has rel=noopener, no duplicate ids, in-page #anchors exist, JSON-LD parses,
 *      external links stay on an allowlist (an unknown host is an ERROR).
 *   6. Hosting files: index.html, 404.html, robots.txt and sitemap.xml exist, and every URL in the sitemap and the
 *      robots.txt "Sitemap:" line starts with SITE_ORIGIN. Unexpected files in the repository root are a WARN.
 *
 * Exit code 1 with a readable list on any ERROR, 0 otherwise (WARN lines never fail the run).
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

/* ------------------------------------------------------------------ configuration */

const ROOT = path.resolve(process.argv[2] || process.cwd());

// Where the site is published. Change here (or set PORTFOLIO_ORIGIN) if the repository is named differently.
const SITE_ORIGIN = (process.env.PORTFOLIO_ORIGIN || 'https://sagarms2005.github.io').replace(/\/+$/, '');

// The only profile URLs that may appear as links (besides mailto:).
const ALLOWED_PROFILE_URLS = [
  'https://github.com/Sagarms2005',
  'https://www.linkedin.com/in/sagar-m-s-867102337/',
  'https://leetcode.com/u/2005sagarms/',
];
// Hosts that are fine to reference (fonts, the site itself).
const ALLOWED_HOSTS = new Set([
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  new URL(SITE_ORIGIN).host,
]);
// XML / JSON-LD namespace URLs that are identifiers, not links.
// What may sit in the repository root. Anything else is reported (a warning) so stray notes and logs do not get published.
const ROOT_ENTRIES = new Set([
  '.git', '.github', '.gitignore', '.nojekyll', '404.html', 'README.md', 'assets', 'css',
  'index.html', 'js', 'robots.txt', 'scripts', 'sitemap.xml',
]);
// Files a GitHub Pages site needs besides the page itself.
const HOSTING_FILES = ['index.html', '404.html', 'robots.txt', 'sitemap.xml'];
const NAMESPACE_URLS = /^https?:\/\/(www\.w3\.org|schema\.org)(\/|$)/;

// Withheld personal details. No private value is stored in this (published) file: the scan uses generic shapes
// (an Indian mobile number, a written-out day-month-year date) plus, optionally, exact terms the owner supplies at
// run time in the PORTFOLIO_PRIVATE_TERMS environment variable (comma-separated; never commit them anywhere).
const j = (...parts) => parts.join('');
const MONTHS = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const FORBIDDEN = [
  { label: 'an Indian mobile number', re: /(?<![\d.])(?:\+?91[\s.-]?)?[6-9](?:\d{4}[\s.-]?\d{5}|\d{3}[\s.-]?\d{3}[\s.-]?\d{3}|\d{2}[\s.-]?\d{3}[\s.-]?\d{4})(?![\d.]*\d)/ },
  { label: 'a day-month-year date (possible date of birth)', re: new RegExp(`\\b\\d{1,2}[\\s\\-/.](?:${MONTHS})[\\s\\-/.,]+\\d{4}\\b`, 'i') },
  { label: 'a dd/mm/yyyy date (possible date of birth)', re: /\b\d{1,2}[/.-]\d{1,2}[/.-](?:19|20)\d{2}\b/ },
];
for (const term of String(process.env.PORTFOLIO_PRIVATE_TERMS || '').split(',').map((t) => t.trim()).filter(Boolean)) {
  const digitsOnly = /^[\d\s+.-]+$/.test(term) && term.replace(/\D/g, '').length >= 6;
  const pattern = digitsOnly
    ? term.replace(/\D/g, '').split('').join('[\\s.-]?')
    : term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  FORBIDDEN.push({ label: 'a private term from PORTFOLIO_PRIVATE_TERMS', re: new RegExp(pattern, 'i') });
}
// Softer indicators: reported as warnings only (they can appear in harmless prose).
const SOFT_TERMS = [
  { label: 'a nationality line', re: new RegExp(j('\\bnation', 'ality\\b'), 'i') },
  { label: 'a date-of-birth label', re: new RegExp(j('date\\s+of\\s+bi', 'rth'), 'i') },
];

const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.bmp', '.mp4', '.webm', '.mov', '.m4v', '.mp3', '.wav',
  '.ogg', '.woff', '.woff2', '.ttf', '.otf', '.eot', '.pdf', '.zip', '.gz', '.7z', '.docx', '.xlsx', '.pptx',
]);
// extras-not-for-github/ is the owner's private proof kit (git-ignored, never published, full of [FILL] markers).
const SKIP_DIRS = new Set(['.git', 'node_modules', '.idea', '.vscode', 'extras-not-for-github']);
// Folders whose file names must be lowercase with no spaces (GitHub Pages is case-sensitive).
const STRICT_NAME_DIRS = ['assets', 'css', 'js'];

/* ------------------------------------------------------------------ reporting */

const errors = [];
const warnings = [];
const notes = [];
const err = (group, msg) => errors.push({ group, msg });
const warn = (group, msg) => warnings.push({ group, msg });
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/') || '.';
const where = (file, text, index) => `${file}:${text.slice(0, index).split('\n').length}`;

/* ------------------------------------------------------------------ file system helpers */

const dirCache = new Map();
function listDir(dir) {
  if (!dirCache.has(dir)) {
    let names = null;
    try { names = fs.readdirSync(dir); } catch { names = null; }
    dirCache.set(dir, names);
  }
  return dirCache.get(dir);
}

/**
 * Case-exact existence check against a real directory listing (fs.existsSync is case-insensitive on Windows and macOS).
 * Returns { ok: true } or { ok: false, reason }.
 */
function exactExists(absPath) {
  const relPath = path.relative(ROOT, absPath);
  if (relPath.startsWith('..') || path.isAbsolute(relPath)) return { ok: false, reason: 'points outside the repository' };
  let dir = ROOT;
  for (const seg of relPath.split(path.sep).filter(Boolean)) {
    const names = listDir(dir);
    if (!names) return { ok: false, reason: `folder "${rel(dir)}" does not exist` };
    if (!names.includes(seg)) {
      const alt = names.find((n) => n.toLowerCase() === seg.toLowerCase());
      return {
        ok: false,
        reason: alt
          ? `case mismatch: "${seg}" is "${alt}" on disk (works locally, 404s on GitHub Pages)`
          : `no such file "${seg}" in "${rel(dir)}"`,
      };
    }
    dir = path.join(dir, seg);
  }
  return { ok: true };
}

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (st.isFile()) out.push(full);
  }
  return out;
}

const readText = (p) => fs.readFileSync(p, 'utf8');
function isBinary(file) {
  if (BINARY_EXT.has(path.extname(file).toLowerCase())) return true;
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(8000);
    const n = fs.readSync(fd, buf, 0, 8000, 0);
    return buf.subarray(0, n).includes(0);
  } finally { fs.closeSync(fd); }
}

/* ------------------------------------------------------------------ text helpers */

/** Blank out matches but keep length and newlines so offsets still map to line numbers. */
const blank = (text, re) => text.replace(re, (m) => m.replace(/[^\n]/g, ' '));
const maskHtmlComments = (html) => blank(html, /<!--[\s\S]*?-->/g);
const maskCssComments = (css) => blank(css, /\/\*[\s\S]*?\*\//g);
/** Blank the body of <script> and <style> elements (keeps the tags and their attributes). */
const maskScriptBodies = (html) => html.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi, (_, a, b, c) => a + b.replace(/[^\n]/g, ' ') + c);
const maskStyleBodies = (html) => html.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (_, a, b, c) => a + b.replace(/[^\n]/g, ' ') + c);

const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', middot: '·', times: '×', copy: '©', thinsp: ' ', ensp: ' ', emsp: ' ' };
function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => (n.toLowerCase() in ENTITIES ? ENTITIES[n.toLowerCase()] : m));
}
/** Visible text of an HTML document in two flavors (tags removed vs. tags replaced by a space), both whitespace-normalized. */
function htmlTextVariants(html) {
  let h = maskHtmlComments(html);
  h = h.replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, ' ');
  const norm = (s) => decodeEntities(s).replace(/[\s    ]+/g, ' ').trim();
  return [norm(h.replace(/<[^>]*>/g, '')), norm(h.replace(/<[^>]*>/g, ' '))];
}
const squash = (s) => s.replace(/\s+/g, '');
const norm1 = (s) => decodeEntities(String(s)).replace(/[\s    ]+/g, ' ').trim();

/* ------------------------------------------------------------------ reference extraction */

const SKIP_REF = /^(?:#|data:|mailto:|tel:|javascript:|blob:|about:)/i;

/** A reference is { raw, index } found in `text` of `file`; classify and verify it. */
function verifyRef({ file, text, index, raw, baseDir, kind, strictRoot = true, rootIsSite = false }) {
  let ref = raw.trim();
  if (!ref || SKIP_REF.test(ref)) return;
  const loc = where(file, text, index);

  if (/^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith('//')) {
    // Absolute URL: only the site's own origin can be mapped back to a local file.
    if (ref.startsWith(SITE_ORIGIN + '/') || ref === SITE_ORIGIN) checkSiteUrl(ref, loc, kind);
    return;
  }
  ref = ref.split('#')[0].split('?')[0];
  if (!ref) return;
  try { ref = decodeURIComponent(ref); } catch { /* keep raw */ }

  if (ref.startsWith('/')) {
    if (rootIsSite) { checkTarget(path.join(ROOT, ref), ref, loc, kind); return; } // 404.html is served from any depth
    if (strictRoot) err('Root-relative URL (breaks if the site is not served from the domain root)', `${loc}  ${kind} "${raw}" — drop the leading slash`);
    else warn('Root-relative URL', `${loc}  ${kind} "${raw}"`);
    return;
  }
  checkTarget(path.resolve(baseDir, ref), raw, loc, kind);
}

function checkTarget(abs, shown, loc, kind) {
  const hit = exactExists(abs);
  if (hit.ok) return;
  err('Broken or case-mismatched local reference', `${loc}  ${kind} "${shown}" -> ${hit.reason}`);
}

function checkSiteUrl(url, loc, kind) {
  let p = url.slice(SITE_ORIGIN.length).split('#')[0].split('?')[0];
  try { p = decodeURIComponent(p); } catch { /* keep */ }
  if (p === '' || p === '/') return;
  const abs = path.join(ROOT, p);
  if (p.endsWith('/')) {
    const hit = exactExists(path.join(abs, 'index.html'));
    if (!hit.ok) err('Absolute URL on this site does not match a file', `${loc}  ${kind} "${url}" -> ${hit.reason}`);
    return;
  }
  const hit = exactExists(abs);
  if (!hit.ok) err('Absolute URL on this site does not match a file', `${loc}  ${kind} "${url}" -> ${hit.reason}`);
}

function htmlRefs(file, html) {
  const base = path.dirname(file);
  const name = path.basename(file);
  const is404 = name.toLowerCase() === '404.html';
  const masked = maskScriptBodies(maskHtmlComments(html));
  const common = { file: rel(file), text: html, baseDir: base, strictRoot: true, rootIsSite: is404 };

  const attr = /\b(href|src|poster|data-src|data-poster|data-href|action|srcset|imagesrcset)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
  for (const m of masked.matchAll(attr)) {
    const a = m[1].toLowerCase();
    const val = m[2] ?? m[3] ?? m[4] ?? '';
    if (a === 'srcset' || a === 'imagesrcset') {
      for (const part of val.split(',')) {
        const u = part.trim().split(/\s+/)[0];
        if (u) verifyRef({ ...common, index: m.index, raw: decodeEntities(u), kind: a });
      }
    } else {
      verifyRef({ ...common, index: m.index, raw: decodeEntities(val), kind: a });
    }
  }
  // <meta content="..."> for share-card images and canonical URLs
  for (const m of masked.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const prop = /\b(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] || '';
    const content = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    if (!content) continue;
    const val = decodeEntities(content[1] ?? content[2] ?? '');
    if (/^(og:image|og:image:url|twitter:image|og:url)$/i.test(prop)) {
      if (!/^https?:\/\//i.test(val)) {
        err('Share-card URL must be absolute', `${rel(file)}:${where(file, html, m.index).split(':').pop()}  <meta ${prop}> is "${val}" — crawlers need a full https:// URL`);
      } else {
        verifyRef({ ...common, index: m.index, raw: val, kind: `meta ${prop}` });
      }
    }
  }
  // url(...) in <style> blocks and style="" attributes (scripts masked, styles kept)
  const forCss = maskCssComments(maskScriptBodies(maskHtmlComments(html)));
  cssUrls(file, html, forCss, base, true);
}

function cssUrls(file, originalText, scanText, baseDir, inHtml = false) {
  const common = { file: rel(file), text: originalText, baseDir, strictRoot: true, rootIsSite: path.basename(file).toLowerCase() === '404.html' };
  for (const m of scanText.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi)) {
    const val = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (!val || /^(?:data:|#|var\()/i.test(val)) continue;
    verifyRef({ ...common, index: m.index, raw: decodeEntities(val), kind: 'url()' });
  }
  if (!inHtml) {
    for (const m of scanText.matchAll(/@import\s+(?:url\()?\s*["']([^"']+)["']/gi)) {
      verifyRef({ ...common, index: m.index, raw: m[1], kind: '@import' });
    }
  }
}

/* JS: look at string literals that look like site asset paths; follow simple "prefix" + variable concatenation. */
// Dir-prefixed paths, any path with a slash and a file extension, or a bare name with a media extension.
// (Bare "about.txt"-style names are NOT treated as assets: the terminal widget uses them as virtual file names.)
const ASSET_LITERAL = /^(?:\.\/)?(?:assets|css|js|fonts|images|img|media)\/[^\s'"`]*$|^[\w.-]+(?:\/[\w.-]+)+\.(?:png|jpe?g|webp|avif|gif|svg|mp4|webm|woff2?|ttf|otf|pdf|ico|json|css|js|html|txt|xml)$|^[\w.-]+\.(?:png|jpe?g|webp|avif|gif|svg|mp4|webm|woff2?|ttf|otf|pdf|ico)$/i;
function jsRefs(file, js) {
  const f = rel(file);
  const lit = /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g;
  for (const m of js.matchAll(lit)) {
    let value = m[2];
    const quote = m[1];
    const after = js.slice(m.index + m[0].length, m.index + m[0].length + 6);
    let dynamic = /^\s*\+/.test(after);
    if (quote === '`' && value.includes('${')) { value = value.slice(0, value.indexOf('${')); dynamic = true; }
    if (!value || /^(?:https?:|data:|mailto:|tel:|\/\/)/i.test(value) || /\s/.test(value)) continue;
    if (value.startsWith('/')) {
      if (/^\/(?:assets|css|js|fonts|images|img|media)\//.test(value)) err('Root-relative URL (breaks if the site is not served from the domain root)', `${where(f, js, m.index)}  JS string "${value}" — drop the leading slash`);
      continue;
    }
    const looksLikeAsset = ASSET_LITERAL.test(value) || (dynamic && /^(?:\.\/)?(?:assets|css|js|fonts|images|img|media)\//i.test(value));
    if (!looksLikeAsset) continue;
    const loc = where(f, js, m.index);
    const clean = value.replace(/^\.\//, '');
    if (!dynamic) {
      checkTarget(path.join(ROOT, clean), value, loc, 'JS string');
    } else {
      // "assets/video/ambient-" + theme + ".mp4": the folder must exist and some file must start with the prefix.
      const slash = clean.lastIndexOf('/');
      const folder = path.join(ROOT, clean.slice(0, slash + 1));
      const stem = clean.slice(slash + 1);
      const folderHit = exactExists(folder);
      if (!folderHit.ok) { err('Broken or case-mismatched local reference', `${loc}  JS string "${value}…" -> ${folderHit.reason}`); continue; }
      const names = listDir(folder) || [];
      if (!names.some((n) => n.startsWith(stem))) {
        const alt = names.find((n) => n.toLowerCase().startsWith(stem.toLowerCase()));
        err('Broken or case-mismatched local reference', `${loc}  JS string "${value}…" -> ${alt ? `case mismatch with "${alt}"` : 'no file in that folder starts with this prefix'}`);
      }
    }
  }
}

/* ------------------------------------------------------------------ individual checks */

function checkLocalReferences(files) {
  for (const file of files.html) htmlRefs(file, readText(file));
  for (const file of files.css) {
    const css = readText(file);
    cssUrls(file, css, maskCssComments(css), path.dirname(file));
  }
  for (const file of files.js) jsRefs(file, readText(file));
}

function checkFileNames(allFiles) {
  for (const f of allFiles) {
    const parts = path.relative(ROOT, f).split(path.sep);
    if (!STRICT_NAME_DIRS.includes(parts[0])) continue;
    for (const seg of parts) {
      if (/\s/.test(seg)) err('File names under assets/ css/ js/ must have no spaces', `${parts.join('/')}  — "${seg}" contains whitespace`);
      else if (/[A-Z]/.test(seg)) err('File names under assets/ css/ js/ must be lowercase', `${parts.join('/')}  — "${seg}" has capitals; rename to "${seg.toLowerCase()}" (and fix references)`);
    }
  }
}

function checkHosting() {
  for (const name of HOSTING_FILES) {
    if (!exactExists(path.join(ROOT, name)).ok) err('Hosting file is missing', `${name} (GitHub Pages needs it at the repository root)`);
  }
  const origin = (file, re) => {
    let text = '';
    try { text = fs.readFileSync(path.join(ROOT, file), 'utf8'); } catch { return; }
    for (const m of text.matchAll(re)) {
      const url = m[1].trim();
      if (url !== SITE_ORIGIN && !url.startsWith(SITE_ORIGIN + '/')) err('Hosting URL does not start with SITE_ORIGIN', `${where(file, text, m.index)}  ${url}  (expected ${SITE_ORIGIN})`);
    }
  };
  origin('sitemap.xml', /<loc>([^<]*)<\/loc>/gi);
  origin('robots.txt', /^\s*Sitemap:\s*(\S+)/gim);
  // The share-card and canonical URLs in index.html and the base of 404.html must name the same origin as the rest.
  origin('index.html', /<link\s+rel="canonical"\s+href="([^"]*)"/gi);
  origin('index.html', /<meta\s+property="og:(?:url|image)"\s+content="([^"]*)"/gi);
  origin('index.html', /<meta\s+name="twitter:image"\s+content="([^"]*)"/gi);
  origin('404.html', /<base\s+href="([^"]*)"/gi);
  // The two hand-kept dates must agree: sitemap <lastmod> and the footer's "Last updated" month.
  try {
    const lastmod = /<lastmod>(\d{4}-\d{2})/i.exec(fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8'));
    const footer = /Last updated\s*<time\s+datetime="(\d{4}-\d{2})/i.exec(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'));
    if (lastmod && footer && lastmod[1] !== footer[1]) warn('Dates disagree', `sitemap.xml lastmod is ${lastmod[1]} but the footer says Last updated ${footer[1]}`);
  } catch { /* a missing file is reported elsewhere */ }
  // The private proof kit is protected only by .gitignore, which web-UI drag-and-drop uploads ignore.
  // Locally it is skipped; in CI its presence means it was published.
  if ((process.env.CI || process.env.GITHUB_ACTIONS) && fs.existsSync(path.join(ROOT, 'extras-not-for-github'))) {
    err('Private folder was published', 'extras-not-for-github/ is in the repository. Delete it from GitHub (it holds personal notes and placeholders) and keep it on your computer only.');
  }
  for (const name of fs.readdirSync(ROOT)) {
    if (!ROOT_ENTRIES.has(name)) warn('Unexpected file in the repository root', `${name}  (delete it, or add it to ROOT_ENTRIES if it belongs)`);
  }
}

function checkPrivacy(allFiles) {
  const pdfs = [];
  let scanned = 0;
  for (const f of allFiles) {
    if (path.extname(f).toLowerCase() === '.pdf') { pdfs.push(rel(f)); continue; }
    if (isBinary(f)) continue;
    scanned++;
    const text = readText(f);
    const lines = text.split('\n');
    for (const { label, re } of FORBIDDEN) {
      // Also test the entity-decoded line, so digits split by &nbsp; cannot slip past the plain-space separators.
      lines.forEach((line, i) => { if (re.test(line) || re.test(decodeEntities(line))) err('Privacy: withheld personal detail found', `${rel(f)}:${i + 1}  looks like the ${label}`); });
    }
    if (rel(f) === 'scripts/check.mjs') continue; // this file names the soft terms it looks for
    for (const { label, re } of SOFT_TERMS) {
      lines.forEach((line, i) => { if (re.test(line)) warn('Privacy: check wording', `${rel(f)}:${i + 1}  mentions ${label} — make sure no personal value follows`); });
    }
  }
  notes.push(`Privacy scan: ${scanned} text files checked.`);
  if (pdfs.length) {
    notes.push(`REMINDER: ${pdfs.join(', ')} ${pdfs.length > 1 ? 'are PDFs and were' : 'is a PDF and was'} NOT text-scanned. Open ${pdfs.length > 1 ? 'them' : 'it'} and confirm no phone number, date of birth, nationality line or home address is printed (also check File > Properties for metadata).`);
  }
}

function loadPortfolioData() {
  const dataFile = path.join(ROOT, 'js', 'data.js');
  if (!fs.existsSync(dataFile)) { err('Facts parity', 'js/data.js is missing'); return null; }
  const window = {};
  const sandbox = { window, console: { log() {}, warn() {}, error() {} } };
  sandbox.self = sandbox.globalThis = window;
  try {
    vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
    new vm.Script(readText(dataFile), { filename: 'js/data.js' }).runInContext(sandbox, { timeout: 2000 });
  } catch (e) {
    err('Facts parity', `js/data.js could not be evaluated: ${e && e.message}`);
    return null;
  }
  const data = window.PORTFOLIO_DATA || sandbox.PORTFOLIO_DATA;
  if (!data || typeof data !== 'object') { err('Facts parity', 'js/data.js did not define PORTFOLIO_DATA'); return null; }
  return data;
}

function checkFactsParity() {
  const data = loadPortfolioData();
  const indexFile = path.join(ROOT, 'index.html');
  if (!data || !fs.existsSync(indexFile)) return;
  const variants = htmlTextVariants(readText(indexFile));
  const squashed = variants.map(squash);
  // Whole-word containment, so "Data Science Cert" does not pass just because "Data Science Certification" is on the page.
  const word = /[\p{L}\p{N}]/u;
  const containsBounded = (hay, needle) => {
    for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + 1)) {
      const before = hay[at - 1], after = hay[at + needle.length];
      if (!(before && word.test(before) && word.test(needle[0])) && !(after && word.test(after) && word.test(needle[needle.length - 1]))) return true;
    }
    return false;
  };
  const has = (needle) => {
    const n = norm1(needle);
    return variants.some((v) => containsBounded(v, n)) || squashed.some((v) => containsBounded(v, squash(n)));
  };
  const expect = (what, value) => {
    if (typeof value !== 'string' || !value.trim()) return;
    if (!has(value)) err('Facts parity: js/data.js and index.html disagree', `${what} "${value}" is in js/data.js but not in the text of index.html`);
  };
  let n = 0;
  const count = (what, v) => { n++; expect(what, v); };

  (data.roles || []).forEach((r, i) => {
    count(`role #${i + 1} title`, r.title); count(`role #${i + 1} company`, r.org); count(`role #${i + 1} dates`, r.dates);
  });
  (data.projects || []).forEach((p, i) => {
    count(`project #${i + 1} title`, p.title); count(`project "${p.title}" dates`, p.dates);
  });
  (data.certifications || []).forEach((c) => count('certification', c));
  (data.education || []).forEach((e, i) => {
    count(`education #${i + 1} school`, e.school); count(`education #${i + 1} years`, e.years); count(`education #${i + 1} score`, e.score);
  });
  if (data.profile) { count('profile name', data.profile.name); count('profile location', data.profile.location); }
  Object.values(data.links || {}).forEach((l) => { if (l && l.display) count(`${l.label} link text`, l.display); });

  // Reverse direction for the same facts: dates shown in index.html as "Mon YYYY – Mon YYYY" must exist in the data.
  const known = new Set();
  (data.roles || []).forEach((r) => known.add(norm1(r.dates)));
  (data.projects || []).forEach((p) => known.add(norm1(p.dates)));
  const html = maskHtmlComments(readText(indexFile));
  const re = /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+\d{4}\s*[–-]\s*(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+\d{4}|Present)/g;
  const visible = html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, (m) => m.replace(/[^\n]/g, ' ')).replace(/<[^>]*>/g, ' ');
  for (const m of visible.matchAll(re)) {
    const d = norm1(m[0]);
    if (!known.has(d)) err('Facts parity: js/data.js and index.html disagree', `${where('index.html', html, m.index)}  date range "${d}" is in index.html but is not a role/project date in js/data.js`);
  }
  notes.push(`Facts parity: ${n} values from js/data.js looked up in index.html.`);
}

function checkHtmlHygiene(file) {
  const f = rel(file);
  const html = readText(file);
  const noComments = maskHtmlComments(html);

  // target=_blank must carry rel=noopener
  for (const m of noComments.matchAll(/<a\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/\btarget\s*=\s*["']?_blank\b/i.test(tag)) continue;
    const relAttr = /\brel\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    const tokens = ((relAttr && (relAttr[1] ?? relAttr[2] ?? relAttr[3])) || '').toLowerCase().split(/\s+/);
    if (!tokens.includes('noopener')) err('target="_blank" link without rel="noopener"', `${where(f, html, m.index)}  ${tag.slice(0, 120)}`);
  }

  // duplicate ids (script/style bodies excluded)
  const body = maskStyleBodies(maskScriptBodies(noComments));
  const seen = new Map();
  for (const m of body.matchAll(/<[a-z][^>]*?\sid\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    const id = m[1] ?? m[2] ?? m[3];
    if (!id) continue;
    if (seen.has(id)) err('Duplicate id attribute', `id="${id}" at ${where(f, html, m.index)} and ${seen.get(id)}`);
    else seen.set(id, where(f, html, m.index));
  }

  // in-page anchors must exist (index.html only; 404.html links go elsewhere)
  if (path.basename(file).toLowerCase() === 'index.html') {
    const names = new Set(seen.keys());
    for (const m of body.matchAll(/<a\b[^>]*?\shref\s*=\s*(?:"#([^"]*)"|'#([^']*)')/gi)) {
      const id = m[1] ?? m[2];
      if (id && id !== 'top' && !names.has(id)) err('In-page link points at a missing id', `${where(f, html, m.index)}  href="#${id}" has no element with that id`);
    }
    for (const m of body.matchAll(/\baria-(?:controls|labelledby|describedby)\s*=\s*"([^"]+)"/gi)) {
      for (const id of m[1].split(/\s+/)) if (id && !names.has(id)) warn('ARIA reference to a missing id', `${where(f, html, m.index)}  "${id}" is not an id in the page`);
    }
  }

  // JSON-LD must parse
  let ld = 0;
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    if (/^\s*<!--/.test(html.slice(Math.max(0, m.index - 4), m.index + 4))) continue;
    ld++;
    try {
      const parsed = JSON.parse(m[1]);
      if (!parsed['@context'] || !(parsed['@type'] || parsed['@graph'])) warn('JSON-LD', `${where(f, html, m.index)}  parses, but has no @context/@type`);
    } catch (e) {
      err('JSON-LD does not parse', `${where(f, html, m.index)}  ${e.message}`);
    }
  }
  if (path.basename(file).toLowerCase() === 'index.html' && ld === 0) warn('JSON-LD', `${f}: no application/ld+json block found`);

  // external URLs
  const external = new Set();
  const scan = noComments.replace(/<(style)\b[\s\S]*?<\/\1>/gi, ' ');
  for (const m of scan.matchAll(/https?:\/\/[^\s"'<>)\\]+/gi)) {
    const url = decodeEntities(m[0]).replace(/[.,;]+$/, '');
    if (NAMESPACE_URLS.test(url)) continue;
    if (/\bUSERNAME\b|\/REPO\b/.test(url)) { err('Placeholder URL left in the page', `${where(f, html, m.index)}  ${url}`); continue; }
    if (ALLOWED_PROFILE_URLS.includes(url)) continue;
    if (/^https:\/\/github\.com\/Sagarms2005\/[A-Za-z0-9._-]+$/.test(url)) continue; // the owner's own project repositories
    let host = '';
    try { host = new URL(url).host; } catch { warn('External URL', `${where(f, html, m.index)}  unparseable URL ${url}`); continue; }
    if (ALLOWED_HOSTS.has(host)) continue;
    if (!external.has(url)) { external.add(url); err('External URL is not on the allowlist (profile links, own repositories, fonts, own site)', `${where(f, html, m.index)}  ${url}`); }
  }
  // Any mailto must be the known address
  for (const m of noComments.matchAll(/mailto:([^"'?\s>]+)/gi)) {
    if (m[1].toLowerCase() !== '2005sagarms@gmail.com') warn('mailto address differs from the known one', `${where(f, html, m.index)}  ${m[0]}`);
  }
}

/* ------------------------------------------------------------------ main */

function main() {
  if (!fs.existsSync(path.join(ROOT, 'index.html'))) {
    console.error(`check: no index.html in ${ROOT} — run this from the repository root.`);
    process.exit(2);
  }
  const all = walk(ROOT);
  const ext = (f) => path.extname(f).toLowerCase();
  const top = (f) => path.relative(ROOT, f).split(path.sep);
  const files = {
    html: all.filter((f) => ext(f) === '.html' && top(f).length === 1),
    css: all.filter((f) => ext(f) === '.css' && top(f)[0] === 'css'),
    js: all.filter((f) => ext(f) === '.js' && top(f)[0] === 'js'),
  };

  checkLocalReferences(files);
  checkFileNames(all);
  checkHosting();
  checkPrivacy(all);
  checkFactsParity();
  for (const f of files.html) checkHtmlHygiene(f);

  const group = (list) => {
    const by = new Map();
    for (const { group: g, msg } of list) { if (!by.has(g)) by.set(g, []); by.get(g).push(msg); }
    return by;
  };
  const print = (label, list) => {
    for (const [g, msgs] of group(list)) {
      console.log(`\n${label}  ${g}  (${msgs.length})`);
      for (const m of msgs) console.log(`  - ${m}`);
    }
  };
  print('ERROR', errors);
  print('WARN ', warnings);
  console.log('');
  for (const n of notes) console.log(`note: ${n}`);

  const summary = `${files.html.length} html, ${files.css.length} css, ${files.js.length} js, ${all.length} files total`;
  if (errors.length) {
    console.log(`\nFAILED: ${errors.length} error(s), ${warnings.length} warning(s)  [${summary}]`);
    process.exitCode = 1;
  } else {
    console.log(`\nOK: all checks passed, ${warnings.length} warning(s)  [${summary}]`);
  }
}

// Allow importing for tests without running.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
