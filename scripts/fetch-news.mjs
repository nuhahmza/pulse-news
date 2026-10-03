// Pulls RSS/Atom feeds from scripts/sources.json and writes site/data/news.json
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(root, "site", "data", "news.json");
const PER_FEED = 15;
const MAX_ITEMS = 320;
const MAX_AGE_DAYS = 14;
const UA = "Mozilla/5.0 (compatible; PulseNewsBot/1.0; +https://netlify.app)";

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", processEntities: true });
const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const text = (v) => (v == null ? "" : typeof v === "object" ? String(v["#text"] ?? "") : String(v));

const decode = (t) =>
  t.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
   .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
   .replace(/&nbsp;/g, " ").replace(/&hellip;/g, "…").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
   .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const strip = (html) => decode(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

async function get(url, ms = 15000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "*/*" }, signal: ctl.signal, redirect: "follow" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally { clearTimeout(t); }
}

function abs(u, base) {
  try { return new URL(u, base).href; } catch { return ""; }
}

function imageFromItem(it, link) {
  for (const m of [...arr(it["media:content"]), ...arr(it["media:thumbnail"]), ...arr(it["media:group"]?.["media:content"])]) {
    const u = m?.["@_url"];
    const type = m?.["@_type"] || "";
    if (u && (!type || type.startsWith("image")) && !/\.(mp4|webm)$/i.test(u)) return abs(u, link);
  }
  for (const e of arr(it.enclosure)) {
    if (e?.["@_url"] && (e["@_type"] || "").startsWith("image")) return abs(e["@_url"], link);
  }
  const html = text(it["content:encoded"]) + text(it.description) + text(it.content) + text(it.summary);
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (m && !/pixel|tracking|1x1|spacer/i.test(m[1])) return abs(m[1], link);
  return "";
}

async function ogImage(link) {
  try {
    const html = (await get(link, 8000)).slice(0, 120000);
    const m = html.match(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]+content=["']([^"']+)["']/i)
           || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|twitter:image)["']/i);
    return m ? abs(m[1].replace(/&amp;/g, "&"), link) : "";
  } catch { return ""; }
}

function parseFeed(xml, src) {
  const j = parser.parse(xml);
  const items = [];
  if (j.rss) {
    for (const it of arr(j.rss.channel?.item).slice(0, src.scan || PER_FEED)) {
      const link = text(it.link).trim();
      items.push({
        title: strip(text(it.title)), link,
        date: it.pubDate || it["dc:date"],
        summary: strip(text(it.description) || text(it["content:encoded"])).slice(0, 220),
        image: imageFromItem(it, link),
      });
    }
  } else if (j.feed) {
    for (const it of arr(j.feed.entry).slice(0, src.scan || PER_FEED)) {
      const l = arr(it.link).find((x) => !x["@_rel"] || x["@_rel"] === "alternate") || arr(it.link)[0];
      const link = l?.["@_href"] || "";
      items.push({
        title: strip(text(it.title)), link,
        date: it.published || it.updated,
        summary: strip(text(it.summary) || text(it.content)).slice(0, 220),
        image: imageFromItem(it, link),
      });
    }
  }
  const re = src.filter ? new RegExp(src.filter, "i") : null;
  return items.filter((i) => i.title && i.link && (!re || re.test(i.title + " " + i.summary))).slice(0, src.keep || PER_FEED).map((i) => ({ ...i, source: src.name, category: src.category, maxAge: src.maxAgeDays || (src.category === "instagram" || src.category === "tiktok" ? 45 : MAX_AGE_DAYS) }));
}

async function pool(list, n, fn) {
  const q = [...list];
  await Promise.all(Array.from({ length: n }, async () => { while (q.length) await fn(q.shift()); }));
}

const sources = JSON.parse(await readFile(path.join(root, "scripts", "sources.json"), "utf8"));
const report = [];
let all = [];

await pool(sources, 5, async (src) => {
  try {
    const items = parseFeed(await get(src.url), src);
    all.push(...items);
    report.push(`ok    ${src.name} (${items.length})`);
  } catch (e) { report.push(`FAIL  ${src.name}: ${e.message}`); }
});

// date filter, de-dupe, sort
const seen = new Set();
all = all
  .map((i) => ({ ...i, ts: Date.parse(i.date) || 0 }))
  .filter((i) => i.ts && i.ts > Date.now() - i.maxAge * 864e5 && i.ts < Date.now() + 36e5)
  .sort((a, b) => b.ts - a.ts)
  .filter((i) => { const k = i.link.split("?")[0]; if (seen.has(k)) return false; seen.add(k); return true; })
  .slice(0, MAX_ITEMS);

// fill missing thumbnails from og:image
await pool(all.filter((i) => !i.image), 6, async (i) => { i.image = await ogImage(i.link); });

const out = all.map(({ title, link, summary, image, source, category, ts }) => ({
  title, link, summary, image, source, category, date: new Date(ts).toISOString(),
}));

// Keep previous data if everything failed
if (out.length === 0) {
  console.error(report.join("\n"));
  console.error("No items fetched; keeping existing news.json");
  process.exit(0);
}

// Arabic translation (Claude API). Reuses earlier translations; skipped without ANTHROPIC_API_KEY.
const MODEL = process.env.TRANSLATE_MODEL || "claude-haiku-4-5-20251001";
let prev = [];
try { prev = JSON.parse(await readFile(OUT, "utf8")).items || []; } catch {}
const cache = new Map(prev.filter((p) => p.title_ar).map((p) => [p.link, p]));
for (const i of out) {
  const c = cache.get(i.link);
  if (c) { i.title_ar = c.title_ar; i.summary_ar = c.summary_ar; }
}

async function translateBatch(batch) {
  const payload = batch.map((i, n) => ({ id: n, title: i.title, summary: i.summary }));
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8000,
      system: "You translate news headlines and summaries into clear Modern Standard Arabic. Keep product names, brands and people's names in Latin script where that is customary. Reply with ONLY a JSON array of {id,title,summary} objects, same ids, no commentary.",
      messages: [{ role: "user", content: JSON.stringify(payload) }],
    }),
  });
  if (!r.ok) throw new Error(`API ${r.status}`);
  const txt = (await r.json()).content?.[0]?.text || "";
  const arrJson = JSON.parse(txt.slice(txt.indexOf("["), txt.lastIndexOf("]") + 1));
  for (const t of arrJson) {
    if (batch[t.id] && t.title) { batch[t.id].title_ar = t.title; batch[t.id].summary_ar = t.summary || ""; }
  }
}

const todo = out.filter((i) => !i.title_ar);
if (todo.length && process.env.ANTHROPIC_API_KEY) {
  for (let k = 0; k < todo.length; k += 20) {
    try { await translateBatch(todo.slice(k, k + 20)); }
    catch (e) { console.error(`translation batch failed: ${e.message}`); }
  }
  console.log(`translated ${todo.filter((i) => i.title_ar).length}/${todo.length} new stories`);
} else if (todo.length) {
  console.log("ANTHROPIC_API_KEY not set; skipping Arabic translation");
}

await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify({ updated: new Date().toISOString(), items: out }, null, 1));
console.log(report.sort().join("\n"));
console.log(`\n${out.length} items, ${out.filter((i) => i.image).length} with images`);
