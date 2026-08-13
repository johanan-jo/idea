"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { AR_TARGETS, ARTargetConfig } from "@/config/arTargets";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  Camera,
  Volume2,
  VolumeX,
  RefreshCw,
  AlertCircle,
  Sparkles,
  ZoomIn,
  Bug,
  X,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
type ScanPhase =
  | "idle"
  | "camera_ready"
  | "shutter_flash"
  | "analyzing"
  | "matched"
  | "no_match"
  | "error";

interface MatchScore {
  targetIndex: number;
  aHashDist: number;          // 0–64, lower = more similar
  dHashDist: number;          // 0–64, lower = more similar
  histogramSim: number;       // 0–1, higher = more similar
  combinedScore: number;      // 0–100, higher = better match
}

// ─────────────────────────────────────────────────────────────────────────────
// Hash & comparison utilities
// ─────────────────────────────────────────────────────────────────────────────

/** Average Hash (aHash): 8×8 grayscale, compare each pixel to mean */
function computeAHash(imageData: ImageData): number[] {
  const SIZE = 8;
  const canvas = document.createElement("canvas");
  canvas.width = SIZE; canvas.height = SIZE;
  const ctx = canvas.getContext("2d")!;
  // Draw the full image data onto a temp canvas, then shrink
  const tmp = document.createElement("canvas");
  tmp.width = imageData.width; tmp.height = imageData.height;
  tmp.getContext("2d")!.putImageData(imageData, 0, 0);
  ctx.drawImage(tmp, 0, 0, SIZE, SIZE);
  const px = ctx.getImageData(0, 0, SIZE, SIZE).data;
  const grays = [];
  for (let i = 0; i < px.length; i += 4)
    grays.push(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
  const avg = grays.reduce((a, b) => a + b, 0) / grays.length;
  return grays.map((g) => (g >= avg ? 1 : 0));
}

/** Difference Hash (dHash): compares adjacent pixels — more robust to brightness shifts */
function computeDHash(imageData: ImageData): number[] {
  const W = 9; const H = 8;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const tmp = document.createElement("canvas");
  tmp.width = imageData.width; tmp.height = imageData.height;
  tmp.getContext("2d")!.putImageData(imageData, 0, 0);
  ctx.drawImage(tmp, 0, 0, W, H);
  const px = ctx.getImageData(0, 0, W, H).data;
  const grays: number[] = [];
  for (let i = 0; i < px.length; i += 4)
    grays.push(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
  const bits: number[] = [];
  for (let row = 0; row < H; row++)
    for (let col = 0; col < W - 1; col++)
      bits.push(grays[row * W + col] > grays[row * W + col + 1] ? 1 : 0);
  return bits; // 64 bits
}

function hammingDist(a: number[], b: number[]): number {
  let d = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) if (a[i] !== b[i]) d++;
  return d;
}

/**
 * Zone histogram similarity.
 * Splits image into a 2×2 grid of zones, computes 8-bin RGB histograms per zone,
 * and returns Bhattacharyya coefficient (0–1, 1 = identical).
 * This is brightness-invariant and works well for photo-of-photo matching.
 */
function computeZoneHistogramSim(captureData: ImageData, refData: ImageData): number {
  const ZONES = 2; // 2×2 grid → 4 zones
  const BINS = 8;
  let totalSim = 0;
  let zoneCount = 0;

  for (let zr = 0; zr < ZONES; zr++) {
    for (let zc = 0; zc < ZONES; zc++) {
      const computeZoneHist = (imgData: ImageData) => {
        const zW = Math.floor(imgData.width / ZONES);
        const zH = Math.floor(imgData.height / ZONES);
        const x0 = zc * zW; const y0 = zr * zH;
        const histR = new Array(BINS).fill(0);
        const histG = new Array(BINS).fill(0);
        const histB = new Array(BINS).fill(0);
        let samples = 0;
        for (let y = y0; y < y0 + zH; y += 3) {
          for (let x = x0; x < x0 + zW; x += 3) {
            const idx = (y * imgData.width + x) * 4;
            histR[Math.min(Math.floor(imgData.data[idx] / (256 / BINS)), BINS - 1)]++;
            histG[Math.min(Math.floor(imgData.data[idx + 1] / (256 / BINS)), BINS - 1)]++;
            histB[Math.min(Math.floor(imgData.data[idx + 2] / (256 / BINS)), BINS - 1)]++;
            samples++;
          }
        }
        // Normalize
        return {
          r: histR.map(v => v / samples),
          g: histG.map(v => v / samples),
          b: histB.map(v => v / samples),
        };
      };

      const cap = computeZoneHist(captureData);
      const ref = computeZoneHist(refData);

      // Bhattacharyya coefficient (histogram intersection approximation)
      let sim = 0;
      for (let k = 0; k < BINS; k++) {
        sim += Math.sqrt(cap.r[k] * ref.r[k]);
        sim += Math.sqrt(cap.g[k] * ref.g[k]);
        sim += Math.sqrt(cap.b[k] * ref.b[k]);
      }
      totalSim += sim / 3;
      zoneCount++;
    }
  }

  return totalSim / zoneCount; // 0–1
}

// ─────────────────────────────────────────────────────────────────────────────
// Reference data (pre-loaded for all targets that have a preview image)
// ─────────────────────────────────────────────────────────────────────────────
interface RefData {
  targetIndex: number;
  aHash: number[];
  dHash: number[];
  imageData: ImageData | null;
  hasImage: boolean;
}

async function buildRefData(): Promise<RefData[]> {
  const results: RefData[] = [];
  for (const target of Object.values(AR_TARGETS)) {
    if (!target.targetImagePreview) {
      results.push({ targetIndex: target.targetIndex, aHash: [], dHash: [], imageData: null, hasImage: false });
      continue;
    }
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => { console.warn("Could not load ref image:", target.targetImagePreview); rej(); };
        // Cache-bust to avoid stale CORS issues
        img.src = target.targetImagePreview + "?v=1";
      });
      const off = document.createElement("canvas");
      // Normalise to 200×200 so comparisons are resolution-independent
      off.width = 200; off.height = 200;
      const offCtx = off.getContext("2d")!;
      offCtx.drawImage(img, 0, 0, 200, 200);
      const imageData = offCtx.getImageData(0, 0, 200, 200);
      results.push({
        targetIndex: target.targetIndex,
        aHash: computeAHash(imageData),
        dHash: computeDHash(imageData),
        imageData,
        hasImage: true,
      });
      console.log(`[Ref] Loaded Target #${target.targetIndex}: ${target.targetImagePreview}`);
    } catch {
      results.push({ targetIndex: target.targetIndex, aHash: [], dHash: [], imageData: null, hasImage: false });
    }
  }
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────
export default function ScannerPage() {
  const liveVideoRef = useRef<HTMLVideoElement>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement>(null);
  const playVideoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const refDataRef = useRef<RefData[] | null>(null);

  const [phase, setPhase] = useState<ScanPhase>("idle");
  const [capturedUrl, setCapturedUrl] = useState<string | null>(null);
  const [matchedTarget, setMatchedTarget] = useState<ARTargetConfig | null>(null);
  const [isMuted, setIsMuted] = useState(true);
  const [statusText, setStatusText] = useState("");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scanProgress, setScanProgress] = useState(0);
  const [showDebug, setShowDebug] = useState(false);
  const [debugScores, setDebugScores] = useState<MatchScore[]>([]);

  // ── Camera ──────────────────────────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    setCameraError(null);
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (liveVideoRef.current) {
        liveVideoRef.current.srcObject = stream;
        await liveVideoRef.current.play();
      }
      setPhase("camera_ready");
    } catch (err: any) {
      const msg =
        err.name === "NotAllowedError"
          ? "Camera access denied. Please allow camera in your browser settings."
          : "Could not open camera. Make sure you're on HTTPS.";
      setCameraError(msg);
      setPhase("error");
    }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (liveVideoRef.current) liveVideoRef.current.srcObject = null;
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  // ── Matching ─────────────────────────────────────────────────────────────────
  const runMatch = useCallback(async (canvas: HTMLCanvasElement) => {
    setStatusText("Scanning image…");
    setScanProgress(15);

    // Normalise capture to 200×200 for consistent comparison
    const normCanvas = document.createElement("canvas");
    normCanvas.width = 200; normCanvas.height = 200;
    const normCtx = normCanvas.getContext("2d")!;
    normCtx.drawImage(canvas, 0, 0, 200, 200);
    const captureData = normCtx.getImageData(0, 0, 200, 200);
    const capAHash = computeAHash(captureData);
    const capDHash = computeDHash(captureData);

    setScanProgress(40);
    setStatusText("Loading reference images…");

    // Build ref data once and cache it
    if (!refDataRef.current) {
      refDataRef.current = await buildRefData();
    }
    const refs = refDataRef.current;
    setScanProgress(65);

    setStatusText("Comparing image signatures…");

    const scores: MatchScore[] = [];
    const hasAnyRef = refs.some(r => r.hasImage);

    for (const ref of refs) {
      if (!ref.hasImage || !ref.imageData) continue;

      const aHashDist = hammingDist(capAHash, ref.aHash);   // 0–64 (lower = better)
      const dHashDist = hammingDist(capDHash, ref.dHash);   // 0–64 (lower = better)
      const histSim   = computeZoneHistogramSim(captureData, ref.imageData); // 0–1 (higher = better)

      // Weighted combined score (0–100, higher = better match)
      // dHash is most robust to lighting changes so it gets the most weight
      const aHashScore  = ((64 - aHashDist) / 64) * 100;
      const dHashScore  = ((64 - dHashDist) / 64) * 100;
      const histScore   = histSim * 100;
      const combined    = dHashScore * 0.45 + aHashScore * 0.25 + histScore * 0.30;

      scores.push({
        targetIndex: ref.targetIndex,
        aHashDist,
        dHashDist,
        histogramSim: histSim,
        combinedScore: Math.round(combined),
      });

      console.log(
        `[Match] Target #${ref.targetIndex} | aHash:${aHashDist} dHash:${dHashDist} hist:${histSim.toFixed(3)} combined:${combined.toFixed(1)}`
      );
    }

    setScanProgress(90);
    setDebugScores(scores);

    // ── Decision ─────────────────────────────────────────────────────────────
    // Sort by combined score descending
    scores.sort((a, b) => b.combinedScore - a.combinedScore);

    /*
     * THRESHOLD RATIONALE:
     * - Identical digital images: combined ≈ 95–100
     * - Same image, different lighting/angle: combined ≈ 55–80
     * - Completely different images: combined ≈ 25–50
     * We use 50 as the minimum match threshold. If only one reference image
     * exists, we lower it to 35 to account for extreme lighting conditions.
     */
    const THRESHOLD_MULTI = 50;  // when multiple targets have reference images
    const THRESHOLD_SOLO  = 35;  // when only one target has a reference image
    const threshold = refs.filter(r => r.hasImage).length > 1 ? THRESHOLD_MULTI : THRESHOLD_SOLO;

    setScanProgress(100);

    const best = scores[0];

    if (best && best.combinedScore >= threshold) {
      const config = AR_TARGETS[best.targetIndex];
      if (config) {
        setMatchedTarget(config);
        setStatusText("✨ Memory Found!");
        setPhase("matched");
        return;
      }
    }

    if (!hasAnyRef) {
      // No reference images configured at all — demonstrate with Target 0
      console.warn("[Match] No reference images found. Defaulting to Target #0 for demo.");
      setMatchedTarget(AR_TARGETS[0]);
      setStatusText("✨ Demo Target #0");
      setPhase("matched");
      return;
    }

    // No confident match
    setPhase("no_match");
    setStatusText("");
    setScanProgress(0);
  }, []);

  // ── Shutter ───────────────────────────────────────────────────────────────
  const handleCapture = useCallback(async () => {
    if (!liveVideoRef.current || !captureCanvasRef.current) return;
    const video = liveVideoRef.current;
    const canvas = captureCanvasRef.current;
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
    setCapturedUrl(canvas.toDataURL("image/jpeg", 0.92));

    setPhase("shutter_flash");
    await new Promise((r) => setTimeout(r, 320));
    setPhase("analyzing");
    setScanProgress(0);
    await runMatch(canvas);
  }, [runMatch]);

  // ── Auto-play video after match ───────────────────────────────────────────
  useEffect(() => {
    if (phase === "matched" && playVideoRef.current) {
      playVideoRef.current.muted = isMuted;
      playVideoRef.current.currentTime = 0;
      playVideoRef.current.play().catch(console.warn);
    }
  }, [phase, matchedTarget, isMuted]);

  useEffect(() => {
    if (playVideoRef.current) playVideoRef.current.muted = isMuted;
  }, [isMuted]);

  // ── Reset ─────────────────────────────────────────────────────────────────
  const handleScanAgain = useCallback(async () => {
    setCapturedUrl(null);
    setMatchedTarget(null);
    setStatusText("");
    setScanProgress(0);
    setDebugScores([]);
    await startCamera();
  }, [startCamera]);

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <main className="relative w-full min-h-screen bg-[#07030f] overflow-hidden flex flex-col">
      <canvas ref={captureCanvasRef} className="hidden" />

      {/* ── Full-screen visual layer ─────────────────────────────────────── */}
      <div className="relative flex-1 w-full min-h-0" style={{ minHeight: "calc(100vh - 140px)" }}>

        {/* Live camera */}
        <video
          ref={liveVideoRef}
          playsInline muted
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${phase === "camera_ready" ? "opacity-100" : "opacity-0"}`}
        />

        {/* Frozen capture frame */}
        <AnimatePresence>
          {capturedUrl && phase !== "matched" && (
            <motion.img key="cap" src={capturedUrl} alt="" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 w-full h-full object-cover" />
          )}
        </AnimatePresence>

        {/* Shutter flash */}
        <AnimatePresence>
          {phase === "shutter_flash" && (
            <motion.div key="flash" initial={{ opacity: 1 }} animate={{ opacity: 0 }} transition={{ duration: 0.32 }} className="absolute inset-0 bg-white z-50" />
          )}
        </AnimatePresence>

        {/* Matched video */}
        <AnimatePresence>
          {phase === "matched" && matchedTarget && (
            <motion.div key="video" initial={{ opacity: 0, scale: 1.04 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-20">
              <video ref={playVideoRef} src={matchedTarget.videoUrl} autoPlay loop playsInline muted={isMuted} className="w-full h-full object-cover" />
              <div className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/90 to-transparent pointer-events-none" />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Viewfinder brackets */}
        <AnimatePresence>
          {phase === "camera_ready" && (
            <motion.div key="vf" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-10 pointer-events-none flex items-center justify-center">
              <div className="relative w-64 h-64 sm:w-72 sm:h-72">
                <div className="absolute top-0 left-0 w-8 h-8 border-t-[3px] border-l-[3px] border-pink-400 rounded-tl-lg" />
                <div className="absolute top-0 right-0 w-8 h-8 border-t-[3px] border-r-[3px] border-pink-400 rounded-tr-lg" />
                <div className="absolute bottom-0 left-0 w-8 h-8 border-b-[3px] border-l-[3px] border-pink-400 rounded-bl-lg" />
                <div className="absolute bottom-0 right-0 w-8 h-8 border-b-[3px] border-r-[3px] border-pink-400 rounded-br-lg" />
                <div className="absolute left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-pink-500 to-transparent shadow-[0_0_12px_3px_rgba(236,72,153,0.7)] animate-scan-laser" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Analyzing overlay */}
        <AnimatePresence>
          {phase === "analyzing" && (
            <motion.div key="analyzing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-30 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center gap-4">
              <div className="relative w-24 h-24">
                <div className="absolute inset-0 rounded-full border-4 border-pink-500/30" />
                <div className="absolute inset-0 rounded-full border-4 border-t-pink-400 border-r-rose-400 border-b-transparent border-l-transparent animate-spin" />
                <div className="absolute inset-2 rounded-full border-2 border-amber-400/40 animate-spin" style={{ animationDirection: "reverse", animationDuration: "1.4s" }} />
                <ZoomIn className="absolute inset-0 m-auto w-8 h-8 text-pink-300 animate-pulse" />
              </div>
              <p className="text-white font-bold text-base tracking-wide">{statusText}</p>
              <div className="w-52 h-1.5 rounded-full bg-white/10 overflow-hidden">
                <motion.div className="h-full bg-gradient-to-r from-pink-500 to-amber-400 rounded-full" initial={{ width: 0 }} animate={{ width: `${scanProgress}%` }} transition={{ duration: 0.4, ease: "easeOut" }} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* No match overlay */}
        <AnimatePresence>
          {phase === "no_match" && (
            <motion.div key="nomatch" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="absolute inset-0 z-30 bg-black/75 backdrop-blur-md flex flex-col items-center justify-center gap-4 p-8 text-center">
              <div className="w-16 h-16 rounded-2xl bg-amber-500/20 border border-amber-500/50 flex items-center justify-center">
                <AlertCircle className="w-9 h-9 text-amber-400" />
              </div>
              <h3 className="text-xl font-bold text-white">Couldn't recognise this photo</h3>
              <p className="text-sm text-pink-200/80 max-w-xs leading-relaxed">
                Make sure the <strong>entire photograph</strong> is inside the frame, well-lit, and held steady.
              </p>
              <ul className="text-xs text-pink-300/70 text-left space-y-1">
                <li>• Fill the viewfinder with just the photo</li>
                <li>• Avoid glare, shadows, and fingerprints</li>
                <li>• Hold camera flat and parallel to the photo</li>
                <li>• Use bright, even lighting</li>
              </ul>
              {/* Debug scores shown in no-match state */}
              {debugScores.length > 0 && (
                <div className="w-full max-w-xs bg-black/60 rounded-xl border border-purple-500/30 p-3 text-[11px] font-mono text-left space-y-1">
                  <p className="text-purple-300 font-bold mb-1">Match Scores (100 = perfect):</p>
                  {debugScores.sort((a, b) => b.combinedScore - a.combinedScore).map(s => (
                    <div key={s.targetIndex} className="flex justify-between text-gray-300">
                      <span>Target #{s.targetIndex}</span>
                      <span className={s.combinedScore >= 50 ? "text-emerald-400" : "text-rose-400"}>
                        {s.combinedScore}/100
                      </span>
                    </div>
                  ))}
                  <p className="text-purple-300/60 text-[10px] mt-1">Need ≥50 to match. Retry in better light.</p>
                </div>
              )}
              <button onClick={handleScanAgain} className="mt-2 flex items-center gap-2 px-6 py-3.5 rounded-2xl bg-gradient-to-r from-pink-500 to-rose-600 text-white font-bold text-sm shadow-xl glow-rose active:scale-[0.97] transition-all">
                <RefreshCw className="w-4 h-4" /> Try Again
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Error overlay */}
        <AnimatePresence>
          {phase === "error" && (
            <motion.div key="error" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-30 bg-black/80 backdrop-blur-md flex flex-col items-center justify-center gap-4 p-8 text-center">
              <div className="w-16 h-16 rounded-2xl bg-rose-500/20 border border-rose-500/50 flex items-center justify-center">
                <AlertCircle className="w-9 h-9 text-rose-400" />
              </div>
              <h3 className="text-xl font-bold text-white">Camera Error</h3>
              <p className="text-sm text-rose-200/80 max-w-xs leading-relaxed">{cameraError}</p>
              <button onClick={startCamera} className="flex items-center gap-2 px-6 py-3.5 rounded-2xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-sm shadow-xl active:scale-[0.97] transition-all">
                <RefreshCw className="w-4 h-4" /> Try Again
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Top bar ── */}
        <div className="absolute top-0 left-0 right-0 z-50 flex items-center justify-between p-4 sm:p-5">
          <Link href="/" className="flex items-center gap-2 px-3.5 py-2 rounded-full glass-panel text-sm font-medium text-pink-200 hover:text-white transition-all backdrop-blur-md">
            <ArrowLeft className="w-4 h-4" /> Home
          </Link>

          <div className="flex items-center gap-2">
            {/* Debug toggle */}
            <button
              onClick={() => setShowDebug(v => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${showDebug ? "bg-purple-600/60 text-purple-100 border border-purple-400/50" : "glass-panel text-gray-400 hover:text-white"}`}
              title="Toggle match score debug panel"
            >
              <Bug className="w-3.5 h-3.5" /> Debug
            </button>

            {/* Mute button (only during video playback) */}
            <AnimatePresence>
              {phase === "matched" && (
                <motion.button key="mute" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}
                  onClick={() => setIsMuted(m => !m)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-full font-semibold text-xs uppercase tracking-wider shadow-lg transition-all ${isMuted ? "bg-pink-600 text-white glow-rose animate-bounce" : "bg-emerald-500/80 text-white backdrop-blur-md"}`}>
                  {isMuted ? <><VolumeX className="w-4 h-4" /> 🔊 Tap for sound</> : <><Volume2 className="w-4 h-4" /> Sound On</>}
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Debug panel overlay */}
        <AnimatePresence>
          {showDebug && debugScores.length > 0 && (
            <motion.div key="debug-panel" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="absolute top-16 left-4 right-4 z-50 glass-panel rounded-2xl border border-purple-500/40 p-4 max-w-xs mx-auto">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold text-purple-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Bug className="w-3.5 h-3.5" /> Match Scores
                </span>
                <button onClick={() => setShowDebug(false)} className="text-gray-400 hover:text-white"><X className="w-4 h-4" /></button>
              </div>
              <div className="space-y-2 text-xs font-mono">
                {[...debugScores].sort((a, b) => b.combinedScore - a.combinedScore).map(s => (
                  <div key={s.targetIndex} className="bg-purple-950/40 rounded-lg p-2">
                    <div className="flex justify-between mb-1">
                      <span className="text-pink-200 font-bold">Target #{s.targetIndex}</span>
                      <span className={`font-bold ${s.combinedScore >= 50 ? "text-emerald-400" : "text-rose-400"}`}>{s.combinedScore}/100</span>
                    </div>
                    <div className="text-gray-400 space-y-0.5">
                      <div>aHash dist: {s.aHashDist}/64</div>
                      <div>dHash dist: {s.dHashDist}/64</div>
                      <div>Histogram:  {(s.histogramSim * 100).toFixed(1)}%</div>
                    </div>
                    {/* Score bar */}
                    <div className="mt-1.5 h-1 rounded-full bg-white/10 overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${s.combinedScore >= 50 ? "bg-emerald-400" : "bg-rose-400"}`} style={{ width: `${s.combinedScore}%` }} />
                    </div>
                  </div>
                ))}
                <p className="text-purple-400/60 text-[10px] mt-1">Threshold: ≥50 combined score</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Matched memory card at bottom */}
        <AnimatePresence>
          {phase === "matched" && matchedTarget && (
            <motion.div key="card" initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} transition={{ delay: 0.3 }} className="absolute bottom-0 left-0 right-0 z-30 p-4 sm:p-5">
              <div className="glass-panel rounded-2xl border border-pink-500/40 p-4 backdrop-blur-xl flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  {matchedTarget.targetImagePreview && (
                    <img src={matchedTarget.targetImagePreview} alt={matchedTarget.title} className="w-12 h-12 rounded-xl object-cover border border-pink-500/40 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <span className="text-[10px] uppercase tracking-widest font-bold text-pink-400 block">✨ {matchedTarget.badge || `Memory #${matchedTarget.targetIndex + 1}`}</span>
                    <p className="text-sm font-serif font-bold text-white truncate">{matchedTarget.title}</p>
                  </div>
                </div>
                <button onClick={handleScanAgain} className="shrink-0 px-3 py-2 rounded-xl glass-panel text-xs font-bold text-pink-200 hover:text-white border border-pink-500/30 flex items-center gap-1.5 transition-all">
                  <RefreshCw className="w-3.5 h-3.5" /> Scan
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Bottom action bar ── */}
      <div className="relative z-40 w-full px-4 pb-10 pt-4 flex flex-col items-center gap-4 bg-gradient-to-t from-black via-[#07030f]/90 to-transparent">
        <AnimatePresence mode="wait">

          {/* Idle start card */}
          {phase === "idle" && (
            <motion.div key="start" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="w-full max-w-sm flex flex-col items-center">
              <div className="glass-panel rounded-3xl p-6 border border-pink-500/20 backdrop-blur-xl w-full text-center">
                <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-pink-500 to-rose-600 flex items-center justify-center shadow-lg glow-rose animate-float">
                  <Camera className="w-7 h-7 text-white" />
                </div>
                <h1 className="text-2xl font-serif font-bold text-gradient-rose mb-2">Memories Alive</h1>
                <p className="text-xs text-pink-200/80 mb-5 leading-relaxed">
                  Point camera at a physical photograph and press the shutter button. The app will recognise the image and play the linked memory video.
                </p>
                <button onClick={startCamera} className="w-full py-4 rounded-2xl bg-gradient-to-r from-pink-500 via-rose-500 to-amber-500 text-white font-bold text-sm tracking-wide shadow-xl flex items-center justify-center gap-2 glow-rose active:scale-[0.98] transition-all">
                  <Sparkles className="w-5 h-5 text-amber-200" /> OPEN CAMERA
                </button>
              </div>
            </motion.div>
          )}

          {/* Shutter button */}
          {phase === "camera_ready" && (
            <motion.div key="shutter" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-3">
              <p className="text-xs text-pink-200/80 font-medium tracking-wide text-center">
                Fill the frame with the photo, then tap the shutter
              </p>
              <button
                onClick={handleCapture}
                aria-label="Capture photo"
                className="w-20 h-20 rounded-full bg-white border-4 border-pink-500/60 shadow-[0_0_30px_rgba(236,72,153,0.5)] flex items-center justify-center active:scale-90 transition-transform"
              >
                <div className="w-14 h-14 rounded-full bg-gradient-to-br from-pink-500 via-rose-500 to-amber-400" />
              </button>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </main>
  );
}
