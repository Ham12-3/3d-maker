"use client";

import { useInteraction } from "@/scene/interaction";
import { addNode, nextNodeId, patchEnvironment, removeNodes } from "@/scene/ops";
import {
  PrimitiveShapeSchema,
  SkySchema,
  TerrainTypeSchema,
  type PrimitiveShape,
} from "@/scene/schema";
import { sceneStore, useScene } from "@/scene/store";
import { FLAT_RADIUS, getWorldHeightField } from "@/scene/terrain";

const COLOURS = ["#d9534f", "#4a7fd6", "#e0b04a", "#3f7d3a", "#9b6bd6", "#e07a4a"];

/**
 * Development-only panel for making manual store edits, so undo/redo can be
 * exercised before the agent exists. Not shown in production builds.
 */
export function DevPanel() {
  const env = useScene((s) => s.world.environment);
  const edit = useScene((s) => s.edit);
  const selectedId = useInteraction((s) => s.selectedId);
  const pointer = useInteraction((s) => s.pointer);

  // A drag of the slider is one undo step.
  const startDrag = () => {
    if (!sceneStore.getState().transaction) sceneStore.getState().beginTransaction("Time of day");
  };
  const endDrag = () => sceneStore.getState().commitTransaction();

  return (
    <div className="glass absolute top-3 right-3 w-64 space-y-3 p-4 text-xs">
      <div className="text-[10px] font-semibold tracking-widest text-white/50 uppercase">
        Dev panel
      </div>

      <label className="block space-y-1">
        <span className="flex justify-between">
          <span>Time of day</span>
          <span className="tabular-nums text-white/60">{env.timeOfDay.toFixed(1)}h</span>
        </span>
        <input
          type="range"
          min={0}
          max={24}
          step={0.1}
          value={env.timeOfDay}
          onPointerDown={startDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onBlur={endDrag}
          onChange={(e) =>
            edit("Time of day", patchEnvironment({ timeOfDay: Number(e.target.value) }))
          }
          className="w-full accent-sky-400"
        />
      </label>

      <Row label="Sky">
        <Select
          value={env.sky}
          options={SkySchema.options}
          onChange={(sky) => edit(`Sky: ${sky}`, patchEnvironment({ sky }))}
        />
      </Row>

      <Row label="Terrain">
        <Select
          value={env.terrain.type}
          options={TerrainTypeSchema.options}
          onChange={(type) => edit(`Terrain: ${type}`, patchEnvironment({ terrain: { type } }))}
        />
        <Button
          onClick={() =>
            edit("New terrain seed", patchEnvironment({ terrain: { seed: randomInt(1, 9999) } }))
          }
        >
          Reseed
        </Button>
      </Row>

      <Row label="Fog / stars">
        <Button
          onClick={() =>
            edit("Toggle fog", patchEnvironment({ fog: { enabled: !env.fog.enabled } }))
          }
        >
          Fog {env.fog.enabled ? "on" : "off"}
        </Button>
        <Button onClick={() => edit("Toggle stars", patchEnvironment({ stars: !env.stars }))}>
          Stars {env.stars ? "on" : "off"}
        </Button>
      </Row>

      <div className="flex gap-2">
        <Button onClick={addRandomPrimitive}>Add primitive</Button>
        <Button
          disabled={!selectedId}
          onClick={() => {
            if (!selectedId) return;
            edit(`Remove ${selectedId}`, removeNodes([selectedId]));
            useInteraction.getState().select(null);
          }}
        >
          Delete
        </Button>
      </div>

      <div className="space-y-0.5 text-white/50">
        <div>Selection: {selectedId ?? "none"}</div>
        <div>Pointer: {pointer ? pointer.map((v) => v.toFixed(1)).join(", ") : "none"}</div>
      </div>
    </div>
  );
}

function addRandomPrimitive() {
  const { world, edit } = sceneStore.getState();
  const shape = pick(PrimitiveShapeSchema.options.filter((s) => s !== "plane"));
  const id = nextNodeId(world, shape);
  const angle = Math.random() * Math.PI * 2;
  const radius = 2 + Math.random() * (FLAT_RADIUS - 4);
  const x = Math.cos(angle) * radius;
  const z = Math.sin(angle) * radius;
  const size = 0.8 + Math.random() * 1.4;
  edit(
    `Add ${id}`,
    addNode({
      id,
      name: `${shape} ${id.split("_").at(-1)}`,
      kind: "primitive",
      primitive: shape as PrimitiveShape,
      transform: {
        position: [x, getWorldHeightField(world)(x, z), z],
        rotation: [0, Math.random() * Math.PI, 0],
        scale: [size, size, size],
      },
      material: { color: pick(COLOURS), roughness: 0.6 },
      relations: [],
      tags: [shape, "dev"],
      createdBy: "user",
    }),
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="shrink-0">{label}</span>
      <div className="flex gap-1.5">{children}</div>
    </div>
  );
}

function Button(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className="rounded-md bg-white/10 px-2.5 py-1 transition hover:bg-white/20 disabled:opacity-30"
    />
  );
}

function Select<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="rounded-md bg-white/10 px-2 py-1 outline-none"
    >
      {options.map((o) => (
        <option key={o} value={o} className="bg-neutral-900">
          {o}
        </option>
      ))}
    </select>
  );
}

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

function randomInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}
