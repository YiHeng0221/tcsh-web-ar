/**
 * Runtime loader for the 8th Wall engine binary (`XR8`).
 *
 * The engine is NOT an npm dependency — it ships as a binary-only blob and we
 * keep it out of the main bundle entirely (Mode A / B / Landing must never pay
 * for ~1 MB of SLAM engine). Instead this module injects a `<script>` the first
 * time the `/dev/slam-mvp` route asks for it, and resolves once `window.XR8`
 * exists. Calling it again returns the same in-flight / settled promise.
 *
 * Source of the URL (verified 2026-06-13):
 *   - npm `@8thwall/engine-binary@1` (latest 1.0.0), homepage 8thwall.org
 *   - served via jsDelivr at the path below; the response carries
 *     `access-control-allow-origin: *`, so it loads cross-origin from any host.
 *   - the binary resolves its own chunk/worker base URL from
 *     `document.currentScript.src`, so loading from the CDN also pulls the
 *     SLAM chunk + media-worker from the CDN with no extra wiring. To fully
 *     self-host, mirror the whole `dist/` tree under
 *     `public/vendor/8thwall/` and point `XR8_ENGINE_URL` at it (see that
 *     directory's README).
 *
 * `data-preload-chunks="slam"` tells the engine to prefetch the world-tracking
 * chunk immediately rather than on first `run()`, shaving start-up latency.
 */

/** jsDelivr-hosted engine binary. Override for a self-hosted mirror. */
export const XR8_ENGINE_URL =
  "https://cdn.jsdelivr.net/npm/@8thwall/engine-binary@1/dist/xr.js";

let loadPromise: Promise<XR8Static> | null = null;

/**
 * The engine's `XR8.Threejs` pipeline module resolves three.js via the
 * legacy `window.THREE` global (field error 2026-06-13: "window.THREE
 * does not exist but is required by the ThreeJS pipeline module"). We
 * bundle three as an ES module, so expose OUR copy as the global before
 * the engine boots — same instance the rest of the app renders with, so
 * objects can cross between XR8's scene and ours safely.
 */
async function ensureGlobalThree(): Promise<void> {
  const w = window as unknown as { THREE?: unknown };
  if (w.THREE) return;
  w.THREE = await import("three");
}

/**
 * Inject the XR8 engine script (once) and resolve with the global `XR8`.
 * Rejects if the script fails to load or the global never appears.
 */
export function loadXR8(src: string = XR8_ENGINE_URL): Promise<XR8Static> {
  if (loadPromise) return loadPromise;

  loadPromise = ensureGlobalThree().then(
    () =>
      new Promise<XR8Static>((resolve, reject) => {
    if (typeof document === "undefined") {
      reject(new Error("loadXR8 requires a browser document"));
      return;
    }

    // Already present (e.g. a prior load on a soft navigation back).
    if (window.XR8) {
      resolve(window.XR8);
      return;
    }

    // The engine fires `xrloaded` on window once the global is wired up;
    // listen before injecting so we never miss it.
    const onLoaded = (): void => {
      if (window.XR8) resolve(window.XR8);
      else reject(new Error("xrloaded fired but window.XR8 is missing"));
    };
    window.addEventListener("xrloaded", onLoaded, { once: true });

    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.crossOrigin = "anonymous";
    // Prefetch the SLAM (world-tracking) chunk; we don't need face/image.
    script.setAttribute("data-preload-chunks", "slam");
    script.onerror = (): void => {
      window.removeEventListener("xrloaded", onLoaded);
      reject(new Error(`Failed to load XR8 engine from ${src}`));
    };
    // Belt-and-suspenders: some engine builds set window.XR8 synchronously on
    // script load without firing xrloaded again. Resolve on load if it's there.
    script.onload = (): void => {
      if (window.XR8) resolve(window.XR8);
    };

        document.head.appendChild(script);
      }),
  );

  return loadPromise;
}


/** jsDelivr-hosted XRExtras (official helper modules — FullWindowCanvas,
 *  loading UI). Same provenance pattern as the engine binary; see the
 *  official aframe-world-effects-example which loads exactly this URL. */
export const XREXTRAS_URL =
  "https://cdn.jsdelivr.net/npm/@8thwall/xrextras@1/dist/xrextras.js";

let xrExtrasPromise: Promise<XRExtrasStatic> | null = null;

/** Inject the XRExtras script (once) and resolve with the global. */
export function loadXRExtras(
  src: string = XREXTRAS_URL,
): Promise<XRExtrasStatic> {
  if (xrExtrasPromise) return xrExtrasPromise;
  xrExtrasPromise = new Promise<XRExtrasStatic>((resolve, reject) => {
    const w = window as unknown as { XRExtras?: XRExtrasStatic };
    if (w.XRExtras) {
      resolve(w.XRExtras);
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.onload = (): void => {
      if (w.XRExtras) resolve(w.XRExtras);
      else reject(new Error("xrextras loaded but global missing"));
    };
    script.onerror = (): void =>
      reject(new Error(`Failed to load XRExtras from ${src}`));
    document.head.appendChild(script);
  });
  return xrExtrasPromise;
}

/** Minimal structural type for what we use from XRExtras. */
export type XRExtrasStatic = {
  FullWindowCanvas: {
    pipelineModule: () => { name: string } & Record<string, unknown>;
  };
};
