"use client";

import type { PrimitiveShape, SceneNode } from "@/scene/schema";

/**
 * Unit-sized primitive with its pivot at the bottom-centre, so the node's
 * scale is its size in metres and position.y is the ground it stands on.
 */
export function Primitive({
  node,
  selected,
  onSelect,
}: {
  node: SceneNode;
  selected: boolean;
  onSelect: () => void;
}) {
  const { position, rotation, scale } = node.transform;
  const m = node.material ?? {};
  const opacity = m.opacity ?? 1;

  return (
    <group position={position} rotation={rotation} scale={scale}>
      <mesh
        {...SHAPE_OFFSETS[node.primitive ?? "box"]}
        castShadow
        receiveShadow
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
      >
        <Geometry shape={node.primitive ?? "box"} />
        <meshStandardMaterial
          color={m.color ?? "#cccccc"}
          roughness={m.roughness ?? 0.7}
          metalness={m.metalness ?? 0}
          emissive={selected ? "#5aa9ff" : (m.emissive ?? "#000000")}
          emissiveIntensity={selected ? 0.45 : (m.emissiveIntensity ?? 0)}
          transparent={opacity < 1}
          opacity={opacity}
        />
      </mesh>
    </group>
  );
}

const SHAPE_OFFSETS: Record<
  PrimitiveShape,
  { position: [number, number, number]; rotation?: [number, number, number] }
> = {
  box: { position: [0, 0.5, 0] },
  sphere: { position: [0, 0.5, 0] },
  cylinder: { position: [0, 0.5, 0] },
  cone: { position: [0, 0.5, 0] },
  plane: { position: [0, 0.01, 0], rotation: [-Math.PI / 2, 0, 0] },
  torus: { position: [0, 0.5, 0] },
};

function Geometry({ shape }: { shape: PrimitiveShape }) {
  switch (shape) {
    case "box":
      return <boxGeometry args={[1, 1, 1]} />;
    case "sphere":
      return <sphereGeometry args={[0.5, 32, 16]} />;
    case "cylinder":
      return <cylinderGeometry args={[0.5, 0.5, 1, 32]} />;
    case "cone":
      return <coneGeometry args={[0.5, 1, 32]} />;
    case "plane":
      return <planeGeometry args={[1, 1]} />;
    case "torus":
      return <torusGeometry args={[0.4, 0.1, 16, 48]} />;
  }
}
