import { create } from "zustand";

/**
 * The chat panel's history: what you asked, and for each request what the
 * agent did (its activity steps), what it said and how it went. Display only;
 * every command is still a fresh conversation for Claude.
 */

export type UserMessage = {
  id: number;
  role: "user";
  text: string;
  voice?: boolean;
  polish?: boolean;
};

export type AgentMessage = {
  id: number;
  role: "agent";
  status: "working" | "done" | "error" | "cancelled";
  /** Finished actions ("Added a lighthouse"). */
  steps: string[];
  /** What it's doing right now ("Thinking", "Adding objects"), while working. */
  live: string | null;
  text: string | null;
  error?: string;
  model?: string;
  seconds?: number;
};

export type ChatMessage = UserMessage | AgentMessage;

type Conversation = {
  messages: ChatMessage[];
  /** Adds a request and its (working) reply; returns the reply's id. */
  start: (text: string, extra?: Pick<UserMessage, "voice" | "polish">) => number;
  step: (id: number, step: string) => void;
  phase: (id: number, live: string) => void;
  say: (id: number, text: string) => void;
  finish: (id: number, result: Partial<AgentMessage> & Pick<AgentMessage, "status">) => void;
  /** A message from the app itself (e.g. a recording that failed). */
  note: (error: string) => void;
};

const MAX_MESSAGES = 200;
let nextId = 1;

export const useConversation = create<Conversation>()((set) => {
  const update = (id: number, fn: (m: AgentMessage) => AgentMessage) =>
    set((s) => ({
      messages: s.messages.map((m) => (m.id === id && m.role === "agent" ? fn(m) : m)),
    }));

  return {
    messages: [],
    start: (text, extra = {}) => {
      const user: UserMessage = { id: nextId++, role: "user", text, ...extra };
      const agent: AgentMessage = {
        id: nextId++,
        role: "agent",
        status: "working",
        steps: [],
        live: null,
        text: null,
      };
      set((s) => ({ messages: [...s.messages, user, agent].slice(-MAX_MESSAGES) }));
      return agent.id;
    },
    step: (id, step) =>
      update(id, (m) => (m.steps.at(-1) === step ? m : { ...m, steps: [...m.steps, step] })),
    phase: (id, live) => update(id, (m) => ({ ...m, live })),
    say: (id, text) => update(id, (m) => ({ ...m, text })),
    finish: (id, result) => update(id, (m) => ({ ...m, live: null, ...result })),
    note: (error) =>
      set((s) => ({
        messages: [
          ...s.messages,
          {
            id: nextId++,
            role: "agent",
            status: "error",
            steps: [],
            live: null,
            text: null,
            error,
          },
        ],
      })),
  };
});
