"use client";

import { useGLTF } from "@react-three/drei";
import { Component, Suspense, useMemo, useRef, type ReactNode } from "react";
import { BoxGeometry, Color, EdgesGeometry, Matrix4, Mesh, type Group } from "three";
import { fitScale, normaliseModel } from "@/assets/loader";
import { useAssetStatus } from "@/assets/status";
import type { SceneNode, Vec3 } from "@/scene/schema";
import { useAnimatedTransform } from "./useAnimatedTransform";

const SELECTED = "#5aa9ff";
const unitEdges = new EdgesGeometry(new BoxGeometry(1, 1, 1));

/**
 * A GLB model. The outer group carries the node transform with
 * scale = the node's size box in metres (same as primitives); the model inside
 * is normalised to bottom-centre and scaled uniformly to fit that box. While
 * loading, a translucent ghost box shows where it will appear.
 */
export function AssetModel({
  node,
  selected,
  onSelect,
}: {
  node: SceneNode;
  selected: boolean;
  onSelect: () => void;
}) {
  const group = useRef<Group>(null);
  useAnimatedTransform(group, node);
  const url = node.asset?.url;

  return (
    <group
      ref={group}
      scale={0.001}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      {url && (
        <AssetErrorBoundary url={url} fallback={<Ghost broken />}>
          <Suspense fallback={<Ghost />}>
            <Model url={url} box={node.transform.scale} tint={node.material?.color} />
          </Suspense>
        </AssetErrorBoundary>
      )}
      {selected && (
        <lineSegments geometry={unitEdges} position={[0, 0.5, 0]}>
          <lineBasicMaterial color={SELECTED} />
        </lineSegments>
      )}
    </group>
  );
}

/** How strongly a tint replaces the model's own colours (keeps some shading detail). */
const TINT_STRENGTH = 0.85;

function Model({ url, box, tint }: { url: string; box: Vec3; tint?: string }) {
  const { scene } = useGLTF(url);
  const model = normaliseModel(scene);

  const content = useMemo(() => {
    const clone = scene.clone(true);
    const target = tint ? new Color(tint) : null;
    clone.traverse((o) => {
      if (o instanceof Mesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        // Tinted models get their own materials (the loaded ones are shared).
        if (target) {
          const tinted = (Array.isArray(o.material) ? o.material : [o.material]).map((m) => {
            const copy = m.clone();
            if ("color" in copy && copy.color instanceof Color)
              copy.color.lerp(target, TINT_STRENGTH);
            return copy;
          });
          o.material = Array.isArray(o.material) ? tinted : tinted[0];
        }
      }
    });
    return clone;
  }, [scene, tint]);

  // The parent is scaled to the box; undo that per axis and apply one uniform fit.
  const matrix = useMemo(() => {
    const k = fitScale(model.size, box);
    return new Matrix4().makeScale(k / box[0], k / box[1], k / box[2]).multiply(model.toOrigin);
  }, [model, box]);

  return (
    <group matrix={matrix} matrixAutoUpdate={false}>
      <primitive object={content} />
    </group>
  );
}

function Ghost({ broken = false }: { broken?: boolean }) {
  return (
    <mesh position={[0, 0.5, 0]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial
        color={broken ? "#ff7a7a" : "#9fd3ff"}
        transparent
        opacity={0.28}
        depthWrite={false}
      />
    </mesh>
  );
}

class AssetErrorBoundary extends Component<
  { url: string; fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: Error) {
    useAssetStatus.getState().markBroken(this.props.url, error.message);
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
