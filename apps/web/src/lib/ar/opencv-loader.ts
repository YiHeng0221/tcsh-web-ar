/**
 * Lazy, single-instance loader for OpenCV.js (`@techstark/opencv-js`).
 *
 * The WASM payload is ~8MB — it must NEVER enter the main bundle (spec §3,
 * CLAUDE.md performance rules). We pull it via a dynamic `import()` so Vite
 * code-splits it into its own chunk that only loads when A3 mounts.
 *
 * `@techstark/opencv-js`'s module object exposes `onRuntimeInitialized`
 * (Emscripten convention); the exported symbols aren't usable until that
 * fires. We wrap the whole thing in a memoised promise so concurrent
 * callers (A3 prefetch + A4 re-solve) share one initialisation.
 *
 * IMPORTANT: every `cv.Mat` allocated against this module lives on the WASM
 * heap and is NOT garbage-collected. Each caller MUST `.delete()` its Mats
 * (REVIEW.md red line); this loader only owns the module lifecycle.
 */

export type Cv = typeof import("@techstark/opencv-js");

type EmscriptenModule = { onRuntimeInitialized?: () => void };

let cvPromise: Promise<Cv> | null = null;

/**
 * Returns the initialised OpenCV namespace. Memoised: repeat calls return
 * the same promise, so the WASM only downloads + compiles once.
 */
export function loadOpenCv(): Promise<Cv> {
  if (cvPromise) return cvPromise;

  cvPromise = import("@techstark/opencv-js").then((mod) => {
    // The dynamic import's default/namespace IS the Emscripten module. Some
    // bundlers wrap the namespace under `.default`; normalise both.
    const cv = ((mod as unknown as { default?: Cv }).default ?? mod) as Cv;
    const em = cv as unknown as EmscriptenModule;

    // If the runtime is already up (warm re-import), `Mat` is callable and
    // we can resolve immediately. Otherwise wait for onRuntimeInitialized.
    const isReady = typeof (cv as unknown as { Mat?: unknown }).Mat === "function";
    if (isReady) return cv;

    return new Promise<Cv>((resolve) => {
      em.onRuntimeInitialized = () => resolve(cv);
    });
  });

  return cvPromise;
}

/** Test-only: reset the memoised promise so a fresh load can be exercised. */
export function __resetOpenCvForTests(): void {
  cvPromise = null;
}
