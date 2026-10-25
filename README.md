# Sagar M S — portfolio

The source of my personal portfolio: a single-page site in plain HTML, CSS and JavaScript, with no build step.

**Live site: <https://sagarms2005.github.io/>**

## What's inside

- **Editorial single-page layout.** Experience, four projects, skills, education and contact on one page, readable with JavaScript switched off.
- **Interactive hero.** A contour field that reacts to the pointer, with a quiet ambient video loop behind it.
- **Project gallery.** The four project covers hang as a framed wall above the project list; a cover tilts toward the pointer, plays its drawing on hover or focus, and opens its row on click. On narrow screens the wall is a swipeable carousel.
- **Project illustrations.** One small diagram per project, drawn in SVG and animated when it scrolls into view.
- **Hairline details.** Small line drawings in the section heads, an "Outside the code" strip for the interests on the resume, and a closing mark in the footer. They draw themselves once, loop only while on screen, and stay still for reduced motion.
- **Quiet atmosphere.** Contour lines drift between the sections, a thin scroll compass sits in the margin on wide screens, and the accent phrase in each headline gets a drawn underline. Everything here is decoration and the page is complete without it.
- **Skills stack map.** An interactive graph of the stack, linked to a skills filter, so selecting a skill shows where it appears in the work.
- **Developer terminal.** Press Ctrl + backtick (`` ` ``) for a small shell with commands such as `projects`, `skills` and `contact`.
- **Command palette.** Ctrl/Cmd + K jumps to any section, skill or project.
- **"How I ship".** A scroll-driven walk through the cloud deployment project: containerize, automate, deploy, store, observe.
- **Light and dark themes,** reduced-motion and no-JavaScript fallbacks.
- **Privacy-minded.** No analytics, no cookies, no trackers. The browser stores only your theme and hero-pause choice on your own device, plus your scroll position and terminal history for the current tab.

## Built with

- Plain HTML, CSS and vanilla JavaScript. No build step, no frameworks, no npm.
- Google Fonts (Newsreader and JetBrains Mono) is the only external request.
- Zero third-party scripts.

## Project structure

```
index.html            the page (all content is real markup)
404.html              page-not-found page
robots.txt, sitemap.xml
css/
  styles.css          base styles, color and type tokens
  fx/                 one stylesheet per effect
js/
  data.js             the facts the effects and palette read
  core.js             shared helpers (window.Portfolio)
  main.js             base page behavior
  fx/                 one module per effect, plus the terminal commands
assets/
  images/             photo, share card, icons
  video/              hero loops and posters
  sagar-m-s-resume.pdf
scripts/check.mjs     safety checks (no dependencies)
.github/workflows/    runs the checks on every push
```

## Run it locally

- Double-click `index.html`, or
- serve the folder like a real site: `python -m http.server 8000`, then open <http://localhost:8000>.

## Quality checks

```
node scripts/check.mjs
```

Needs Node 20 or newer and installs nothing. The same script runs on every push through a read-only GitHub Actions workflow. It checks:

- **Relative references:** every link, image, script, stylesheet and video resolves to a real file, with the exact-case name that GitHub Pages requires.
- **Privacy guard:** withheld personal details never appear in any text file.
- **Data and HTML parity:** `js/data.js` and `index.html` cannot drift apart.
- **Link hygiene:** external links use `rel="noopener"`, only known hosts are referenced, ids are unique and in-page anchors exist.
- **Hosting files:** `404.html`, `robots.txt` and `sitemap.xml` exist and point at the site's own address.

## Performance and accessibility

Measured on the final build:

- About 252 KB gzipped for all of the HTML, CSS, JavaScript and page images (roughly 750 KB uncompressed; a first visit on a phone fetches only one 6 to 12 KB portrait, a desktop visit adds the 9 to 25 KB About portrait when it scrolls near), not counting web fonts, the hero video or the resume PDF.
- First and largest paint under 1.5 s (about 0.8 to 1.2 s across runs) with the CPU throttled 4x, on a fast connection.
- Cumulative layout shift below 0.01.
- The hero video is not downloaded on phones, with Save-Data on, or with reduced motion; those visitors get a still image.
- The skills map, the project illustrations and the terminal's command shell are fetched only when they are about to be needed, and every effect is optional: the page is complete without any of them.
- axe-core found 0 violations in the light and dark themes.
- Keyboard-friendly: skip link, visible focus, and the palette and terminal work without a mouse.

## Contact

- Email: [2005sagarms@gmail.com](mailto:2005sagarms@gmail.com)
- LinkedIn: [linkedin.com/in/sagar-m-s-867102337](https://www.linkedin.com/in/sagar-m-s-867102337/)
- GitHub: [github.com/Sagarms2005](https://github.com/Sagarms2005)
- LeetCode: [leetcode.com/u/2005sagarms](https://leetcode.com/u/2005sagarms/)
