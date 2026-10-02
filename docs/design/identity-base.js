const NOW = 12.23,
  H0 = 6,
  H1 = 18;
const pct = (t) => (((t - H0) / (H1 - H0)) * 100).toFixed(2);
const PEOPLE = [
  {
    n: "Jan Peeters",
    i: "JP",
    s: "work",
    from: 8.03,
    br: [],
    start: "08:02",
    label: "Werkt sinds 08:02",
    dur: "4u 12",
  },
  {
    n: "Els Maes",
    i: "EM",
    s: "break",
    from: 7.5,
    br: [[12.08, NOW]],
    start: "07:30",
    label: "Pauze sinds 12:05",
    dur: "4u 35",
  },
  {
    n: "Mohamed Amrani",
    i: "MA",
    s: "work",
    from: 9,
    br: [[11, 11.25]],
    start: "09:00",
    label: "Werkt sinds 09:00",
    dur: "3u 00",
  },
  {
    n: "Tom Claes",
    i: "TC",
    s: "work",
    from: 8.25,
    br: [],
    start: "08:15",
    label: "Werkt sinds 08:15",
    dur: "3u 59",
  },
  {
    n: "An Jacobs",
    i: "AJ",
    s: "warn",
    from: 6,
    br: [],
    start: "gisteren",
    label: "Gisteren niet uitgeklokt",
    dur: "—",
  },
  {
    n: "Sara Willems",
    i: "SW",
    s: "done",
    from: 7,
    to: 12,
    br: [[9.5, 9.75]],
    start: "07:00",
    label: "Gestopt om 12:00",
    dur: "4u 45",
  },
  {
    n: "Lotte De Smet",
    i: "LD",
    s: "plan",
    from: 13,
    to: 17,
    br: [],
    start: "—",
    label: "Gepland vanaf 13:00",
    dur: "—",
  },
];
const STATUS = {
  work: "Aan het werk",
  break: "Op pauze",
  warn: "Aandacht",
  done: "Klaar",
  plan: "Nog niet gestart",
};
const bar = (p) => {
  const end = p.to ?? NOW;
  let h = `<span class="bar ${p.s}" style="left:${pct(p.from)}%;width:${pct(end) - pct(p.from)}%"></span>`;
  for (const [a, b] of p.br)
    h += `<span class="brk" style="left:${pct(a)}%;width:${Math.max(pct(b) - pct(a), 0.8)}%"></span>`;
  return h;
};
const LOGO = (h) =>
  `<svg height="${h}" viewBox="0 0 285 100"><g fill="none" stroke="currentColor" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"><path d="M46.3 35.7A23 23 0 1 0 46.3 68.3"/><path d="M72 15V75"/><circle cx="117" cy="52" r="23"/><path d="M162 29 202 75M202 29 162 75"/><circle cx="247" cy="52" r="23"/><path d="M270 29V75"/></g><circle cx="53" cy="52" r="6.5" fill="#22c55e"/></svg>`;
document
  .querySelectorAll(".logo")
  .forEach((e) => (e.innerHTML = LOGO(e.dataset.h || 30)));
const fill = (sel, fn, list = PEOPLE) =>
  document.querySelectorAll(sel).forEach((e) => (e.innerHTML = list.map(fn).join("")));
