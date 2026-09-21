# Discord Status Card — Project Checklist & Handoff

**Live site:** https://status-web-topaz.vercel.app
**Repo:** https://github.com/heyitsaadin/discord-status-web (branch: `main`, auto-push enabled)
**Vercel project:** `discord-status-web` (linked to the repo, auto-deploys on push)

---

## ✅ What's already built

- [x] Full-page looping background video (`YOUR_VIDEO_FILE.mp4` — needs the real filename swapped in, see below)
- [x] Vignette + faint comic-style radial motion-streak overlay on the video
- [x] Video attempts to autoplay **with sound**; falls back to muted if the browser blocks it (browsers always block audio-autoplay without prior user interaction — this is a platform limit, not fixable in code)
- [x] Floating identity block (no card/box) — avatar, display name, @username, live status dot, centered on screen
- [x] Avatar decoration support (tries animated `.gif` frame first, falls back to `.png`)
- [x] Live Discord presence via **Lanyard** (`https://api.lanyard.rest/v1/users/{id}`), polled every 10s
  - Status dot color + pulse animation (online/idle/dnd/offline)
  - Activity pill (shows current Discord "Playing X" / "Watching X" / custom activity, when present)
  - Spotify block (song, artist, album art) — shows automatically when Spotify is playing
- [x] Mute/unmute button (bottom-right, floating)
- [x] Three "Liquid Glass" (iOS 18 style) circular buttons under the profile info, linking to:
  - Discord → `https://discord.com/users/1382308851814240298`
  - GitHub → `https://github.com/heyitsaadin`
  - Email → `mailto:hey.itsaadin@gmail.com`

**Discord User ID in use:** `1382308851814240298`
User **must** stay a member of the Lanyard Discord server for the API to track them — already confirmed done.

---

## 🔴 Still to do

### 1. Upload the real background video
`index.html` still has a placeholder `<source src="YOUR_VIDEO_FILE.mp4">`. Needs:
- User to supply the actual video file
- Upload it into the repo (e.g. as `background.mp4`)
- Update the `<source>` tag to point at it

### 2. Custom "what I'm doing" presence (GitHub / YouTube / coding activity)

**Important context for the next agent:** Discord's **Connections** feature (GitHub, YouTube, Spotify shown in the profile "Connections" list) is **not** a live presence signal. It only adds a verified badge + profile link. Lanyard (and therefore this card) can only show what Discord itself reports as an **activity** (aka Rich Presence) — which today is limited to:
- Spotify (already working — user has "Display Spotify as your status" enabled)
- Whatever a running app reports via Discord's Rich Presence SDK (games, and apps explicitly built to report presence)

There is **no official way** to turn "watching a YouTube video" into Discord presence — YouTube doesn't push that data to Discord at all.

**What the user actually wants:** a live "I'm currently coding" or "I'm active on GitHub" indicator, shown the same way Spotify shows up now.

**How to actually build that** (options for the next agent to evaluate with the user):

**Option A — VS Code Rich Presence extension**
- Have the user install a VS Code extension such as "Discord Presence" or "vscord" from the VS Code marketplace
- Once configured, it pushes a custom Rich Presence activity ("Editing `file.js` in `project-name`") to Discord while VS Code is open
- Lanyard will then surface this the same way it surfaces games — no site code changes needed, `applyActivity()` in `index.html` already handles generic activities
- This is the most realistic path for a live "coding" status

**Option B — Custom activity via a small background script**
- Discord's Rich Presence SDK (via `discord-rpc` npm package or similar) can be used to push a fully custom activity from any script — e.g., a script that watches GitHub's API for the user's recent commits/events and sets a Discord activity like "Recently pushed to `repo-name`"
- More work, but fully custom (could reflect GitHub activity specifically, not just "editor open")
- Requires a Discord Application (client ID) created at discord.com/developers, and the script needs to run locally on a device where the user is logged into Discord (Rich Presence only works via the local Discord client, not a server)

**Option C — Static/manual GitHub activity block on the card itself**
- Skip Discord presence entirely for GitHub — instead, have the site itself call the GitHub API (e.g. `https://api.github.com/users/heyitsaadin/events`) directly and render "Last commit: ..." as its own section on the card, independent of Discord/Lanyard
- Simplest to implement, always accurate, but shows as a separate "GitHub activity" block rather than through the Discord status/activity pill

**Recommendation to discuss with user:** Option A for a quick live "coding" presence; Option C if they specifically want GitHub commit activity shown (since Option A only reports "VS Code is open," not what repo/commit).

YouTube "watching" presence: **not possible** — flag this to the user as a hard platform limitation, no workaround exists.

---

## Reference: How the card gets its data

- **Presence/status/Spotify:** `https://api.lanyard.rest/v1/users/1382308851814240298` — polled client-side every 10s in `index.html`
- **Avatar / decoration / username:** pulled from the same Lanyard response (`discord_user` object)
- No backend/server — everything is client-side fetches from a single static `index.html`