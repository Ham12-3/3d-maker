import {
  Box3,
  Matrix4,
  Mesh,
  Vector3,
  type BufferGeometry,
  type Material,
  type Object3D,
} from "three";
import type { Vec3 } from "@/scene/schema";

/**
 * GLB normalisation. Every model is treated as a box standing on the ground:
 * centred in X/Z, bottom at y = 0, and scaled uniformly to fit the requested
 * real-world size. Works on the loaded scene without mutating it (useGLTF
 * caches scenes and shares them between nodes).
 */

export type ModelPart = {
  geometry: BufferGeometry;
  material: Material | Material[];
  matrix: Matrix4;
};

export type NormalisedModel = {
  parts: ModelPart[];
  /** Native bounds size, before scaling. */
  size: Vector3;
  /** Moves the model so its bottom-centre sits at the origin. */
  toOrigin: Matrix4;
};

const cache = new WeakMap<Object3D, NormalisedModel>();

export function normaliseModel(scene: Object3D): NormalisedModel {
  const hit = cache.get(scene);
  if (hit) return hit;

  scene.updateMatrixWorld(true);
  const box = new Box3().setFromObject(scene);
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  const toOrigin = new Matrix4().makeTranslation(-center.x, -box.min.y, -center.z);
  const rootInverse = new Matrix4().copy(scene.matrixWorld).invert();

  const parts: ModelPart[] = [];
  scene.traverse((o) => {
    if (o instanceof Mesh) {
      parts.push({
        geometry: o.geometry,
        material: o.material,
        matrix: new Matrix4().multiplyMatrices(rootInverse, o.matrixWorld),
      });
    }
  });

  const result = { parts, size, toOrigin };
  cache.set(scene, result);
  return result;
}

/** Uniform scale that fits the native size inside the target box (metres). */
export function fitScale(native: Vector3, box: Vec3): number {
  const k = Math.min(
    box[0] / Math.max(native.x, 1e-6),
    box[1] / Math.max(native.y, 1e-6),
    box[2] / Math.max(native.z, 1e-6),
  );
  return Number.isFinite(k) && k > 0 ? k : 1;
}

/** Uniform scale that makes the model this tall. */
export function heightScale(native: Vector3, height: number): number {
  return height / Math.max(native.y, 1e-6);
}
