"use client";

import { useShallow } from "zustand/react/shallow";
import { useInteraction } from "@/scene/interaction";
import { useScene } from "@/scene/store";
import { Primitive } from "./nodes/Primitive";
import { PointerMarker } from "./PointerMarker";
import { SkySystem } from "./SkySystem";
import { Terrain } from "./Terrain";

/** Renders the world graph from the store. */
export function World() {
  const env = useScene((s) => s.world.environment);
  const nodeIds = useScene(useShallow((s) => Object.keys(s.world.nodes)));

  return (
    <>
      <SkySystem env={env} />
      <Terrain terrain={env.terrain} />
      <PointerMarker />
      {nodeIds.map((id) => (
        <NodeView key={id} id={id} />
      ))}
    </>
  );
}

/** Subscribes to one node, so Immer's structural sharing keeps re-renders local. */
function NodeView({ id }: { id: string }) {
  const node = useScene((s) => s.world.nodes[id]);
  const selected = useInteraction((s) => s.selectedId === id);
  const select = useInteraction((s) => s.select);
  if (!node) return null;

  switch (node.kind) {
    case "primitive":
      return <Primitive node={node} selected={selected} onSelect={() => select(id)} />;
    default:
      // asset, procedural, light, group and particles renderers arrive in later phases.
      return null;
  }
}
