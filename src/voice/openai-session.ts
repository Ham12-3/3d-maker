import { sanitizeKeywords } from "./keywords";

/**
 * Request body for minting an ephemeral client secret for a Realtime
 * transcription session (POST https://api.openai.com/v1/realtime/client_secrets).
 * Shape from the Realtime transcription guide and client_secrets reference.
 *
 * - gpt-live-transcribe needs turn_detection null: the client commits the
 *   audio buffer itself when the user releases push-to-talk.
 * - No audio format: over WebRTC the format is negotiated in SDP.
 */

export const STT_MODEL = "gpt-live-transcribe";
export const REALTIME_CLIENT_SECRETS_URL = "https://api.openai.com/v1/realtime/client_secrets";
export const REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";
const SECRET_TTL_SECONDS = 600;

const PROMPT =
  "Short spoken commands to a 3D world builder: environment, weather, nature, buildings and camera moves. " +
  "Words like 'this' and 'there' refer to things the user clicked.";

export function transcriptionSessionBody(keywords: readonly unknown[], language = "en") {
  return {
    expires_after: { anchor: "created_at", seconds: SECRET_TTL_SECONDS },
    session: {
      type: "transcription",
      audio: {
        input: {
          noise_reduction: { type: "near_field" },
          transcription: {
            model: STT_MODEL,
            prompt: PROMPT,
            keywords: sanitizeKeywords(keywords),
            languages: [language],
          },
          turn_detection: null,
        },
      },
    },
  };
}
