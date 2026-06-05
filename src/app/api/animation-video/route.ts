import { getAnimationJob } from "@/lib/services/animation-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const assistantId = url.searchParams.get("assistantId");

  if (!assistantId) {
    return new Response("assistantId is required.", { status: 400 });
  }

  const job = getAnimationJob(assistantId);

  if (
    !job ||
    job.animationStatus !== "ready" ||
    !job.videoBytesBase64
  ) {
    return new Response("Animation video is not ready.", { status: 404 });
  }

  const buffer = Buffer.from(job.videoBytesBase64, "base64");

  return new Response(buffer, {
    headers: {
      "Content-Type": job.mimeType ?? "video/mp4",
      "Cache-Control": "no-store",
    },
  });
}
