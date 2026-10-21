import { describe, expect, it } from "vitest";
import { computeShot } from "@/render/camera/shots";
import { loadDefaultWorld } from "@/scene/defaults";
import { createSceneStore } from "@/scene/store";
import { mockSearchAllAssets, mockSearchAssets } from "./test-helpers";
import { focusFor } from "./tools/common";
import { executeToolCall } from "./tools";
import type { ToolContext } from "./tools/types";

describe("scene framing", () => {
  it("frames a whole forest ring, not just its centre point", async () => {
    const store = createSceneStore(loadDefaultWorld());
    store.getState().edit("clear", (d) => {
      d.nodes = {};
    });
    const ctx: ToolContext = {
      getWorld: () => store.getState().world,
      edit: (label, recipe) => store.getState().edit(label, recipe),
      selection: null,
      pointer: null,
      camera: store.getState().world.camera,
      seed: 1,
      moveCamera: () => {},
      say: () => {},
      searchAssets: mockSearchAssets,
      searchAllAssets: mockSearchAllAssets,
      candidates: new Map(),
    };
    await executeToolCall("add_procedural", { type: "lake", id: "lake_1", radius: 12 }, ctx);
    await executeToolCall(
      "add_procedural",
      { type: "forest", radius: 22, relations: [{ predicate: "around", target: "lake_1" }] },
      ctx,
    );

    const focus = focusFor("scene", ctx);
    if (typeof focus === "string") throw new Error(focus);
    expect(focus.radius).toBeGreaterThan(35);

    // The establishing shot ends up outside the forest ring.
    const shot = computeShot("establishing", focus, ctx.camera);
    if (shot.kind !== "tween") throw new Error("expected a tween");
    const lake = store.getState().world.nodes.lake_1!.transform.position;
    expect(Math.hypot(shot.position[0] - lake[0], shot.position[2] - lake[2])).toBeGreaterThan(40);
  });
});
