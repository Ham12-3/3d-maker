import { create } from "zustand";

/** Editor layout: whether the chat panel is open (Ctrl/Cmd+B toggles it, as in Lovable). */
type Layout = { chatOpen: boolean; toggleChat: () => void; setChatOpen: (open: boolean) => void };

export const useLayout = create<Layout>()((set) => ({
  chatOpen: true,
  toggleChat: () => set((s) => ({ chatOpen: !s.chatOpen })),
  setChatOpen: (chatOpen) => set({ chatOpen }),
}));
