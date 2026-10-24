"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  BoxGeometry,
  CapsuleGeometry,
  CatmullRomCurve3,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  LatheGeometry,
  Matrix4,
  Shape,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
  type BufferGeometry,
  type Group,
} from "three";
import { partsFrame } from "@/scene/parts";
import type { Part, SceneNode } from "@/scene/schema";
import { useAnimatedTransform } from "./useAnimatedTransform";

const DEG = Math.PI / 180;
const SELECTED = "#5aa9ff";

/**
 * A custom object Claude designed from shapes. Parts are authored in metres
 * around the object's ground centre; like models, they are normalised to a
 * unit box at the bottom-centre so the node's scale is its size in metres.
 */
export function CustomObject({
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
  const parts = node.parts;

  const matrix = useMemo(() => {
    const { size, offset } = partsFrame(parts ?? []);
    return new Matrix4()
      .makeScale(1 / size[0], 1 / size[1], 1 / size[2])
      .multiply(new Matrix4().makeTranslation(offset[0], offset[1], offset[2]));
  }, [parts]);

  if (!parts) return null;
  return (
    <group
      ref={group}
      scale={0.001}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      <group matrix={matrix} matrixAutoUpdate={false}>
        {parts.map((part, i) => (
          <PartMesh key={i} part={part} selected={selected} />
        ))}
      </group>
    </group>
  );
}

function PartMesh({ part, selected }: { part: Part; selected: boolean }) {
  const geometry = useMemo(() => partGeometry(part), [part]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const [w, h, d] = part.size ?? [1, 1, 1];
  // Unit shapes are scaled to their size; lathe/extrude/tube are built in metres.
  const scale: [number, number, number] = UNIT_SHAPES.has(part.shape) ? [w, h, d] : [1, 1, 1];
  const rotation = (part.rotation ?? [0, 0, 0]).map((v) => v * DEG) as [number, number, number];
  const color = part.color ?? "#c8c8c8";
  const glow = part.emissive === true;
  const opacity = part.opacity ?? 1;

  return (
    <mesh
      geometry={geometry}
      position={part.position ?? [0, 0, 0]}
      rotation={rotation}
      scale={scale}
      castShadow={!glow}
      receiveShadow
    >
      <meshStandardMaterial
        color={color}
        roughness={part.roughness ?? 0.75}
        metalness={part.metalness ?? 0}
        emissive={selected ? SELECTED : glow ? color : "#000000"}
        emissiveIntensity={selected ? 0.45 : glow ? 1.4 : 0}
        transparent={opacity < 1}
        opacity={opacity}
        flatShading
      />
    </mesh>
  );
}

const UNIT_SHAPES = new Set<Part["shape"]>([
  "box",
  "sphere",
  "cylinder",
  "cone",
  "torus",
  "capsule",
]);

/** Geometry for one part: unit-sized and centred, or in metres for profile shapes. */
function partGeometry(part: Part): BufferGeometry {
  const seg = part.segments;
  switch (part.shape) {
    case "box":
      return new BoxGeometry(1, 1, 1);
    case "sphere":
      return new SphereGeometry(0.5, seg ?? 16, Math.max(2, Math.round((seg ?? 16) / 2)));
    case "cylinder":
      return new CylinderGeometry(0.5 * (part.taper ?? 1), 0.5, 1, seg ?? 16);
    case "cone":
      return new ConeGeometry(0.5, 1, seg ?? 16);
    case "torus":
      // Flat on the ground: outer diameter 1, ring thickness 1 before scaling.
      return new TorusGeometry(0.375, 0.125, 8, seg ?? 24).rotateX(Math.PI / 2).scale(1, 4, 1);
    case "capsule":
      // Total height 1, width 0.5 before scaling; widen to a unit footprint.
      return new CapsuleGeometry(0.25, 0.5, 4, seg ?? 12).scale(2, 1, 2);
    case "lathe": {
      const pts = (part.profile ?? []).map(([r, y]) => new Vector2(Math.max(0, r), y));
      return new LatheGeometry(pts, seg ?? 20);
    }
    case "extrude": {
      const shape = new Shape((part.outline ?? []).map(([x, y]) => new Vector2(x, y)));
      const depth = part.size?.[2] ?? 0.2;
      return new ExtrudeGeometry(shape, { depth, bevelEnabled: false }).translate(0, 0, -depth / 2);
    }
    case "tube": {
      const pts = (part.path ?? []).map(([x, y, z]) => new Vector3(x, y, z));
      const curve = new CatmullRomCurve3(pts);
      const radius = (part.size?.[0] ?? 0.1) / 2;
      return new TubeGeometry(curve, Math.max(8, pts.length * 8), radius, seg ?? 8, false);
    }
  }
}
