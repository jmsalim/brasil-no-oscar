"use strict";

const FIRST_YEAR = 1960;
const LAST_YEAR = 2026;
const CONF_RANK = { low: 0, medium: 1, high: 2 };
const MACRO_REGIONS = ["Norte", "Nordeste", "Centro-Oeste", "Sudeste", "Sul"];

const state = {
  films: [],         // submissions, sorted by year
  byId: new Map(),
  byYear: new Map(),
  tags: {},          // film id -> tag list
  meta: null,        // submissions file header
  tagMeta: null,     // tags file header
  theme: "",
  minConf: "low",
  selected: null,
};

const $ = (sel) => document.querySelector(sel);

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

function years() {
  const out = [];
  for (let y = FIRST_YEAR; y <= LAST_YEAR; y++) out.push(y);
  return out;
}

function gapYears() {
  return years().filter((y) => !state.byYear.has(y));
}

function directorFilms(name) {
  return state.films.filter((f) => f.directors.includes(name));
}

function returningDirectors() {
  const counts = new Map();
  for (const f of state.films) {
    for (const d of f.directors) counts.set(d, (counts.get(d) || 0) + 1);
  }
  return [...counts]
    .filter(([, n]) => n > 1)
    .map(([name, n]) => ({ name, n, first: directorFilms(name)[0].year }))
    .sort((a, b) => b.n - a.n || a.first - b.first);
}

// Claude's tags for a film, of one type, at or above the chosen confidence.
function filmTags(id, type) {
  return (state.tags[id] || []).filter(
    (t) => (!type || t.type === type) && CONF_RANK[t.confidence] >= CONF_RANK[state.minConf]
  );
}

function matchesTheme(film) {
  return !state.theme || filmTags(film.id, "theme").some((t) => t.value === state.theme);
}

function sourceLabel(key) {
  return key === "wikipedia_list" ? "Wikipedia" : key === "claude_knowledge" ? "Claude's knowledge" : key;
}

async function loadJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

async function init() {
  let subs, tags;
  try {
    [subs, tags] = await Promise.all([
      loadJSON("brazil_oscar_submissions.json"),
      loadJSON("brazil_oscar_tags.json"),
    ]);
  } catch (err) {
    $("#chart").replaceChildren(
      el("p", { class: "error" },
        "Couldn't load the data files (", String(err.message || err), "). ",
        "If you opened index.html straight from disk, serve the folder instead, for example with ",
        el("code", { text: "python3 -m http.server" }), ", then open http://localhost:8000.")
    );
    return;
  }

  state.meta = subs;
  state.tagMeta = tags;
  state.films = [...subs.films].sort((a, b) => a.year - b.year);
  state.tags = tags.films || {};
  for (const f of state.films) {
    state.byId.set(f.id, f);
    state.byYear.set(f.year, f);
  }

  renderStats();
  renderSources();
  renderControls();
  renderAll();
}

function renderStats() {
  const f = state.films;
  const count = (code) => f.filter((x) => x.result_code === code).length;
  const won = f.filter((x) => x.result_code === "won");
  const gaps = gapYears();
  const ret = returningDirectors();
  const tiles = [
    ["Films submitted", f.length, `${FIRST_YEAR} to ${LAST_YEAR}`],
    ["Years with no submission", gaps.length, `of ${LAST_YEAR - FIRST_YEAR + 1} years`],
    ["Nominations", count("nominated") + won.length, `including the win`],
    ["Wins", won.length, won.map((x) => `${x.title_english}, ${x.year}`).join("; ")],
    ["Returning directors", ret.length, `${ret[0].name} leads with ${ret[0].n}`],
  ];
  $("#stats").replaceChildren(
    ...tiles.map(([label, value, note]) =>
      el("div", {}, el("dt", { text: label }), el("dd", {}, String(value), el("small", { text: note })))
    )
  );
}

function renderSources() {
  const m = state.meta;
  const t = state.tagMeta;
  $("#sources").replaceChildren(
    el("p", {},
      el("span", { class: "src src-wiki", text: "Wikipedia" }), " Titles, years, directors, languages, results and notes come from the ",
      el("a", { href: m.source, text: "Wikipedia list of Brazilian submissions" }),
      `, retrieved ${m.retrieved}. Ceremony years are derived (film year + 1).`),
    el("p", {},
      el("span", { class: "src src-claude", text: "Claude's tags" }), " ", t.about),
    el("p", {}, "Data files: ",
      el("a", { href: "brazil_oscar_submissions.json", text: "brazil_oscar_submissions.json" }), " and ",
      el("a", { href: "brazil_oscar_tags.json", text: "brazil_oscar_tags.json" }), ".")
  );
}

function renderControls() {
  const counts = new Map();
  for (const list of Object.values(state.tags)) {
    for (const t of list) if (t.type === "theme") counts.set(t.value, (counts.get(t.value) || 0) + 1);
  }
  const themes = state.tagMeta.vocabulary?.theme || [...counts.keys()].sort();
  const sel = $("#theme-select");
  for (const th of themes) sel.append(el("option", { value: th, text: `${th} (${counts.get(th) || 0})` }));
  sel.addEventListener("change", () => { state.theme = sel.value; renderAll(); });
  const conf = $("#confidence-select");
  conf.addEventListener("change", () => { state.minConf = conf.value; renderAll(); });
}

function renderAll() {
  renderThemeNote();
  renderLegend();
  renderTimeline();
  renderDecadeTable();
  renderFilmTable();
}

/* ---------- Timeline ---------- */

const SVG_NS = "http://www.w3.org/2000/svg";

function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "text") node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c) node.append(c);
  return node;
}

const RESULT_TEXT = {
  won: "Won",
  nominated: "Nominated",
  shortlisted: "Shortlisted",
  not_nominated: "Not nominated",
  disqualified: "Disqualified",
  pending: "Pending",
};

// The mark for a submission's result. Shape and fill both change, so result
// never rests on color alone.
function resultMark(code, cx, cy) {
  switch (code) {
    case "won": return star(cx, cy, 8, 3.6);
    case "nominated": return svg("circle", { cx, cy, r: 5.5, class: "m-nominated" });
    case "shortlisted": return svg("circle", { cx, cy, r: 4.5, class: "m-shortlisted" });
    case "disqualified": {
      const d = 4;
      return svg("path", { class: "m-disq", d: `M${cx - d},${cy - d}L${cx + d},${cy + d}M${cx - d},${cy + d}L${cx + d},${cy - d}` });
    }
    case "pending": return svg("circle", { cx, cy, r: 4.5, class: "m-pending" });
    default: return svg("circle", { cx, cy, r: 3.5, class: "m-not" });
  }
}

function star(cx, cy, outer, inner) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? inner : outer;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return svg("polygon", { points: pts.join(" "), class: "m-won" });
}

// Claude's tags are squares, kept apart from the round result marks:
// solid = high confidence, half-tone = medium, outline = low.
function tagMark(conf, cx, cy) {
  const s = 9;
  return svg("rect", { x: cx - s / 2, y: cy - s / 2, width: s, height: s, rx: 2, class: `t-${conf}` });
}

function laneOrder(type, key = "value") {
  const first = new Map();
  for (const f of state.films) {
    for (const t of state.tags[f.id] || []) {
      if (t.type !== type) continue;
      const v = t[key];
      if (!first.has(v)) first.set(v, f.year);
    }
  }
  return [...first].sort((a, b) => a[1] - b[1]).map(([v]) => v);
}

const textWidth = (s, px = 11) => s.length * px * 0.56;

let lastChartWidth = 0;

function renderTimeline() {
  const host = $("#chart");
  const avail = host.clientWidth || 1000;
  lastChartWidth = avail;
  const narrow = avail < 700;
  const labelW = narrow ? 128 : 210;
  const nYears = LAST_YEAR - FIRST_YEAR + 1;
  const padX = 6;
  const yearW = Math.max(14, (avail - labelW - padX * 2 - 2) / nYears);
  const plotW = Math.ceil(nYears * yearW + padX * 2);
  const xOf = (y) => padX + (y - FIRST_YEAR) * yearW + yearW / 2;
  const laneH = 20;

  // Label the nominations and the win, stacked in levels above the marks so
  // that no label overlaps another and no leader line runs through a label.
  const labels0 = state.films
    .filter((f) => f.result_code === "nominated" || f.result_code === "won")
    .map((f) => {
      const text = f.result_code === "won" ? `${f.title_english} · won` : f.title_english;
      const w = textWidth(text);
      const cx = xOf(f.year);
      const rightAnchor = cx - 4 + w > plotW - 2;
      const x0 = rightAnchor ? cx + 4 - w : cx - 4;
      return { f, text, cx, rightAnchor, x0, x1: x0 + w, level: -1 };
    });
  // Left-anchored labels place right to left, right-anchored ones left to right,
  // so the leader of each later-placed label clears the earlier ones.
  const order = [
    ...labels0.filter((l) => !l.rightAnchor).reverse(),
    ...labels0.filter((l) => l.rightAnchor),
  ];
  const done = [];
  for (const l of order) {
    const ok = (lv) => done.every((o) =>
      (o.level !== lv || l.x1 + 6 < o.x0 || o.x1 + 6 < l.x0) &&
      (o.level >= lv || l.cx < o.x0 - 2 || l.cx > o.x1 + 2) &&
      (o.level <= lv || o.cx < l.x0 - 2 || o.cx > l.x1 + 2));
    let lv = 0;
    while (!ok(lv) && lv < 8) lv++;
    l.level = lv;
    done.push(l);
  }
  const placed = labels0;
  const levelH = 15;
  const labelsH = (Math.max(-1, ...placed.map((p) => p.level)) + 1) * levelH + 6;

  const rows = [];
  let y = 0;
  const pushRow = (row) => { row.y = y; rows.push(row); y += row.h; };

  pushRow({ kind: "axis", h: 26 });
  pushRow({ kind: "section", h: 34, title: "Submissions", src: "wiki" });
  pushRow({ kind: "subs", h: labelsH + 28, labelsH, label: "Result" });
  pushRow({ kind: "section", h: 38, title: "Movement", src: "claude" });
  for (const m of laneOrder("movement")) pushRow({ kind: "movement", h: laneH, label: m, value: m });
  pushRow({ kind: "section", h: 38, title: narrow ? "Setting" : "Setting (macro-region)", src: "claude" });
  for (const r of MACRO_REGIONS) pushRow({ kind: "region", h: laneH, label: r, value: r });
  pushRow({ kind: "section", h: 38, title: narrow ? "Directors, 2+ films" : "Directors with 2+ films", src: "wiki" });
  for (const d of returningDirectors()) pushRow({ kind: "director", h: laneH, label: `${d.name} (${d.n})`, value: d.name });
  pushRow({ kind: "axis", h: 26, bottom: true });
  const height = y;
  const firstBody = rows[1].y;
  const lastBody = rows[rows.length - 1].y;

  /* Lane labels: their own SVG so they stay put while the plot scrolls. */
  const labels = svg("svg", { width: labelW, height, "aria-hidden": "true" });
  for (const r of rows) {
    if (r.kind === "section") {
      labels.append(svg("text", { x: 0, y: r.y + 18, class: "section-title", text: r.title }));
      const badge = r.src === "wiki" ? "Wikipedia" : "Claude's tags";
      const bw = textWidth(badge, 10) + 10;
      labels.append(
        svg("rect", { x: 0, y: r.y + 23, width: bw, height: 13, rx: 3, style: `fill: var(--${r.src}-bg)` }),
        svg("text", { x: 5, y: r.y + 33, style: `font-size:10px;font-weight:600;fill:var(--${r.src}-ink)`, text: badge })
      );
    } else if (r.label) {
      const max = Math.floor((labelW - 8) / (12 * 0.55));
      const text = r.label.length > max ? r.label.slice(0, max - 1) + "…" : r.label;
      const t = svg("text", { x: 0, y: r.y + r.h - (r.kind === "subs" ? 10 : 6), class: "lane-label", text });
      if (text !== r.label) t.append(svg("title", { text: r.label }));
      labels.append(t);
    }
  }

  /* Plot. */
  const plot = svg("svg", {
    width: plotW, height, role: "group",
    "aria-label": `Timeline of Brazil's submissions, ${FIRST_YEAR} to ${LAST_YEAR}`,
  });
  const bg = svg("g");
  const fg = svg("g");
  plot.append(bg, fg);

  // Years with no submission: a band through every row.
  for (const gy of gapYears()) {
    bg.append(svg("rect", { x: xOf(gy) - yearW / 2, y: firstBody, width: yearW, height: lastBody - firstBody, class: "gap-band" }));
  }
  // Decade gridlines.
  for (let d = FIRST_YEAR; d <= LAST_YEAR; d += 10) {
    const x = xOf(d) - yearW / 2;
    bg.append(svg("line", { x1: x, x2: x, y1: firstBody - 4, y2: lastBody + 4, class: "grid-line" }));
  }

  for (const r of rows) {
    if (r.kind === "axis") {
      const ty = r.bottom ? r.y + 18 : r.y + 14;
      for (let d = FIRST_YEAR; d <= LAST_YEAR; d += 10) {
        fg.append(svg("text", { x: xOf(d) - yearW / 2 + 2, y: ty, class: "axis-tick", text: `${d}s` }));
      }
      const ly = r.bottom ? r.y + 2 : r.y + r.h - 2;
      fg.append(svg("line", { x1: padX, x2: plotW - padX, y1: ly, y2: ly, class: "axis-line" }));
    } else if (r.kind === "section") {
      fg.append(svg("line", { x1: padX, x2: plotW - padX, y1: r.y + r.h - 0.5, y2: r.y + r.h - 0.5, class: "grid-line" }));
    } else if (r.kind === "subs") {
      const cy = r.y + r.labelsH + 14;
      for (const yr of years()) {
        const f = state.byYear.get(yr);
        const cx = xOf(yr);
        if (!f) {
          const g = svg("g", { class: "gap-year" },
            svg("rect", { x: cx - yearW / 2, y: r.y, width: yearW, height: r.h, fill: "transparent" }),
            svg("line", { x1: cx - 3, x2: cx + 3, y1: cy, y2: cy, class: "m-none" }));
          g.addEventListener("mouseenter", (e) => showTip(e, gapTip(yr), cx));
          g.addEventListener("mouseleave", hideTip);
          fg.append(g);
          continue;
        }
        fg.append(filmNode(f, { x: cx - yearW / 2, y: r.y, w: yearW, h: r.h }, resultMark(f.result_code, cx, cy), cx, null, true));
      }
      for (const p of placed) {
        const ty = r.y + r.labelsH - 8 - p.level * levelH;
        const fade = matchesTheme(p.f) ? null : "dim";
        fg.append(
          svg("line", { x1: p.cx, x2: p.cx, y1: ty + 3, y2: cy - 8, class: "leader " + (fade || "") }),
          svg("text", {
            x: p.rightAnchor ? p.cx + 4 : p.cx - 4, y: ty, class: "film-label " + (fade || ""),
            "text-anchor": p.rightAnchor ? "end" : "start",
            style: p.f.result_code === "won" ? "font-weight:600" : null, text: p.text,
          })
        );
      }
    } else if (r.kind === "movement" || r.kind === "region") {
      const cy = r.y + r.h / 2;
      const key = r.kind === "region" ? "macro_region" : "value";
      const type = r.kind;
      for (const f of state.films) {
        const tag = filmTags(f.id, type).find((t) => t[key] === r.value);
        if (!tag) continue;
        const cx = xOf(f.year);
        fg.append(filmNode(f, { x: cx - yearW / 2, y: r.y, w: yearW, h: r.h }, tagMark(tag.confidence, cx, cy), cx, tag));
      }
    } else if (r.kind === "director") {
      const cy = r.y + r.h / 2;
      const list = directorFilms(r.value);
      const x1 = xOf(list[0].year);
      const x2 = xOf(list[list.length - 1].year);
      fg.append(svg("line", { x1, x2, y1: cy, y2: cy, class: "axis-line" }));
      for (const f of list) {
        const cx = xOf(f.year);
        fg.append(filmNode(f, { x: cx - yearW / 2, y: r.y, w: yearW, h: r.h }, resultMark(f.result_code, cx, cy), cx));
      }
    }
  }

  const guide = svg("line", { y1: firstBody, y2: lastBody, class: "hover-guide" });
  plot.append(guide);
  hoverGuide = guide;

  const scroller = el("div", { class: "chart-scroll" });
  scroller.append(plot);
  const labelBox = el("div", { class: "chart-labels" });
  labelBox.append(labels);
  const prevScroll = host.querySelector(".chart-scroll")?.scrollLeft || 0;
  host.replaceChildren(labelBox, scroller);
  scroller.scrollLeft = prevScroll;
}

let hoverGuide = null;

function filmNode(f, box, mark, cx, tag, focusable) {
  const g = svg("g", {
    class: "film" + (matchesTheme(f) ? "" : " dim") + (state.selected === f.id ? " selected" : ""),
    "data-id": f.id,
  });
  if (focusable) {
    g.setAttribute("tabindex", "0");
    g.setAttribute("role", "button");
    g.setAttribute("aria-label", `${f.year}: ${f.title_english}, directed by ${f.directors.join(" and ")}. ${f.result}.`);
  }
  g.append(svg("rect", { x: box.x + 0.5, y: box.y + 1, width: box.w - 1, height: box.h - 2, rx: 3, class: "hit" }), mark);
  const tip = () => filmTip(f, tag);
  g.addEventListener("mouseenter", (e) => showTip(e, tip(), cx));
  g.addEventListener("mousemove", moveTip);
  g.addEventListener("mouseleave", hideTip);
  g.addEventListener("focus", () => showTip(null, tip(), cx, g));
  g.addEventListener("blur", hideTip);
  g.addEventListener("click", () => selectFilm(f.id, false));
  g.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectFilm(f.id, true); }
  });
  return g;
}

function filmTip(f, tag) {
  const parts = [
    el("div", { class: "tt-year", text: `${f.year} · ${f.ceremony} ceremony (${f.ceremony_year})` }),
    el("div", { class: "tt-title", text: f.title_english }),
    f.title_original && f.title_original !== f.title_english ? el("div", { class: "muted", text: f.title_original }) : null,
    el("div", { text: f.directors.join(", ") }),
    el("div", {}, el("strong", { text: f.result })),
  ];
  if (tag) {
    parts.push(el("div", { style: "margin-top:4px" },
      el("span", { class: "src src-claude", text: "Claude's tag" }), " ",
      `${tag.type === "region" && tag.macro_region !== tag.value ? `${tag.value} (${tag.macro_region})` : tag.value}, ${tag.confidence} confidence`));
  }
  if (state.theme && !matchesTheme(f)) parts.push(el("div", { class: "muted", text: `Not tagged “${state.theme}”` }));
  return parts;
}

function gapTip(year) {
  return [el("div", { class: "tt-year", text: String(year) }), el("div", { class: "tt-title", text: "No submission" })];
}

function showTip(e, content, cx, anchor) {
  const tip = $("#tooltip");
  tip.replaceChildren(...content.filter(Boolean));
  tip.hidden = false;
  if (hoverGuide) {
    hoverGuide.setAttribute("x1", cx);
    hoverGuide.setAttribute("x2", cx);
    hoverGuide.classList.add("on");
  }
  if (e) moveTip(e);
  else if (anchor) {
    const b = anchor.getBoundingClientRect();
    placeTip(b.right + 8, b.top);
  }
}

function moveTip(e) { placeTip(e.clientX + 14, e.clientY + 14); }

function placeTip(x, y) {
  const tip = $("#tooltip");
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  if (x + w > window.innerWidth - 8) x = Math.max(8, x - w - 28);
  if (y + h > window.innerHeight - 8) y = Math.max(8, y - h - 28);
  tip.style.left = `${x}px`;
  tip.style.top = `${y}px`;
}

function hideTip() {
  $("#tooltip").hidden = true;
  hoverGuide?.classList.remove("on");
}

function selectFilm(id, moveFocus) {
  state.selected = id;
  document.querySelectorAll(".film").forEach((n) => n.classList.toggle("selected", n.dataset.id === id));
  renderDetail();
  const panel = $("#detail");
  const top = panel.getBoundingClientRect().top;
  if (moveFocus) panel.focus({ preventScroll: true });
  if (top > window.innerHeight - 120 || top < 0) panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---------- Film record ---------- */

function confBadge(conf) {
  return el("span", { class: "conf", title: `${conf} confidence` },
    legendSwatch((x, y) => tagMark(conf, x, y), 12, 12), `${conf} confidence`);
}

function renderDetail() {
  const f = state.byId.get(state.selected);
  const panel = $("#detail");
  if (!f) return;
  const others = (name) => directorFilms(name).filter((x) => x.id !== f.id);
  const film = (x) => el("button", {
    type: "button", class: "linkish", onclick: () => selectFilm(x.id, true),
    text: `${x.title_english} (${x.year})`,
  });
  const facts = [
    ["Directed by", el("ul", {}, f.directors.map((d) => {
      const o = others(d);
      return el("li", {}, d, o.length ? el("span", { class: "muted small" }, " · also submitted: ",
        o.flatMap((x, i) => [i ? ", " : "", film(x)])) : null);
    }))],
    ["Language", f.languages.join(", ")],
    ["Ceremony", `${f.ceremony} Academy Awards, held ${f.ceremony_year}`],
    ["Result", el("span", { class: "result-pill" }, legendSwatch((x, y) => resultMark(f.result_code, x, y)), f.result)],
    f.notes ? ["Notes", f.notes] : null,
    f.brazilian_shortlist_competitors?.length
      ? ["Also on Brazil's shortlist", f.brazilian_shortlist_competitors.join(", ")]
      : null,
  ].filter(Boolean);

  const tags = state.tags[f.id] || [];
  const sources = state.tagMeta.sources || {};
  const tagOrder = { movement: 0, region: 1, theme: 2 };
  const tagItems = [...tags]
    .sort((a, b) => tagOrder[a.type] - tagOrder[b.type] || CONF_RANK[b.confidence] - CONF_RANK[a.confidence])
    .map((t) => {
      let value = el("span", {}, t.value);
      if (t.type === "region") {
        const where = [t.place, t.state && t.state !== t.place && t.state !== t.value ? t.state : null, t.macro_region !== t.value ? t.macro_region : null]
          .filter(Boolean).join(" · ");
        value = el("span", {}, t.value, where ? el("span", { class: "tag-place", text: where }) : null);
      }
      return el("li", {},
        el("span", { class: "tag-type", text: t.type === "region" ? "setting" : t.type }),
        el("span", {}, value, el("span", { class: "tag-place", text: `Source: ${sourceLabel(t.source)}` })),
        confBadge(t.confidence));
    });

  panel.replaceChildren(
    el("h2", { id: "detail-title", text: "Film record" }),
    el("p", { class: "detail-year", text: `${f.year} submission` }),
    el("h3", { class: "detail-title", text: f.title_english }),
    f.title_original && f.title_original !== f.title_english
      ? el("p", { class: "detail-original", text: f.title_original }) : null,
    el("div", { class: "source-box" },
      el("p", {}, el("span", { class: "src src-wiki", text: "Wikipedia" }), " ",
        el("span", { class: "muted small" }, "From the ", el("a", { href: state.meta.source, text: "Wikipedia list" }),
          `, retrieved ${state.meta.retrieved}. The ceremony year is derived.`)),
      el("dl", { class: "facts" }, facts.flatMap(([k, v]) => [el("dt", { text: k }), el("dd", {}, v)])),
      f.parse_flags?.length
        ? el("details", {}, el("summary", { class: "small muted", text: `Parsing notes (${f.parse_flags.length})` }),
            el("ul", { class: "flags" }, f.parse_flags.map((p) => el("li", { text: p }))))
        : null),
    el("div", { class: "source-box claude" },
      el("p", {}, el("span", { class: "src src-claude", text: "Claude's tags" }), " ",
        el("span", { class: "muted small", text: sources.claude_knowledge || "Not verified against a source." })),
      tagItems.length ? el("ul", { class: "tag-list" }, tagItems) : el("p", { class: "muted", text: "No tags for this film." })),
    el("p", { class: "small" }, el("a", { href: "#timeline-title", text: "Back to the timeline" }))
  );
}

/* ---------- Tables ---------- */

const DECADES = [1960, 1970, 1980, 1990, 2000, 2010, 2020];

function renderDecadeTable() {
  const films = state.films.filter(matchesTheme);
  const inDecade = (y, d) => y >= d && y < d + 10 && y <= LAST_YEAR;
  const head = el("tr", {}, el("th", { text: "" }), DECADES.map((d) => el("th", { class: "num", text: `${d}s` })));
  const cell = (n) => el("td", { class: "num" + (n ? "" : " zero"), text: String(n) });
  const rows = [
    el("tr", {}, el("th", { scope: "row" }, "Films submitted ", el("span", { class: "src src-wiki", text: "Wikipedia" })),
      DECADES.map((d) => cell(films.filter((f) => inDecade(f.year, d)).length))),
    state.theme ? null : el("tr", {}, el("th", { scope: "row", text: "Years with none" }),
      DECADES.map((d) => cell(gapYears().filter((y) => inDecade(y, d)).length))),
    ...laneOrder("movement").map((m) =>
      el("tr", {}, el("th", { scope: "row", text: m }),
        DECADES.map((d) => cell(films.filter((f) => inDecade(f.year, d) &&
          filmTags(f.id, "movement").some((t) => t.value === m)).length)))),
  ];
  const caption = state.theme ? `Only films tagged “${state.theme}”.` : null;
  $("#decade-table").replaceChildren(
    caption ? el("p", { class: "small muted", text: caption }) : "",
    el("table", { class: "decade-table" }, el("thead", {}, head), el("tbody", {}, rows))
  );
}

function tagCell(id, type) {
  const list = filmTags(id, type);
  return el("td", {}, list.flatMap((t, i) => [
    i ? el("br") : null,
    t.type === "region" && t.macro_region && t.macro_region !== t.value ? `${t.value}, ${t.macro_region}` : t.value,
    t.confidence === "high" ? null : el("span", { class: "conf-note", text: ` (${t.confidence})` }),
  ]));
}

function renderFilmTable() {
  const head = el("tr", {}, ["Year", "Film", "Director", "Result", "Movement", "Setting", "Themes"].map((h, i) =>
    el("th", { class: i === 0 ? "num" : null }, h,
      i >= 4 ? el("span", { class: "src src-claude", style: "margin-left:6px", text: "Claude" }) : null)));
  const rows = years().map((y) => {
    const f = state.byYear.get(y);
    if (!f) return el("tr", { class: "gap-row" }, el("td", { class: "num", text: String(y) }), el("td", { colspan: 6, text: "No submission" }));
    return el("tr", { class: matchesTheme(f) ? null : "dim" },
      el("td", { class: "num", text: String(y) }),
      el("td", {}, el("button", { type: "button", onclick: () => selectFilm(f.id, true), text: f.title_english }),
        f.title_original && f.title_original !== f.title_english ? el("div", { class: "muted small", text: f.title_original }) : null),
      el("td", { text: f.directors.join(", ") }),
      el("td", { text: f.result }),
      tagCell(f.id, "movement"),
      tagCell(f.id, "region"),
      tagCell(f.id, "theme"));
  });
  $("#film-table").replaceChildren(
    el("p", { class: "small muted", text: "Tags below high confidence are marked (medium) or (low). The confidence setting above applies here too." }),
    el("table", { class: "film-table" }, el("thead", {}, head), el("tbody", {}, rows))
  );
}

function renderThemeNote() {
  const note = $("#theme-note");
  if (!state.theme) { note.hidden = true; return; }
  const hits = state.films.filter(matchesTheme);
  note.hidden = false;
  note.replaceChildren(
    el("strong", { text: `${hits.length} film${hits.length === 1 ? "" : "s"}` }),
    ` tagged “${state.theme}”`,
    hits.length ? ` (${hits.map((f) => f.year).join(", ")}). ` : ". ",
    "Other films are faded. ",
    el("span", { class: "src src-claude", text: "Claude's tags" })
  );
}

function legendSwatch(build, w = 18, h = 16) {
  const s = svg("svg", { width: w, height: h, "aria-hidden": "true" });
  s.append(build(w / 2, h / 2));
  return s;
}

function renderLegend() {
  const res = [
    ["won", "Won"], ["nominated", "Nominated"], ["shortlisted", "Shortlisted"],
    ["not_nominated", "Not nominated"], ["disqualified", "Disqualified"], ["pending", "Pending"],
  ];
  const gapSw = svg("svg", { width: 18, height: 16, "aria-hidden": "true" });
  gapSw.append(svg("rect", { x: 2, y: 0, width: 14, height: 16, class: "gap-band" }),
    svg("line", { x1: 6, x2: 12, y1: 8, y2: 8, class: "m-none" }));
  $("#legend").replaceChildren(
    el("div", { class: "legend-group" },
      el("strong", { text: "Result" }), el("span", { class: "src src-wiki", text: "Wikipedia" }),
      ...res.map(([code, label]) => el("span", { class: "legend-item" }, legendSwatch((x, y) => resultMark(code, x, y)), label)),
      el("span", { class: "legend-item" }, gapSw, "No submission that year")),
    el("div", { class: "legend-group" },
      el("strong", { text: "Tag confidence" }), el("span", { class: "src src-claude", text: "Claude's tags" }),
      ...["high", "medium", "low"].map((c) =>
        el("span", { class: "legend-item" }, legendSwatch((x, y) => tagMark(c, x, y)), c[0].toUpperCase() + c.slice(1))))
  );
}

let resizeTimer = 0;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (state.films.length && Math.abs($("#chart").clientWidth - lastChartWidth) > 4) renderTimeline();
  }, 150);
});

document.addEventListener("DOMContentLoaded", init);
