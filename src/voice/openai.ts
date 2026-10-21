import { REALTIME_CALLS_URL, STT_MODEL } from "./openai-session";
import { TranscriptAccumulator, type RealtimeEvent } from "./transcript";
import { Emitter, type KeywordSource, type Transcriber } from "./transcriber";

/**
 * gpt-live-transcribe over WebRTC (default engine). Our server mints a
 * short-lived client secret; the browser streams mic audio straight to OpenAI.
 *
 * The connection is opened on first use and kept warm between presses, so
 * only the first command pays for the handshake. Between presses the mic
 * track is disabled (WebRTC then sends silence), and each press clears the
 * server's audio buffer before unmuting, so idle silence is never transcribed.
 */

const TAIL_MS = 200;
const FINAL_TIMEOUT_MS = 8000;
const CHANNEL_OPEN_TIMEOUT_MS = 8000;

type Pending = { resolve: () => void; timer: ReturnType<typeof setTimeout> };

export class OpenAIStreamingTranscriber implements Transcriber {
  readonly kind = "openai" as const;
  private readonly partial = new Emitter<string>();
  private readonly final = new Emitter<string>();
  private readonly errors = new Emitter<string>();
  private readonly acc = new TranscriptAccumulator();
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private stream: MediaStream | null = null;
  private track: MediaStreamTrack | null = null;
  private analyser: AnalyserNode | null = null;
  private audioCtx: AudioContext | null = null;
  private connecting: Promise<void> | null = null;
  private waiting: Pending | null = null;
  private lastKeywords = "";

  constructor(
    private readonly keywords: KeywordSource,
    private readonly fetchToken: (keywords: string[]) => Promise<string> = requestSttToken,
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
    if (!this.isOpen()) {
      this.connecting ??= this.connect().finally(() => {
        this.connecting = null;
      });
      try {
        await this.connecting;
      } catch (err) {
        this.teardown();
        throw err;
      }
    }
    this.refreshKeywords();
    this.acc.reset();
    this.send({ type: "input_audio_buffer.clear" });
    this.track!.enabled = true;
  }

  async stop(): Promise<void> {
    if (!this.track?.enabled) {
      this.final.emit("");
      return;
    }
    // Let the last syllable reach the server before cutting the mic.
    await sleep(TAIL_MS);
    this.track.enabled = false;
    const done = new Promise<void>((resolve) => {
      const timer = setTimeout(
        () => this.finish(this.acc.partialFor(this.acc.pendingItem)),
        FINAL_TIMEOUT_MS,
      );
      this.waiting = { resolve, timer };
    });
    this.send({ type: "input_audio_buffer.commit" });
    await done;
  }

  level(): number {
    if (!this.analyser || !this.track?.enabled) return 0;
    const data = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (const v of data) sum += ((v - 128) / 128) ** 2;
    return Math.min(1, Math.sqrt(sum / data.length) * 4);
  }

  dispose(): void {
    if (this.waiting) this.finish("");
    this.teardown();
  }

  private async connect(): Promise<void> {
    const token = await this.fetchToken(this.keywords());
    this.lastKeywords = this.keywords().join("|");
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const track = stream.getAudioTracks()[0];
    if (!track) throw new Error("No microphone found");
    track.enabled = false;

    const pc = new RTCPeerConnection();
    pc.addTrack(track, stream);
    const dc = pc.createDataChannel("oai-events");
    dc.onmessage = (e) => this.onEvent(JSON.parse(String(e.data)) as RealtimeEvent);
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        this.errors.emit("Speech connection dropped; it will reconnect on the next press.");
        this.teardown();
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const res = await fetch(REALTIME_CALLS_URL, {
      method: "POST",
      body: offer.sdp,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/sdp" },
    });
    if (!res.ok) {
      pc.close();
      stream.getTracks().forEach((t) => t.stop());
      throw new Error(`Speech connection failed (${res.status})`);
    }
    await pc.setRemoteDescription({ type: "answer", sdp: await res.text() });
    await waitForOpen(dc);

    this.audioCtx = new AudioContext();
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 512;
    this.audioCtx.createMediaStreamSource(stream).connect(this.analyser);
    Object.assign(this, { pc, dc, stream, track });
  }

  /** Keep recognition hints in step with the scene (new object names). */
  private refreshKeywords(): void {
    const keywords = this.keywords();
    const key = keywords.join("|");
    if (key === this.lastKeywords) return;
    this.lastKeywords = key;
    this.send({
      type: "session.update",
      session: {
        type: "transcription",
        audio: { input: { transcription: { model: STT_MODEL, keywords } } },
      },
    });
  }

  private onEvent(event: RealtimeEvent): void {
    const update = this.acc.handle(event);
    if (!update) return;
    switch (update.kind) {
      case "partial":
        this.partial.emit(update.text);
        break;
      case "final": {
        const pending = this.acc.pendingItem;
        if (this.waiting && (pending === null || pending === update.itemId))
          this.finish(update.text);
        break;
      }
      case "failed":
        if (this.waiting) this.finish(this.acc.partialFor(update.itemId));
        this.errors.emit(update.message);
        break;
      case "error":
        // A too-short press commits an empty buffer; that's not worth a message.
        if (this.waiting) this.finish(this.acc.partialFor(this.acc.pendingItem));
        else this.errors.emit(update.message);
        break;
    }
  }

  private finish(text: string): void {
    const w = this.waiting;
    if (!w) return;
    clearTimeout(w.timer);
    this.waiting = null;
    this.final.emit(text.trim());
    w.resolve();
  }

  private send(event: Record<string, unknown>): void {
    if (this.dc?.readyState === "open") this.dc.send(JSON.stringify(event));
  }

  private isOpen(): boolean {
    return Boolean(
      this.pc &&
      this.dc?.readyState === "open" &&
      this.track &&
      this.pc.connectionState !== "failed",
    );
  }

  private teardown(): void {
    this.dc?.close();
    this.pc?.close();
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.audioCtx?.close();
    this.pc = this.dc = this.stream = this.track = this.analyser = this.audioCtx = null;
  }
}

/** Ask our server for a short-lived OpenAI client secret. */
export async function requestSttToken(keywords: string[]): Promise<string> {
  const res = await fetch("/api/stt/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ keywords }),
  });
  const body = (await res.json().catch(() => null)) as { value?: string; error?: string } | null;
  if (!res.ok || !body?.value)
    throw new Error(body?.error ?? `Speech token failed (${res.status})`);
  return body.value;
}

function waitForOpen(dc: RTCDataChannel): Promise<void> {
  if (dc.readyState === "open") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Speech channel did not open")),
      CHANNEL_OPEN_TIMEOUT_MS,
    );
    dc.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
