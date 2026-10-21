"use client";

import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { InstancedMesh, Matrix4, Object3D, Quaternion, Vector3 } from "three";
import { getKitModel } from "@/assets/catalog";
import { heightScale, normaliseModel } from "@/assets/loader";
import {
  scatterFeature,
  scatterKey,
  scatterVariants,
  type ScatterInstance,
} from "@/layout/scatter";
import type { SceneNode } from "@/scene/schema";
import { sceneStore, useScene } from "@/scene/store";

const GROW_DURATION = 0.6;
const GROW_SPREAD = 0.9;
const MIN_SCALE = 0.001;

/**
 * Instanced nature: one InstancedMesh per (model variant, mesh part), so a
 * 300-tree forest is a handful of draw calls. Instances grow in from the
 * centre outwards when the feature first appears.
 */
export function Scatter({ node, onSelect }: { node: SceneNode; onSelect: () => void }) {
  const variantIds = useMemo(() => scatterVariants(node), [node]);
  const urls = useMemo(() => variantIds.map((id) => getKitModel(id)!.url), [variantIds]);
  const gltfs = useGLTF(urls);
  const key = useScene((s) => scatterKey(s.world));
  const instances = useMemo(() => {
    void key;
    return scatterFeature(sceneStore.getState().world, node);
  }, [key, node]);

  const type = node.procedural?.type;
  const castShadow = type === "forest" || type === "rocks";
  const pickable = type === "forest" || type === "rocks";

  const meshes = useMemo(
    () =>
      buildMeshes(
        variantIds,
        gltfs.map((g) => g.scene),
        instances,
        castShadow,
        pickable,
      ),
    [variantIds, gltfs, instances, castShadow, pickable],
  );
  useEffect(() => () => meshes.forEach((m) => m.mesh.dispose()), [meshes]);

  // Grow in on first appearance only; later re-scatters (e.g. a cabin clears
  // a spot) snap straight to the final layout.
  const grow = useRef({ elapsed: 0, done: false });
  const [cx, , cz] = node.transform.position;
  const maxDist = useMemo(
    () => Math.max(1, ...instances.map((i) => Math.hypot(i.x - cx, i.z - cz))),
    [instances, cx, cz],
  );

  useEffect(() => {
    if (grow.current.done) writeMatrices(meshes, instances, () => 1);
  }, [meshes, instances]);

  useFrame((_, dt) => {
    const g = grow.current;
    if (g.done) return;
    g.elapsed += Math.min(dt, 0.1);
    writeMatrices(meshes, instances, (inst) => {
      const delay = (Math.hypot(inst.x - cx, inst.z - cz) / maxDist) * GROW_SPREAD;
      return easeOutBack(Math.min(1, Math.max(0, (g.elapsed - delay) / GROW_DURATION)));
    });
    if (g.elapsed > GROW_SPREAD + GROW_DURATION) g.done = true;
  });

  return (
    <group
      onClick={
        pickable
          ? (e) => {
              e.stopPropagation();
              onSelect();
            }
          : undefined
      }
    >
      {meshes.map((m) => (
        <primitive key={m.mesh.uuid} object={m.mesh} />
      ))}
    </group>
  );
}

type Built = { mesh: InstancedMesh; variant: number; local: Matrix4; scale: number };

function buildMeshes(
  variantIds: string[],
  scenes: Object3D[],
  instances: ScatterInstance[],
  castShadow: boolean,
  pickable: boolean,
): Built[] {
  const out: Built[] = [];
  variantIds.forEach((id, variant) => {
    const count = instances.filter((i) => i.variant === variant).length;
    if (count === 0) return;
    const model = normaliseModel(scenes[variant]!);
    const realHeight = getKitModel(id)?.size[1] ?? 1;
    const scale = heightScale(model.size, realHeight);
    for (const part of model.parts) {
      const mesh = new InstancedMesh(part.geometry, part.material, count);
      mesh.castShadow = castShadow;
      mesh.receiveShadow = true;
      if (!pickable) mesh.raycast = () => {};
      out.push({
        mesh,
        variant,
        // Part transform inside the model, after moving it to bottom-centre.
        local: new Matrix4().multiplyMatrices(model.toOrigin, part.matrix),
        scale,
      });
    }
  });
  return out;
}

const tmp = new Object3D();
const q = new Quaternion();
const up = new Vector3(0, 1, 0);
const m = new Matrix4();

function writeMatrices(
  meshes: Built[],
  instances: ScatterInstance[],
  growth: (i: ScatterInstance) => number,
) {
  for (const b of meshes) {
    let n = 0;
    for (const inst of instances) {
      if (inst.variant !== b.variant) continue;
      const s = Math.max(MIN_SCALE, b.scale * inst.scale * growth(inst));
      tmp.position.set(inst.x, inst.y, inst.z);
      tmp.quaternion.copy(q.setFromAxisAngle(up, inst.rotationY));
      tmp.scale.setScalar(s);
      tmp.updateMatrix();
      b.mesh.setMatrixAt(n++, m.multiplyMatrices(tmp.matrix, b.local));
    }
    b.mesh.instanceMatrix.needsUpdate = true;
    b.mesh.computeBoundingSphere();
  }
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  return 1 + (c1 + 1) * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}
