/** Axis-aligned footprint on the ground plane (XZ), in metres. */
export type Footprint = { minX: number; maxX: number; minZ: number; maxZ: number };

export function footprintAt(x: number, z: number, width: number, depth: number): Footprint {
  return { minX: x - width / 2, maxX: x + width / 2, minZ: z - depth / 2, maxZ: z + depth / 2 };
}

export function footprintsOverlap(a: Footprint, b: Footprint, gap = 0): boolean {
  return (
    a.minX < b.maxX + gap && a.maxX + gap > b.minX && a.minZ < b.maxZ + gap && a.maxZ + gap > b.minZ
  );
}

/** Uniform grid over XZ so overlap checks stay cheap with hundreds of objects. */
export class SpatialHash {
  private readonly cells = new Map<string, Set<string>>();
  private readonly items = new Map<string, Footprint>();

  constructor(private readonly cellSize = 4) {}

  insert(id: string, box: Footprint): void {
    this.remove(id);
    this.items.set(id, box);
    for (const key of this.keysFor(box)) {
      let cell = this.cells.get(key);
      if (!cell) this.cells.set(key, (cell = new Set()));
      cell.add(id);
    }
  }

  remove(id: string): void {
    const box = this.items.get(id);
    if (!box) return;
    for (const key of this.keysFor(box)) this.cells.get(key)?.delete(id);
    this.items.delete(id);
  }

  /** Ids whose footprints overlap `box` (with an optional clearance gap). */
  query(box: Footprint, gap = 0): string[] {
    const padded = {
      minX: box.minX - gap,
      maxX: box.maxX + gap,
      minZ: box.minZ - gap,
      maxZ: box.maxZ + gap,
    };
    const found = new Set<string>();
    for (const key of this.keysFor(padded)) {
      for (const id of this.cells.get(key) ?? []) {
        const other = this.items.get(id);
        if (other && footprintsOverlap(box, other, gap)) found.add(id);
      }
    }
    return [...found];
  }

  private *keysFor(box: Footprint): Generator<string> {
    const x0 = Math.floor(box.minX / this.cellSize);
    const x1 = Math.floor(box.maxX / this.cellSize);
    const z0 = Math.floor(box.minZ / this.cellSize);
    const z1 = Math.floor(box.maxZ / this.cellSize);
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) yield `${x},${z}`;
  }
}
