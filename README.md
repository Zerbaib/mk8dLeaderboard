# 🏁 MK8DX Times — Mario Kart 8 Deluxe leaderboard

A time trial leaderboard for **Mario Kart 8 Deluxe** (150cc and 200cc, all 96 tracks including the Booster Course Pass).

- Players submit their times through a form (player name, country, track, engine class, time, proof as a **link** or an **uploaded file**).
- Each submission is posted on **Discord** with two buttons: **✅ Approve** / **❌ Reject** (with an optional reason).
- Only approved times appear on the leaderboards: **per track**, **players**, **countries** and **world regions**
  (Europe, North America, South America, Asia, Africa, Oceania — deduced automatically from the player's country).
- Data is stored in a **SQLite** database (`data/leaderboard.db`).
- Includes **Terms of Use**, **Privacy Policy** (GDPR), **Legal Notice** and a "How points work" page.

![Home](docs/home.png)

| Track leaderboard | Tracks |
|---|---|
| ![Track leaderboard](docs/track.png) | ![Tracks](docs/tracks.png) |
| **Submission form** | **Region rankings** |
| ![Form](docs/submit.png) | ![Regions](docs/regions.png) |

## Setup

Requires **Node.js 22 or later** (`better-sqlite3` does not support older versions). On Debian/Ubuntu:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
```

```bash
npm install
cp .env.example .env   # then fill in the variables
npm start              # http://localhost:3000
```

To try it with fake data: `npm run seed` (do not run it in production).

## Discord bot setup

Interactive buttons require a **bot** (a plain webhook cannot receive button clicks).

1. Go to <https://discord.com/developers/applications> → **New Application**.
2. **Bot** tab → **Reset Token** → copy the token into `DISCORD_TOKEN`.
3. **OAuth2 → URL Generator**: tick `bot`, then the permissions
   *View Channels*, *Send Messages*, *Embed Links*, *Attach Files*. Open the generated URL to invite the bot to your server.
4. In Discord, enable **Developer Mode** (Settings → Advanced), right-click the review channel → **Copy Channel ID** → `DISCORD_CHANNEL_ID`.
   Make this channel **private** (moderators only): it contains unpublished submissions.
5. (Optional) Right-click the moderator role → **Copy Role ID** → `DISCORD_MOD_ROLE_ID`.
   Without it, anyone with the **Manage Messages** permission can review.
6. Set `PUBLIC_URL` to the public address of the site (proof files too large for Discord are linked there).

No privileged intent is needed.

## Legal pages

The Terms of Use, Privacy Policy and Legal Notice are filled in from your `.env`.
**Before going live**, set `LEGAL_OWNER_NAME`, `LEGAL_OWNER_ADDRESS`, `LEGAL_CONTACT_EMAIL`, `LEGAL_HOST_NAME` and `LEGAL_HOST_ADDRESS`:
until they are set, placeholders are highlighted in yellow on the pages.

The texts are a solid starting point for a free, non-commercial fan site run from the EU (France), but they are not legal advice — have them reviewed if your situation is different.

What the code does to match the Privacy Policy:

- explicit acceptance of the Terms / Privacy Policy is required to submit (checked server-side);
- IP addresses are only kept in memory for rate limiting, never stored;
- rejected submissions and their files are deleted automatically after `REJECTED_RETENTION_DAYS` (default 30);
- fonts and flags are self-hosted: no request to Google Fonts or any third-party CDN, no cookies, no analytics;
- erasure requests: `npm run delete-player -- "Player name"` deletes a player, all their submissions and proof files.

## Environment variables

| Variable | Description |
|---|---|
| `PORT` | HTTP port (default 3000) |
| `PUBLIC_URL` | Public URL of the site |
| `SITE_NAME` | Site name shown on the legal pages |
| `DISCORD_TOKEN` | Bot token |
| `DISCORD_CHANNEL_ID` | Channel where submissions are posted for review |
| `DISCORD_MOD_ROLE_ID` | Role allowed to review (optional) |
| `DISCORD_BOT_STATUS` | Bot status text (default `🚀 go on mk8dxtimes.fr`) |
| `DISCORD_INVITE_URL` | Public invite shown on the Terms page (optional) |
| `LEGAL_SITE_URL` | Site address shown in the Terms of Use (defaults to `PUBLIC_URL`) |
| `LEGAL_OWNER_NAME`, `LEGAL_OWNER_ADDRESS`, `LEGAL_CONTACT_EMAIL` | Publisher information |
| `LEGAL_HOST_NAME`, `LEGAL_HOST_ADDRESS` | Hosting provider information |
| `REJECTED_RETENTION_DAYS` | Days before rejected submissions are deleted (default 30) |
| `DB_PATH` | SQLite database path (default `data/leaderboard.db`) |
| `MAX_UPLOAD_MB` | Max proof file size (default 50) |
| `RATE_LIMIT` | Max submissions per IP every 10 minutes (default 10) |

## Points

For each track and engine class, only a player's **best approved time** counts.

- Points = `1000 × record time ÷ player time` (the record holder gets 1,000 points).
- **Players**: sum of points across all tracks.
- **Countries / regions**: sum of the points of their players.
  The country → region mapping is in `src/countries.js` (North America includes Central America and the Caribbean; Asia includes the Middle East; Turkey and the Caucasus are in Europe).

## Project structure

```
src/server.js             Express API + submission form (uploads via multer)
src/db.js                 SQLite schema and leaderboard queries
src/discord.js            Discord bot: posts submissions, Approve/Reject buttons
src/tracks.js             The 96 tracks
src/countries.js          Countries and their world region
public/                   Front-end (plain HTML/CSS/JS) incl. legal pages
scripts/seed.js           Demo data
scripts/delete-player.js  Erasure of a player's data
```

## API

| Route | Description |
|---|---|
| `POST /api/submissions` | Submit a time (multipart) |
| `GET /api/leaderboard/track/:id?cc=150&country=FR&region=europe` | Track leaderboard |
| `GET /api/leaderboard/players?cc=150&region=north-america` | Player rankings |
| `GET /api/leaderboard/countries?cc=150` | Country rankings |
| `GET /api/leaderboard/regions?cc=150` | Region rankings |
| `GET /api/players/:id` | Player profile |
