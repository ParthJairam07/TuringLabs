export type BuildRequest = {
  youtubeUrls: string[];
  uploadedPhotoDataUrl?: string;
};

export type SkippedLink = {
  url: string;
  reason: string;
};

export type TranscriptDiagnosticEvent = {
  atMs: number;
  label: string;
  detail?: string;
  httpStatus?: number;
  supadataStatus?: string;
  attempt?: number;
};

export type TranscriptDiagnostic = {
  url: string;
  videoId: string;
  status: "success" | "skipped";
  durationMs: number;
  reason?: string;
  transcriptChars?: number;
  transcriptPreview?: string;
  lang?: string;
  events: TranscriptDiagnosticEvent[];
};

export type BuildDebug = {
  transcriptDiagnostics: TranscriptDiagnostic[];
  successfulTranscripts: number;
  skippedTranscripts: number;
  combinedTranscriptChars?: number;
  liveContextChars?: number;
  liveContextEstimatedTokens?: number;
};

export type PersonaProfile = {
  name: string;
  oneLineBio: string;
  areasOfExpertise: string[];
  speakingStyle: string;
  recurringThemes: string[];
  characteristicPhrases: string[];
  notableOpinions: string[];
  perVideoSummaries: { source: string; summary: string }[];
};

export type Mentor = {
  personName: string;
  personaProfile: PersonaProfile;
  faceImageUrl: string;
  animationLoopUrl: string | null;
  animationStatus: "pending" | "ready" | "failed";
  vapiAssistantId: string;
  skippedLinks: SkippedLink[];
  debug?: BuildDebug;
};

export type BuildError = {
  error: string;
  skippedLinks?: SkippedLink[];
  debug?: BuildDebug;
};

export type TranscriptSource = {
  url: string;
  videoId: string;
  source: string;
  content: string;
  lang?: string;
  title?: string;
  channelName?: string;
};
