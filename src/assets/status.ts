import { create } from "zustand";

/** Asset URLs that failed to load in the renderer; the judge reports them. */
type AssetStatus = {
  broken: Record<string, string>;
  markBroken: (url: string, reason: string) => void;
};

export const useAssetStatus = create<AssetStatus>()((set) => ({
  broken: {},
  markBroken: (url, reason) => set((s) => ({ broken: { ...s.broken, [url]: reason } })),
}));
