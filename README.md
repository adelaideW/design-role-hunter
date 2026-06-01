# Role Hunter

Design job listings and mock interview practice — [live on Vercel](https://design-challenge-liart.vercel.app/).

## Data sources

Job listings are synced from public ATS APIs (Greenhouse, Ashby, Lever), aligned with [ai-design-jobs.vercel.app](https://ai-design-jobs.vercel.app/). The company board list is derived from that reference site’s apply links.

| Script | Purpose |
|--------|---------|
| `npm run import-sources` | Refresh `scripts/job-sources.json` from ai-design-jobs |
| `npm run sync-jobs` | Fetch design roles from ATS boards, write `public/data/jobs/` |
| `npm run sync-if-stale` | Run sync only if data is older than 24 hours (used in `prebuild`) |

Daily updates run via GitHub Actions (`.github/workflows/sync-jobs.yml`).

## Development

```bash
npm install
npm run dev
```

Build runs `sync-if-stale` then Vite:

```bash
npm run build
npm run preview
```
