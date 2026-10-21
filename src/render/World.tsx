"use client";

import { Suspense, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { isScatterType } from "@/layout/scatter";
import { useInteraction } from "@/scene/interaction";
import type { SceneNode } from "@/scene/schema";
import { useScene } from "@/scene/store";
import { lakesOf, type Lake as LakeShape } from "@/scene/terrain";
import { Ghosts } from "./Ghosts";
import { AssetModel } from "./nodes/AssetModel";
import { Fireflies } from "./nodes/Fireflies";
import { Lake } from "./nodes/Lake";
import { PathRibbon } from "./nodes/PathRibbon";
import { Primitive } from "./nodes/Primitive";
import { Scatter } from "./nodes/Scatter";
import { PointerMarker } from "./PointerMarker";
import { SkySystem } from "./SkySystem";
import { Terrain } from "./Terrain";

/** Renders the world graph from the store. */
export function World() {
  const env = useScene((s) => s.world.environment);
  const nodeIds = useScene(useShallow((s) => Object.keys(s.world.nodes)));
  // A string key keeps the terrain from rebuilding unless a lake actually changed.
  const lakesKey = useScene((s) => JSON.stringify(lakesOf(s.world)));
  const lakes = useMemo(() => JSON.parse(lakesKey) as LakeShape[], [lakesKey]);

  return (
    <>
      <SkySystem env={env} />
      <Terrain terrain={env.terrain} lakes={lakes} />
      <PointerMarker />
      <Ghosts />
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
  const onSelect = () => select(id);

  switch (node.kind) {
    case "primitive":
      return <Primitive node={node} selected={selected} onSelect={onSelect} />;
    case "asset":
      return <AssetModel node={node} selected={selected} onSelect={onSelect} />;
    case "procedural":
      return <Procedural node={node} onSelect={onSelect} />;
    default:
      // light, group and particles renderers arrive in later phases.
      return null;
  }
}

function Procedural({ node, onSelect }: { node: SceneNode; onSelect: () => void }) {
  const type = node.procedural?.type;
  if (isScatterType(type)) {
    return (
      <Suspense fallback={null}>
        <Scatter node={node} onSelect={onSelect} />
      </Suspense>
    );
  }
  switch (type) {
    case "lake":
      return <Lake node={node} onSelect={onSelect} />;
    case "path":
      return <PathRibbon node={node} />;
    case "fireflies":
      return <Fireflies node={node} />;
    default:
      // river, rain and snow arrive later (weather is in the environment).
      return null;
  }
}
