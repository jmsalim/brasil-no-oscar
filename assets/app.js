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
  // Filled in by the timeline, detail and table sections below.
}

document.addEventListener("DOMContentLoaded", init);
