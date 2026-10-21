"use client";

import { Html } from "@react-three/drei";
import { useEffect, useRef, useState } from "react";
import { BufferGeometry, Float32BufferAttribute } from "three";
import { regionEdgePoint } from "@/layout/regions";
import type { Region } from "@/scene/schema";
import { useScene } from "@/scene/store";
import { getWorldHeightField } from "@/scene/terrain";

const FLASH_MS = 4000;

/**
 * Regions are invisible, so when one is named ("call this the village
 * square") its outline and name show for a few seconds as confirmation.
 */
export function RegionFlash() {
  const regions = useScene((s) => s.world.regions);
  const seen = useRef<Set<string> | null>(null);
  const [flashing, setFlashing] = useState<string[]>([]);

  useEffect(() => {
    const ids = Object.keys(regions);
    // Regions that exist at load aren't news.
    if (seen.current === null) {
      seen.current = new Set(ids);
      return;
    }
    const fresh = ids.filter((id) => !seen.current!.has(id));
    for (const id of ids) seen.current.add(id);
    if (fresh.length === 0) return;
    setFlashing((f) => [...f, ...fresh]);
    const timer = setTimeout(
      () => setFlashing((f) => f.filter((id) => !fresh.includes(id))),
      FLASH_MS,
    );
    return () => clearTimeout(timer);
  }, [regions]);

  return (
    <>{flashing.map((id) => (regions[id] ? <Outline key={id} region={regions[id]} /> : null))}</>
  );
}

function Outline({ region }: { region: Region }) {
  const world = useScene((s) => s.world);
  const [geometry] = useState(() => {
    const heightAt = getWorldHeightField(world);
    const pts: number[] = [];
    for (let i = 0; i <= 96; i++) {
      const p = regionEdgePoint(region, i / 96);
      pts.push(p.x, heightAt(p.x, p.z) + 0.2, p.z);
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(pts, 3));
    return g;
  });
  const [cx, , cz] = region.center;

  return (
    <group>
      <line>
        <primitive object={geometry} attach="geometry" />
        <lineBasicMaterial color="#9fd3ff" transparent opacity={0.9} />
      </line>
      <Html position={[cx, region.center[1] + 2, cz]} center>
        <div className="glass pointer-events-none px-2.5 py-1 text-xs whitespace-nowrap text-white">
          {region.id.replace(/_/g, " ")}
        </div>
      </Html>
    </group>
  );
}
