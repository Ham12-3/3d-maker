import { searchKit, tokenize } from "@/assets/catalog";
import type { AssetCandidate, AssetSearch } from "@/assets/types";

/**
 * Offline stand-in for asset search, used by unit tests and evals: the real
 * bundled kit plus a few fake "online" models (so nothing hits Poly Pizza).
 */
const FAKE_ONLINE: AssetCandidate[] = [
  {
    source: "polypizza",
    id: "fakeCabin01",
    name: "Log Cabin",
    url: "/api/assets/file/fakeCabin01",
    license: "CC-BY",
    attribution: "Log Cabin by Test Author, https://poly.pizza/m/fakeCabin01",
    tags: ["log", "cabin", "house", "building"],
    score: 3,
  },
  {
    source: "polypizza",
    id: "fakeHouse01",
    name: "Small House",
    url: "/api/assets/file/fakeHouse01",
    license: "CC0",
    tags: ["house", "home", "building", "cottage"],
    score: 2,
  },
];

function online(query: string): AssetCandidate[] {
  const words = tokenize(query);
  return FAKE_ONLINE.filter((c) => words.some((w) => c.tags.includes(w)));
}

export const mockSearchAssets: AssetSearch = async (query, limit = 5) => {
  const local = searchKit(query, limit);
  return local.length ? local : online(query).slice(0, limit);
};

export const mockSearchAllAssets: AssetSearch = async (query, limit = 6) =>
  [...searchKit(query, limit), ...online(query)].slice(0, limit);
