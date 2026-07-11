# Social Video Scheduler — Design

Date: 2026-07-11
Status: Approved for implementation (autonomous run; decisions below are stated
assumptions the user can revise)

## Goal

Add a scheduler to Video Clipper: from the dashboard header, a **Scheduler**
button opens a new page with one tab per platform (TikTok, Facebook, YouTube).
V1 implements TikTok only; the other tabs are visible but disabled ("coming
soon"). The user picks a folder, selects one or more videos, orders them, sets
a start date/time and a gap between posts, and the app publishes each video to
TikTok at its scheduled time.

## Constraints & context

- Video Clipper is a **local-first** tool: Express server on localhost serving
  a React SPA, native OS dialogs for path picking, no database, no router.
- The server must be running for scheduled posts to publish. The UI states
  this plainly.
- TikTok's Content Posting API requires an app + OAuth access token with the
  `video.publish` scope. Obtaining the token is out of scope for v1; the user
  pastes an access token into an input field. Unaudited TikTok apps may only
  post `SELF_ONLY` (private) — the UI surfaces this.

## Architecture

### Shared (`shared/scheduler.ts`)

- Types: `ScheduledPost` (`id`, `platform: 'tiktok'`, `videoPath`, `fileName`,
  `caption`, `privacy`, `publishAt` (ms epoch), `status: 'scheduled' |
  'uploading' | 'posted' | 'failed' | 'cancelled'`, `error?`, `createdAt`),
  `SchedulerSettingsView` (`hasAccessToken`, `tokenPreview`).
- `computeScheduleTimes(startMs, gapMinutes, count)` — pure; returns the
  publish timestamp for each queue position.

### Server (`server/scheduler/`)

- **`store.ts`** — `SchedulerStore`: JSON persistence of `{ settings, posts }`
  at `$VIDEO_CLIPPER_DATA_DIR ?? ~/.video-clipper` / `scheduler.json`, written
  with mode 0600 (it holds the access token). Synchronous load on first use;
  atomic write (tmp + rename). Access token is never returned to the client —
  only `hasAccessToken` + last-4 preview.
- **`tiktok.ts`** — TikTok Content Posting API v2 client using global `fetch`:
  - `queryCreatorInfo(token)` → POST `/v2/post/publish/creator_info/query/`
    (used by "Test connection").
  - `directPost(token, filePath, { title, privacyLevel })` → init with
    `source_info: FILE_UPLOAD` (chunk plan per TikTok rules), PUT chunks with
    `Content-Range`, then poll `/v2/post/publish/status/fetch/` until
    `PUBLISH_COMPLETE` / failure / timeout.
  - `planChunks(fileSize)` — pure chunking math (≤64 MB: single chunk;
    otherwise 10 MB chunks with the remainder merged into the last chunk).
  - Base URL comes from `TIKTOK_API_BASE_URL` env override so tests can point
    at a local stub.
- **`engine.ts`** — `SchedulerEngine(store, uploader, now?)`: `tick()` finds
  due `scheduled` posts and processes them sequentially (uploading → posted /
  failed with error message). `start(intervalMs)` / `stop()`. Started from
  `server/index.ts` only, so `createApp()` in tests never spawns timers.
- **`router.ts`** — `createSchedulerRouter(store)`:
  - `GET  /api/scheduler/state` → `{ settings, posts }` (token masked)
  - `PUT  /api/scheduler/settings` → save/clear access token
  - `POST /api/scheduler/test` → creator info check with the stored token
  - `POST /api/scheduler/videos` → list video files in a directory
    (name, path, size, modified), video extensions only
  - `POST /api/scheduler/schedule` → validate `{ videos[{path, caption}],
    startAt, gapMinutes, privacy }`, compute publish times, append posts
  - `POST /api/scheduler/posts/:id/cancel` — pending posts only
  - `POST /api/scheduler/posts/:id/retry` — failed/cancelled → scheduled (now)
  - `DELETE /api/scheduler/posts/:id` — remove finished/cancelled entries

### Web

- **Routing:** minimal hash routing in `App.tsx` (`#/scheduler`); no new deps.
  Header gains a **Scheduler** button; the scheduler page has a back link.
- **`components/scheduler/SchedulerPage.tsx`** — page shell + platform tabs
  (TikTok active; Facebook / YouTube disabled with "coming soon" badges).
- **`components/scheduler/TikTokScheduler.tsx`** — orchestrates the tab:
  1. **Connect** card — access-token password input, save, test connection,
     connection status.
  2. **Pick videos** card — "Choose folder…" (existing native dialog), video
     grid with thumbnails (`<video preload="metadata">` against the existing
     `/api/video/stream` endpoint), multi-select.
  3. **Build queue** card — ordered list (drag + up/down), per-video caption
     (defaults to file name), privacy select, start `datetime-local`, gap
     value + unit, computed publish time per row, "Schedule" button.
  4. **Scheduled posts** card — status chips, cancel/retry/remove, 5 s polling
     while the page is open.
- **`lib/schedulerApi.ts`** — fetch client mirroring the existing `api.ts`
  conventions.
- Styles extend `styles.css` with a `.sched-*` block reusing the existing
  design tokens (dark surface cards, accent, chips).

## Error handling

- Router validates inputs and returns 400 with messages; file-not-found on
  schedule creation is a 400 naming the missing file.
- Engine catches per-post errors, marks the post `failed` with the message,
  and continues with later posts; a crash never stops the tick loop.
- TikTok error responses surface `error.code`/`error.message` from the API
  envelope.
- Store write failures propagate to the API response but never crash the
  server.

## Testing

- `tests/shared/scheduler.test.ts` — `computeScheduleTimes` edge cases.
- `tests/server/scheduler-store.test.ts` — round-trip, masking, 0600, tmp dir.
- `tests/server/scheduler-router.test.ts` — supertest: CRUD, validation,
  token masking, folder listing.
- `tests/server/tiktok.test.ts` — `planChunks` math; request construction
  against a stubbed fetch/base URL.
- `tests/server/scheduler-engine.test.ts` — fake uploader + injected clock:
  due-post selection, sequential processing, failure isolation.

## Out of scope (v1)

- TikTok OAuth flow / token refresh (user pastes a token).
- Facebook and YouTube publishing (tabs are placeholders).
- Upload progress percentage per post (status transitions only).
- Publishing while the app is closed (would need a daemon).
