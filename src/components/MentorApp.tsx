"use client";

import type Vapi from "@vapi-ai/web";
import {
  Link as LinkIcon,
  Loader2,
  Mic,
  MicOff,
  RefreshCcw,
  Sparkles,
  Square,
  Trash2,
} from "lucide-react";
import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import styles from "./MentorApp.module.css";
import { parseYouTubeUrl } from "@/lib/utils/youtube";
import type { BuildDebug, BuildError, Mentor, SkippedLink } from "@/types/mentor";

type Screen = "input" | "building" | "conversation";
type TalkMode = "hold" | "toggle";
type VoiceState = "disconnected" | "connecting" | "idle" | "listening" | "speaking";
type TranscriptRole = "user" | "assistant";
type TranscriptTurn = {
  id: string;
  role: TranscriptRole;
  text: string;
  final: boolean;
  committed?: boolean;
  committedText?: string;
  partialText?: string;
  streamKey?: string;
};
type TranscriptStreamState = {
  activeTurnKeyByRole: Partial<Record<TranscriptRole, string>>;
  localTurnCounter: number;
};

const MAX_LINKS = 6;
const BUILD_STEPS = [
  "Fetching the transcripts...",
  "Studying how they think and talk...",
  "Bringing the face to life...",
];
const AVATAR_TALKING_VIDEO_SRC = "/avatar/talking.mp4";
const AVATAR_LISTENING_VIDEO_SRC = "/avatar/listening.mp4";

export default function MentorApp() {
  const [screen, setScreen] = useState<Screen>("input");
  const [urlFields, setUrlFields] = useState<string[]>([""]);
  const [mentor, setMentor] = useState<Mentor | null>(null);
  const [skippedLinks, setSkippedLinks] = useState<SkippedLink[]>([]);
  const [buildDebug, setBuildDebug] = useState<BuildDebug | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [buildStep, setBuildStep] = useState(0);

  const nonEmptyUrls = useMemo(
    () => urlFields.map((url) => url.trim()).filter(Boolean),
    [urlFields],
  );
  const invalidUrls = useMemo(
    () => nonEmptyUrls.filter((url) => !parseYouTubeUrl(url)),
    [nonEmptyUrls],
  );
  const canBuild =
    nonEmptyUrls.length > 0 &&
    invalidUrls.length === 0;

  useEffect(() => {
    if (screen !== "building") {
      return;
    }

    const interval = window.setInterval(() => {
      setBuildStep((current) => Math.min(current + 1, BUILD_STEPS.length - 1));
    }, 2200);

    return () => window.clearInterval(interval);
  }, [screen]);

  async function handleBuildMentor() {
    if (!canBuild) {
      return;
    }

    setError(null);
    setSkippedLinks([]);
    setBuildDebug(null);
    setBuildStep(0);
    setScreen("building");

    try {
      const response = await fetch("/api/build-mentor", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          youtubeUrls: nonEmptyUrls,
        }),
      });

      const data = (await response.json()) as Mentor | BuildError;

      if (!response.ok || "error" in data) {
        setSkippedLinks("skippedLinks" in data ? data.skippedLinks ?? [] : []);
        setBuildDebug("debug" in data ? data.debug ?? null : null);
        throw new Error("error" in data ? data.error : "Build failed.");
      }

      setMentor(data);
      setSkippedLinks(data.skippedLinks);
      setBuildDebug(data.debug ?? null);
      setScreen("conversation");
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Something went wrong while building the mentor.",
      );
      setScreen("input");
    }
  }

  function updateUrlField(index: number, value: string) {
    setUrlFields((current) =>
      current.map((field, fieldIndex) =>
        fieldIndex === index ? value : field,
      ),
    );
  }

  function addUrlField() {
    setUrlFields((current) =>
      current.length >= MAX_LINKS ? current : [...current, ""],
    );
  }

  function removeUrlField(index: number) {
    setUrlFields((current) => {
      const next = current.filter((_, fieldIndex) => fieldIndex !== index);
      return next.length > 0 ? next : [""];
    });
  }

  function resetAll() {
    setMentor(null);
    setSkippedLinks([]);
    setBuildDebug(null);
    setError(null);
    setScreen("input");
  }

  return (
    <main className={styles.appShell}>
      {screen === "input" && (
        <section className={styles.inputGrid}>
          <div className={styles.intro}>
            <p className={styles.kicker}>Live AI Mentor</p>
            <h1>Talk to anyone. Paste their YouTube videos, get a live mentor.</h1>
            <p className={styles.subtext}>
              Paste up to 6 YouTube links of the same person. We&apos;ll infer
              their name automatically.
            </p>
          </div>

          <div className={styles.builderPanel}>
            <div className={styles.urlList}>
              {urlFields.map((url, index) => {
                const isInvalid = url.trim() !== "" && !parseYouTubeUrl(url);

                return (
                  <label className={styles.urlRow} key={index}>
                    <LinkIcon aria-hidden size={18} />
                    <input
                      value={url}
                      onChange={(event) =>
                        updateUrlField(index, event.target.value)
                      }
                      placeholder={`YouTube URL ${index + 1}`}
                      aria-invalid={isInvalid}
                    />
                    {urlFields.length > 1 && (
                      <button
                        className={styles.iconButton}
                        type="button"
                        onClick={() => removeUrlField(index)}
                        aria-label={`Remove URL ${index + 1}`}
                      >
                        <Trash2 aria-hidden size={17} />
                      </button>
                    )}
                  </label>
                );
              })}
            </div>

            {invalidUrls.length > 0 && (
              <p className={styles.inlineError}>
                Use a valid YouTube watch, youtu.be, or Shorts link.
              </p>
            )}

            <div className={styles.inputActions}>
              <button
                className={styles.secondaryButton}
                type="button"
                onClick={addUrlField}
                disabled={urlFields.length >= MAX_LINKS}
              >
                Add link
              </button>
            </div>

            {error && <p className={styles.errorMessage}>{error}</p>}
            {buildDebug && <BuildDebugPanel debug={buildDebug} />}

            <button
              className={styles.primaryButton}
              type="button"
              onClick={handleBuildMentor}
              disabled={!canBuild}
            >
              <Sparkles aria-hidden size={19} />
              Build my mentor
            </button>
          </div>
        </section>
      )}

      {screen === "building" && (
        <section className={styles.buildingView}>
          <Loader2 className={styles.spinner} aria-hidden size={34} />
          <p>{BUILD_STEPS[buildStep]}</p>
          {skippedLinks.length > 0 && (
            <SkippedLinksNotice skippedLinks={skippedLinks} />
          )}
        </section>
      )}

      {screen === "conversation" && mentor && (
        <ConversationView
          mentor={mentor}
          skippedLinks={skippedLinks}
          debug={mentor.debug ?? buildDebug}
          onMentorUpdate={setMentor}
          onReset={resetAll}
        />
      )}
    </main>
  );
}

function ConversationView({
  mentor,
  skippedLinks,
  debug,
  onMentorUpdate,
  onReset,
}: {
  mentor: Mentor;
  skippedLinks: SkippedLink[];
  debug: BuildDebug | null;
  onMentorUpdate: (mentor: Mentor) => void;
  onReset: () => void;
}) {
  const [talkMode, setTalkMode] = useState<TalkMode>("hold");
  const [voiceState, setVoiceState] = useState<VoiceState>("disconnected");
  const [transcript, setTranscript] = useState<TranscriptTurn[]>([]);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [avatarVideoFailed, setAvatarVideoFailed] = useState(false);
  const vapiRef = useRef<Vapi | null>(null);
  const isPressedRef = useRef(false);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const transcriptStreamRef = useRef<TranscriptStreamState>({
    activeTurnKeyByRole: {},
    localTurnCounter: 0,
  });

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  useEffect(() => {
    if (mentor.animationStatus !== "pending") {
      return;
    }

    const pollAnimation = async () => {
      const response = await fetch(
        `/api/animation-status?assistantId=${encodeURIComponent(
          mentor.vapiAssistantId,
        )}`,
      );
      const data = (await response.json()) as Pick<
        Mentor,
        "animationStatus" | "animationLoopUrl"
      >;

      if (data.animationStatus !== "pending") {
        onMentorUpdate({
          ...mentor,
          animationStatus: data.animationStatus,
          animationLoopUrl: data.animationLoopUrl,
        });
      }
    };

    const interval = window.setInterval(pollAnimation, 8000);
    void pollAnimation();

    return () => window.clearInterval(interval);
  }, [mentor, onMentorUpdate]);

  useEffect(() => {
    return () => {
      void stopCurrentCall();
    };
  }, []);

  function markCallDisconnected(vapi: Vapi | null) {
    if (!vapi || vapiRef.current === vapi) {
      vapiRef.current = null;
    }

    isPressedRef.current = false;
    setVoiceState("disconnected");
  }

  function safelySetMuted(vapi: Vapi | null, muted: boolean) {
    if (!vapi) {
      markCallDisconnected(vapi);
      return false;
    }

    try {
      vapi.setMuted(muted);
      return true;
    } catch (caughtError) {
      setVoiceError(readableVapiError(caughtError));
      markCallDisconnected(vapi);
      return false;
    }
  }

  async function stopCurrentCall() {
    const vapi = vapiRef.current;

    if (!vapi) {
      return;
    }

    vapiRef.current = null;

    try {
      await vapi.stop();
    } catch {
      // The call may already be closed.
    }

    try {
      vapi.removeAllListeners();
    } catch {
      // Listener cleanup should not block UI reset.
    }
  }

  async function ensureCall() {
    if (vapiRef.current && voiceState !== "disconnected") {
      return vapiRef.current;
    }

    const publicKey = process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY;

    if (!publicKey) {
      throw new Error("NEXT_PUBLIC_VAPI_PUBLIC_KEY is not configured.");
    }

    setVoiceError(null);
    setVoiceState("connecting");

    const { default: VapiClass } = await import("@vapi-ai/web");
    const vapi = new VapiClass(publicKey);

    vapi.on("call-start", () => {
      if (safelySetMuted(vapi, true)) {
        setVoiceState("idle");
      }
    });
    vapi.on("call-end", () => markCallDisconnected(vapi));
    vapi.on("speech-start", () => setVoiceState("speaking"));
    vapi.on("speech-end", () => setVoiceState("idle"));
    vapi.on("message", (message) =>
      handleVapiMessage(message, setTranscript, transcriptStreamRef),
    );
    vapi.on("error", (caughtError) => {
      setVoiceError(readableVapiError(caughtError));
      setVoiceState("idle");
    });
    vapi.on("call-start-failed", (event) => {
      setVoiceError(event.error);
      markCallDisconnected(vapi);
    });

    vapiRef.current = vapi;

    try {
      await vapi.start(mentor.vapiAssistantId);
      if (safelySetMuted(vapi, true)) {
        setVoiceState("idle");
      }
      return vapi;
    } catch (caughtError) {
      markCallDisconnected(vapi);
      try {
        vapi.removeAllListeners();
      } catch {
        // Listener cleanup should not hide the original start error.
      }
      throw caughtError;
    }
  }

  async function beginTalking() {
    try {
      isPressedRef.current = true;
      const vapi = await ensureCall();

      if (talkMode === "hold" && !isPressedRef.current) {
        safelySetMuted(vapi, true);
        return;
      }

      if (safelySetMuted(vapi, false)) {
        setVoiceState("listening");
      }
    } catch (caughtError) {
      setVoiceError(readableVapiError(caughtError));
      setVoiceState("disconnected");
    }
  }

  function stopTalking() {
    isPressedRef.current = false;

    if (safelySetMuted(vapiRef.current, true)) {
      setVoiceState((current) => (current === "listening" ? "idle" : current));
    }
  }

  async function toggleTalking() {
    if (voiceState === "listening") {
      stopTalking();
      return;
    }

    await beginTalking();
  }

  async function startVoiceCall() {
    try {
      await ensureCall();
    } catch (caughtError) {
      setVoiceError(readableVapiError(caughtError));
    }
  }

  async function resetConversation() {
    await stopCurrentCall();
    onReset();
  }

  const isConnected = voiceState !== "disconnected" && voiceState !== "connecting";
  const isSpeaking = voiceState === "speaking";
  const isListening = voiceState === "listening";

  return (
    <section className={styles.conversationView}>
      <div className={styles.portraitColumn}>
        <div
          className={`${styles.faceFrame} ${isSpeaking ? styles.speaking : ""}`}
        >
          {avatarVideoFailed ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className={`${styles.faceMedia} ${styles.mentorFace}`}
              src={mentor.faceImageUrl}
              alt={`${mentor.personName} AI recreation`}
            />
          ) : (
            <>
              <video
                aria-hidden
                className={`${styles.faceMedia} ${styles.faceVideo} ${
                  isSpeaking ? styles.faceVideoActive : ""
                }`}
                src={AVATAR_TALKING_VIDEO_SRC}
                poster={mentor.faceImageUrl}
                autoPlay
                loop
                muted
                playsInline
                preload="auto"
                onError={() => setAvatarVideoFailed(true)}
              />
              <video
                aria-hidden
                className={`${styles.faceMedia} ${styles.faceVideo} ${
                  isSpeaking ? "" : styles.faceVideoActive
                }`}
                src={AVATAR_LISTENING_VIDEO_SRC}
                poster={mentor.faceImageUrl}
                autoPlay
                loop
                muted
                playsInline
                preload="auto"
                onError={() => setAvatarVideoFailed(true)}
              />
            </>
          )}
        </div>
        <p className={styles.disclaimer}>
          Doodle version of your conversation :)
        </p>
        <h2>{mentor.personName}</h2>
        <div className={styles.voiceStatus}>{voiceStatusText(voiceState)}</div>

        <div className={styles.talkModeTabs} aria-label="Talk mode">
          <button
            type="button"
            className={talkMode === "hold" ? styles.activeTab : ""}
            onClick={() => {
              stopTalking();
              setTalkMode("hold");
            }}
          >
            Hold
          </button>
          <button
            type="button"
            className={talkMode === "toggle" ? styles.activeTab : ""}
            onClick={() => {
              stopTalking();
              setTalkMode("toggle");
            }}
          >
            Toggle
          </button>
        </div>

        {!isConnected ? (
          <button
            className={styles.primaryButton}
            type="button"
            onClick={startVoiceCall}
            disabled={voiceState === "connecting"}
          >
            {voiceState === "connecting" ? (
              <Loader2 className={styles.buttonSpinner} aria-hidden size={19} />
            ) : (
              <Mic aria-hidden size={19} />
            )}
            Start voice call
          </button>
        ) : (
          <button
            className={`${styles.talkButton} ${
              isListening ? styles.listening : ""
            }`}
            type="button"
            onPointerDown={talkMode === "hold" ? beginTalking : undefined}
            onPointerUp={talkMode === "hold" ? stopTalking : undefined}
            onPointerCancel={talkMode === "hold" ? stopTalking : undefined}
            onPointerLeave={talkMode === "hold" ? stopTalking : undefined}
            onClick={talkMode === "toggle" ? toggleTalking : undefined}
          >
            {isListening ? (
              <MicOff aria-hidden size={24} />
            ) : (
              <Mic aria-hidden size={24} />
            )}
            {talkMode === "hold"
              ? isListening
                ? "Listening"
                : "Hold to talk"
              : isListening
                ? "Tap to stop"
                : "Tap to talk"}
          </button>
        )}

        <button
          className={styles.secondaryButton}
          type="button"
          onClick={resetConversation}
        >
          <RefreshCcw aria-hidden size={18} />
          Refresh Mentor
        </button>

        {voiceError && <p className={styles.errorMessage}>{voiceError}</p>}
        {skippedLinks.length > 0 && (
          <SkippedLinksNotice skippedLinks={skippedLinks} />
        )}
        {debug && <BuildDebugPanel debug={debug} />}
      </div>

      <div className={styles.transcriptPanel}>
        <div className={styles.transcriptHeader}>
          <h3>Transcript</h3>
          {isConnected && (
            <span>
              <Square aria-hidden size={10} fill="currentColor" />
              Live
            </span>
          )}
        </div>
        <div className={styles.transcriptList}>
          {transcript.length === 0 ? (
            <p className={styles.emptyTranscript}>
              The conversation transcript will appear here.
            </p>
          ) : (
            transcript.map((turn) => (
              <article
                className={`${styles.turn} ${
                  turn.role === "assistant" ? styles.assistantTurn : ""
                } ${turn.final ? "" : styles.partialTurn}`}
                key={turn.id}
              >
                <span>{turn.role === "assistant" ? mentor.personName : "You"}</span>
                <p>{turn.text}</p>
              </article>
            ))
          )}
          <div ref={transcriptEndRef} />
        </div>
      </div>
    </section>
  );
}

function SkippedLinksNotice({ skippedLinks }: { skippedLinks: SkippedLink[] }) {
  return (
    <div className={styles.notice}>
      <p>Could not use {skippedLinks.length} of your links - built from the rest.</p>
      <ul className={styles.noticeList}>
        {skippedLinks.map((link, index) => (
          <li key={`${link.url}-${index}`}>
            <span className={styles.noticeUrl}>{compactUrl(link.url)}</span>
            <span className={styles.noticeReason}>{link.reason}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BuildDebugPanel({ debug }: { debug: BuildDebug }) {
  return (
    <details className={styles.debugPanel} open={debug.skippedTranscripts > 0}>
      <summary>Transcript diagnostics</summary>
      <p className={styles.debugSummary}>
        {debug.successfulTranscripts} loaded, {debug.skippedTranscripts} skipped
        {debug.combinedTranscriptChars
          ? `, ${debug.combinedTranscriptChars.toLocaleString()} combined chars`
          : ""}
        {debug.liveContextEstimatedTokens
          ? `, ${debug.liveContextEstimatedTokens.toLocaleString()} live context tokens`
          : ""}
      </p>
      <ul className={styles.debugList}>
        {debug.transcriptDiagnostics.map((diagnostic) => (
          <li key={`${diagnostic.videoId}-${diagnostic.status}`}>
            <div className={styles.debugItemHeader}>
              <span
                className={`${styles.debugStatus} ${
                  diagnostic.status === "success"
                    ? styles.debugSuccess
                    : styles.debugSkipped
                }`}
              >
                {diagnostic.status}
              </span>
              <span className={styles.debugUrl}>{compactUrl(diagnostic.url)}</span>
              <span className={styles.debugDuration}>
                {formatDuration(diagnostic.durationMs)}
              </span>
            </div>

            {diagnostic.reason && (
              <p className={styles.debugReason}>{diagnostic.reason}</p>
            )}

            {diagnostic.transcriptChars !== undefined && (
              <p className={styles.debugMeta}>
                {diagnostic.transcriptChars.toLocaleString()} chars
                {diagnostic.lang ? `, ${diagnostic.lang}` : ""}
              </p>
            )}

            {diagnostic.transcriptPreview && (
              <p className={styles.debugPreview}>{diagnostic.transcriptPreview}</p>
            )}

            <details className={styles.debugEvents}>
              <summary>Events</summary>
              <ol>
                {diagnostic.events.map((event, index) => (
                  <li key={`${event.label}-${event.atMs}-${index}`}>
                    <span>{formatDuration(event.atMs)}</span>
                    <strong>{event.label}</strong>
                    {event.httpStatus !== undefined && (
                      <em>HTTP {event.httpStatus}</em>
                    )}
                    {event.supadataStatus && <em>{event.supadataStatus}</em>}
                    {event.attempt !== undefined && <em>poll {event.attempt}</em>}
                    {event.detail && <p>{event.detail}</p>}
                  </li>
                ))}
              </ol>
            </details>
          </li>
        ))}
      </ul>
    </details>
  );
}

function compactUrl(url: string) {
  const parsedYouTubeUrl = parseYouTubeUrl(url);

  if (parsedYouTubeUrl) {
    return `youtube.com/watch?v=${parsedYouTubeUrl.videoId}`;
  }

  try {
    const parsedUrl = new URL(url);
    return `${parsedUrl.hostname}${parsedUrl.pathname}`;
  } catch {
    return url;
  }
}

function formatDuration(ms: number) {
  if (ms < 1000) {
    return `${ms}ms`;
  }

  return `${(ms / 1000).toFixed(1)}s`;
}

function handleVapiMessage(
  message: unknown,
  setTranscript: Dispatch<SetStateAction<TranscriptTurn[]>>,
  transcriptStreamRef: { current: TranscriptStreamState },
) {
  if (!message || typeof message !== "object") {
    return;
  }

  const event = message as {
    type?: string;
    role?: "user" | "assistant";
    transcript?: string;
    transcriptType?: "partial" | "final";
    messages?: unknown;
    messagesOpenAIFormatted?: unknown;
    output?: unknown;
    status?: "started" | "stopped";
    turn?: number;
  };

  if (event.type === "speech-update" && isTranscriptRole(event.role)) {
    syncActiveSpeechTurn(event, transcriptStreamRef.current);
    return;
  }

  if (event.type === "conversation-update") {
    const authoritativeTurns = normalizeConversationMessages(
      Array.isArray(event.messagesOpenAIFormatted)
        ? event.messagesOpenAIFormatted
        : event.messages,
    );

    if (authoritativeTurns.length > 0) {
      setTranscript((current) =>
        mergeAuthoritativeTurns(current, authoritativeTurns),
      );
    }

    return;
  }

  if (event.type === "model-output") {
    const outputText = extractModelOutputText(event.output);

    if (!outputText.trim()) {
      return;
    }

    setTranscript((current) => appendAssistantModelOutput(current, outputText));
    return;
  }

  if (
    !isTranscriptEventType(event.type) ||
    !event.transcript ||
    event.role !== "user"
  ) {
    return;
  }

  const role = "user";
  const transcriptText = event.transcript;
  const isFinal = event.transcriptType !== "partial";
  const streamKey = getTranscriptStreamKey(role, event.turn, transcriptStreamRef.current);

  setTranscript((current) => {
    return mergeUserTranscriptTurn(current, transcriptText, isFinal, streamKey);
  });
}

function syncActiveSpeechTurn(
  event: {
    role?: "user" | "assistant";
    status?: "started" | "stopped";
    turn?: number;
  },
  streamState: TranscriptStreamState,
) {
  if (!isTranscriptRole(event.role) || event.status !== "started") {
    return;
  }

  streamState.activeTurnKeyByRole[event.role] =
    typeof event.turn === "number"
      ? `${event.role}-${event.turn}`
      : createLocalTurnKey(event.role, streamState);
}

function getTranscriptStreamKey(
  role: TranscriptRole,
  eventTurn: number | undefined,
  streamState: TranscriptStreamState,
) {
  if (typeof eventTurn === "number") {
    const streamKey = `${role}-${eventTurn}`;
    streamState.activeTurnKeyByRole[role] = streamKey;
    return streamKey;
  }

  const activeTurnKey = streamState.activeTurnKeyByRole[role];

  if (activeTurnKey) {
    return activeTurnKey;
  }

  const streamKey = createLocalTurnKey(role, streamState);
  streamState.activeTurnKeyByRole[role] = streamKey;
  return streamKey;
}

function createLocalTurnKey(
  role: TranscriptRole,
  streamState: TranscriptStreamState,
) {
  streamState.localTurnCounter += 1;
  return `${role}-local-${streamState.localTurnCounter}`;
}

function appendAssistantModelOutput(
  current: TranscriptTurn[],
  outputText: string,
): TranscriptTurn[] {
  const lastIndex = current.length - 1;
  const lastTurn = current[lastIndex];

  if (lastTurn?.role === "assistant" && !lastTurn.final) {
    const next = [...current];
    const text = outputText.startsWith(lastTurn.text)
      ? outputText
      : `${lastTurn.text}${outputText}`;

    next[lastIndex] = {
      ...lastTurn,
      text: text.trimStart(),
      committed: false,
    };

    return next;
  }

  return [
    ...current,
    {
      id: `assistant-output-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}`,
      role: "assistant",
      text: outputText.trimStart(),
      final: false,
      committed: false,
      streamKey: "assistant-live",
    },
  ];
}

function mergeUserTranscriptTurn(
  current: TranscriptTurn[],
  transcriptText: string,
  isFinal: boolean,
  streamKey: string,
): TranscriptTurn[] {
  const targetIndex = findTranscriptTargetIndex(current, "user", streamKey);
  const targetTurn =
    targetIndex >= 0
      ? current[targetIndex]
      : createTranscriptTurn("user", streamKey);
  const updatedTurn = applyTranscriptChunk(targetTurn, transcriptText, isFinal);

  if (!updatedTurn.text.trim()) {
    return current;
  }

  if (targetIndex >= 0) {
    const next = [...current];
    next[targetIndex] = updatedTurn;
    return next;
  }

  return [...current, updatedTurn];
}

function findTranscriptTargetIndex(
  current: TranscriptTurn[],
  role: TranscriptRole,
  streamKey: string,
) {
  const streamIndex = current.findIndex(
    (turn) => turn.role === role && turn.streamKey === streamKey,
  );

  if (streamIndex >= 0) {
    return streamIndex;
  }

  const lastIndex = current.length - 1;
  const lastTurn = current[lastIndex];

  if (lastTurn?.role === role && !lastTurn.committed) {
    return lastIndex;
  }

  return -1;
}

function createTranscriptTurn(
  role: TranscriptRole,
  streamKey: string,
): TranscriptTurn {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    role,
    text: "",
    final: false,
    committed: false,
    committedText: "",
    partialText: "",
    streamKey,
  };
}

function applyTranscriptChunk(
  turn: TranscriptTurn,
  transcriptText: string,
  isFinal: boolean,
): TranscriptTurn {
  const committedText = turn.committedText ?? (turn.final ? turn.text : "");
  const partialText = turn.partialText ?? (!turn.final ? turn.text : "");

  if (isFinal) {
    const nextCommittedText = mergeTranscriptText(committedText, transcriptText);

    return {
      ...turn,
      text: nextCommittedText,
      final: true,
      committed: false,
      committedText: nextCommittedText,
      partialText: "",
    };
  }

  const nextPartialText = partialTextAfterCommitted(
    committedText,
    transcriptText || partialText,
  );
  const nextText = combineTranscriptParts(committedText, nextPartialText);

  return {
    ...turn,
    text: nextText,
    final: false,
    committed: false,
    committedText,
    partialText: nextPartialText,
  };
}

function mergeAuthoritativeTurns(
  current: TranscriptTurn[],
  authoritativeTurns: TranscriptTurn[],
) {
  const drafts = current.filter(
    (turn) =>
      !turn.committed &&
      turn.text.trim() &&
      !isTurnRepresented(authoritativeTurns, turn),
  );

  return [...authoritativeTurns, ...drafts];
}

function isTurnRepresented(
  authoritativeTurns: TranscriptTurn[],
  draft: TranscriptTurn,
) {
  const draftText = normalizeTranscriptText(draft.text);

  return authoritativeTurns.some((turn) => {
    if (turn.role !== draft.role) {
      return false;
    }

    const authoritativeText = normalizeTranscriptText(turn.text);

    if (authoritativeText.length < 8 || draftText.length < 8) {
      return authoritativeText === draftText;
    }

    return (
      authoritativeText === draftText ||
      authoritativeText.includes(draftText) ||
      draftText.includes(authoritativeText)
    );
  });
}

function normalizeConversationMessages(messages: unknown): TranscriptTurn[] {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages.flatMap((message, index) => {
    if (!message || typeof message !== "object") {
      return [];
    }

    const item = message as {
      role?: unknown;
      content?: unknown;
      message?: unknown;
    };

    if (item.role !== "user" && item.role !== "assistant") {
      return [];
    }

    const text = extractMessageText(item.content ?? item.message).trim();

    if (!text) {
      return [];
    }

    return {
      id: `conversation-${index}-${item.role}`,
      role: item.role,
      text,
      final: true,
      committed: true,
      committedText: text,
      partialText: "",
      streamKey: `conversation-${index}-${item.role}`,
    };
  });
}

function mergeTranscriptText(existingText: string, incomingText: string) {
  const existing = existingText.trim();
  const incoming = incomingText.trim();

  if (!existing) {
    return incoming;
  }

  if (!incoming) {
    return existing;
  }

  const normalizedExisting = normalizeTranscriptText(existing);
  const normalizedIncoming = normalizeTranscriptText(incoming);

  if (
    normalizedExisting === normalizedIncoming ||
    normalizedExisting.includes(normalizedIncoming)
  ) {
    return existing;
  }

  if (normalizedIncoming.includes(normalizedExisting)) {
    return incoming;
  }

  const overlapLength = transcriptOverlapLength(existing, incoming);

  if (overlapLength > 0) {
    return `${existing}${incoming.slice(overlapLength)}`.trim();
  }

  return `${existing} ${incoming}`.trim();
}

function partialTextAfterCommitted(
  committedText: string,
  partialTranscriptText: string,
) {
  const committed = committedText.trim();
  const partial = partialTranscriptText.trim();

  if (!committed || !partial) {
    return partial;
  }

  const normalizedCommitted = normalizeTranscriptText(committed);
  const normalizedPartial = normalizeTranscriptText(partial);

  if (normalizedCommitted.includes(normalizedPartial)) {
    return "";
  }

  if (partial.toLowerCase().startsWith(committed.toLowerCase())) {
    return partial.slice(committed.length).trimStart();
  }

  const overlapLength = transcriptOverlapLength(committed, partial);
  return partial.slice(overlapLength).trimStart();
}

function combineTranscriptParts(committedText: string, partialText: string) {
  const committed = committedText.trim();
  const partial = partialText.trim();

  if (!committed) {
    return partial;
  }

  if (!partial) {
    return committed;
  }

  return `${committed} ${partial}`;
}

function transcriptOverlapLength(left: string, right: string) {
  const normalizedLeft = left.toLowerCase();
  const normalizedRight = right.toLowerCase();
  const maxOverlap = Math.min(left.length, right.length);

  for (let length = maxOverlap; length > 0; length -= 1) {
    if (
      normalizedLeft.slice(-length) === normalizedRight.slice(0, length) &&
      (length >= 4 || /\s/.test(normalizedRight[length] ?? ""))
    ) {
      return length;
    }
  }

  return 0;
}

function normalizeTranscriptText(text: string) {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function isTranscriptRole(role: unknown): role is TranscriptRole {
  return role === "user" || role === "assistant";
}

function isTranscriptEventType(type: unknown) {
  return type === "transcript" || type === "transcript[transcriptType='final']";
}

function extractMessageText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (part && typeof part === "object") {
          const item = part as { text?: unknown; content?: unknown };

          if (typeof item.text === "string") {
            return item.text;
          }

          if (typeof item.content === "string") {
            return item.content;
          }
        }

        return "";
      })
      .filter(Boolean)
      .join(" ");
  }

  return "";
}

function extractModelOutputText(output: unknown): string {
  if (typeof output === "string") {
    return output;
  }

  if (Array.isArray(output)) {
    return output.map(extractModelOutputText).join("");
  }

  if (!output || typeof output !== "object") {
    return "";
  }

  const item = output as Record<string, unknown>;
  const textKeys = [
    "text",
    "textDelta",
    "deltaText",
    "content",
    "delta",
    "message",
    "output",
    "token",
  ];

  for (const key of textKeys) {
    const text = extractModelOutputText(item[key]);

    if (text) {
      return text;
    }
  }

  return extractModelOutputText(item.choices);
}

function voiceStatusText(state: VoiceState) {
  switch (state) {
    case "connecting":
      return "Connecting";
    case "idle":
      return "Ready";
    case "listening":
      return "Listening";
    case "speaking":
      return "Speaking";
    default:
      return "Disconnected";
  }
}

function readableVapiError(error: unknown) {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "Microphone permission is required to talk with the mentor.";
  }

  if (error instanceof Error) {
    if (error.message.toLowerCase().includes("call object is not available")) {
      return "Voice call ended. Start a new voice call to continue.";
    }

    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Voice call connection failed. Try starting the call again.";
}
