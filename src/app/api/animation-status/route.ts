import {
  getAnimationJob,
  getAnimationVideoUrl,
  setAnimationJob,
} from "@/lib/services/animation-store";
import { refreshVeoAnimationJob } from "@/lib/services/gemini";
import type { Mentor } from "@/types/mentor";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const assistantId = url.searchParams.get("assistantId");

  if (!assistantId) {
    return Response.json(
      { error: "assistantId is required." },
      { status: 400 },
    );
  }

  const job = getAnimationJob(assistantId);

  if (!job) {
    return Response.json({
      animationStatus: "failed",
      animationLoopUrl: null,
    } satisfies Pick<Mentor, "animationStatus" | "animationLoopUrl">);
  }

  const refreshed =
    job.animationStatus === "pending" ? await refreshVeoAnimationJob(job) : job;

  if (refreshed !== job) {
    setAnimationJob(refreshed);
  }

  return Response.json({
    animationStatus: refreshed.animationStatus,
    animationLoopUrl:
      refreshed.animationStatus === "ready"
        ? getAnimationVideoUrl(assistantId)
        : null,
  } satisfies Pick<Mentor, "animationStatus" | "animationLoopUrl">);
}
