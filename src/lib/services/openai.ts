import {
  buildCompressionUserPrompt,
  buildPersonaPassUserPrompt,
  COMPRESSION_SYSTEM_PROMPT,
  PERSONA_PASS_SYSTEM_PROMPT,
} from "@/lib/prompts/persona";
import type { PersonaProfile } from "@/types/mentor";

const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const PERSONA_MODEL = "gpt-4o";
const COMPRESSION_MODEL = "gpt-4o-mini";
const CHARS_PER_TOKEN_ESTIMATE = 4;
const TOKEN_COMPRESSION_THRESHOLD = 8_000;
const TOKEN_COMPRESSION_TARGET = 5_000;
const LIVE_CONTEXT_TOKEN_LIMIT = 7_000;

type OpenAIChatResponse = {
  choices?: {
    message?: {
      content?: string | null;
    };
  }[];
};

const personaJsonSchema = {
  name: "persona_profile",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "name",
      "oneLineBio",
      "areasOfExpertise",
      "speakingStyle",
      "recurringThemes",
      "characteristicPhrases",
      "notableOpinions",
      "perVideoSummaries",
    ],
    properties: {
      name: { type: "string" },
      oneLineBio: { type: "string" },
      areasOfExpertise: { type: "array", items: { type: "string" } },
      speakingStyle: { type: "string" },
      recurringThemes: { type: "array", items: { type: "string" } },
      characteristicPhrases: { type: "array", items: { type: "string" } },
      notableOpinions: { type: "array", items: { type: "string" } },
      perVideoSummaries: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["source", "summary"],
          properties: {
            source: { type: "string" },
            summary: { type: "string" },
          },
        },
      },
    },
  },
};

export function estimateTokens(text: string) {
  return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE);
}

export async function compressTranscriptContextIfNeeded(combinedTranscripts: string) {
  let transcriptContext = combinedTranscripts;

  if (estimateTokens(combinedTranscripts) > TOKEN_COMPRESSION_THRESHOLD) {
    transcriptContext = await chatCompletionText({
      model: COMPRESSION_MODEL,
      messages: [
        { role: "system", content: COMPRESSION_SYSTEM_PROMPT },
        {
          role: "user",
          content: buildCompressionUserPrompt(
            TOKEN_COMPRESSION_TARGET,
            combinedTranscripts,
          ),
        },
      ],
      maxCompletionTokens: TOKEN_COMPRESSION_TARGET + 1000,
    });
  }

  return limitTextToApproxTokens(transcriptContext, LIVE_CONTEXT_TOKEN_LIMIT);
}

export async function buildPersonaProfile(
  combinedTranscripts: string,
  personName: string,
): Promise<PersonaProfile> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const content = await chatCompletionText({
        model: PERSONA_MODEL,
        messages: [
          { role: "system", content: PERSONA_PASS_SYSTEM_PROMPT },
          {
            role: "user",
            content: buildPersonaPassUserPrompt(
              personName,
              combinedTranscripts,
            ),
          },
        ],
        responseFormat: {
          type: "json_schema",
          json_schema: personaJsonSchema,
        },
        maxCompletionTokens: 5000,
      });

      return JSON.parse(content) as PersonaProfile;
    } catch (error) {
      if (attempt === 1) {
        throw error;
      }
    }
  }

  throw new Error("Persona generation failed.");
}

export function buildFallbackPersonaProfile(
  combinedTranscripts: string,
  personName: string,
): PersonaProfile {
  const name = personName.trim() || inferNameFallback(combinedTranscripts);

  return {
    name,
    oneLineBio: "A mentor inferred from the provided public video transcripts.",
    areasOfExpertise: [],
    speakingStyle:
      "Speak naturally, directly, and only from the provided transcript material.",
    recurringThemes: [],
    characteristicPhrases: [],
    notableOpinions: [],
    perVideoSummaries: [
      {
        source: "Provided transcripts",
        summary:
          "Persona JSON parsing failed, so the mentor should rely directly on the transcript context.",
      },
    ],
  };
}

async function chatCompletionText({
  model,
  messages,
  responseFormat,
  maxCompletionTokens,
}: {
  model: string;
  messages: { role: "system" | "user"; content: string }[];
  responseFormat?: unknown;
  maxCompletionTokens?: number;
}) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.2,
      ...(responseFormat ? { response_format: responseFormat } : {}),
      ...(maxCompletionTokens
        ? { max_completion_tokens: maxCompletionTokens }
        : {}),
    }),
  });

  const data = (await response.json().catch(() => null)) as
    | (OpenAIChatResponse & { error?: { message?: string } })
    | null;

  if (!response.ok) {
    throw new Error(data?.error?.message ?? `OpenAI returned ${response.status}.`);
  }

  const content = data?.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("OpenAI returned an empty message.");
  }

  return content;
}

function inferNameFallback(combinedTranscripts: string) {
  const match = combinedTranscripts.match(/\b(?:my name is|I'm|I am)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);

  return match?.[1] ?? "this mentor";
}

function limitTextToApproxTokens(text: string, maxTokens: number) {
  if (estimateTokens(text) <= maxTokens) {
    return text;
  }

  const maxChars = maxTokens * CHARS_PER_TOKEN_ESTIMATE;
  const slice = text.slice(0, maxChars);
  const lastParagraph = slice.lastIndexOf("\n\n");
  const lastSentence = slice.lastIndexOf(". ");
  const lastLine = slice.lastIndexOf("\n");
  const boundary = Math.max(lastParagraph, lastSentence, lastLine);
  const safeBoundary = boundary > maxChars * 0.75 ? boundary + 1 : maxChars;
  const shortened = slice.slice(0, safeBoundary).trim();

  return `${shortened}\n\n[Context shortened for live voice reliability.]`;
}
