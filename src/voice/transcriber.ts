/**
 * Speech to text behind one interface, so push-to-talk doesn't care which
 * engine is listening. Implementations:
 * - OpenAIStreamingTranscriber (default): gpt-live-transcribe over WebRTC.
 * - WebSpeechTranscriber: the browser's SpeechRecognition (Chrome), free.
 *
 * Contract: start() begins capturing a turn; stop() ends it and resolves
 * after onFinal has fired for that turn (possibly with an empty string).
 */
export interface Transcriber {
  readonly kind: TranscriberKind;
  start(): Promise<void>;
  stop(): Promise<void>;
  onPartial(cb: (text: string) => void): void;
  onFinal(cb: (text: string) => void): void;
  onError(cb: (message: string) => void): void;
  /** Mic level 0..1 for the UI meter, when the engine exposes the stream. */
  level?(): number;
  dispose(): void;
}

export type TranscriberKind = "openai" | "webspeech";

/** Words to bias recognition towards (scene object names, app vocabulary). */
export type KeywordSource = () => string[];

/** Emits callbacks to everyone who registered; shared by implementations. */
export class Emitter<T> {
  private readonly listeners = new Set<(value: T) => void>();

  on(cb: (value: T) => void): void {
    this.listeners.add(cb);
  }

  emit(value: T): void {
    for (const cb of this.listeners) cb(value);
  }
}
