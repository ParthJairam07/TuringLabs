import { GoogleGenAI, type GenerateVideosOperation } from "@google/genai";
import { parseDataUrl } from "@/lib/utils/data-url";
import type { AnimationJob } from "@/lib/services/animation-store";

const VEO_MODEL = "veo-2.0-generate-001";
const VEO_PROMPT =
  "A person breathing naturally, subtle ambient motion, calm, portrait, gentle blinking, still - idle, no speaking.";
const VEO_START_TIMEOUT_MS = 10_000;

export async function startVeoAnimationJob(faceImageUrl: string) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const ai = new GoogleGenAI({ apiKey });
  const image = await getImageForGemini(faceImageUrl);

  const operation = await withTimeout(
    ai.models.generateVideos({
      model: VEO_MODEL,
      prompt: VEO_PROMPT,
      image,
      config: {
        numberOfVideos: 1,
        durationSeconds: 8,
        aspectRatio: "16:9",
        personGeneration: "allow_adult",
        negativePrompt: "talking, lip sync, speech, exaggerated motion",
      },
    }),
    VEO_START_TIMEOUT_MS,
  );

  if (!operation.name) {
    throw new Error("Veo did not return an operation name.");
  }

  return operation.name;
}

export async function refreshVeoAnimationJob(job: AnimationJob): Promise<AnimationJob> {
  if (job.animationStatus !== "pending" || !job.operationName) {
    return job;
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return {
      ...job,
      animationStatus: "failed",
      error: "GEMINI_API_KEY is not configured.",
      updatedAt: Date.now(),
    };
  }

  const ai = new GoogleGenAI({ apiKey });
  const operation = await ai.operations.getVideosOperation({
    operation: { name: job.operationName } as GenerateVideosOperation,
  });

  if (!operation.done) {
    return {
      ...job,
      updatedAt: Date.now(),
    };
  }

  if (operation.error) {
    return {
      ...job,
      animationStatus: "failed",
      error: JSON.stringify(operation.error),
      updatedAt: Date.now(),
    };
  }

  const video = operation.response?.generatedVideos?.[0]?.video;

  if (!video) {
    return {
      ...job,
      animationStatus: "failed",
      error: "Veo completed without a video.",
      updatedAt: Date.now(),
    };
  }

  if (video.videoBytes) {
    return {
      ...job,
      animationStatus: "ready",
      videoBytesBase64: video.videoBytes,
      mimeType: video.mimeType ?? "video/mp4",
      updatedAt: Date.now(),
    };
  }

  if (!video.uri) {
    return {
      ...job,
      animationStatus: "failed",
      error: "Veo video has no downloadable URI.",
      updatedAt: Date.now(),
    };
  }

  const response = await fetch(video.uri, {
    headers: {
      "x-goog-api-key": apiKey,
    },
  });

  if (!response.ok) {
    return {
      ...job,
      animationStatus: "failed",
      error: `Video download returned ${response.status}.`,
      updatedAt: Date.now(),
    };
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  return {
    ...job,
    animationStatus: "ready",
    videoBytesBase64: buffer.toString("base64"),
    mimeType: response.headers.get("content-type") ?? "video/mp4",
    updatedAt: Date.now(),
  };
}

async function getImageForGemini(faceImageUrl: string) {
  const dataUrl = parseDataUrl(faceImageUrl);

  if (dataUrl) {
    return {
      imageBytes: dataUrl.base64,
      mimeType: dataUrl.mimeType,
    };
  }

  const response = await fetch(faceImageUrl);

  if (!response.ok) {
    throw new Error(`Could not fetch face image (${response.status}).`);
  }

  const mimeType = response.headers.get("content-type") ?? "image/jpeg";
  const imageBytes = Buffer.from(await response.arrayBuffer()).toString("base64");

  return {
    imageBytes,
    mimeType,
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Veo job start timed out."));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timeout);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timeout);
        reject(error);
      });
  });
}
