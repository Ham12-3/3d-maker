import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/stt/token/route";
import { loadDefaultWorld } from "@/scene/defaults";
import { MIN_HOLD_MS, createPushToTalk, type VoiceState } from "./controller";
import { MAX_KEYWORDS, keywordsFor, sanitizeKeywords } from "./keywords";
import { STT_MODEL, transcriptionSessionBody } from "./openai-session";
import { TranscriptAccumulator } from "./transcript";
import { Emitter, type Transcriber } from "./transcriber";
import { assembleResults } from "./webspeech";

describe("keywords", () => {
  it("strips characters the API rejects, dedupes and caps", () => {
    expect(
      sanitizeKeywords(["Cabin", "cabin", "a<b>c", "two\nlines", "x", 42, "  pine  tree "]),
    ).toEqual(["cabin", "a b c", "two lines", "pine tree"]);
    expect(sanitizeKeywords(Array.from({ length: 200 }, (_, i) => `word${i}`))).toHaveLength(
      MAX_KEYWORDS,
    );
  });

  it("include app vocabulary and names from the scene", () => {
    const words = keywordsFor(loadDefaultWorld());
    expect(words).toContain("fireflies");
    expect(words).toContain("stone pillar");
  });
});

describe("OpenAI transcription session", () => {
  it("asks for gpt-live-transcribe with client-side turns and keyword hints", () => {
    const body = transcriptionSessionBody(["cabin", "fog<"]);
    expect(body.session.type).toBe("transcription");
    expect(body.session.audio.input.transcription.model).toBe(STT_MODEL);
    expect(body.session.audio.input.turn_detection).toBeNull();
    expect(body.session.audio.input.transcription.keywords).toEqual(["cabin", "fog"]);
    expect(body.session.audio.input.transcription.languages).toEqual(["en"]);
    expect(body.session.audio.input).not.toHaveProperty("format");
    expect(body.expires_after.seconds).toBe(600);
  });
});

describe("TranscriptAccumulator", () => {
  it("builds partials from deltas and finishes with the completed transcript", () => {
    const acc = new TranscriptAccumulator();
    expect(acc.handle({ type: "input_audio_buffer.committed", item_id: "a" })).toBeNull();
    expect(
      acc.handle({
        type: "conversation.item.input_audio_transcription.delta",
        item_id: "a",
        delta: "make it ",
      }),
    ).toEqual({
      kind: "partial",
      text: "make it ",
    });
    expect(
      acc.handle({
        type: "conversation.item.input_audio_transcription.delta",
        item_id: "a",
        delta: "night",
      }),
    ).toEqual({
      kind: "partial",
      text: "make it night",
    });
    expect(acc.pendingItem).toBe("a");
    expect(
      acc.handle({
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "a",
        transcript: " Make it night. ",
      }),
    ).toEqual({
      kind: "final",
      itemId: "a",
      text: "Make it night.",
    });
  });

  it("keeps interleaved items apart and surfaces failures and errors", () => {
    const acc = new TranscriptAccumulator();
    acc.handle({
      type: "conversation.item.input_audio_transcription.delta",
      item_id: "old",
      delta: "stale",
    });
    acc.handle({ type: "input_audio_buffer.committed", item_id: "new" });
    acc.handle({
      type: "conversation.item.input_audio_transcription.delta",
      item_id: "new",
      delta: "fresh",
    });
    expect(acc.partialFor("new")).toBe("fresh");
    expect(acc.partialFor("old")).toBe("stale");
    expect(
      acc.handle({
        type: "conversation.item.input_audio_transcription.failed",
        item_id: "new",
        error: { message: "bad audio" },
      }),
    ).toEqual({
      kind: "failed",
      itemId: "new",
      message: "bad audio",
    });
    expect(acc.handle({ type: "error", error: { message: "boom" } })).toEqual({
      kind: "error",
      message: "boom",
    });
    expect(acc.handle({ type: "session.created" })).toBeNull();
  });
});

describe("Web Speech results", () => {
  it("joins final and interim text", () => {
    const r = (transcript: string, isFinal: boolean) => ({ isFinal, 0: { transcript } });
    expect(
      assembleResults([r("make it", true), r(" night and", true), r(" add fire", false)]),
    ).toEqual({
      final: "make it night and",
      interim: "add fire",
      text: "make it night and add fire",
    });
  });
});

class FakeTranscriber implements Transcriber {
  readonly kind = "webspeech" as const;
  readonly partial = new Emitter<string>();
  readonly final = new Emitter<string>();
  readonly errors = new Emitter<string>();
  startImpl: () => Promise<void> = async () => {};
  nextFinal = "";
  stops = 0;
  onPartial(cb: (t: string) => void) {
    this.partial.on(cb);
  }
  onFinal(cb: (t: string) => void) {
    this.final.on(cb);
  }
  onError(cb: (m: string) => void) {
    this.errors.on(cb);
  }
  start() {
    return this.startImpl();
  }
  async stop() {
    this.stops++;
    this.final.emit(this.nextFinal);
  }
  dispose() {}
}

function rig(canStart = () => true) {
  let clock = 0;
  const t = new FakeTranscriber();
  const commands: { text: string; at: number }[] = [];
  const states: VoiceState[] = [];
  const errors: string[] = [];
  const ptt = createPushToTalk({
    transcriber: t,
    onCommand: (text, at) => commands.push({ text, at }),
    onState: (s) => states.push(s),
    onError: (m) => errors.push(m),
    canStart,
    now: () => clock,
  });
  const advance = (ms: number) => (clock += ms);
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return { t, ptt, commands, states, errors, advance, flush };
}

describe("push-to-talk", () => {
  it("press, speak, release sends the final transcript as a command", async () => {
    const { t, ptt, commands, advance, flush } = rig();
    t.nextFinal = "make it night";
    ptt.press();
    await flush();
    expect(ptt.state).toBe("listening");
    t.partial.emit("make it");
    advance(1200);
    ptt.release();
    await flush();
    expect(commands).toEqual([{ text: "make it night", at: 1200 }]);
    expect(ptt.state).toBe("idle");
  });

  it("discards accidental taps", async () => {
    const { t, ptt, commands, advance, flush } = rig();
    t.nextFinal = "uh";
    ptt.press();
    await flush();
    advance(MIN_HOLD_MS - 50);
    ptt.release();
    await flush();
    expect(commands).toEqual([]);
    expect(ptt.state).toBe("idle");
  });

  it("stops right after connecting when released early", async () => {
    const { t, ptt, commands, advance, flush } = rig();
    let connected!: () => void;
    t.startImpl = () => new Promise((r) => (connected = r));
    t.nextFinal = "add fireflies";
    ptt.press();
    advance(900);
    ptt.release();
    expect(ptt.state).toBe("connecting");
    connected();
    await flush();
    expect(t.stops).toBe(1);
    expect(commands.map((c) => c.text)).toEqual(["add fireflies"]);
  });

  it("ignores presses while busy or refused, and recovers from start failures", async () => {
    const busy = rig(() => false);
    busy.ptt.press();
    expect(busy.ptt.state).toBe("idle");

    const { t, ptt, errors, flush } = rig();
    t.startImpl = () => Promise.reject(new Error("Microphone access was blocked"));
    ptt.press();
    ptt.press();
    await flush();
    expect(errors).toEqual(["Microphone access was blocked"]);
    expect(ptt.state).toBe("idle");
  });
});

describe("/api/stt/token", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("reports and refuses when OpenAI isn't configured", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(await GET().json()).toMatchObject({ openai: false });
    const res = await POST(new Request("http://x/api/stt/token", { method: "POST", body: "{}" }));
    expect(res.status).toBe(503);
  });

  it("mints a client secret with the scene keywords, never exposing the real key", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test-real");
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(body.session.audio.input.transcription.keywords).toEqual(["cabin", "lantern"]);
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test-real");
      return Response.json({ value: "ek_123", expires_at: 1900000000 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await POST(
      new Request("http://x/api/stt/token", {
        method: "POST",
        headers: { "x-forwarded-for": "10.0.0.9" },
        body: JSON.stringify({ keywords: ["cabin", "lantern"] }),
      }),
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toEqual({ value: "ek_123", expires_at: 1900000000 });
    expect(JSON.stringify(json)).not.toContain("sk-test-real");
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.openai.com/v1/realtime/client_secrets");
  });
});
