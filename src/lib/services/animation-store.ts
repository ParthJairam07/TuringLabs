export type AnimationJob = {
  assistantId: string;
  animationStatus: "pending" | "ready" | "failed";
  operationName?: string;
  videoBytesBase64?: string;
  mimeType?: string;
  error?: string;
  updatedAt: number;
};

type AnimationStore = Map<string, AnimationJob>;

declare global {
  var liveAiMentorAnimationStore: AnimationStore | undefined;
}

export function getAnimationStore() {
  if (!globalThis.liveAiMentorAnimationStore) {
    globalThis.liveAiMentorAnimationStore = new Map();
  }

  return globalThis.liveAiMentorAnimationStore;
}

export function setAnimationJob(job: AnimationJob) {
  getAnimationStore().set(job.assistantId, job);
}

export function getAnimationJob(assistantId: string) {
  return getAnimationStore().get(assistantId);
}

export function getAnimationVideoUrl(assistantId: string) {
  return `/api/animation-video?assistantId=${encodeURIComponent(assistantId)}`;
}
