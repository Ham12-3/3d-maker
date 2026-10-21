/**
 * Folds Realtime transcription server events into partial and final text.
 * Events for different audio items can interleave, so text is tracked per
 * item_id; the item we are waiting for is the one our commit created.
 */

export type RealtimeEvent =
  | { type: "input_audio_buffer.committed"; item_id: string }
  | { type: "conversation.item.input_audio_transcription.delta"; item_id: string; delta: string }
  | {
      type: "conversation.item.input_audio_transcription.completed";
      item_id: string;
      transcript: string;
    }
  | {
      type: "conversation.item.input_audio_transcription.failed";
      item_id: string;
      error?: { message?: string };
    }
  | { type: "error"; error?: { message?: string; code?: string } }
  | { type: string; [key: string]: unknown };

export type TranscriptUpdate =
  | { kind: "partial"; text: string }
  | { kind: "final"; itemId: string; text: string }
  | { kind: "failed"; itemId: string; message: string }
  | { kind: "error"; message: string }
  | null;

export class TranscriptAccumulator {
  private readonly text = new Map<string, string>();
  private current: string | null = null;

  /** Feed one server event; returns what (if anything) the UI should learn. */
  handle(event: RealtimeEvent): TranscriptUpdate {
    switch (event.type) {
      case "input_audio_buffer.committed":
        this.current = (event as { item_id: string }).item_id;
        return null;
      case "conversation.item.input_audio_transcription.delta": {
        const e = event as { item_id: string; delta: string };
        const next = (this.text.get(e.item_id) ?? "") + e.delta;
        this.text.set(e.item_id, next);
        this.current ??= e.item_id;
        return { kind: "partial", text: next };
      }
      case "conversation.item.input_audio_transcription.completed": {
        const e = event as { item_id: string; transcript: string };
        this.text.delete(e.item_id);
        return { kind: "final", itemId: e.item_id, text: e.transcript.trim() };
      }
      case "conversation.item.input_audio_transcription.failed": {
        const e = event as { item_id: string; error?: { message?: string } };
        this.text.delete(e.item_id);
        return {
          kind: "failed",
          itemId: e.item_id,
          message: e.error?.message ?? "Transcription failed",
        };
      }
      case "error": {
        const e = event as { error?: { message?: string } };
        return { kind: "error", message: e.error?.message ?? "Speech service error" };
      }
      default:
        return null;
    }
  }

  /** Item our latest commit created (null until the server confirms it). */
  get pendingItem(): string | null {
    return this.current;
  }

  /** Best text so far for the pending item (used if the final never arrives). */
  partialFor(itemId: string | null): string {
    return itemId ? (this.text.get(itemId) ?? "") : "";
  }

  reset(): void {
    this.current = null;
  }
}
