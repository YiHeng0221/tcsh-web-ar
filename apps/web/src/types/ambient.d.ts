/// <reference types="vite/client" />

// Pulling in the @react-three/fiber module activates its JSX namespace
// augmentation so intrinsic elements like `<mesh>`, `<ambientLight>`,
// `<primitive>` are known to TS in any file without extra imports.
import type {} from "@react-three/fiber";
