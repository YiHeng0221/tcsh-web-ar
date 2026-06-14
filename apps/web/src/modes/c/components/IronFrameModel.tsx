import { useGLTF } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import type { Material, Object3D } from "three";
import { Box3, Mesh, MeshStandardMaterial, Vector3 } from "three";
import type { GLTF } from "three-stdlib";

/**
 * Source URL for the bare iron-frame ("notex") variant of the artwork.
 *
 * This is the *scaffolding* mesh — the spiral metal grid without the
 * finished Mode-B textures — used as the spatial backdrop in the C5
 * placement editor so an admin can see where each placement sits on the
 * real structure. It is intentionally distinct from `ARTWORK_MODEL_URL`
 * (`TaiJai.glb`, the textured Mode-B artwork).
 *
 * Dev: `apps/web/public/models/TaiJai.notex.glb` (~10.4 MB, gitignored —
 * see README there). Prod: override via `VITE_IRON_FRAME_MODEL_URL`.
 */
export const IRON_FRAME_MODEL_URL =
  import.meta.env.VITE_IRON_FRAME_MODEL_URL ?? "/models/TaiJai.notex.glb";

/**
 * Static prefetch for the iron-frame glTF. Like `queueArtworkPreload`, this
 * is a plain function (not a hook) so call-sites can fire it from a
 * `useEffect` without tripping rules-of-hooks. We keep it off the module
 * top level so importing this file (e.g. when react-router pre-parses the
 * Mode C chunk) doesn't kick off a ~10 MB download before the admin
 * actually enters isolation mode.
 */
export function queueIronFramePreload(): void {
  useGLTF.preload(IRON_FRAME_MODEL_URL);
}

type Props = {
  /** Opacity for the frame meshes. 1 = opaque (isolation mode focuses on a
   *  single placement against a solid frame); < 1 dims it so the placement
   *  markers read on top (preview mode shows many markers). */
  opacity?: number;
};

/**
 * Loads + recentres the bare iron-frame artwork and renders it as a
 * world-locked backdrop. The mesh is recentred to the world origin (same
 * convention as `ArtworkModel`) so the editor's `CameraSetup` frames it and
 * the placement markers share the frame's coordinate space.
 *
 * Lifecycle: deep-clones the cached scene so opacity tweaks don't bleed
 * into other mounts, and disposes the per-mount geometry + cloned
 * materials on unmount (textures stay owned by drei's `useGLTF` cache — the
 * notex frame has none of consequence, but we keep the discipline so a
 * later textured swap doesn't black-screen).
 */
export function IronFrameModel({ opacity = 1 }: Props = {}) {
  const gltf = useGLTF(IRON_FRAME_MODEL_URL) as GLTF;

  const scene = useMemo<Object3D>(() => {
    const cloned = gltf.scene.clone(true);
    const bbox = new Box3().setFromObject(cloned);
    const centre = bbox.getCenter(new Vector3());
    cloned.position.sub(centre);
    cloned.traverse((node) => {
      if (node instanceof Mesh) {
        node.geometry = node.geometry.clone();
        node.material = cloneMaterial(node.material);
        node.name = node.name || FRAME_MESH_NAME;
      }
    });
    return cloned;
  }, [gltf.scene]);

  // Apply opacity in a layout-safe effect so toggling isolation/preview
  // re-dims without rebuilding the clone. Re-runs whenever opacity flips.
  useEffect(() => {
    const transparent = opacity < 1;
    scene.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      const apply = (m: MeshStandardMaterial) => {
        m.transparent = transparent;
        m.opacity = opacity;
        m.depthWrite = !transparent;
        m.needsUpdate = true;
      };
      const mat = node.material as MeshStandardMaterial | MeshStandardMaterial[];
      if (Array.isArray(mat)) mat.forEach(apply);
      else apply(mat);
    });
  }, [scene, opacity]);

  // Dispose per-mount geometry + materials on unmount. Ref indirection
  // reads the latest clone (mirrors ArtworkModel). Textures belong to the
  // drei cache, so we never dispose those.
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  useEffect(() => {
    return () => {
      sceneRef.current.traverse((node) => {
        if (node instanceof Mesh) {
          node.geometry?.dispose();
          disposeMaterial(node.material);
        }
      });
    };
  }, []);

  return <primitive object={scene} />;
}

/** Name applied to frame meshes that ship without one, so the editor's
 *  dimming / raycaster filters can opt them out by name if needed. */
export const FRAME_MESH_NAME = "tcsh-iron-frame";

function cloneMaterial(material: Material | Material[]): Material | Material[] {
  if (Array.isArray(material)) return material.map((m) => m.clone());
  return material.clone();
}

function disposeMaterial(material: Material | Material[]): void {
  const dispose = (m: Material): void => m.dispose();
  if (Array.isArray(material)) material.forEach(dispose);
  else dispose(material);
}
