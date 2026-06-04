import { useRef, useState, useEffect, useCallback, Suspense } from "react";
import { Link } from "react-router-dom";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import * as THREE from "three";
import { streamMercuriusChat } from "../lib/mercurius_stream";
import { computeCameraView } from "../lib/camera";
import MarkdownLite from "../lib/MarkdownLite";

const API = `${process.env.REACT_APP_BACKEND_URL || ""}/api`;

// ---------------- Bicone geometry ---------------- //

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

    positions.push(top.x, top.y, top.z, p1.x, p1.y, p1.z, p0.x, p0.y, p0.z);
    const n_upper = new THREE.Vector3()
      .subVectors(p1, top)
      .cross(new THREE.Vector3().subVectors(p0, top))
      .normalize();
    for (let k = 0; k < 3; k++) normals.push(n_upper.x, n_upper.y, n_upper.z);

    positions.push(bottom.x, bottom.y, bottom.z, p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
    const n_lower = new THREE.Vector3()
      .subVectors(p0, bottom)
      .cross(new THREE.Vector3().subVectors(p1, bottom))
      .normalize();
    for (let k = 0; k < 3; k++) normals.push(n_lower.x, n_lower.y, n_lower.z);
  }

  geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  return geom;
}

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

function BiconeSurface({ radius = 1.4, height = 1.6 }) {
  const meshRef = useRef();
  const geometry = useState(() => makeBiconeGeometry(radius, height, 96))[0];

  useEffect(() => {
    const pos = geometry.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const top = new THREE.Color("#d8b27b");
    const bottom = new THREE.Color("#4f6a85");
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const t = (y + height) / (2 * height);
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
      <mesh geometry={geometry}>
        <meshBasicMaterial color="#8a7e63" wireframe transparent opacity={0.18} />
      </mesh>
    </>
  );
}

// ---------------- Nodes ---------------- //

function MacroNode({ position, color, label, sub, testId, accent = false, focused, dimmed, onClick }) {
  const meshRef = useRef();
  const [hover, setHover] = useState(false);
  const radius = focused || hover ? 0.058 : 0.045;
  const labelOpacity = dimmed ? 0.35 : 1;

  return (
    <group position={position}>
      <mesh
        ref={meshRef}
        onClick={(e) => {
          e.stopPropagation();
          if (meshRef.current) {
            const wp = new THREE.Vector3();
            meshRef.current.getWorldPosition(wp);
            onClick({ worldPos: wp });
          }
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHover(true);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          setHover(false);
          document.body.style.cursor = "";
        }}
      >
        <sphereGeometry args={[radius, 24, 24]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={accent || focused || hover ? 1.0 : 0.7}
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
            border: `1px solid ${focused ? "rgba(200,162,107,0.55)" : "rgba(200,162,107,0.22)"}`,
            borderRadius: 4,
            padding: "5px 9px",
            whiteSpace: "nowrap",
            color: "var(--ink-text)",
            fontSize: 11,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            transform: "translate(14px, -50%)",
            userSelect: "none",
            opacity: labelOpacity,
            transition: "opacity 600ms ease, border-color 400ms ease",
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

function ChildNode({ position, label, focused, fade, onClick }) {
  const meshRef = useRef();
  const [hover, setHover] = useState(false);
  const radius = focused || hover ? 0.038 : 0.028;

  return (
    <group position={position}>
      <mesh
        ref={meshRef}
        onClick={(e) => {
          e.stopPropagation();
          if (meshRef.current) {
            const wp = new THREE.Vector3();
            meshRef.current.getWorldPosition(wp);
            onClick({ worldPos: wp });
          }
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHover(true);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          setHover(false);
          document.body.style.cursor = "";
        }}
      >
        <sphereGeometry args={[radius, 18, 18]} />
        <meshStandardMaterial
          color="#a08862"
          emissive="#a08862"
          emissiveIntensity={focused || hover ? 0.95 : 0.55}
          metalness={0.15}
          roughness={0.55}
        />
      </mesh>
      <Html
        center
        distanceFactor={6}
        zIndexRange={[0, 0]}
        style={{ pointerEvents: "none" }}
      >
        <div
          className="font-ui"
          style={{
            background: "rgba(13,17,23,0.72)",
            backdropFilter: "blur(4px)",
            border: `1px solid ${focused ? "rgba(200,162,107,0.55)" : "rgba(200,162,107,0.16)"}`,
            borderRadius: 3,
            padding: "3px 7px",
            whiteSpace: "nowrap",
            color: "var(--ink-text-dim)",
            fontSize: 9,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            transform: "translate(12px, -50%)",
            userSelect: "none",
            opacity: fade,
            transition: "opacity 600ms ease, border-color 400ms ease, color 400ms ease",
            ...(focused ? { color: "var(--ink-text)" } : {}),
          }}
        >
          {label}
        </div>
      </Html>
    </group>
  );
}

// ---------------- Camera control ---------------- //

function CameraController({ targetWorldPos, controlsRef, controlsReady }) {
  const { camera } = useThree();
  const animRef = useRef(null);
  const lastTargetRef = useRef(null);

  useEffect(() => {
    // Only kick off a new animation when the target identity actually changes
    if (lastTargetRef.current === targetWorldPos) return;
    lastTargetRef.current = targetWorldPos;
    if (!controlsReady) return;

    const startPos = camera.position.clone();
    const startTarget = controlsRef.current
      ? controlsRef.current.target.clone()
      : new THREE.Vector3();

    let endPos;
    let endTarget;
    if (targetWorldPos) {
      // Stay along the same line of sight from current camera to the target,
      // but move in to a fixed standoff distance.
      const dir = startPos.clone().sub(targetWorldPos).normalize();
      endPos = targetWorldPos.clone().add(dir.multiplyScalar(2.6));
      endTarget = targetWorldPos.clone();
    } else {
      endPos = new THREE.Vector3(3.8, 2.6, 3.8);
      endTarget = new THREE.Vector3(0, 0.1, 0);
    }

    animRef.current = {
      startPos,
      startTarget,
      endPos,
      endTarget,
      startTime: performance.now(),
      duration: 1300,
    };
  }, [targetWorldPos, camera, controlsRef, controlsReady]);

  useFrame(() => {
    if (!animRef.current) return;
    const now = performance.now();
    const t = Math.min(1, (now - animRef.current.startTime) / animRef.current.duration);
    // ease-in-out cubic
    const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    camera.position.lerpVectors(animRef.current.startPos, animRef.current.endPos, ease);
    if (controlsRef.current) {
      const newTarget = animRef.current.startTarget
        .clone()
        .lerp(animRef.current.endTarget, ease);
      controlsRef.current.target.copy(newTarget);
      controlsRef.current.update();
    }
    if (t >= 1) animRef.current = null;
  });

  return null;
}

// ---------------- Rotation + camera tracking ---------------- //

function BreathingRotation({ groupRef, idleRef, paused }) {
  useFrame((_, dt) => {
    if (!groupRef.current) return;
    if (paused) return;
    const now = performance.now();
    const sinceInteract = now - idleRef.current.lastInteract;
    if (sinceInteract > 2500) {
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

function CameraTracker({ cameraStateRef }) {
  const { camera } = useThree();
  useFrame(() => {
    cameraStateRef.current = computeCameraView(camera.position);
  });
  return null;
}

// ---------------- Scene ---------------- //

const MACRO_COLORS = {
  light: "#e8c585",
  dark: "#5a7aa0",
  "pi-paradox": "#c8a26b",
  "inversion-access": "#b89870",
  "lived-actuality": "#a8a194",
};

function Scene({
  idleRef,
  onFirstInteract,
  cameraStateRef,
  macros,
  focusedConcept,
  focusedMacroId,
  childFade,
  onMacroClick,
  onChildClick,
  onBackgroundClick,
  targetWorldPos,
  controlsRef,
  controlsReady,
  setControlsReady,
}) {
  const groupRef = useRef();
  const radius = 1.4;
  const height = 1.6;
  const rotationPaused = !!focusedConcept;

  return (
    <>
      <ambientLight intensity={0.45} />
      <directionalLight position={[3, 4, 5]} intensity={0.8} color="#fdf3e0" />
      <directionalLight position={[-3, -2, -4]} intensity={0.35} color="#6e8cab" />

      <InteractionWatcher idleRef={idleRef} onFirstInteract={onFirstInteract} />
      <CameraTracker cameraStateRef={cameraStateRef} />
      <CameraController
        targetWorldPos={targetWorldPos}
        controlsRef={controlsRef}
        controlsReady={controlsReady}
      />

      {/* background-click catcher behind everything; transparent giant sphere */}
      <mesh
        onClick={(e) => {
          e.stopPropagation();
          onBackgroundClick();
        }}
        scale={[60, 60, 60]}
      >
        <sphereGeometry args={[1, 8, 8]} />
        <meshBasicMaterial transparent opacity={0} side={THREE.BackSide} depthWrite={false} />
      </mesh>

      <group ref={groupRef}>
        <BiconeSurface radius={radius} height={height} />
        <EquatorRing radius={radius} />
        <PolarAxis height={height} />

        {macros.map((macro) => {
          const isFocusedMacro = focusedConcept && focusedConcept.id === macro.id;
          const dimmed = focusedConcept && focusedMacroId !== null && focusedMacroId !== macro.id;
          return (
            <group key={macro.id}>
              <MacroNode
                position={macro.position}
                color={MACRO_COLORS[macro.id] || "#c8a26b"}
                label={macro.label}
                sub={macro.sub}
                testId={`node-${macro.id}`}
                accent={macro.accent}
                focused={isFocusedMacro}
                dimmed={dimmed}
                onClick={({ worldPos }) => onMacroClick(macro.id, worldPos)}
              />
              {focusedMacroId === macro.id &&
                macro.children.map((child) => (
                  <ChildNode
                    key={child.id}
                    position={child.position}
                    label={child.label}
                    focused={focusedConcept && focusedConcept.id === child.id}
                    fade={childFade}
                    onClick={({ worldPos }) => onChildClick(child.id, worldPos)}
                  />
                ))}
            </group>
          );
        })}
      </group>

      <BreathingRotation groupRef={groupRef} idleRef={idleRef} paused={rotationPaused} />

      <OrbitControls
        ref={(c) => {
          controlsRef.current = c;
          if (c && !controlsReady) setControlsReady(true);
        }}
        enableDamping
        dampingFactor={0.08}
        minDistance={1.6}
        maxDistance={9}
        rotateSpeed={0.65}
        zoomSpeed={0.6}
        panSpeed={0.5}
      />
    </>
  );
}

// ---------------- Reading card ---------------- //

function ReadingCard({ concept, loading, onClose }) {
  if (!concept && !loading) return null;
  return (
    <div
      data-testid="reading-card"
      className="absolute"
      style={{
        bottom: 36,
        left: 32,
        width: 420,
        maxHeight: "72vh",
        display: "flex",
        flexDirection: "column",
        background: "rgba(13,17,23,0.94)",
        backdropFilter: "blur(14px)",
        border: "1px solid rgba(200,162,107,0.30)",
        borderRadius: 6,
        boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
        color: "var(--ink-text)",
        zIndex: 40,
      }}
    >
      {/* Header */}
      <div
        className="flex items-start justify-between px-5 py-4"
        style={{ borderBottom: "1px solid var(--ink-rule-soft)" }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          {concept?.parent_label && (
            <div
              className="font-ui"
              style={{
                color: "var(--ink-text-faint)",
                fontSize: 9,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                marginBottom: 4,
              }}
            >
              {concept.parent_label} ·
            </div>
          )}
          <div
            className="font-serif"
            style={{
              fontSize: 22,
              lineHeight: 1.15,
              color: "var(--ink-text)",
              fontStyle: concept?.parent_label ? "normal" : "italic",
            }}
          >
            {concept?.label || "…"}
          </div>
          {concept?.sub && (
            <div
              className="font-serif italic"
              style={{ color: "var(--ink-text-dim)", fontSize: 13, marginTop: 4 }}
            >
              {concept.sub}
            </div>
          )}
        </div>
        <button
          type="button"
          data-testid="reading-card-close"
          onClick={onClose}
          className="font-ui transition-colors duration-200"
          style={{
            background: "transparent",
            border: "none",
            color: "var(--ink-text-faint)",
            cursor: "pointer",
            fontSize: 10,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            marginLeft: 12,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--ink-text)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--ink-text-faint)")}
          title="Esc"
        >
          esc
        </button>
      </div>

      {/* Body */}
      <div
        className="overflow-y-auto px-5 py-4"
        style={{ flex: 1, minHeight: 60 }}
      >
        {loading && (
          <div
            className="font-serif italic"
            style={{ color: "var(--ink-text-faint)", fontSize: 14 }}
          >
            drawing from the corpus…
          </div>
        )}
        {!loading && concept && concept.passages.length === 0 && (
          <div
            className="font-serif italic"
            style={{ color: "var(--ink-text-faint)", fontSize: 14 }}
          >
            the map runs out here.
          </div>
        )}
        {!loading &&
          concept &&
          concept.passages.map((p, i) => (
            <div key={i} style={{ marginBottom: i < concept.passages.length - 1 ? 22 : 0 }}>
              <div
                className="font-ui"
                style={{
                  color: "var(--ink-text-faint)",
                  fontSize: 9,
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  marginBottom: 8,
                }}
              >
                {p.doc_title}
                {p.section ? ` · ${p.section}` : ""}
              </div>
              <div className="mercurius-prose" style={{ fontSize: 14 }}>
                <MarkdownLite text={p.text} />
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}

// ---------------- Floating Mercurius panel (unchanged) ---------------- //

function MercuriusPanel({ open, onClose, cameraStateRef }) {
  const [exchanges, setExchanges] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [waitingFirstToken, setWaitingFirstToken] = useState(false);
  const [error, setError] = useState("");
  const [retryPayload, setRetryPayload] = useState(null);
  const panelRef = useRef(null);
  const inputRef = useRef(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    const onDoc = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDoc);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDoc);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [exchanges, waitingFirstToken]);

  const send = async (text) => {
    const msg = (text ?? input).trim();
    if (!msg || sending) return;
    setSending(true);
    setWaitingFirstToken(true);
    setError("");
    setRetryPayload(null);

    const cam = cameraStateRef.current
      ? {
          azimuth: cameraStateRef.current.azimuth,
          elevation: cameraStateRef.current.elevation,
          region: cameraStateRef.current.region,
        }
      : null;

    const exId = `ex-${Date.now()}`;
    setExchanges((xs) => [
      ...xs,
      { id: exId, user: msg, assistant: "", _streaming: true, _camera: cam },
    ]);
    setInput("");

    // History: prior completed exchanges in this ephemeral panel session.
    const history = exchanges
      .filter((x) => x.user && x.assistant && !x._streaming)
      .flatMap((x) => [
        { role: "user", content: x.user },
        { role: "assistant", content: x.assistant },
      ]);

    let gotText = "";
    try {
      await streamMercuriusChat({
        apiBase: API,
        message: msg,
        history,
        cameraContext: cam,
        onToken: (_t, full) => {
          if (waitingFirstToken) setWaitingFirstToken(false);
          setWaitingFirstToken(false);
          gotText = full;
          setExchanges((xs) =>
            xs.map((x) => (x.id === exId ? { ...x, assistant: full } : x))
          );
        },
        onDone: ({ content }) => {
          gotText = content;
          setExchanges((xs) =>
            xs.map((x) =>
              x.id === exId ? { ...x, assistant: content, _streaming: false } : x
            )
          );
        },
      });
    } catch (e) {
      console.error("panel stream", e);
      setError(String(e.message || e));
      if (gotText) {
        setExchanges((xs) =>
          xs.map((x) => (x.id === exId ? { ...x, _streaming: false } : x))
        );
      } else {
        setExchanges((xs) => xs.filter((x) => x.id !== exId));
        setInput(msg);
      }
      setRetryPayload({ message: msg });
    } finally {
      setSending(false);
      setWaitingFirstToken(false);
      inputRef.current?.focus();
    }
  };

  const onKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      data-testid="geometry-mercurius-panel"
      className="absolute"
      style={{
        bottom: 80,
        right: 20,
        width: 380,
        maxHeight: "70vh",
        display: "flex",
        flexDirection: "column",
        background: "rgba(13,17,23,0.92)",
        backdropFilter: "blur(14px)",
        border: "1px solid rgba(200,162,107,0.28)",
        borderRadius: 6,
        boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
        color: "var(--ink-text)",
        zIndex: 50,
      }}
    >
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: "1px solid var(--ink-rule-soft)" }}
      >
        <div className="flex items-center gap-2">
          <span
            className="font-ui text-[10px] uppercase tracking-[0.18em]"
            style={{ color: "var(--ink-accent)" }}
          >
            m.
          </span>
          <span
            className="font-serif italic text-sm"
            style={{ color: "var(--ink-text-dim)" }}
          >
            from where you stand
          </span>
        </div>
        <button
          type="button"
          data-testid="panel-close"
          onClick={onClose}
          className="font-ui text-[10px] uppercase tracking-[0.18em] transition-colors duration-200"
          style={{
            background: "transparent",
            border: "none",
            color: "var(--ink-text-faint)",
            cursor: "pointer",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--ink-text)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--ink-text-faint)")}
          title="Esc to close"
        >
          esc
        </button>
      </div>

      <div
        ref={scrollRef}
        className="overflow-y-auto px-4 py-3"
        style={{ flex: 1, minHeight: 80 }}
      >
        {exchanges.length === 0 && (
          <div
            className="font-serif italic text-sm"
            style={{ color: "var(--ink-text-faint)" }}
          >
            ask from the angle you're holding. mercurius will hear the camera too.
          </div>
        )}
        {exchanges.map((ex) => (
          <div key={ex.id} className="mb-4">
            <div className="user-prose mb-2" style={{ fontSize: 14 }}>
              <span
                className="font-ui text-[10px] uppercase tracking-[0.18em] mr-2"
                style={{ color: "var(--ink-text-faint)" }}
              >
                you
              </span>
              {ex.user}
            </div>
            {ex._camera && (
              <div
                className="font-ui text-[10px] mb-2"
                style={{ color: "var(--ink-text-faint)", letterSpacing: "0.06em" }}
              >
                · az {Math.round(ex._camera.azimuth)}° · el {Math.round(ex._camera.elevation)}° · {ex._camera.region}
              </div>
            )}
            {(ex.assistant || ex._streaming) && (
              <div className="mercurius-prose" style={{ fontSize: 14 }}>
                <MarkdownLite text={ex.assistant} showCursor={!!ex._streaming} />
              </div>
            )}
          </div>
        ))}
        {waitingFirstToken && (
          <div className="flex items-center gap-2" data-testid="panel-thinking">
            <span
              className="font-ui text-[10px] uppercase tracking-[0.18em]"
              style={{ color: "var(--ink-accent)" }}
            >
              m.
            </span>
            <span
              className="breath-dot inline-block rounded-full"
              style={{ width: 5, height: 5, background: "var(--ink-accent)" }}
            />
            <span
              className="font-serif italic text-xs"
              style={{ color: "var(--ink-text-faint)" }}
            >
              listening
            </span>
          </div>
        )}
        {error && (
          <div
            className="mt-2 font-serif italic text-xs flex items-center gap-3"
            style={{ color: "#c97a7a" }}
            data-testid="panel-error"
          >
            <span>— {error}</span>
            {retryPayload && (
              <button
                type="button"
                data-testid="panel-retry"
                onClick={() => send(retryPayload.message)}
                className="font-ui text-[10px] uppercase tracking-[0.18em] underline"
                style={{ background: "transparent", border: "none", color: "var(--ink-accent)", cursor: "pointer" }}
              >
                retry
              </button>
            )}
          </div>
        )}
      </div>

      <div className="px-3 pb-3 pt-2" style={{ borderTop: "1px solid var(--ink-rule-soft)" }}>
        <textarea
          ref={inputRef}
          data-testid="panel-input"
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          placeholder="speak"
          disabled={sending}
          className="font-serif w-full resize-none"
          style={{
            background: "var(--ink-bg-2)",
            color: "var(--ink-text)",
            border: "1px solid var(--ink-rule)",
            borderRadius: 3,
            padding: "8px 10px",
            fontSize: 15,
            lineHeight: 1.45,
            outline: "none",
            minHeight: 38,
            maxHeight: 120,
          }}
          onInput={(e) => {
            e.currentTarget.style.height = "auto";
            e.currentTarget.style.height =
              Math.min(e.currentTarget.scrollHeight, 120) + "px";
          }}
        />
        <div className="flex justify-between items-center mt-2">
          <span
            className="font-ui text-[10px] uppercase tracking-[0.18em]"
            style={{ color: "var(--ink-text-faint)" }}
          >
            enter to send · esc to close
          </span>
          <button
            type="button"
            data-testid="panel-send"
            onClick={() => send()}
            disabled={sending || !input.trim()}
            className="font-ui text-[10px] uppercase tracking-[0.18em] transition-colors duration-200"
            style={{
              padding: "5px 12px",
              background: input.trim() && !sending ? "var(--ink-accent)" : "transparent",
              color: input.trim() && !sending ? "var(--ink-bg)" : "var(--ink-text-faint)",
              border: `1px solid ${input.trim() && !sending ? "var(--ink-accent)" : "var(--ink-rule)"}`,
              borderRadius: 3,
              cursor: sending || !input.trim() ? "default" : "pointer",
              opacity: sending ? 0.5 : 1,
            }}
          >
            send
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------- Geometry page ---------------- //

export default function Geometry() {
  const idleRef = useRef({ lastInteract: 0 });
  const cameraStateRef = useRef({ azimuth: 0, elevation: 0, region: "Equator" });
  const controlsRef = useRef(null);
  const [controlsReady, setControlsReady] = useState(false);

  const [hasInteracted, setHasInteracted] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);

  // Concept tree (macros + children, no passages)
  const [macros, setMacros] = useState([]);
  // Focused: { id, label, sub, parent_id, parent_label, passages }
  const [focusedConcept, setFocusedConcept] = useState(null);
  // Macro whose children are visible (the focused macro, or the parent of focused child)
  const [focusedMacroId, setFocusedMacroId] = useState(null);
  const [childFade, setChildFade] = useState(0);
  const [cardLoading, setCardLoading] = useState(false);
  const [targetWorldPos, setTargetWorldPos] = useState(null);

  const onFirstInteract = useCallback(() => {
    setHasInteracted((v) => v || true);
  }, []);

  // Fetch concept tree on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API}/geometry/concepts`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) setMacros(data.concepts || []);
      } catch (e) {
        console.error("failed to load concepts", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Fade children in/out when the visible macro changes
  useEffect(() => {
    if (focusedMacroId === null) {
      // Fade out
      setChildFade(0);
      return;
    }
    // Fade in
    setChildFade(0);
    const t = setTimeout(() => setChildFade(1), 50);
    return () => clearTimeout(t);
  }, [focusedMacroId]);

  // 'm' key opens the panel (unless typing)
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target?.tagName || "").toLowerCase();
      const inField = tag === "input" || tag === "textarea" || e.target?.isContentEditable;
      if (inField) return;
      if (e.key === "m" || e.key === "M") {
        e.preventDefault();
        setPanelOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Esc closes reading card (panel has its own Esc handler)
  useEffect(() => {
    if (!focusedConcept && focusedMacroId === null) return;
    const onKey = (e) => {
      if (e.key === "Escape") {
        // If the panel is open, let its handler take it
        if (panelOpen) return;
        e.preventDefault();
        clearFocus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedConcept, focusedMacroId, panelOpen]);

  const closePanel = useCallback(() => setPanelOpen(false), []);

  const clearFocus = useCallback(() => {
    setFocusedConcept(null);
    setFocusedMacroId(null);
    setTargetWorldPos(null);
    setCardLoading(false);
  }, []);

  const fetchConcept = useCallback(async (conceptId) => {
    setCardLoading(true);
    try {
      const res = await fetch(`${API}/geometry/concepts/${conceptId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setFocusedConcept(data);
    } catch (e) {
      console.error("failed to load concept", e);
      setFocusedConcept({
        id: conceptId,
        label: conceptId,
        sub: null,
        parent_id: null,
        parent_label: null,
        passages: [],
      });
    } finally {
      setCardLoading(false);
    }
  }, []);

  const onMacroClick = useCallback(
    (macroId, worldPos) => {
      setFocusedMacroId(macroId);
      setTargetWorldPos(worldPos);
      fetchConcept(macroId);
    },
    [fetchConcept]
  );

  const onChildClick = useCallback(
    (childId, worldPos) => {
      setTargetWorldPos(worldPos);
      fetchConcept(childId);
    },
    [fetchConcept]
  );

  const onBackgroundClick = useCallback(() => {
    if (focusedConcept || focusedMacroId !== null) {
      clearFocus();
    }
  }, [focusedConcept, focusedMacroId, clearFocus]);

  return (
    <div
      className="relative w-screen h-screen overflow-hidden"
      style={{ background: "var(--ink-bg)" }}
      data-testid="geometry-page"
    >
      <Canvas
        camera={{ position: [3.8, 2.6, 3.8], fov: 38 }}
        gl={{ antialias: true, alpha: false }}
        onCreated={({ gl, camera }) => {
          gl.setClearColor("#0d1117", 1);
          camera.lookAt(0, 0.1, 0);
          cameraStateRef.current = computeCameraView(camera.position);
        }}
        dpr={[1, 2]}
      >
        <Suspense fallback={null}>
          <Scene
            idleRef={idleRef}
            onFirstInteract={onFirstInteract}
            cameraStateRef={cameraStateRef}
            macros={macros}
            focusedConcept={focusedConcept}
            focusedMacroId={focusedMacroId}
            childFade={childFade}
            onMacroClick={onMacroClick}
            onChildClick={onChildClick}
            onBackgroundClick={onBackgroundClick}
            targetWorldPos={targetWorldPos}
            controlsRef={controlsRef}
            controlsReady={controlsReady}
            setControlsReady={setControlsReady}
          />
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

      {/* Bottom-left hint, fades on interact (hidden when card is open) */}
      {!focusedConcept && (
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
          orbit · click a node · press m
        </div>
      )}

      {/* Bottom-right legend */}
      <div
        className="absolute bottom-10 right-8 font-ui text-[10px] uppercase tracking-[0.2em] text-right pointer-events-none"
        style={{ color: "var(--ink-text-faint)" }}
      >
        <div>look down the axis · circle</div>
        <div className="mt-1">look across the equator · diamond</div>
        <div className="mt-3" style={{ color: "var(--ink-accent)" }}>
          press <span style={{ fontFamily: "Inter Tight, monospace" }}>m</span> · ask from here
        </div>
      </div>

      {/* Reading card */}
      <ReadingCard
        concept={focusedConcept}
        loading={cardLoading}
        onClose={clearFocus}
      />

      {/* Floating Mercurius panel */}
      <MercuriusPanel
        open={panelOpen}
        onClose={closePanel}
        cameraStateRef={cameraStateRef}
      />
    </div>
  );
}
