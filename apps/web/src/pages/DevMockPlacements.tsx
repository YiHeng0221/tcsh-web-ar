import { OrbitControls, Grid } from "@react-three/drei";
import { Canvas, useLoader } from "@react-three/fiber";
import { Suspense } from "react";
import { Link } from "react-router-dom";
import { DoubleSide, TextureLoader } from "three";

import {
  MOCK_PLACEMENTS,
  MOCK_QR_SIZE_MM,
  MOCK_STATION_ID,
  type MockPlacement,
} from "@/lib/ar/mock-placements";

/**
 * Dev-only sandbox (`/dev/mock-placements`): renders the Mode A mock
 * placements in plain 3D — no camera, no QR, no IMU — so texture
 * layout, orientation, and scale can be eyeballed before A4 exists.
 * The yellow square on the ground is the demo QR footprint; the origin
 * marker sits where solvePnP will put the anchor. What you orbit here
 * is exactly what the AR camera will be world-locked into.
 */
export default function DevMockPlacements() {
  return (
    <main data-screen="dev-mock" className="relative h-dvh w-screen bg-bg text-fg">
      <Canvas camera={{ position: [0, 1.4, 1.8], fov: 55, near: 0.01, far: 100 }}>
        <color attach="background" args={["#111318"]} />
        <ambientLight intensity={0.9} />
        <directionalLight position={[3, 5, 2]} intensity={0.6} />

        {/* Ground reference + QR footprint at the anchor origin. */}
        <Grid args={[10, 10]} cellColor="#2a2e3a" sectionColor="#3d4356" />
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]}>
          <planeGeometry args={[MOCK_QR_SIZE_MM / 1000, MOCK_QR_SIZE_MM / 1000]} />
          <meshBasicMaterial color="#facc15" />
        </mesh>

        <Suspense fallback={null}>
          {MOCK_PLACEMENTS.map((p) => (
            <PlacementQuad key={p.id} placement={p} />
          ))}
        </Suspense>

        <OrbitControls makeDefault target={[0, 1, -1.5]} enableDamping />
      </Canvas>

      <div className="safe-area pointer-events-none absolute inset-x-0 top-0 flex justify-between px-4 pt-4 text-xs text-muted">
        <span>
          dev · mock placements · station {MOCK_STATION_ID} · 黃色方塊 = QR 位置
        </span>
        <Link to="/" className="pointer-events-auto text-accent">
          ← landing
        </Link>
      </div>
    </main>
  );
}

function PlacementQuad({ placement }: { placement: MockPlacement }) {
  const texture = useLoader(TextureLoader, placement.textureUrl);
  return (
    <mesh
      position={placement.position}
      quaternion={placement.rotation}
      scale={placement.scale}
    >
      <planeGeometry args={[1, 1]} />
      {/* DoubleSide so a flipped-handedness bug shows a mirrored texture
          instead of an invisible quad — easier to diagnose. */}
      <meshBasicMaterial map={texture} side={DoubleSide} toneMapped={false} />
    </mesh>
  );
}
