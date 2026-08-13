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
  hueScore: number;       // 0–100 (hue histogram similarity, lighting-invariant)
  dHashScore: number;     // 0–100 (structural similarity)
  satScore: number;       // 0–100 (saturation histogram)
  combinedScore: number;  // 0–100 weighted final
}

// ─────────────────────────────────────────────────────────────────────────────
// Color utilities
// ─────────────────────────────────────────────────────────────────────────────

/** Convert RGB (0-255 each) to HSV (h: 0-1, s: 0-1, v: 0-1) */
function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === r)      h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else                h = (r - g) / delta + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  return { h, s: max === 0 ? 0 : delta / max, v: max };
}

/**
 * Extracts a multi-zone HSV histogram fingerprint from ImageData.
 * Splits image into ZONES×ZONES cells, computes hue (H_BINS) and
 * saturation (S_BINS) histograms per cell, ignoring low-saturation
 * pixels (grays/whites) for hue — these change with lighting.
 *
 * Returns Float32Array: [zone0_hBin0, zone0_hBin1, ..., zone0_sbin0, ...]
 */
const ZONES    = 4;   // 4×4 spatial grid = 16 zones
const H_BINS   = 16;  // hue resolution (22.5° per bin)
const S_BINS   = 8;   // saturation resolution
const SAT_THRESHOLD = 0.15; // ignore near-gray pixels for hue

function extractHSVHistogram(data: ImageData): Float32Array {
  const zW = Math.floor(data.width  / ZONES);
  const zH = Math.floor(data.height / ZONES);
  const FLOATS_PER_ZONE = H_BINS + S_BINS;
  const out = new Float32Array(ZONES * ZONES * FLOATS_PER_ZONE);

  for (let zr = 0; zr < ZONES; zr++) {
    for (let zc = 0; zc < ZONES; zc++) {
      const zoneIdx = (zr * ZONES + zc) * FLOATS_PER_ZONE;
      let hueCount = 0, satCount = 0;

      for (let y = zr * zH; y < (zr + 1) * zH; y += 2) {
        for (let x = zc * zW; x < (zc + 1) * zW; x += 2) {
          const i = (y * data.width + x) * 4;
          const { h, s } = rgbToHsv(data.data[i], data.data[i+1], data.data[i+2]);
          // Saturation histogram (all pixels)
          out[zoneIdx + H_BINS + Math.min(Math.floor(s * S_BINS), S_BINS - 1)]++;
          satCount++;
          // Hue histogram (only chromatic pixels — saturation above threshold)
          if (s >= SAT_THRESHOLD) {
            out[zoneIdx + Math.min(Math.floor(h * H_BINS), H_BINS - 1)]++;
            hueCount++;
          }
        }
      }
      // Normalise each sub-histogram independently
      if (hueCount > 0) for (let b = 0; b < H_BINS; b++) out[zoneIdx + b] /= hueCount;
      if (satCount > 0) for (let b = 0; b < S_BINS; b++)  out[zoneIdx + H_BINS + b] /= satCount;
    }
  }
  return out;
}

/** Bhattacharyya coefficient between two normalised histograms (0–1, 1=identical) */
function bhattacharyya(a: Float32Array, b: Float32Array): number {
  let coeff = 0;
  for (let i = 0; i < a.length; i++) coeff += Math.sqrt(a[i] * b[i]);
  return coeff; // already 0–1 when both histograms sum to 1
}

/**
 * dHash (Difference Hash) at 17×16 = 272 bits.
 * Compares adjacent pixels horizontally → robust to brightness/contrast shifts.
 */
function computeDHash(data: ImageData): Uint8Array {
  const W = 17, H = 16;
  const tmp = document.createElement("canvas");
  tmp.width = W; tmp.height = H;
  const ctx = tmp.getContext("2d")!;
  // Draw source at full size to a temp canvas then sample
  const src = document.createElement("canvas");
  src.width = data.width; src.height = data.height;
  src.getContext("2d")!.putImageData(data, 0, 0);
  ctx.drawImage(src, 0, 0, W, H);
  const px = ctx.getImageData(0, 0, W, H).data;

  const grays: number[] = [];
  for (let i = 0; i < px.length; i += 4)
    grays.push(0.299 * px[i] + 0.587 * px[i+1] + 0.114 * px[i+2]);

  const bits = new Uint8Array((W - 1) * H);
  for (let row = 0; row < H; row++)
    for (let col = 0; col < W - 1; col++)
      bits[row * (W - 1) + col] = grays[row * W + col] > grays[row * W + col + 1] ? 1 : 0;

  return bits; // 256 bits
}

function hammingDist(a: Uint8Array, b: Uint8Array): number {
  let d = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) if (a[i] !== b[i]) d++;
  return d;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reference data cache
// ─────────────────────────────────────────────────────────────────────────────
interface RefEntry {
  targetIndex: number;
  hsvHist: Float32Array;
  dHash: Uint8Array;
  hasImage: boolean;
}

const REF_SIZE = 200; // normalise all images to 200×200 before hashing

async function loadRefEntry(target: { targetIndex: number; targetImagePreview?: string }): Promise<RefEntry> {
  const empty = { targetIndex: target.targetIndex, hsvHist: new Float32Array(0), dHash: new Uint8Array(0), hasImage: false };
  if (!target.targetImagePreview) return empty;

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const off = document.createElement("canvas");
        off.width = REF_SIZE; off.height = REF_SIZE;
        const ctx = off.getContext("2d")!;
        ctx.drawImage(img, 0, 0, REF_SIZE, REF_SIZE);
        const data = ctx.getImageData(0, 0, REF_SIZE, REF_SIZE);
        resolve({
          targetIndex: target.targetIndex,
          hsvHist: extractHSVHistogram(data),
          dHash: computeDHash(data),
          hasImage: true,
        });
      } catch {
        resolve(empty);
      }
    };
    img.onerror = () => resolve(empty);
    // Append timestamp to bypass any caching that might cause CORS issues
    img.src = target.targetImagePreview + "?t=" + Date.now();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────
export default function ScannerPage() {
  const liveVideoRef    = useRef<HTMLVideoElement>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement>(null);
  const playVideoRef    = useRef<HTMLVideoElement>(null);
  const streamRef       = useRef<MediaStream | null>(null);
  const refCacheRef     = useRef<RefEntry[] | null>(null);

  const [phase, setPhase]             = useState<ScanPhase>("idle");
  const [capturedUrl, setCapturedUrl] = useState<string | null>(null);
  const [matchedTarget, setMatchedTarget] = useState<ARTargetConfig | null>(null);
  const [isMuted, setIsMuted]         = useState(true);
  const [statusText, setStatusText]   = useState("");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scanProgress, setScanProgress] = useState(0);
  const [showDebug, setShowDebug]     = useState(false);
  const [debugScores, setDebugScores] = useState<MatchScore[]>([]);

  // ── Camera ──────────────────────────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    setCameraError(null);
    try {
      streamRef.current?.getTracks().forEach(t => t.stop());
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      if (liveVideoRef.current) {
        liveVideoRef.current.srcObject = stream;
        await liveVideoRef.current.play();
      }
      setPhase("camera_ready");
    } catch (err: any) {
      setCameraError(
        err.name === "NotAllowedError"
          ? "Camera access denied. Please allow camera in your browser settings."
          : "Could not open camera. Make sure you're on HTTPS."
      );
      setPhase("error");
    }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (liveVideoRef.current) liveVideoRef.current.srcObject = null;
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  // ── Matching ─────────────────────────────────────────────────────────────────
  const runMatch = useCallback(async (canvas: HTMLCanvasElement) => {
    setStatusText("Preparing image…");
    setScanProgress(10);

    // Normalise captured frame to REF_SIZE×REF_SIZE
    const norm = document.createElement("canvas");
    norm.width = REF_SIZE; norm.height = REF_SIZE;
    const normCtx = norm.getContext("2d")!;
    normCtx.drawImage(canvas, 0, 0, REF_SIZE, REF_SIZE);
    const capData = normCtx.getImageData(0, 0, REF_SIZE, REF_SIZE);

    const capHSV  = extractHSVHistogram(capData);
    const capDHash = computeDHash(capData);

    setScanProgress(35);
    setStatusText("Loading references…");

    // Load reference data once and cache
    if (!refCacheRef.current) {
      const targets = Object.values(AR_TARGETS);
      refCacheRef.current = await Promise.all(targets.map(loadRefEntry));
    }
    const refs = refCacheRef.current;

    setScanProgress(65);
    setStatusText("Matching image…");

    const scores: MatchScore[] = [];
    const FLOATS_PER_ZONE = H_BINS + S_BINS;
    const ZONES_SQ = ZONES * ZONES;
    const HIST_LEN = ZONES_SQ * FLOATS_PER_ZONE;

    for (const ref of refs) {
      if (!ref.hasImage) continue;

      // ── HSV zone-by-zone Bhattacharyya (hue vs saturation separately) ──────
      let hueBC = 0, satBC = 0;
      for (let z = 0; z < ZONES_SQ; z++) {
        const base = z * FLOATS_PER_ZONE;
        // hue portion
        const capHueSub = capHSV.slice(base, base + H_BINS);
        const refHueSub = ref.hsvHist.slice(base, base + H_BINS);
        hueBC += bhattacharyya(capHueSub, refHueSub);
        // saturation portion
        const capSatSub = capHSV.slice(base + H_BINS, base + H_BINS + S_BINS);
        const refSatSub = ref.hsvHist.slice(base + H_BINS, base + H_BINS + S_BINS);
        satBC += bhattacharyya(capSatSub, refSatSub);
      }
      const hueScore = (hueBC / ZONES_SQ) * 100;   // 0–100
      const satScore = (satBC / ZONES_SQ) * 100;   // 0–100

      // ── dHash structural similarity ────────────────────────────────────────
      const dDist = hammingDist(capDHash, ref.dHash);     // 0–256
      const dHashScore = ((256 - dDist) / 256) * 100;    // 0–100

      /*
       * WEIGHTING RATIONALE:
       * Hue histogram: 55%  — most distinctive, lighting-invariant
       *                        (Spider-Man: red/blue, Sai Baba: green/gold)
       * dHash:         30%  — structural / edge layout
       * Saturation:    15%  — secondary color characteristic
       */
      const combinedScore = Math.round(hueScore * 0.55 + dHashScore * 0.30 + satScore * 0.15);

      scores.push({ targetIndex: ref.targetIndex, hueScore: Math.round(hueScore), dHashScore: Math.round(dHashScore), satScore: Math.round(satScore), combinedScore });
      console.log(`[Match] Target #${ref.targetIndex} | hue:${hueScore.toFixed(1)} dHash:${dHashScore.toFixed(1)} sat:${satScore.toFixed(1)} → combined:${combinedScore}`);
    }

    setScanProgress(92);
    scores.sort((a, b) => b.combinedScore - a.combinedScore);
    setDebugScores([...scores]);

    /*
     * THRESHOLD:
     * Identical images (same hue distribution): combined ≈ 75–95
     * Correct physical photo, imperfect angle:  combined ≈ 55–75
     * Wrong photo:                              combined ≈ 25–50
     *
     * Minimum threshold = 48. If multiple refs exist require best to be
     * at least 8 points ahead of runner-up (gap check prevents false matches).
     */
    const THRESHOLD = 48;
    const GAP_MIN   = 6;

    setScanProgress(100);

    const best   = scores[0];
    const runner = scores[1];
    const hasRefs = refs.some(r => r.hasImage);

    if (!hasRefs) {
      // No reference images at all — demo mode
      console.warn("[Match] No reference images. Demo: Target #0");
      setMatchedTarget(AR_TARGETS[0]);
      setStatusText("✨ Memory Found!");
      setPhase("matched");
      return;
    }

    if (best && best.combinedScore >= THRESHOLD) {
      // If there's a runner-up, require a clear margin to avoid false matches
      const gapOk = !runner || (best.combinedScore - runner.combinedScore) >= GAP_MIN;
      if (gapOk) {
        const config = AR_TARGETS[best.targetIndex];
        if (config) {
          setMatchedTarget(config);
          setStatusText("✨ Memory Found!");
          setPhase("matched");
          return;
        }
      } else {
        // Scores too close — can't confidently pick
        console.warn(`[Match] Ambiguous: Target#${best.targetIndex}=${best.combinedScore} vs Target#${runner.targetIndex}=${runner.combinedScore}, gap=${best.combinedScore - runner.combinedScore}`);
      }
    }

    setPhase("no_match");
    setStatusText("");
    setScanProgress(0);
  }, []);

  // ── Shutter ───────────────────────────────────────────────────────────────
  const handleCapture = useCallback(async () => {
    if (!liveVideoRef.current || !captureCanvasRef.current) return;
    const video  = liveVideoRef.current;
    const canvas = captureCanvasRef.current;
    canvas.width  = video.videoWidth  || 1280;
    canvas.height = video.videoHeight || 720;
    canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
    setCapturedUrl(canvas.toDataURL("image/jpeg", 0.92));
    setPhase("shutter_flash");
    await new Promise(r => setTimeout(r, 320));
    setPhase("analyzing");
    setScanProgress(0);
    await runMatch(canvas);
  }, [runMatch]);

  // ── Video autoplay after match ────────────────────────────────────────────
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

  // ── Reset / scan again ────────────────────────────────────────────────────
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

      {/* ── Visual layer ── */}
      <div className="relative flex-1 w-full" style={{ minHeight: "calc(100vh - 140px)" }}>

        {/* Live feed */}
        <video ref={liveVideoRef} playsInline muted
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${phase === "camera_ready" ? "opacity-100" : "opacity-0"}`} />

        {/* Frozen capture */}
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

        {/* Viewfinder */}
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

        {/* Analyzing */}
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

        {/* No match */}
        <AnimatePresence>
          {phase === "no_match" && (
            <motion.div key="nomatch" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="absolute inset-0 z-30 bg-black/75 backdrop-blur-md flex flex-col items-center justify-center gap-4 p-8 text-center overflow-y-auto">
              <div className="w-16 h-16 rounded-2xl bg-amber-500/20 border border-amber-500/50 flex items-center justify-center">
                <AlertCircle className="w-9 h-9 text-amber-400" />
              </div>
              <h3 className="text-xl font-bold text-white">Couldn't recognise this photo</h3>
              <p className="text-sm text-pink-200/80 max-w-xs leading-relaxed">
                Fill the frame with the entire photo, hold steady, use bright even light.
              </p>
              {debugScores.length > 0 && (
                <div className="w-full max-w-xs bg-black/60 rounded-xl border border-purple-500/30 p-3 text-[11px] font-mono text-left space-y-2">
                  <p className="text-purple-300 font-bold">Match scores (need ≥48):</p>
                  {debugScores.map(s => (
                    <div key={s.targetIndex}>
                      <div className="flex justify-between text-gray-300">
                        <span>Target #{s.targetIndex}</span>
                        <span className={s.combinedScore >= 48 ? "text-emerald-400 font-bold" : "text-rose-400"}>{s.combinedScore}/100</span>
                      </div>
                      <div className="text-[10px] text-gray-500">hue:{s.hueScore} struct:{s.dHashScore} sat:{s.satScore}</div>
                      <div className="h-1 rounded-full bg-white/10 mt-1 overflow-hidden">
                        <div className={`h-full rounded-full ${s.combinedScore >= 48 ? "bg-emerald-400" : "bg-rose-500"}`} style={{ width: `${s.combinedScore}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <button onClick={handleScanAgain} className="flex items-center gap-2 px-6 py-3.5 rounded-2xl bg-gradient-to-r from-pink-500 to-rose-600 text-white font-bold text-sm shadow-xl glow-rose active:scale-[0.97] transition-all">
                <RefreshCw className="w-4 h-4" /> Try Again
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Error */}
        <AnimatePresence>
          {phase === "error" && (
            <motion.div key="error" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-30 bg-black/80 backdrop-blur-md flex flex-col items-center justify-center gap-4 p-8 text-center">
              <div className="w-16 h-16 rounded-2xl bg-rose-500/20 border border-rose-500/50 flex items-center justify-center">
                <AlertCircle className="w-9 h-9 text-rose-400" />
              </div>
              <h3 className="text-xl font-bold text-white">Camera Error</h3>
              <p className="text-sm text-rose-200/80 max-w-xs">{cameraError}</p>
              <button onClick={startCamera} className="flex items-center gap-2 px-6 py-3.5 rounded-2xl bg-rose-600 text-white font-bold text-sm shadow-xl active:scale-[0.97] transition-all">
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
            <button onClick={() => setShowDebug(v => !v)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${showDebug ? "bg-purple-600/60 text-purple-100 border border-purple-400/50" : "glass-panel text-gray-400 hover:text-white"}`}>
              <Bug className="w-3.5 h-3.5" /> Debug
            </button>
            <AnimatePresence>
              {phase === "matched" && (
                <motion.button key="mute" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}
                  onClick={() => setIsMuted(m => !m)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-full font-semibold text-xs uppercase tracking-wider shadow-lg transition-all ${isMuted ? "bg-pink-600 text-white glow-rose animate-bounce" : "bg-emerald-500/80 text-white"}`}>
                  {isMuted ? <><VolumeX className="w-4 h-4" />🔊 Tap for sound</> : <><Volume2 className="w-4 h-4" />Sound On</>}
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Debug panel */}
        <AnimatePresence>
          {showDebug && debugScores.length > 0 && (
            <motion.div key="debug" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="absolute top-16 left-4 right-4 z-50 glass-panel rounded-2xl border border-purple-500/40 p-4 max-w-xs mx-auto">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold text-purple-300 uppercase tracking-wider flex items-center gap-1.5"><Bug className="w-3.5 h-3.5" /> Match Scores</span>
                <button onClick={() => setShowDebug(false)} className="text-gray-400 hover:text-white"><X className="w-4 h-4" /></button>
              </div>
              <div className="space-y-2 text-xs font-mono">
                {debugScores.map(s => (
                  <div key={s.targetIndex} className="bg-purple-950/40 rounded-lg p-2">
                    <div className="flex justify-between mb-1">
                      <span className="text-pink-200 font-bold">Target #{s.targetIndex}</span>
                      <span className={`font-bold ${s.combinedScore >= 48 ? "text-emerald-400" : "text-rose-400"}`}>{s.combinedScore}/100</span>
                    </div>
                    <div className="text-gray-400 space-y-0.5 text-[10px]">
                      <div>Hue (55%):       {s.hueScore}</div>
                      <div>Structure (30%): {s.dHashScore}</div>
                      <div>Saturation (15%): {s.satScore}</div>
                    </div>
                    <div className="mt-1.5 h-1 rounded-full bg-white/10 overflow-hidden">
                      <div className={`h-full rounded-full ${s.combinedScore >= 48 ? "bg-emerald-400" : "bg-rose-400"}`} style={{ width: `${s.combinedScore}%` }} />
                    </div>
                  </div>
                ))}
                <p className="text-purple-400/60 text-[10px]">Threshold ≥48 + 6pt gap between top 2</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Matched card */}
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
                <button onClick={handleScanAgain} className="shrink-0 px-3 py-2 rounded-xl glass-panel text-xs font-bold text-pink-200 hover:text-white border border-pink-500/30 flex items-center gap-1.5">
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

          {phase === "idle" && (
            <motion.div key="start" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="w-full max-w-sm">
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

          {phase === "camera_ready" && (
            <motion.div key="shutter" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-3">
              <p className="text-xs text-pink-200/80 font-medium tracking-wide text-center">
                Fill the frame with the photo, then tap the shutter
              </p>
              <button onClick={handleCapture} aria-label="Capture photo"
                className="w-20 h-20 rounded-full bg-white border-4 border-pink-500/60 shadow-[0_0_30px_rgba(236,72,153,0.5)] flex items-center justify-center active:scale-90 transition-transform">
                <div className="w-14 h-14 rounded-full bg-gradient-to-br from-pink-500 via-rose-500 to-amber-400" />
              </button>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </main>
  );
}
