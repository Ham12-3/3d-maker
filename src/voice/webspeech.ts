import { Emitter, type Transcriber } from "./transcriber";

/**
 * Free fallback: the browser's SpeechRecognition (Chrome, Edge, Safari).
 * Audio goes to the browser vendor's service, so quality and privacy are
 * theirs. A fresh recognition runs per press (browsers end long sessions).
 *
 * No keyword hints: Chrome exposes `phrases` biasing but fails with
 * "phrases-not-supported" unless recognition runs on-device.
 */

type ResultList = ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;

type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: { results: ResultList }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

type RecognitionCtor = new () => Recognition;

const END_TIMEOUT_MS = 4000;

export function webSpeechSupported(): boolean {
  return typeof window !== "undefined" && Boolean(recognitionCtor());
}

/** Join recognition results into confirmed text plus the in-progress guess. */
export function assembleResults(results: ResultList): {
  final: string;
  interim: string;
  text: string;
} {
  let final = "";
  let interim = "";
  for (let i = 0; i < results.length; i++) {
    const r = results[i]!;
    if (r.isFinal) final += r[0].transcript;
    else interim += r[0].transcript;
  }
  const text = `${final} ${interim}`.replace(/\s+/g, " ").trim();
  return { final: final.trim(), interim: interim.trim(), text };
}

export class WebSpeechTranscriber implements Transcriber {
  readonly kind = "webspeech" as const;
  private readonly partial = new Emitter<string>();
  private readonly final = new Emitter<string>();
  private readonly errors = new Emitter<string>();
  private rec: Recognition | null = null;
  private text = "";
  private ended: (() => void) | null = null;

  constructor(
    private readonly lang = typeof navigator === "undefined"
      ? "en-GB"
      : navigator.language || "en-GB",
  ) {}

  onPartial(cb: (text: string) => void) {
    this.partial.on(cb);
  }
  onFinal(cb: (text: string) => void) {
    this.final.on(cb);
  }
  onError(cb: (message: string) => void) {
    this.errors.on(cb);
  }

  async start(): Promise<void> {
    const Ctor = recognitionCtor();
    if (!Ctor) throw new Error("Speech recognition isn't available in this browser");
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = this.lang;
    this.text = "";
    rec.onresult = (e) => {
      this.text = assembleResults(e.results).text;
      this.partial.emit(this.text);
    };
    rec.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      this.errors.emit(
        e.error === "not-allowed"
          ? "Microphone access was blocked"
          : `Speech recognition error: ${e.error}`,
      );
    };
    rec.onend = () => this.ended?.();
    this.rec = rec;
    rec.start();
  }

  async stop(): Promise<void> {
    const rec = this.rec;
    if (!rec) {
      this.final.emit("");
      return;
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, END_TIMEOUT_MS);
      this.ended = () => {
        clearTimeout(timer);
        resolve();
      };
      rec.stop();
    });
    this.ended = null;
    this.rec = null;
    this.final.emit(this.text.trim());
  }

  dispose(): void {
    this.rec?.abort();
    this.rec = null;
  }
}

function recognitionCtor(): RecognitionCtor | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}
