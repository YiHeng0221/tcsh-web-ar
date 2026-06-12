/**
 * AR render layer (spec §0.5 `viewing` + §6 A4ARViewing).
 *
 * A transparent R3F `<Canvas>` overlaid on the live `<video>`. Each frame the
 * R3F camera is driven straight from `pose-fusion` (the single pose source):
 *   - `camera.matrixAutoUpdate = false` — we write position+quaternion and
 *     update the matrix by hand so three doesn't clobber it from its own
 *     position/rotation tracking.
 *   - vertical FOV is derived from the same approximated intrinsics solvePnP
 *     uses (`fovYFromIntrinsics`), so the projection matches the camera feed.
 *
 * Placements render as textured quads. Textures are lazy-loaded with an LRU
 * cache (CLAUDE.md performance rule: never eagerly load all 200–300 textures)
 * and the cache disposes evicted GPU textures. On unmount every cached texture
 * + the shared geometry/material are disposed (REVIEW.md red line: r3f does
 * NOT auto-dispose user-created resources).
 */

import { useFrame, useThree } from "@react-three/fiber";
import { memo, useEffect, useMemo, useRef } from "react";
import {
  DoubleSide,
  type Group,
  MeshBasicMaterial,
  PlaneGeometry,
  type Texture,
  TextureLoader,
} from "three";

import { approxIntrinsics, fovYFromIntrinsics } from "@/lib/ar/coords";
import type { PoseFusion } from "@/lib/ar/pose-fusion";

import type { RenderPlacement } from "../usePlacements";

/** Max textures kept resident (CLAUDE.md: LRU cache, cap to avoid loading all). */
const TEXTURE_CACHE_LIMIT = 50;

/**
 * Tiny LRU texture cache. `get` returns a cached texture or kicks off a load
 * and returns null until it resolves; `dispose` frees everything. Three's
 * TextureLoader has no built-in eviction, so we own it here.
 */
class TextureCache {
  private readonly loader = new TextureLoader();
  private readonly map = new Map<string, Texture>();
  private readonly pending = new Set<string>();
  private disposed = false;

  constructor(
    private readonly limit: number,
    private readonly onLoaded: () => void,
  ) {}

  get(url: string): Texture | null {
    const existing = this.map.get(url);
    if (existing) {
      // Touch: move to the end (most-recently-used).
      this.map.delete(url);
      this.map.set(url, existing);
      return existing;
    }
    if (!this.pending.has(url)) {
      this.pending.add(url);
      this.loader.load(
        url,
        (texture) => {
          this.pending.delete(url);
          if (this.disposed) {
            texture.dispose();
            return;
          }
          texture.colorSpace = "srgb";
          this.insert(url, texture);
          this.onLoaded();
        },
        undefined,
        () => {
          // Load failure (missing texture file etc.) — drop the pending flag
          // so a later frame can retry, but don't spam.
          this.pending.delete(url);
        },
      );
    }
    return null;
  }

  private insert(url: string, texture: Texture): void {
    this.map.set(url, texture);
    while (this.map.size > this.limit) {
      const oldestKey = this.map.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      const oldest = this.map.get(oldestKey);
      this.map.delete(oldestKey);
      oldest?.dispose();
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const texture of this.map.values()) texture.dispose();
    this.map.clear();
    this.pending.clear();
  }
}

export type ARSceneProps = {
  fusion: PoseFusion;
  placements: RenderPlacement[];
  videoWidth: number;
  videoHeight: number;
};

/**
 * Drives the R3F camera from pose-fusion every frame. Renders nothing itself.
 */
function CameraDriver({
  fusion,
  videoWidth,
  videoHeight,
}: {
  fusion: PoseFusion;
  videoWidth: number;
  videoHeight: number;
}) {
  const { camera } = useThree();

  // Match the projection to the (approximated) physical camera intrinsics.
  useEffect(() => {
    camera.matrixAutoUpdate = false;
    if ("isPerspectiveCamera" in camera && camera.isPerspectiveCamera) {
      const { fy } = approxIntrinsics(videoWidth, videoHeight);
      const fovDeg = (fovYFromIntrinsics(videoHeight, fy) * 180) / Math.PI;
      camera.fov = fovDeg;
      camera.aspect = videoWidth / videoHeight;
      camera.near = 0.01;
      camera.far = 100;
      camera.updateProjectionMatrix();
    }
    return () => {
      // Restore default so a remount with a different camera isn't stuck.
      camera.matrixAutoUpdate = true;
    };
  }, [camera, videoWidth, videoHeight]);

  useFrame(() => {
    const pose = fusion.getPose();
    camera.position.copy(pose.position);
    camera.quaternion.copy(pose.quaternion);
    camera.updateMatrix();
    camera.updateMatrixWorld(true);
  });

  return null;
}

/**
 * The placement quads + camera driver. Lives inside the <Canvas>.
 */
function ARSceneInner({
  fusion,
  placements,
  videoWidth,
  videoHeight,
}: ARSceneProps) {
  const groupRef = useRef<Group>(null);
  const invalidate = useThree((s) => s.invalidate);

  // One shared geometry + per-placement material. The unit plane is scaled per
  // placement; sharing the geometry avoids 300 PlaneGeometry allocations.
  const geometry = useMemo(() => new PlaneGeometry(1, 1), []);

  const cache = useMemo(
    () => new TextureCache(TEXTURE_CACHE_LIMIT, () => invalidate()),
    [invalidate],
  );

  // Dispose all GPU resources on unmount (REVIEW.md red line).
  useEffect(() => {
    return () => {
      cache.dispose();
      geometry.dispose();
    };
  }, [cache, geometry]);

  return (
    <group ref={groupRef}>
      <CameraDriver
        fusion={fusion}
        videoWidth={videoWidth}
        videoHeight={videoHeight}
      />
      <ambientLight intensity={1} />
      {placements.map((p) => (
        <PlacementQuad
          key={p.id}
          placement={p}
          geometry={geometry}
          cache={cache}
        />
      ))}
    </group>
  );
}

/**
 * One placement quad. Owns its own MeshBasicMaterial (disposed on unmount) and
 * pulls its texture from the shared LRU cache. Until the texture resolves the
 * mesh stays invisible rather than flashing an untextured plane.
 */
function PlacementQuad({
  placement,
  geometry,
  cache,
}: {
  placement: RenderPlacement;
  geometry: PlaneGeometry;
  cache: TextureCache;
}) {
  const material = useMemo(
    () =>
      new MeshBasicMaterial({
        side: DoubleSide,
        transparent: true,
        toneMapped: false,
      }),
    [],
  );

  useEffect(() => {
    return () => {
      material.dispose();
    };
  }, [material]);

  // Pull (or kick off a load of) the texture each render. The cache calls
  // invalidate() when a load lands, which re-renders us on demand.
  const texture = cache.get(placement.textureUrl);
  material.map = texture;
  material.visible = texture != null;
  material.needsUpdate = true;

  return (
    <mesh
      geometry={geometry}
      material={material}
      position={placement.position}
      quaternion={placement.rotation}
      scale={placement.scale}
    />
  );
}

export default memo(ARSceneInner);
