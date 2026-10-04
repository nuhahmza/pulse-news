import { I18N } from "./i18n.js";

const PH = "img/placeholder.svg";
const $ = (id) => document.getElementById(id);
const CFG = window.PULSE || {};
const CATS = CFG.cats || ["ai", "photo", "video", "instagram", "tiktok"];
const state = { lang: "en", cat: "all", q: "", items: [], updated: null, failed: false };

try {
  state.lang = localStorage.getItem("lang") || ((navigator.language || "").startsWith("ar") ? "ar" : "en");
} catch {
  state.lang = (navigator.language || "").startsWith("ar") ? "ar" : "en";
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function ago(iso) {
  const t = I18N[state.lang].ago;
  const fmt = (unit, n) => (state.lang === "ar" ? t[unit].replace("{n}", n) : `${n}${t[unit]}`);
  const m = Math.round((Date.now() - Date.parse(iso)) / 6e4);
  if (m < 2) return t.now;
  if (m < 60) return fmt("m", m);
  const h = Math.round(m / 60);
  if (h < 24) return fmt("h", h);
  return fmt("d", Math.round(h / 24));
}

const tt = (it) => (state.lang === "ar" && it.title_ar) || it.title;
const ss = (it) => (state.lang === "ar" && it.summary_ar) || it.summary;
const img = (it) =>
  `<img class="thumb" src="${esc(it.image || PH)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='${PH}'">`;
const meta = (it, t) =>
  `<div class="meta"><span class="cat ${esc(it.category)}">${esc(t[it.category])}</span><span>${esc(it.source)}</span><span>· ${ago(it.date)}</span></div>`;

function render() {
  const t = I18N[state.lang];
  document.documentElement.lang = state.lang;
  document.documentElement.dir = t.dir;
  const o = (CFG.text && CFG.text[state.lang]) || {};
  $("siteName").textContent = o.site || t.site;
  $("tag").textContent = o.tag || t.tag;
  $("q").placeholder = t.search;
  $("langBtn").textContent = t.lang;
  document.title = CFG.title ? CFG.title[state.lang] : `${t.site} — AI & Photography News`;
  $("tabs").innerHTML = ["all", ...CATS]
    .map((c) => `<button class="tab" data-c="${c}" aria-pressed="${state.cat === c}">${t[c]}</button>`).join("");
  if (state.updated) $("updated").textContent = `${t.updated}: ${ago(state.updated)}`;

  const q = state.q.toLowerCase();
  const list = state.items.filter((i) =>
    (state.cat === "all" ? CATS.includes(i.category) : i.category === state.cat) &&
    (!q || `${i.title} ${i.summary} ${i.title_ar || ""} ${i.source}`.toLowerCase().includes(q)));

  const heroItem = list.find((i) => i.image);
  const rest = list.filter((i) => i !== heroItem);
  $("hero").innerHTML = heroItem
    ? `<a class="hero" href="${esc(heroItem.link)}" target="_blank" rel="noopener">${img(heroItem)}<div class="body">${meta(heroItem, t)}<h2>${esc(tt(heroItem))}</h2><p>${esc(ss(heroItem))}</p></div></a>`
    : "";
  $("grid").innerHTML = rest
    .map((i) => `<a class="card" href="${esc(i.link)}" target="_blank" rel="noopener">${img(i)}<div class="body">${meta(i, t)}<h3>${esc(tt(i))}</h3><p>${esc(ss(i))}</p></div></a>`)
    .join("");
  $("msg").hidden = list.length > 0;
  if (!list.length) $("msg").textContent = state.failed ? t.loadfail : t.empty;
}

$("tabs").addEventListener("click", (e) => {
  const b = e.target.closest(".tab");
  if (b) { state.cat = b.dataset.c; render(); }
});
$("q").addEventListener("input", (e) => { state.q = e.target.value; render(); });
$("langBtn").addEventListener("click", () => {
  state.lang = state.lang === "en" ? "ar" : "en";
  try { localStorage.setItem("lang", state.lang); } catch {}
  render();
});

render();
try {
  const r = await fetch("data/news.json", { cache: "no-cache" });
  const j = await r.json();
  state.items = j.items;
  state.updated = j.updated;
} catch {
  state.failed = true;
}
render();
