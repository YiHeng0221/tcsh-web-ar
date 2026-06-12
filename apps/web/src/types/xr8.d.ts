/**
 * Minimal ambient typings for the 8th Wall engine binary (`XR8`).
 *
 * 8th Wall went free / open-source on 2026-02-28; the SLAM engine ships as a
 * binary-only package (`@8thwall/engine-binary`, https://8th.io/xrjs) with no
 * `@types`. Rather than add an npm dependency for a binary-licensed blob we
 * load it as a `<script>` at runtime (see `lib/slam/load-xr8.ts`) and describe
 * only the surface this MVP touches. This is deliberately partial — the real
 * engine API is much larger.
 *
 * Frame conventions (the part that bites): `processCpuResult.reality` from the
 * `XrController` pipeline module reports the *camera's* pose in the SLAM world
 * as `{ rotation: quaternion, position }`. `XR8.Threejs.xrScene()` hands back a
 * live three.js scene/camera/renderer; the engine drives that camera each frame
 * from the same reality pose, so anything parented to the scene is world-locked
 * by SLAM for free.
 */

import type { Camera, Scene, WebGLRenderer, Texture } from "three";

declare global {
  interface XR8CameraPipelineModule {
    name: string;
    // The engine calls many lifecycle hooks; we only ever supply a subset, so
    // every hook is optional and loosely typed (the payloads are large and
    // version-specific — we read just `processCpuResult.reality`).
    onStart?: (args: { canvas: HTMLCanvasElement }) => void;
    onAttach?: (args: unknown) => void;
    onUpdate?: (args: XR8PipelineUpdateArgs) => void;
    onCameraStatusChange?: (args: { status: string }) => void;
    onException?: (error: unknown) => void;
    [key: string]: unknown;
  }

  interface XR8RealityPose {
    /** Camera orientation in the SLAM world, quaternion [x, y, z, w]. */
    rotation: { x: number; y: number; z: number; w: number };
    /** Camera position in the SLAM world, metres. */
    position: { x: number; y: number; z: number };
    /** Camera intrinsics, when available. */
    intrinsics?: number[];
  }

  interface XR8PipelineUpdateArgs {
    framework: unknown;
    processCpuResult?: {
      reality?: XR8RealityPose;
      [key: string]: unknown;
    };
    /** Engine ≥1.0 surfaces CameraPixelArray frames HERE (verified by
     *  dissecting the binary: `processGpuResult.camerapixelarray =
     *  { rows, cols, rowBytes, pixels, srcTex }`), not in the CPU result
     *  like older docs suggest. */
    processGpuResult?: {
      [key: string]: unknown;
    };
    [key: string]: unknown;
  }

  interface XR8ThreejsScene {
    scene: Scene;
    camera: Camera;
    renderer: WebGLRenderer;
    cameraTexture?: Texture;
  }

  interface XR8Threejs {
    pipelineModule(): XR8CameraPipelineModule;
    xrScene(): XR8ThreejsScene;
  }

  interface XR8XrConfigDevice {
    ANY: unknown;
    MOBILE: unknown;
    MOBILE_AND_HEADSETS: unknown;
  }

  interface XR8RunOptions {
    canvas: HTMLCanvasElement;
    allowedDevices?: unknown;
    cameraConfig?: { direction?: string };
  }

  interface XR8Static {
    addCameraPipelineModule(mod: XR8CameraPipelineModule): void;
    addCameraPipelineModules(mods: XR8CameraPipelineModule[]): void;
    clearCameraPipelineModules(): void;
    run(options: XR8RunOptions): void;
    stop(): void;
    pause(): void;
    resume(): void;
    Threejs: XR8Threejs;
    XrController: { pipelineModule(): XR8CameraPipelineModule };
    GlTextureRenderer: { pipelineModule(): XR8CameraPipelineModule };
    CameraPixelArray: {
      pipelineModule(opts?: {
        luminance?: boolean;
        width?: number;
        height?: number;
      }): XR8CameraPipelineModule;
    };
    XrConfig: { device(): XR8XrConfigDevice };
    [key: string]: unknown;
  }

  interface Window {
    XR8?: XR8Static;
    XRExtras?: unknown;
    onxrloaded?: () => void;
  }
}

export {};
