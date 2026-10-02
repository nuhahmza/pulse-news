// Pulls RSS/Atom feeds from scripts/sources.json and writes site/data/news.json
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(root, "site", "data", "news.json");
const PER_FEED = 15;
const MAX_ITEMS = 120;
const MAX_AGE_DAYS = 14;
const UA = "Mozilla/5.0 (compatible; PulseNewsBot/1.0; +https://netlify.app)";

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", processEntities: true });
const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const text = (v) => (v == null ? "" : typeof v === "object" ? String(v["#text"] ?? "") : String(v));

const strip = (html) =>
  html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#8217;/g, "’")
      .replace(/&#8216;/g, "‘").replace(/&#8220;|&#8221;/g, '"').replace(/&hellip;|&#8230;/g, "…")
      .replace(/\s+/g, " ").trim();

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
    for (const it of arr(j.rss.channel?.item).slice(0, PER_FEED)) {
      const link = text(it.link).trim();
      items.push({
        title: strip(text(it.title)), link,
        date: it.pubDate || it["dc:date"],
        summary: strip(text(it.description) || text(it["content:encoded"])).slice(0, 220),
        image: imageFromItem(it, link),
      });
    }
  } else if (j.feed) {
    for (const it of arr(j.feed.entry).slice(0, PER_FEED)) {
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
  return items.filter((i) => i.title && i.link).map((i) => ({ ...i, source: src.name, category: src.category }));
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
const cutoff = Date.now() - MAX_AGE_DAYS * 864e5;
const seen = new Set();
all = all
  .map((i) => ({ ...i, ts: Date.parse(i.date) || 0 }))
  .filter((i) => i.ts && i.ts > cutoff && i.ts < Date.now() + 36e5)
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

await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify({ updated: new Date().toISOString(), items: out }, null, 1));
console.log(report.sort().join("\n"));
console.log(`\n${out.length} items, ${out.filter((i) => i.image).length} with images`);
