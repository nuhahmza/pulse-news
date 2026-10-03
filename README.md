# Pulse — AI & Photography news

Static site (`site/`) + a fetcher (`scripts/fetch-news.mjs`) that builds `site/data/news.json` from RSS feeds.

- **Add/remove sources:** edit `scripts/sources.json` (`category`: `ai` | `photo` | `video`).
- **Run locally:** `npm install && npm run fetch && npm run serve` → http://localhost:5173
- **Auto-update:** `.github/workflows/update-news.yml` runs every 30 min, commits the JSON, Netlify redeploys. Edit the cron line to change the schedule.
- **Deploy:** GitHub Pages. Settings → Pages → Source: GitHub Actions. The same workflow fetches news and deploys `site/` every 30 min (no Netlify credits used).
