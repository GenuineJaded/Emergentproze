import { useRef, useState, useEffect, Suspense } from "react";
import { Link } from "react-router-dom";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import * as THREE from "three";

// ---------------- Bicone geometry ----------------
// Two cones glued base-to-base. ConeGeometry's apex is at +height/2 along Y by
// default. We build them as a single BufferGeometry shaped manually so the
// equator is a clean ring at y=0.

function makeBiconeGeometry(radius = 1.4, height = 1.6, segments = 96) {
  const geom = new THREE.BufferGeometry();
  const positions = [];
  const normals = [];

  const top = new THREE.Vector3(0, height, 0);
  const bottom = new THREE.Vector3(0, -height, 0);

  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const p0 = new THREE.Vector3(Math.cos(a0) * radius, 0, Math.sin(a0) * radius);
    const p1 = new THREE.Vector3(Math.cos(a1) * radius, 0, Math.sin(a1) * radius);

    // Upper cone triangle: top, p1, p0  (outward winding)
    positions.push(top.x, top.y, top.z);
    positions.push(p1.x, p1.y, p1.z);
    positions.push(p0.x, p0.y, p0.z);
    const n_upper = new THREE.Vector3()
      .subVectors(p1, top)
      .cross(new THREE.Vector3().subVectors(p0, top))
      .normalize();
    for (let k = 0; k < 3; k++)
      normals.push(n_upper.x, n_upper.y, n_upper.z);

    // Lower cone triangle: bottom, p0, p1
    positions.push(bottom.x, bottom.y, bottom.z);
    positions.push(p0.x, p0.y, p0.z);
    positions.push(p1.x, p1.y, p1.z);
    const n_lower = new THREE.Vector3()
      .subVectors(p0, bottom)
      .cross(new THREE.Vector3().subVectors(p1, bottom))
      .normalize();
    for (let k = 0; k < 3; k++)
      normals.push(n_lower.x, n_lower.y, n_lower.z);
  }

  geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  return geom;
}

// Equator ring outline
function EquatorRing({ radius = 1.4, color = "#c8a26b" }) {
  const geometry = useState(() => {
    const points = [];
    const segs = 128;
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      points.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
    }
    return new THREE.BufferGeometry().setFromPoints(points);
  })[0];
  const material = useState(
    () =>
      new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.55,
      })
  )[0];
  return <primitive object={new THREE.Line(geometry, material)} />;
}

// Vertical axis line through poles
function PolarAxis({ height = 1.6 }) {
  const geometry = useState(() => {
    const points = [
      new THREE.Vector3(0, -height * 1.08, 0),
      new THREE.Vector3(0, height * 1.08, 0),
    ];
    return new THREE.BufferGeometry().setFromPoints(points);
  })[0];
  const material = useState(
    () =>
      new THREE.LineBasicMaterial({
        color: "#3a3f48",
        transparent: true,
        opacity: 0.5,
      })
  )[0];
  return <primitive object={new THREE.Line(geometry, material)} />;
}

// Bicone with vertical-gradient surface (warmer near top pole, cooler near bottom)
function BiconeSurface({ radius = 1.4, height = 1.6 }) {
  const meshRef = useRef();
  const geometry = useState(() => makeBiconeGeometry(radius, height, 96))[0];

  // Vertical-gradient shader-like material via vertex color trick:
  // Use a standard physical-ish material with vertexColors.
  useEffect(() => {
    const pos = geometry.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const top = new THREE.Color("#d8b27b"); // warm
    const bottom = new THREE.Color("#4f6a85"); // cool
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const t = (y + height) / (2 * height); // 0..1
      const c = bottom.clone().lerp(top, t);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  }, [geometry, height]);

  return (
    <>
      <mesh ref={meshRef} geometry={geometry}>
        <meshStandardMaterial
          vertexColors
          transparent
          opacity={0.32}
          metalness={0.05}
          roughness={0.65}
          emissive="#1a1610"
          emissiveIntensity={0.4}
          side={THREE.DoubleSide}
          flatShading
        />
      </mesh>
      {/* Wireframe overlay */}
      <mesh geometry={geometry}>
        <meshBasicMaterial
          color="#8a7e63"
          wireframe
          transparent
          opacity={0.18}
        />
      </mesh>
    </>
  );
}

// A labeled node — small sphere + HTML billboard
function Node({ position, color, label, sub, testId, accent = false }) {
  return (
    <group position={position}>
      <mesh>
        <sphereGeometry args={[0.045, 24, 24]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={accent ? 1.0 : 0.7}
          metalness={0.2}
          roughness={0.4}
        />
      </mesh>
      <Html
        center
        distanceFactor={6}
        zIndexRange={[0, 0]}
        style={{ pointerEvents: "none" }}
      >
        <div
          data-testid={testId}
          className="font-ui"
          style={{
            background: "rgba(13,17,23,0.78)",
            backdropFilter: "blur(6px)",
            border: "1px solid rgba(200,162,107,0.22)",
            borderRadius: 4,
            padding: "5px 9px",
            whiteSpace: "nowrap",
            color: "var(--ink-text)",
            fontSize: 11,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            transform: "translate(14px, -50%)",
            userSelect: "none",
          }}
        >
          <div style={{ color: "var(--ink-text)" }}>{label}</div>
          {sub && (
            <div
              style={{
                color: "var(--ink-text-faint)",
                textTransform: "none",
                fontStyle: "italic",
                fontFamily: "EB Garamond, serif",
                fontSize: 11,
                marginTop: 2,
                letterSpacing: 0,
              }}
            >
              {sub}
            </div>
          )}
        </div>
      </Html>
    </group>
  );
}

// Ambient breathing rotation, paused on user interaction.
function BreathingRotation({ groupRef, idleRef }) {
  useFrame((_, dt) => {
    if (!groupRef.current) return;
    const now = performance.now();
    const sinceInteract = now - idleRef.current.lastInteract;
    // resume after 2.5s of idle
    if (sinceInteract > 2500) {
      // 60s per revolution => 2π / 60 rad/s
      groupRef.current.rotation.y += dt * ((Math.PI * 2) / 60);
    }
  });
  return null;
}

function InteractionWatcher({ idleRef, onFirstInteract }) {
  const { gl } = useThree();
  useEffect(() => {
    const el = gl.domElement;
    const mark = () => {
      idleRef.current.lastInteract = performance.now();
      onFirstInteract();
    };
    el.addEventListener("pointerdown", mark);
    el.addEventListener("wheel", mark, { passive: true });
    el.addEventListener("touchstart", mark, { passive: true });
    return () => {
      el.removeEventListener("pointerdown", mark);
      el.removeEventListener("wheel", mark);
      el.removeEventListener("touchstart", mark);
    };
  }, [gl, idleRef, onFirstInteract]);
  return null;
}

function Scene({ idleRef, onFirstInteract }) {
  const groupRef = useRef();
  const radius = 1.4;
  const height = 1.6;
  return (
    <>
      <ambientLight intensity={0.45} />
      <directionalLight position={[3, 4, 5]} intensity={0.8} color="#fdf3e0" />
      <directionalLight position={[-3, -2, -4]} intensity={0.35} color="#6e8cab" />

      <InteractionWatcher idleRef={idleRef} onFirstInteract={onFirstInteract} />

      <group ref={groupRef}>
        <BiconeSurface radius={radius} height={height} />
        <EquatorRing radius={radius} />
        <PolarAxis height={height} />

        {/* Top pole: Light */}
        <Node
          position={[0, height, 0]}
          color="#e8c585"
          label="Light"
          sub="visible · articulated · conscious"
          testId="node-light"
        />

        {/* Bottom pole: Dark */}
        <Node
          position={[0, -height, 0]}
          color="#5a7aa0"
          label="Dark"
          sub="hidden · latent · subconscious"
          testId="node-dark"
        />

        {/* Equator front: π / Paradox */}
        <Node
          position={[radius, 0, 0]}
          color="#c8a26b"
          label="π · Paradox"
          sub="where linear meets circular"
          accent
          testId="node-pi"
        />

        {/* Upper tip-adjacent: Inversion access */}
        <Node
          position={[0.15, height * 0.82, 0.15]}
          color="#b89870"
          label="Inversion access"
          sub="hidden presses into surface"
          testId="node-inversion"
        />

        {/* Middle interior: Lived Actuality */}
        <Node
          position={[0.0, 0.0, -0.35]}
          color="#a8a194"
          label="Lived Actuality"
          sub="where Ground · Love · Change tension"
          testId="node-lived-actuality"
        />
      </group>

      <BreathingRotation groupRef={groupRef} idleRef={idleRef} />

      <OrbitControls
        enableDamping
        dampingFactor={0.08}
        minDistance={2}
        maxDistance={9}
        rotateSpeed={0.65}
        zoomSpeed={0.6}
        panSpeed={0.5}
      />
    </>
  );
}

export default function Geometry() {
  const idleRef = useRef({ lastInteract: 0 });
  const [hasInteracted, setHasInteracted] = useState(false);

  const onFirstInteract = () => {
    if (!hasInteracted) setHasInteracted(true);
  };

  return (
    <div
      className="relative w-screen h-screen overflow-hidden"
      style={{ background: "var(--ink-bg)" }}
      data-testid="geometry-page"
    >
      <Canvas
        camera={{ position: [3.4, 1.8, 3.4], fov: 38 }}
        gl={{ antialias: true, alpha: false }}
        onCreated={({ gl }) => gl.setClearColor("#0d1117", 1)}
        dpr={[1, 2]}
      >
        <Suspense fallback={null}>
          <Scene idleRef={idleRef} onFirstInteract={onFirstInteract} />
        </Suspense>
      </Canvas>

      {/* Top-left: back link + title */}
      <div className="absolute top-6 left-8 flex items-baseline gap-5 pointer-events-auto">
        <Link
          to="/"
          data-testid="geometry-back-link"
          className="font-ui text-xs tracking-[0.18em] uppercase transition-colors duration-300"
          style={{ color: "var(--ink-text-faint)" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--ink-text)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--ink-text-faint)")}
        >
          ← Home
        </Link>
        <span
          className="font-serif italic text-base"
          style={{ color: "var(--ink-text-dim)" }}
        >
          Geometry · the bicone
        </span>
      </div>

      {/* Bottom-left hint, fades on interact */}
      <div
        className={`absolute bottom-10 left-8 font-serif italic text-base pointer-events-none ${
          !hasInteracted ? "hint-fade" : ""
        }`}
        style={{
          color: "var(--ink-text-dim)",
          opacity: hasInteracted ? 0 : undefined,
          transition: "opacity 1.2s",
        }}
        data-testid="geometry-hint"
      >
        orbit to change what this is
      </div>

      {/* Bottom-right: legend of failure-modes hint */}
      <div
        className="absolute bottom-10 right-8 font-ui text-[10px] uppercase tracking-[0.2em] text-right pointer-events-none"
        style={{ color: "var(--ink-text-faint)" }}
      >
        <div>look down the axis · circle</div>
        <div className="mt-1">look across the equator · diamond</div>
      </div>
    </div>
  );
}
