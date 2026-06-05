import type {
  TranscriptDiagnostic,
  TranscriptDiagnosticEvent,
  TranscriptSource,
} from "@/types/mentor";

type SupadataTranscriptResponse =
  | {
      content?: string | { text?: string }[];
      lang?: string;
      availableLangs?: string[];
      result?: SupadataTranscriptResult;
      status?: SupadataTranscriptStatus;
      error?: unknown;
      message?: unknown;
    }
  | {
      jobId: string;
    };

type SupadataTranscriptResult = {
  content?: string | { text?: string }[];
  lang?: string;
  availableLangs?: string[];
};

type SupadataTranscriptStatus = "queued" | "active" | "completed" | "failed";

const SUPADATA_BASE_URL = "https://api.supadata.ai/v1";
const TRANSCRIPT_POLL_INTERVAL_MS = 1000;
const TRANSCRIPT_MAX_POLLS = 45;

type DiagnosticRecorder = (
  event: Omit<TranscriptDiagnosticEvent, "atMs">,
) => void;

export class TranscriptFetchError extends Error {
  diagnostic: TranscriptDiagnostic;

  constructor(message: string, diagnostic: TranscriptDiagnostic) {
    super(message);
    this.name = "TranscriptFetchError";
    this.diagnostic = diagnostic;
  }
}

export async function fetchTranscriptForVideo(
  url: string,
  videoId: string,
  index: number,
): Promise<TranscriptSource> {
  const { transcript } = await fetchTranscriptForVideoWithDiagnostics(
    url,
    videoId,
    index,
  );

  return transcript;
}

export async function fetchTranscriptForVideoWithDiagnostics(
  url: string,
  videoId: string,
  index: number,
): Promise<{ transcript: TranscriptSource; diagnostic: TranscriptDiagnostic }> {
  const startedAt = Date.now();
  const diagnostic: TranscriptDiagnostic = {
    url,
    videoId,
    status: "skipped",
    durationMs: 0,
    events: [],
  };
  const record: DiagnosticRecorder = (event) => {
    diagnostic.events.push({
      ...event,
      atMs: Date.now() - startedAt,
    });
  };

  try {
    const transcript = await fetchTranscriptForVideoInternal(
      url,
      videoId,
      index,
      record,
    );
    const preview = transcript.content.trim().slice(0, 280);

    diagnostic.status = "success";
    diagnostic.durationMs = Date.now() - startedAt;
    diagnostic.lang = transcript.lang;
    diagnostic.transcriptChars = transcript.content.length;
    diagnostic.transcriptPreview = preview;

    record({
      label: "completed",
      detail: `Transcript loaded (${transcript.content.length.toLocaleString()} chars).`,
    });

    return { transcript, diagnostic };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not fetch transcript.";

    diagnostic.status = "skipped";
    diagnostic.durationMs = Date.now() - startedAt;
    diagnostic.reason = message;

    record({
      label: "skipped",
      detail: message,
    });

    throw new TranscriptFetchError(message, diagnostic);
  }
}

async function fetchTranscriptForVideoInternal(
  url: string,
  videoId: string,
  index: number,
  record: DiagnosticRecorder,
): Promise<TranscriptSource> {
  const apiKey = process.env.TRANSCRIPT_API_KEY;

  if (!apiKey) {
    throw new Error("TRANSCRIPT_API_KEY is not configured.");
  }

  const searchParams = new URLSearchParams({
    url,
    text: "true",
    mode: "auto",
  });

  record({
    label: "initial-request",
    detail: "Requesting Supadata transcript.",
  });

  const response = await fetch(`${SUPADATA_BASE_URL}/transcript?${searchParams}`, {
    headers: {
      "x-api-key": apiKey,
    },
  });

  const data = (await response.json().catch(() => null)) as
    | SupadataTranscriptResponse
    | null;

  record({
    label: "initial-response",
    httpStatus: response.status,
    supadataStatus: getSupadataStatus(data),
    detail: describeSupadataResponse(data),
  });

  if (!response.ok && response.status !== 202) {
    throw new Error(extractSupadataError(data) ?? `Transcript API returned ${response.status}.`);
  }

  const resolved = await resolveTranscriptResponse(data, apiKey, record);
  const content = normalizeTranscriptContent(resolved.content);

  if (!content.trim()) {
    throw new Error("No usable transcript was returned.");
  }

  return {
    url,
    videoId,
    source: `Video ${index + 1} (${videoId})`,
    content,
    lang: resolved.lang,
  };
}

async function resolveTranscriptResponse(
  data: SupadataTranscriptResponse | null,
  apiKey: string,
  record: DiagnosticRecorder,
): Promise<SupadataTranscriptResult> {
  if (!data) {
    throw new Error("Transcript API returned an empty response.");
  }

  if ("jobId" in data) {
    record({
      label: "async-job",
      detail: "Supadata returned an async transcript job.",
    });

    for (let attempt = 0; attempt < TRANSCRIPT_MAX_POLLS; attempt += 1) {
      await sleep(TRANSCRIPT_POLL_INTERVAL_MS);

      const response = await fetch(`${SUPADATA_BASE_URL}/transcript/${data.jobId}`, {
        headers: {
          "x-api-key": apiKey,
        },
      });

      const jobData = (await response.json().catch(() => null)) as
        | SupadataTranscriptResponse
        | null;

      record({
        label: "poll-response",
        attempt: attempt + 1,
        httpStatus: response.status,
        supadataStatus: getSupadataStatus(jobData),
        detail: describeSupadataResponse(jobData),
      });

      if (!response.ok && response.status !== 202) {
        throw new Error(extractSupadataError(jobData) ?? "Transcript job failed.");
      }

      const resolved = resolveTranscriptJobData(jobData);

      if (resolved.status === "completed") {
        record({
          label: "job-completed",
          attempt: attempt + 1,
          detail: "Supadata transcript job completed.",
        });
        return resolved.transcript;
      }

      if (resolved.status === "failed") {
        throw new Error(resolved.reason);
      }
    }

    record({
      label: "job-timeout",
      detail: "Supadata job did not complete within the local polling window.",
    });

    throw new Error("Transcript generation was still processing after 45 seconds.");
  }

  const resolved = resolveTranscriptJobData(data);

  if (resolved.status === "completed") {
    return resolved.transcript;
  }

  if (resolved.status === "failed") {
    throw new Error(resolved.reason);
  }

  throw new Error("Transcript generation is still processing.");
}

function resolveTranscriptJobData(data: SupadataTranscriptResponse | null):
  | { status: "completed"; transcript: SupadataTranscriptResult }
  | { status: "pending" }
  | { status: "failed"; reason: string } {
  if (!data) {
    return { status: "pending" };
  }

  if ("jobId" in data) {
    return { status: "pending" };
  }

  if (data.status === "failed") {
    return {
      status: "failed",
      reason: extractSupadataError(data) ?? "Transcript job failed.",
    };
  }

  const transcript = extractTranscriptResult(data);

  if (data.status === "completed") {
    if (transcript) {
      return { status: "completed", transcript };
    }

    return {
      status: "failed",
      reason: "Transcript job completed without usable content.",
    };
  }

  if (data.status === "queued" || data.status === "active") {
    return { status: "pending" };
  }

  if (transcript) {
    return { status: "completed", transcript };
  }

  return { status: "pending" };
}

function extractTranscriptResult(
  data: Exclude<SupadataTranscriptResponse, { jobId: string }>,
): SupadataTranscriptResult | null {
  if (data.result?.content) {
    return data.result;
  }

  if (data.content) {
    return {
      content: data.content,
      lang: data.lang,
      availableLangs: data.availableLangs,
    };
  }

  return null;
}

function getSupadataStatus(data: SupadataTranscriptResponse | null) {
  if (!data || "jobId" in data) {
    return undefined;
  }

  return data.status;
}

function describeSupadataResponse(data: SupadataTranscriptResponse | null) {
  if (!data) {
    return "Empty response body.";
  }

  if ("jobId" in data) {
    return "Async job ID returned.";
  }

  if (data.status === "queued" || data.status === "active") {
    return `Job ${data.status}.`;
  }

  if (data.status === "failed") {
    return extractSupadataError(data) ?? "Job failed.";
  }

  if (data.result?.content) {
    return "Nested transcript content returned.";
  }

  if (data.content) {
    return "Transcript content returned.";
  }

  if (data.status === "completed") {
    return "Job completed without transcript content.";
  }

  return "Response did not include transcript content or job status.";
}

function normalizeTranscriptContent(content: SupadataTranscriptResult["content"]) {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content.map((chunk) => chunk.text ?? "").join(" ");
  }

  return "";
}

function extractSupadataError(data: unknown) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const maybeError = data as {
    error?: unknown;
    message?: unknown;
    details?: unknown;
  };

  if (typeof maybeError.error === "string") {
    return maybeError.error;
  }

  if (maybeError.error && typeof maybeError.error === "object") {
    return extractSupadataError(maybeError.error);
  }

  if (typeof maybeError.message === "string") {
    return maybeError.message;
  }

  if (typeof maybeError.details === "string") {
    return maybeError.details;
  }

  return null;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
