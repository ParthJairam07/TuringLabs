# Live AI Mentor

Live AI Mentor is a Next.js app that turns a person's public YouTube videos into a real-time voice mentor you can talk to.

## What It Does

- Accepts a mentor name and 1-6 YouTube links from the same person.
- Fetches video transcripts with Supadata.
- Builds a persona and grounded conversation prompt with OpenAI.
- Creates a Vapi web-call assistant server-side.
- Lets the user talk to the mentor with push-to-talk voice controls.
- Shows a live transcript panel for both user and assistant turns.
- Uses local avatar loops:
  - `/avatar/listening.mp4` while idle or while the user is talking.
  - `/avatar/talking.mp4` while the assistant is speaking.

The app is deployed at:

```text
https://project-012gp.vercel.app
```

## Tech Stack

- Next.js 16.2.7 App Router
- React 19
- TypeScript
- Vapi Web SDK for live calls
- OpenAI for persona generation and Vapi LLM/TTS credentialing
- Supadata for transcript fetching
- Vercel for deployment

## Environment Variables

Create `.env.local` for local development:

```env
OPENAI_API_KEY=
VAPI_PRIVATE_KEY=
NEXT_PUBLIC_VAPI_PUBLIC_KEY=
TRANSCRIPT_API_KEY=
GEMINI_API_KEY=
VAPI_LIVE_MODEL=gpt-4o
VAPI_LIVE_FALLBACK_MODELS=gpt-4o-mini
```

Notes:

- `NEXT_PUBLIC_VAPI_PUBLIC_KEY` is the only client-side key.
- Do not expose `OPENAI_API_KEY`, `VAPI_PRIVATE_KEY`, `TRANSCRIPT_API_KEY`, or `GEMINI_API_KEY` in browser code.
- Gemini/Veo is currently not used by the visible avatar flow; local MP4 loops replaced it for demo stability.

## Local Development

Install dependencies:

```bash
npm install
```

Run the dev server:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

Useful checks:

```bash
npm run lint
npm run build
```

On Windows, `next build` can occasionally hit a locked `.next` file. Re-running the same build command usually clears it.

## Main Flow

1. User enters a mentor name.
2. User pastes 1-6 YouTube links.
3. `/api/build-mentor` validates the request.
4. Supadata fetches transcripts with rate-limit-friendly spacing.
5. OpenAI creates a persona profile and compressed live context.
6. Vapi assistant is created server-side with the generated system prompt.
7. The conversation screen starts a Vapi web call.
8. The avatar switches between local listening/talking videos based on voice state.
9. The transcript panel updates from Vapi conversation and transcript events.

## Current Implementation Notes

- The photo upload UI was removed; the app uses the YouTube thumbnail as the mentor face image fallback.
- Local avatar videos live in `public/avatar/`.
- The transcript panel has its own scroll area on desktop/tablet.
- Transcript diagnostics are still visible in the UI when build debug data exists.
- Vapi call settings include longer silence and duration limits for push-to-talk.
- `/api/build-mentor` has `maxDuration = 60` and uses the Node.js runtime.

## Deployment

The project is linked to Vercel. Production deployment can be run with:

```bash
npx vercel deploy --prod --yes --token <VERCEL_TOKEN>
```

Required Vercel environment variables:

```text
OPENAI_API_KEY
VAPI_PRIVATE_KEY
NEXT_PUBLIC_VAPI_PUBLIC_KEY
TRANSCRIPT_API_KEY
GEMINI_API_KEY
VAPI_LIVE_MODEL
VAPI_LIVE_FALLBACK_MODELS
```

After deployment, smoke-test:

- Homepage returns `200`.
- `/api/build-mentor` returns `400` for an empty invalid request.
- `/avatar/talking.mp4` returns `200` with `video/mp4`.
- `/avatar/listening.mp4` returns `200` with `video/mp4`.
- No obvious server-side key names or key values appear in served HTML/static assets.

## Security And Cost Notes

- There is currently no app-level rate limit or passcode gate.
- Anyone with the public link can attempt builds and voice calls, which can consume API credits.
- Before broad sharing, consider adding one of:
  - Vercel Deployment Protection
  - a simple demo passcode
  - per-IP rate limiting for `/api/build-mentor`
- Revoke any temporary Vercel tokens after deployment.
- Keep vendor billing alerts enabled for OpenAI, Vapi, Supadata, and Vercel.

## Git Commands

Review changes:

```bash
git status
git diff --stat
```

Commit everything:

```bash
git add .
git commit -m "Polish live AI mentor demo"
```

Push to GitHub:

```bash
git push origin main
```
