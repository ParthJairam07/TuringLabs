import { buildConversationSystemPrompt } from "@/lib/prompts/persona";
import {
  buildFallbackPersonaProfile,
  buildPersonaProfile,
  compressTranscriptContextIfNeeded,
  estimateTokens,
} from "@/lib/services/openai";
import {
  fetchTranscriptForVideoWithDiagnostics,
  TranscriptFetchError,
} from "@/lib/services/supadata";
import { createVapiAssistant } from "@/lib/services/vapi";
import { estimateDataUrlBytes, parseDataUrl } from "@/lib/utils/data-url";
import {
  dedupeParsedUrls,
  getHighQualityThumbnailUrl,
  getMaxResThumbnailUrl,
  parseYouTubeUrls,
} from "@/lib/utils/youtube";
import type {
  BuildDebug,
  BuildError,
  BuildRequest,
  Mentor,
  TranscriptDiagnostic,
} from "@/types/mentor";

export const maxDuration = 60;
export const runtime = "nodejs";

const MAX_YOUTUBE_URLS = 6;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const TRANSCRIPT_REQUEST_STAGGER_MS = 1100;
const LOCAL_AVATAR_LOOP_URL = "/avatar/listening.mp4";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<BuildRequest>;
    const validation = validateBuildRequest(body);

    if ("error" in validation) {
      return Response.json(validation, { status: 400 });
    }

    const parsedUrls = validation.youtubeUrls;
    const personName = validation.personName;
    const transcriptResults = await fetchTranscriptsWithRateLimit(
      parsedUrls,
    );

    const transcripts = transcriptResults
      .map((result) => result.transcript)
      .filter((item) => item !== undefined);
    const skippedLinks = transcriptResults
      .map((result) => result.skipped)
      .filter((item) => item !== undefined);
    const debug = buildDebug(transcriptResults.map((result) => result.diagnostic));

    if (skippedLinks.length > 0) {
      console.info(
        "[build-mentor] skipped transcript links",
        skippedLinks.map(({ url, reason }) => ({ url, reason })),
      );
      console.info(
        "[build-mentor] transcript diagnostics",
        debug.transcriptDiagnostics.map((diagnostic) => ({
          url: diagnostic.url,
          videoId: diagnostic.videoId,
          status: diagnostic.status,
          reason: diagnostic.reason,
          durationMs: diagnostic.durationMs,
          transcriptChars: diagnostic.transcriptChars,
          events: diagnostic.events,
        })),
      );
    }

    if (transcripts.length === 0) {
      return Response.json(
        {
          error:
            "Couldn't get transcripts for any of these videos. Try other links from the same person (videos with captions work best).",
          skippedLinks,
          debug,
        } satisfies BuildError,
        { status: 422 },
      );
    }

    const combinedTranscripts = transcripts
      .map(
        (transcript) =>
          `--- ${transcript.source} ---\nURL: ${transcript.url}\nLanguage: ${
            transcript.lang ?? "unknown"
          }\n\n${transcript.content}`,
      )
      .join("\n\n");
    debug.combinedTranscriptChars = combinedTranscripts.length;

    const faceImageUrl =
      validation.uploadedPhotoDataUrl ??
      (await chooseThumbnailUrl(transcripts[0].videoId));

    const [transcriptContext, generatedPersonaProfile] = await buildPersonaWithContext(
      combinedTranscripts,
      personName,
    );
    debug.liveContextChars = transcriptContext.length;
    debug.liveContextEstimatedTokens = estimateTokens(transcriptContext);

    const personaProfile = {
      ...generatedPersonaProfile,
      name: personName,
    };
    const systemPrompt = buildConversationSystemPrompt(
      personName,
      personaProfile,
      transcriptContext,
    );
    const vapiAssistantId = await createVapiAssistant({
      personName,
      personaProfile,
      systemPrompt,
    });

    const mentor: Mentor = {
      personName,
      personaProfile,
      faceImageUrl,
      animationLoopUrl: LOCAL_AVATAR_LOOP_URL,
      animationStatus: "ready",
      vapiAssistantId,
      skippedLinks,
      debug,
    };

    return Response.json(mentor);
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Something went wrong while building the mentor.",
      } satisfies BuildError,
      { status: 500 },
    );
  }
}

async function fetchTranscriptsWithRateLimit(
  parsedUrls: { url: string; videoId: string }[],
) {
  const results = [];

  for (let index = 0; index < parsedUrls.length; index += 1) {
    const { url, videoId } = parsedUrls[index];

    if (index > 0) {
      await sleep(TRANSCRIPT_REQUEST_STAGGER_MS);
    }

    try {
      const { transcript, diagnostic } =
        await fetchTranscriptForVideoWithDiagnostics(url, videoId, index);

      results.push({ transcript, diagnostic });
    } catch (error) {
      const diagnostic =
        error instanceof TranscriptFetchError
          ? error.diagnostic
          : buildSkippedTranscriptDiagnostic(url, videoId, error);

      results.push({
        skipped: {
          url,
          reason:
            error instanceof Error
              ? error.message
              : "Could not fetch transcript.",
        },
        diagnostic,
      });
    }
  }

  return results;
}

function buildDebug(
  transcriptDiagnostics: TranscriptDiagnostic[],
): BuildDebug {
  return {
    transcriptDiagnostics,
    successfulTranscripts: transcriptDiagnostics.filter(
      (diagnostic) => diagnostic.status === "success",
    ).length,
    skippedTranscripts: transcriptDiagnostics.filter(
      (diagnostic) => diagnostic.status === "skipped",
    ).length,
  };
}

function buildSkippedTranscriptDiagnostic(
  url: string,
  videoId: string,
  error: unknown,
): TranscriptDiagnostic {
  const reason =
    error instanceof Error ? error.message : "Could not fetch transcript.";

  return {
    url,
    videoId,
    status: "skipped",
    durationMs: 0,
    reason,
    events: [
      {
        atMs: 0,
        label: "skipped",
        detail: reason,
      },
    ],
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function validateBuildRequest(body: Partial<BuildRequest>):
  | {
      personName: string;
      youtubeUrls: { url: string; videoId: string }[];
      uploadedPhotoDataUrl?: string;
    }
  | BuildError {
  const personName =
    typeof body.personName === "string" ? body.personName.trim() : "";

  if (!personName) {
    return { error: "Provide the person's name." };
  }

  if (personName.length > 80) {
    return { error: "Person's name must be 80 characters or fewer." };
  }

  if (!Array.isArray(body.youtubeUrls)) {
    return { error: "Provide 1-6 YouTube URLs." };
  }

  const rawUrls = body.youtubeUrls
    .map((url) => (typeof url === "string" ? url.trim() : ""))
    .filter(Boolean);

  if (rawUrls.length < 1 || rawUrls.length > MAX_YOUTUBE_URLS) {
    return { error: "Provide 1-6 YouTube URLs." };
  }

  const parsed = parseYouTubeUrls(rawUrls);
  const invalid = parsed.filter((item) => !item.parsed);

  if (invalid.length > 0) {
    return {
      error: "Every link must be a valid YouTube watch, youtu.be, or Shorts URL.",
      skippedLinks: invalid.map((item) => ({
        url: item.rawUrl,
        reason: "Invalid YouTube URL.",
      })),
    };
  }

  let uploadedPhotoDataUrl: string | undefined;

  if (body.uploadedPhotoDataUrl) {
    if (
      typeof body.uploadedPhotoDataUrl !== "string" ||
      !parseDataUrl(body.uploadedPhotoDataUrl) ||
      !body.uploadedPhotoDataUrl.startsWith("data:image/")
    ) {
      return { error: "Uploaded photo must be an image file." };
    }

    if (estimateDataUrlBytes(body.uploadedPhotoDataUrl) > MAX_UPLOAD_BYTES) {
      return { error: "Uploaded photo must be 5 MB or smaller." };
    }

    uploadedPhotoDataUrl = body.uploadedPhotoDataUrl;
  }

  return {
    personName,
    youtubeUrls: dedupeParsedUrls(
      parsed.map((item) => item.parsed).filter((item) => item !== null),
    ),
    uploadedPhotoDataUrl,
  };
}

async function buildPersonaWithContext(
  combinedTranscripts: string,
  personName: string,
) {
  const transcriptContext =
    await compressTranscriptContextIfNeeded(combinedTranscripts);

  try {
    return [
      transcriptContext,
      await buildPersonaProfile(transcriptContext, personName),
    ] as const;
  } catch {
    return [
      transcriptContext,
      buildFallbackPersonaProfile(transcriptContext, personName),
    ] as const;
  }
}

async function chooseThumbnailUrl(videoId: string) {
  const maxResUrl = getMaxResThumbnailUrl(videoId);

  try {
    const response = await fetch(maxResUrl, { method: "HEAD" });

    if (response.ok) {
      return maxResUrl;
    }
  } catch {
    // Fall through to hqdefault.
  }

  return getHighQualityThumbnailUrl(videoId);
}
