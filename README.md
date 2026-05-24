# Reckon

A daily math puzzle web app. Transform a starting number into a target using 5 ordered operations — Wordle-style feedback, streaks, shareable grids.

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | Vanilla JS + HTML + CSS (no framework, no build step) |
| API | Vercel Serverless Functions (Node.js) |
| Storage | Vercel KV (Redis) |
| Cron | Vercel Cron (daily puzzle generation at 00:05 UTC) |
| Hosting | Vercel |

Everything runs on Vercel's free tier. One platform, one dashboard, one deploy command.

---

## Local Development

### Prerequisites
- Node.js 18+
- [Vercel CLI](https://vercel.com/docs/cli): `npm i -g vercel`

### First-time setup

```bash
# Clone and install
git clone https://github.com/YOUR_USERNAME/reckon
cd reckon
npm install

# Link to a Vercel project (creates one if needed)
vercel link

# Create a KV store in Vercel dashboard:
# Dashboard → Storage → Create → KV → connect to your project
# This auto-populates KV_REST_API_URL and KV_REST_API_TOKEN

# Pull env vars for local dev
vercel env pull .env.local

# Add CRON_SECRET to Vercel project settings (any random string):
# Dashboard → Project → Settings → Environment Variables
# Name: CRON_SECRET  Value: <generate with: openssl rand -hex 32>
# Then pull again:
vercel env pull .env.local

# Start local dev server
npm run dev
# → http://localhost:3000
```

### Bootstrap first puzzle

The daily cron runs at 00:05 UTC. To generate today's puzzle immediately:

```bash
# From local dev (with .env.local populated):
npm run bootstrap
# It reads CRON_SECRET and API_URL from env. Default API_URL is http://localhost:3000
```

Or targeting production:

```bash
CRON_SECRET=your-secret API_URL=https://your-app.vercel.app node scripts/bootstrap.js
```

The script logs only success/failure — no puzzle contents are printed.

---

## Deploy to Production

```bash
vercel --prod
```

Vercel auto-deploys on `git push` if you connect your GitHub repo in the dashboard.

**Post-deploy checklist:**
1. ✅ `CRON_SECRET` env var set in Vercel project settings
2. ✅ KV store connected to the project
3. ✅ Run bootstrap to generate today's puzzle
4. ✅ Visit the deployed URL and play

---

## Architecture

```
vercel.json (cron: 00:05 UTC daily)
     ↓
GET /api/generate  ←  Authorization: Bearer $CRON_SECRET
     ↓
lib/generator.js   ←  crypto.randomBytes (true randomness, no seed)
     ↓
Vercel KV          ←  key: puzzle:YYYY-MM-DD
     ↓
GET /api/today     ←  public read endpoint
     ↓
public/app.js      ←  SPA, caches puzzle in localStorage
```

### Puzzle privacy

Puzzles use true randomness (`crypto.randomBytes`) — no seed, no salt, nothing deterministic. Even you can't predict tomorrow's puzzle. Full threat model in [SPEC.md §4.7](SPEC.md).

**Rules:** `api/generate.js` never logs puzzle contents (only success/failure). Don't capture bootstrap output if you care about spoilers.

---

## Repo Structure

```
/
├── public/              # Static SPA (no build step)
│   ├── index.html
│   ├── app.js
│   └── styles.css
├── api/                 # Vercel Serverless Functions
│   ├── today.js         # GET /api/today  — public
│   └── generate.js      # GET /api/generate — cron (auth required)
├── lib/
│   └── generator.js     # Puzzle generation algorithm
├── scripts/
│   └── bootstrap.js     # One-time puzzle seeding
├── vercel.json          # Cron schedule
├── package.json
└── SPEC.md              # Full product spec
```

---

## Customization

| What | Where |
|---|---|
| Launch date (puzzle #1) | `LAUNCH_DATE` in `api/generate.js` |
| Cron time | `schedule` in `vercel.json` |
| App URL in share text | `generateShareText()` in `public/app.js` |
| Source code link | `#source-link` href in `public/index.html` |

---

## License

MIT
