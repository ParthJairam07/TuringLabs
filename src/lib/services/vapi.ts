import type { PersonaProfile } from "@/types/mentor";

type VapiAssistantResponse = {
  id?: string;
  error?: string;
  message?: string;
};

const VAPI_API_BASE_URL = "https://api.vapi.ai";
const DEFAULT_LIVE_MODEL = "gpt-4o";
const DEFAULT_LIVE_FALLBACK_MODELS = ["gpt-4o-mini"];
const BLOCKED_LIVE_MODELS = new Set(["chatgpt-4o-latest"]);

export async function createVapiAssistant({
  personName,
  personaProfile,
  systemPrompt,
}: {
  personName: string;
  personaProfile: PersonaProfile;
  systemPrompt: string;
}) {
  const privateKey = process.env.VAPI_PRIVATE_KEY;
  const openAiApiKey = process.env.OPENAI_API_KEY;

  if (!privateKey) {
    throw new Error("VAPI_PRIVATE_KEY is not configured.");
  }

  if (!openAiApiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const { model, fallbackModels } = getLiveModelConfig();

  const response = await fetch(`${VAPI_API_BASE_URL}/assistant`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${privateKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: `${personName} AI Mentor`,
      firstMessage: buildFirstMessage(personName, personaProfile),
      firstMessageMode: "assistant-speaks-first",
      firstMessageInterruptionsEnabled: false,
      silenceTimeoutSeconds: 300,
      maxDurationSeconds: 1800,
      transcriber: {
        provider: "deepgram",
        model: "nova-3-general",
        language: "en",
      },
      model: {
        provider: "openai",
        model,
        fallbackModels,
        temperature: 0.45,
        maxTokens: 250,
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
        ],
      },
      voice: {
        provider: "openai",
        voiceId: "alloy",
        model: "gpt-4o-mini-tts",
        speed: 1,
      },
      credentials: [
        {
          provider: "openai",
          apiKey: openAiApiKey,
          name: "Live AI Mentor OpenAI",
        },
      ],
      clientMessages: [
        "transcript",
        "conversation-update",
        "model-output",
        "speech-update",
        "status-update",
        "user-interrupted",
      ],
      modelOutputInMessagesEnabled: true,
      serverMessages: [],
      backgroundSpeechDenoisingPlan: {
        smartDenoisingPlan: {
          enabled: true,
        },
      },
      metadata: {
        app: "live-ai-mentor",
      },
    }),
  });

  const data = (await response.json().catch(() => null)) as
    | VapiAssistantResponse
    | null;

  if (!response.ok || !data?.id) {
    throw new Error(
      data?.message ?? data?.error ?? `Vapi returned ${response.status}.`,
    );
  }

  return data.id;
}

function buildFirstMessage(personName: string, personaProfile: PersonaProfile) {
  const expertise = personaProfile.areasOfExpertise[0]?.trim();
  const expertiseHook = expertise ? ` I spend a lot of time thinking about ${expertise}.` : "";

  return `Hey, I'm ${personName}.${expertiseHook} Good to meet you - what's on your mind today?`;
}

function getLiveModelConfig() {
  const model = safeModelName(process.env.VAPI_LIVE_MODEL, DEFAULT_LIVE_MODEL);
  const configuredFallbacks = parseModelList(
    process.env.VAPI_LIVE_FALLBACK_MODELS,
  );
  const fallbackModels =
    configuredFallbacks.length > 0
      ? configuredFallbacks
      : DEFAULT_LIVE_FALLBACK_MODELS;

  return { model, fallbackModels };
}

function parseModelList(value: string | undefined) {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item && !BLOCKED_LIVE_MODELS.has(item));
}

function safeModelName(value: string | undefined, fallback: string) {
  const model = value?.trim();

  if (!model || BLOCKED_LIVE_MODELS.has(model)) {
    return fallback;
  }

  return model;
}
