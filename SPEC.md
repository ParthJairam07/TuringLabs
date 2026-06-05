# Live AI Mentor — MVP Build Specification

> **For the coding agent:** This is a complete, self-contained spec. You have no prior context, and none is needed — everything required is below. Build exactly what is described. This document covers **Part A (the engineering MVP) only.** Part B (a go-to-market email + LinkedIn message) is a separate writing task and is intentionally **not** in scope here.
>
> **External APIs:** This spec names specific third-party services and describes precisely what each integration must do. Method names and exact request/response shapes for those services change over time — **always confirm the current API against each service's official docs** before wiring it. The *behavior* described here is authoritative; the exact SDK call signatures should be taken from current docs.

---

## 1. What we are building (plain-English overview)

A web app that turns a single person's YouTube videos into a **live, voice-based AI "mentor"** you can talk to.

The user pastes up to ~6 YouTube links of **one specific person** (any person they choose — a creator, expert, founder, etc.). The app:
1. Pulls the transcripts of those videos.
2. Studies them to build a "persona" of that person — their knowledge, opinions, and speaking style.
3. Shows the person's **real face as a still photo with gentle ambient animation** (breathing/blinking/sway), plus a clear "AI recreation" disclaimer.
4. Lets the user have a **real-time spoken conversation** with the mentor, who answers in the first person, grounded in what that person actually said in their videos.

The deliverable is a **deployed, live, working link** (not a video, not a local demo). It must work reliably when opened in a browser by someone else.

**Three things this MVP is judged on (design every trade-off around these, in priority order):**
1. **Context** — how well the mentor is grounded in the specific person's actual content.
2. **Speed to a usable MVP** — ship something that genuinely works, fast; do not over-engineer.
3. **LLM-driven voice interaction** — the live spoken conversation must feel responsive.

---

## 2. The end-to-end user flow

1. **Input screen.** User pastes 1–6 YouTube URLs (all of the same person) and clicks **"Build my mentor."** Optionally, the user can upload one clear photo of the person to use as the face (overrides the auto-grabbed thumbnail).
2. **Building screen.** A progress view runs while the app fetches transcripts, builds the persona, and prepares the animated face. If any link couldn't be used, it is **skipped and reported** (the build still succeeds with the remaining links).
3. **Conversation screen.** The animated face appears with the person's name and the disclaimer. The user **presses and holds (or toggles) a push-to-talk button** to speak. The mentor replies out loud in a generic, gender-neutral voice within ~1–2 seconds. A live running transcript of the conversation is shown. The mentor remembers earlier parts of **this** conversation.
4. **Reset.** Starting a new mentor (or reloading) clears the conversation — there is **no cross-session memory**.

---

## 3. Definitive tech stack

| Layer | Choice | Notes |
|---|---|---|
| Language | **TypeScript** | Throughout. |
| Framework | **Next.js (App Router)** | Single deployable web app: frontend + serverless API routes in one repo. |
| Hosting | **Vercel** | One-command deploy; provides logs for debugging. |
| Voice (real-time STT + LLM + TTS loop) | **Vapi** | Managed voice-agent platform. Handles microphone, streaming, turn detection, and gives call logs + live transcripts for easy debugging. Configured to run on **the user's own OpenAI key** for the LLM. |
| LLM brain (conversation) | **OpenAI GPT-4o** (via Vapi) | Fast + high quality. If live latency is consistently above target, fall back to `gpt-4o-mini`. |
| LLM (persona pass + compression) | **OpenAI** (server-side, direct) | Standard Chat Completions calls from our own API routes. |
| Transcripts | **Supadata** (supadata.ai) | Purpose-built YouTube transcript API. Pass a video URL, get the transcript back. Handles the Vercel/datacenter-IP reliability issue. For caption-less videos, automatically falls back to Whisper AI — same endpoint, same response format, no extra code. Free tier: 100 req/month, no credit card. |
| Face animation | **Google Veo via Gemini API** (ai.google.dev) | Image-to-video: pass a face image + a prompt, get back an 8-second idle animation clip. Async job — poll until complete, then download the mp4 within 2 days. See §6.6 for the full requirement and the instant CSS fallback. |

**Stack priorities (explicit user requirement):** maximize built-in features, easy debugging, and fast shipping. Prefer managed services with dashboards/logs over hand-rolled real-time plumbing.

---

## 4. External accounts, keys, and environment variables

The app needs accounts/keys for: **OpenAI** (already set up), **Vapi** (already set up, OpenAI credential added), **Supadata** (already set up), and **Gemini** (for Veo animation, already set up).

Set these environment variables (in Vercel project settings and a local `.env.local`):

```
OPENAI_API_KEY=              # server-side: persona pass + transcript compression
VAPI_PRIVATE_KEY=            # server-side: create/configure the Vapi assistant
NEXT_PUBLIC_VAPI_PUBLIC_KEY= # client-side: start the in-browser voice call
TRANSCRIPT_API_KEY=          # server-side: Supadata API key
GEMINI_API_KEY=              # server-side: Google Gemini API key (used for Veo video generation only)
```

**OpenAI key is used in two places:** (a) directly by our server for the persona pass + compression, and (b) added as a credential inside **Vapi** so the conversation LLM runs on the user's OpenAI account. Configure the OpenAI credential in the Vapi dashboard under Settings → Provider Credentials → Model Providers and reference GPT-4o in the assistant's model config.

**Never expose** `OPENAI_API_KEY`, `VAPI_PRIVATE_KEY`, `TRANSCRIPT_API_KEY`, or `GEMINI_API_KEY` to the client. Only `NEXT_PUBLIC_VAPI_PUBLIC_KEY` is client-side.

---

## 5. Architecture overview

```
[ Browser (Next.js client) ]
   │  paste links / optional photo
   ▼
POST /api/build-mentor  ───────────────────────────────┐
   │                                                    │ (server, in parallel where possible)
   │  1. parse video IDs                                │
   │  2. fetch transcripts (transcript API)  ── skip+notify on failures
   │  3. assemble combined transcript; if > threshold → compress (OpenAI)
   │  4. persona pass (OpenAI) → PersonaProfile
   │  5. choose face image (uploaded photo OR maxres thumbnail of a video)
   │  6. build conversation system prompt (persona + context)
   │  7. create Vapi assistant (system prompt + GPT-4o + neutral voice) → vapiAssistantId
   │  8. start portrait-animation job from face image → loop URL (may be async)
   ▼
returns Mentor { personName, faceImageUrl, animationLoopUrl|pending, vapiAssistantId, skippedLinks, ... }
   │
   ▼
[ Conversation screen ]
   - shows face (CSS breathing immediately; swap to AI loop when ready)
   - push-to-talk → Vapi web call (NEXT_PUBLIC_VAPI_PUBLIC_KEY + vapiAssistantId)
   - Vapi streams STT → GPT-4o (user's OpenAI key) → TTS, ≤ ~2s
   - live transcript rendered from Vapi events
```

For the MVP, the built `Mentor` object can be held in **client React state** for the session (no database required, since there's no cross-session memory). The large system prompt lives inside the **Vapi assistant** (created server-side), so it is never shipped to the client.

---

## 6. Detailed component specifications

### 6.1 Input screen

- **Heading:** e.g. *"Talk to anyone. Paste their YouTube videos, get a live mentor."*
- **Sub-text (one line):** explains: paste up to 6 YouTube links of the same person.
- **URL input:** allow 1–6 YouTube URLs (a multi-line textarea, or up-to-6 individual fields). Validate each is a YouTube URL (accept `youtube.com/watch?v=`, `youtu.be/`, `youtube.com/shorts/`). Extract the 11-char video ID from each. Reject/flag non-YouTube input inline.
- **Optional photo upload:** "Use your own photo of this person (optional)" — accepts an image file; if provided, it overrides the thumbnail as the face image.
- **Primary button:** **"Build my mentor."** Disabled until ≥1 valid YouTube URL is present. On click → call `POST /api/build-mentor` and transition to the building screen.

### 6.2 Build pipeline (server: `/api/build-mentor`)

Run these steps. Parallelize independent ones (the animation job and the persona pass can run concurrently) so total build time ≈ the slowest step, not the sum.

1. **Parse video IDs** from the submitted URLs.
2. **Fetch transcripts via Supadata**, one per video. Make a GET request per video:
   ```
   GET https://api.supadata.ai/v1/youtube/transcript?url=<YOUTUBE_URL>&text=true
   Header: x-api-key: TRANSCRIPT_API_KEY
   Returns: { content: string, lang: string, availableLangs: string[] }
   ```
   Supadata automatically uses Whisper for caption-less videos — same endpoint, no extra code. For each video that still returns no usable transcript (private/removed/API error): **do not fail the build** — add it to `skippedLinks` with a short reason and continue. If **all** links fail, return a clear error (see §12).
3. **Assemble** the successful transcripts into one combined text, each clearly delimited with its video title (or index).
4. **Compress if needed.** Estimate total tokens. If the combined transcript exceeds **~100,000 tokens**, run the **compression prompt** (§7) to bring it to **~70,000 tokens**, preserving concrete specifics. (At 6 normal videos this rarely triggers; it's a safety valve for very long videos.) Keep the static context comfortably within GPT-4o's context window and front-loaded so OpenAI prompt caching keeps per-turn latency low.
5. **Persona pass.** Send the (possibly compressed) transcripts to OpenAI with the **persona-pass prompt** (§7). Parse the returned JSON into `PersonaProfile`.
6. **Choose the face image.** If the user uploaded a photo, use it. Otherwise use the **max-resolution thumbnail** of the first successfully-transcribed video: `https://img.youtube.com/vi/<VIDEO_ID>/maxresdefault.jpg` (fall back to `hqdefault.jpg` if maxres 404s). Thumbnails are CDN-served and not subject to the datacenter-IP blocking that transcripts are.
7. **Build the conversation system prompt** (§7) by injecting `PersonaProfile` + the transcript context + the person's name.
8. **Create the Vapi assistant** (server-side, using `VAPI_PRIVATE_KEY`) with: the system prompt, model = OpenAI GPT-4o (via the OpenAI credential), a **gender-neutral voice**, a transcriber, and a short `firstMessage` greeting in the persona's voice. Return its `vapiAssistantId`.
9. **Start the Veo animation job** via the Gemini API (`GEMINI_API_KEY`). Pass the face image URL + this prompt: *"A person breathing naturally, subtle ambient motion, calm, portrait, gentle blinking, still — idle, no speaking."* Use model `veo-2.0-generate-001` (or the latest stable Veo model — confirm in current Google AI docs). Veo generation is async: submit the job, get a job ID, poll until complete, then download the mp4 to serve it. **Download the file within 2 days** — Google deletes hosted videos after that. If generation takes longer than expected or fails, proceed with the CSS fallback (§6.6). Return `animationStatus: "pending"` in the API response and let the client poll `GET /api/animation-status`.
10. **Return** the `Mentor` object (§8).

### 6.3 Building-state UI

Show a friendly progress indicator with sequential step labels, e.g.:
- "Fetching the transcripts…"
- "Studying how they think and talk…"
- "Bringing the face to life…"

If `skippedLinks` is non-empty, surface it gently: *"Couldn't use 1 of your links (no captions available) — built your mentor from the other 4."* Then transition to the conversation screen as soon as the mentor + `vapiAssistantId` are ready (don't block on the animation — see progressive enhancement in §6.6).

### 6.4 Conversation screen

- **The face:** centered. Initially the still photo with the **CSS breathing/sway** effect (§6.6) so it's alive instantly; swap to the **AI idle loop** when it finishes loading.
- **Disclaimer caption** (always visible, small, directly under/over the face): **"AI recreation based on public videos — not the real person."**
- **Person's name** displayed.
- **Push-to-talk button** (primary control): large, obvious. See §6.5 for behavior. Visual states: idle ("Hold to talk" / "Tap to talk"), **listening** (clearly highlighted while capturing the user's voice), and **speaking** (a subtle indicator while the mentor is talking — e.g. an animated ring around the face; this is a UI cue only and is **not** lip-sync).
- **Live transcript panel:** render the conversation (user turns + mentor turns) from Vapi's transcript events, newest at the bottom, auto-scrolling.
- **"New mentor" / reset button:** returns to the input screen and clears the conversation.
- **Desktop-first.** It should be usable on a laptop in a browser; mobile polish is not required for the demo.

### 6.5 Voice integration (Vapi)

- The client starts an **in-browser voice call** using `NEXT_PUBLIC_VAPI_PUBLIC_KEY` and the `vapiAssistantId` returned by the build step.
- **Push-to-talk behavior (required — do not use always-on open mic):**
  - On call start, **mute the microphone by default** (so the mentor isn't triggered by ambient noise).
  - **Hold-to-talk:** while the button is pressed (`pointerdown`/`touchstart` → `pointerup`/`touchend`), **unmute** the mic; on release, **mute** again. The mentor then processes and answers the captured utterance.
  - Provide a **toggle fallback** (tap to start talking, tap to stop) in case hold-to-talk is awkward in the browser; pick whichever is more reliable and keep the UI label consistent with the chosen behavior.
  - Confirm the exact mic-control method against current Vapi docs (e.g. a `setMuted`-style call) — the requirement is: user audio is only sent while the user is actively pressing/toggling "talk."
- **In-session memory:** keep **one continuous Vapi call** for the whole session so the assistant retains the running conversation history automatically. Starting a new mentor ends the call and starts fresh = reset.
- **Events:** subscribe to Vapi's events for partial/final transcripts, speech-start, and speech-end to drive the transcript panel and the listening/speaking UI states.
- **Voice:** a **gender-neutral / neutral-sounding** voice from whichever TTS provider Vapi is configured with. Not a clone of the person.
- **Errors:** handle mic-permission-denied and call-connection failures with clear messages (§12).

### 6.6 Face animation (decoupled, pre-rendered, progressively enhanced)

The animation is **completely decoupled from speech.** It is an **idle/ambient loop** (gentle breathing, blinking, slight head sway). It does **NOT** lip-sync and must **never** add to voice latency. This is deliberate — it keeps the response time within target while still feeling alive.

Two layers:

1. **Instant CSS effect (always on, zero cost, zero latency):** apply a subtle looping transform to the still photo so it has life immediately and as a permanent fallback. Example:

```css
@keyframes breathe {
  0%   { transform: scale(1.00) translateY(0px); }
  50%  { transform: scale(1.03) translateY(-4px); }
  100% { transform: scale(1.00) translateY(0px); }
}
.mentor-face { animation: breathe 6s ease-in-out infinite; will-change: transform; }
```

2. **AI idle loop (the "elevated" version, pre-rendered once at build time):** generate a short (~6–10s) idle animation **video** from the face image using the portrait-animation API, then play it **looped** on the conversation screen.
   - Request the service's **idle / "live portrait" / ambient** mode (a calm, non-talking clip with natural micro-movements and blinking). If the service only outputs talking-head clips, request a short neutral/closed-mouth clip and loop it.
   - **Progressive enhancement:** show the CSS-animated still **immediately** so the user can start talking right away; **swap in** the AI loop the moment it's ready. The user never waits on the animation.
   - Run the animation job **in parallel** with the persona pass during build.
   - **Graceful degradation:** if generation fails or is too slow, simply keep the CSS effect. The app must remain fully usable without the AI loop.
   - A small visible seam at the loop point is acceptable for the MVP; add a short crossfade only if trivial.

---

## 7. The exact prompts

> Use these verbatim (substitute the `{PLACEHOLDERS}`). They encode the required behavior.

### 7.1 Persona-pass prompt

**System:**
```
You are an expert at analyzing a person's spoken content and distilling their identity, expertise, and communication style. You will be given transcripts from one or more YouTube videos of a single person. Produce a structured "persona profile" that another AI will use to convincingly speak and mentor AS this person in a live voice conversation.
```
**User:**
```
Person's name (if known): {NAME_OR_"unknown — infer from the content"}

TRANSCRIPTS:
{COMBINED_TRANSCRIPTS}

Produce a single JSON object with exactly these fields:
- "name": string
- "oneLineBio": string
- "areasOfExpertise": string[]
- "speakingStyle": string  (tone, pace, vocabulary, sentence structure, energy)
- "recurringThemes": string[]  (their main ideas, frameworks, mental models)
- "characteristicPhrases": string[]  (expressions/phrases they actually use)
- "notableOpinions": string[]  (specific stances they have expressed, each one self-contained)
- "perVideoSummaries": { "source": string, "summary": string }[]

Rules:
- Base EVERYTHING only on the transcripts. Do not invent facts.
- If a transcript mixes multiple speakers (e.g. an interview), focus only on the primary/target person.
- Preserve concrete specifics: real examples, numbers, named concepts, and how they phrase things.
- Output ONLY the JSON object. No preamble, no markdown fences.
```

### 7.2 Compression prompt (only if transcripts exceed the threshold)

**System:**
```
You compress transcripts while preserving their substance, so they can serve as an AI's knowledge base. You never reduce them to abstract bullet points.
```
**User:**
```
Compress the following transcripts to roughly {TARGET_TOKENS} tokens.

Keep ALL concrete specifics: the person's actual examples, numbers, named frameworks, stories, opinions, and distinctive phrasing. Remove only filler, repetition, verbal tics, and off-topic tangents. Preserve the first-person voice and how they actually talk. Keep it as readable, condensed prose — NOT a summary of bullet abstractions.

TRANSCRIPTS:
{COMBINED_TRANSCRIPTS}
```

### 7.3 Conversation system prompt (injected into the Vapi assistant)

```
You ARE {NAME}, speaking live with someone who has come to you for mentorship. You are not an assistant or an AI playing a role — respond as {NAME}, in the first person, as if this were a real conversation.

WHO YOU ARE (your persona):
{PERSONA_PROFILE_JSON}

YOUR KNOWLEDGE (everything below is drawn from your own videos — this is what you have actually talked about):
{TRANSCRIPT_CONTEXT}

HOW YOU RESPOND:
- Speak in your own voice and style, consistent with the persona above. Stay in character the entire time.
- Ground your answers in YOUR KNOWLEDGE above. When the topic is something you've covered, use your real examples, opinions, and phrasing.
- If you're asked about something you have NOT covered in your videos: be honest — briefly say you haven't specifically talked about this — and THEN still give a helpful, thoughtful general answer, making clear that part is your general take rather than something from your videos.
- Never invent specific facts, quotes, statistics, or strong opinions and present them as if they came from your videos. Being honest about what you have and haven't said matters.
- This is a SPOKEN conversation. Keep replies natural and concise — usually 2–5 sentences, easy to say out loud. No lists, no markdown, nothing that sounds like reading a document. Ask the occasional follow-up question, like a real mentor would.
- Remember what the person has told you earlier in this conversation and build on it.

Be warm, direct, and genuinely useful. You are here to mentor.
```

---

## 8. Data model (TypeScript types)

```ts
type BuildRequest = {
  youtubeUrls: string[];          // 1–6, validated YouTube URLs
  uploadedPhotoDataUrl?: string;  // optional, overrides thumbnail
};

type SkippedLink = { url: string; reason: string };

type PersonaProfile = {
  name: string;
  oneLineBio: string;
  areasOfExpertise: string[];
  speakingStyle: string;
  recurringThemes: string[];
  characteristicPhrases: string[];
  notableOpinions: string[];
  perVideoSummaries: { source: string; summary: string }[];
};

type Mentor = {
  personName: string;
  personaProfile: PersonaProfile;
  faceImageUrl: string;
  animationLoopUrl: string | null;
  animationStatus: "pending" | "ready" | "failed";
  vapiAssistantId: string;
  skippedLinks: SkippedLink[];
};
```

---

## 9. API endpoints

### `POST /api/build-mentor`
- **Body:** `BuildRequest`
- **Action:** runs the full build pipeline (§6.2).
- **Returns:** `Mentor` (with `animationStatus: "pending"` if the loop is still generating), or an error object (§12).

### `GET /api/animation-status?assistantId=...` *(only if animation is async)*
- **Returns:** `{ animationStatus, animationLoopUrl }`. Client polls until `ready` or `failed`, then swaps the CSS still for the loop.

### Voice call
- No custom proxy endpoint required for the call itself: the client starts the Vapi web call directly with `NEXT_PUBLIC_VAPI_PUBLIC_KEY` + `vapiAssistantId`. (The assistant — including the system prompt and the OpenAI-key-backed model — was created server-side during build.)

---

## 10. Behavior rules (consolidated)

- **Grounding:** answers come from the person's actual video content (loaded fully into context — **no RAG/vector DB**, because the corpus is small).
- **Out-of-scope questions:** be honest that it wasn't covered, then give a clearly-flagged general answer. (Both behaviors required — not one or the other.)
- **No fabricated attributions:** never put invented specifics/opinions in the person's mouth as if from their videos.
- **Voice:** generic, gender-neutral. **Not** a clone of the person.
- **Face:** the person's real likeness as a still photo + ambient idle animation, with the AI-recreation disclaimer.
- **Memory:** remembers within the current conversation; **resets** on a new mentor/new session.
- **Input style:** push-to-talk (hold or toggle), never always-on open mic.

---

## 11. Latency requirements & how to meet them

- **Target:** spoken reply within ~1–2 seconds of the user finishing speaking. **Never more than ~2 seconds.**
- The **animation is decoupled** and does not count toward this.
- To hit it: rely on Vapi's streaming pipeline; use **GPT-4o** (or `gpt-4o-mini` if needed); front-load the large static context (persona + transcripts) in the system prompt so **OpenAI prompt caching** keeps per-turn latency low; keep the context within the compression threshold; choose a low-latency TTS voice.

---

## 12. Error handling & edge cases

- **A link has no usable transcript** (no captions + transcription unavailable, private/removed, or API error): **skip it, add to `skippedLinks` with a reason, continue.** One bad link must never kill the build.
- **All links fail:** return a clear error to the UI: *"Couldn't get transcripts for any of these videos. Try other links from the same person (videos with captions work best)."*
- **Invalid / non-YouTube URL:** flag inline on the input screen before building.
- **maxres thumbnail 404:** fall back to `hqdefault.jpg`.
- **Animation generation fails or is slow:** keep the CSS effect; set `animationStatus: "failed"`; app stays fully usable.
- **Microphone permission denied:** show a clear prompt explaining the app needs mic access to talk.
- **Voice call connection error:** show a retry option and surface the error; rely on Vapi's call logs for debugging.
- **Persona-pass JSON parse failure:** retry once; if it still fails, fall back to using the raw transcripts as context with a minimal persona ("You are {NAME}; speak in first person, grounded in the material below").

---

## 13. Non-goals / explicitly out of scope

- ❌ Voice cloning of the real person (generic voice only).
- ❌ Lip-sync / talking-head video (idle ambient animation only).
- ❌ RAG / embeddings / vector database (corpus is small → full-context).
- ❌ User accounts, login, or any cross-session persistence.
- ❌ Multi-person mentors in one build (one person per mentor).
- ❌ Mobile-optimized polish (desktop-first for the demo).
- ❌ Part B (the GTM email + LinkedIn message) — separate task, not built here.

---

## 14. Acceptance criteria (definition of done)

The MVP is done when **all** of the following are true on the **deployed Vercel link**:

1. Pasting 1–6 YouTube links of one person and clicking "Build my mentor" produces a working mentor.
2. A link without a usable transcript is **skipped and reported**, and the build still succeeds on the rest.
3. The conversation screen shows the person's **real face** with **gentle ambient animation** and the **"AI recreation" disclaimer**.
4. **Push-to-talk** works; ambient noise does not trigger the mentor.
5. The mentor replies **out loud** in a **gender-neutral** voice, grounded in the person's actual content, within **~1–2 seconds**, **never more than ~2s**.
6. Asked about something not in the videos, the mentor is **honest** about it **and** still gives a useful general answer.
7. The mentor **remembers earlier turns** in the same conversation; a new session **resets**.
8. The animation **never delays** voice responses (it's decoupled), and the app works even if the AI animation fails (CSS fallback).
9. It is a **live, shareable URL** that works for someone else in their browser.

---

## 15. Suggested build order

1. Scaffold the Next.js (TS) app; deploy a "hello world" to Vercel to confirm the pipeline early.
2. Input screen + YouTube URL validation + video-ID parsing.
3. `/api/build-mentor` step 1: transcript fetching via the transcript API, with skip+notify. Verify on real links.
4. Persona pass (OpenAI) + JSON parsing; add compression fallback.
5. Face image selection (thumbnail; uploaded-photo override).
6. Create the Vapi assistant server-side; return `vapiAssistantId`.
7. Conversation screen + Vapi web call + **push-to-talk** + live transcript. Get the voice loop working end-to-end and tune latency.
8. CSS breathing effect (instant), then the AI idle-loop generation + progressive-enhancement swap.
9. Disclaimer, reset, all error states.
10. Polish, then verify every acceptance criterion on the deployed URL.

---

## 16. Notes

- **Cost:** Vapi bills per minute of voice call; Supadata is free up to 100 requests/month; Veo/Gemini bills per second of generated video; OpenAI bills per token. This is fine for a demo — just be aware running a live conversation costs a small amount per minute, and each mentor build triggers one Veo generation job.
- **Vercel timeout:** The default serverless function timeout is 10 seconds on hobby plans. This project uses **Vercel Pro**, which supports up to 60 seconds — enough for the persona pass. Configure `maxDuration = 60` in the API route config for `/api/build-mentor`. Veo generation is async (poll separately), so it never blocks the build route.
- **Likeness/ethics:** the face is a real person's likeness recreated by AI. The visible "AI recreation" disclaimer is required, and the face is sourced from the **provided videos' thumbnails** (or a user upload) — **not** by scraping arbitrary images off the open web.
- **Part B reminder:** the go-to-market email + LinkedIn message is a separate deliverable and depends on knowing **what is being sold** — get that clarified before writing it.
```
