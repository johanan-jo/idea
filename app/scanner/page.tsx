"use client";

/**
 * Photo-capture only scanner.
 *
 * User opens camera → takes a photo → system analyses it → plays video.
 *
 * Recognition priority:
 *   1. MindAR live tracking (background, fires automatically)
 *   2. HOG reference image matching  (on captured photo)
 *   3. Hue + dHash + Saturation fallback (on captured photo)
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, Bug, X, Camera, RefreshCw,
  Volume2, VolumeX, Sparkles, AlertCircle, CheckCircle2, ZoomIn,
} from "lucide-react";

import { AR_TARGETS, ARTargetConfig }            from "@/config/arTargets";
import { FALLBACK_COLOR_THRESHOLD }              from "@/config/recognitionTargets";
import { RECOGNITION_TARGETS, getTargetById, getTargetByMindarIndex } from "@/config/recognitionTargets";
import type { RecognitionTarget }                from "@/config/recognitionTargets";
import {
  buildReferenceDescriptors,
  matchReferenceImages,
} from "@/lib/referenceImageMatcher";
import type { ReferenceDescriptor, ReferenceMatchResult } from "@/lib/referenceImageMatcher";
import { RecognitionEngine }                     from "@/lib/recognitionEngine";
import type { RecognitionResult, RecognitionMethod } from "@/lib/recognitionEngine";
import { loadFallbackRef, computeFallbackScores } from "@/lib/markerDetector";
import type { FallbackRef, FallbackMatchResult } from "@/lib/markerDetector";
import ARScanner                                 from "@/components/ARScanner";
import type { ARTelemetryState }                 from "@/components/ARScanner";

// ─────────────────────────────────────────────────────────────────────────────
type Phase =
  | "idle"        // Landing card — camera not yet open
  | "camera"      // Camera live, waiting for shutter press
  | "analysing"   // Photo captured, running matchers
  | "matched"     // Confident target found → video playing
  | "no_match"    // Analysed but nothing found
  | "error";      // Camera / permission error

interface DebugState {
  camera: string;
  mindar: string;
  refMatcher: string;
  detectedTarget: string;
  method: string;
  confidence: string;
  video: string;
  status: string;
  fallbackScores: FallbackMatchResult[];
  lastRef?: { url: string; conf: number; region: string };
  scanMs: number;
  agreement: boolean;
}

const INIT_DEBUG: DebugState = {
  camera: "Idle", mindar: "Loading", refMatcher: "Loading",
  detectedTarget: "NONE", method: "—", confidence: "—",
  video: "—", status: "Idle", fallbackScores: [], scanMs: 0, agreement: false,
};

// ─────────────────────────────────────────────────────────────────────────────
export default function ScannerPage() {
  // ── Refs ──────────────────────────────────────────────────────────────────
  const captureCanvasRef  = useRef<HTMLCanvasElement>(null);
  const playVideoRef      = useRef<HTMLVideoElement>(null);
  const engineRef         = useRef<RecognitionEngine | null>(null);
  const refDescsRef       = useRef<ReferenceDescriptor[] | null>(null);
  const fallbackRefsRef   = useRef<FallbackRef[] | null>(null);
  const graceRef          = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── State ─────────────────────────────────────────────────────────────────
  const [phase,          setPhase]          = useState<Phase>("idle");
  const [isScanning,     setIsScanning]     = useState(false);
  const [matchedTarget,  setMatchedTarget]  = useState<RecognitionTarget | null>(null);
  const [capturedUrl,    setCapturedUrl]    = useState<string | null>(null);
  const [isMuted,        setIsMuted]        = useState(true);
  const [cameraError,    setCameraError]    = useState<string | null>(null);
  const [scanProgress,   setScanProgress]   = useState(0);
  const [statusText,     setStatusText]     = useState("");
  const [showDebug,      setShowDebug]      = useState(false);
  const [isMock,         setIsMock]         = useState(false);
  const [debug,          setDebug]          = useState<DebugState>(INIT_DEBUG);

  // ── Detection engine ───────────────────────────────────────────────────────
  useEffect(() => {
    engineRef.current = new RecognitionEngine({
      onTargetChanged: handleTargetFound,
      onTargetLost:    handleTargetLost,
    });
  }, []); // eslint-disable-line

  // ── Load reference descriptors once ───────────────────────────────────────
  useEffect(() => {
    setDebug(d => ({ ...d, refMatcher: "Loading…" }));
    buildReferenceDescriptors().then(descs => {
      refDescsRef.current = descs;
      setDebug(d => ({ ...d, refMatcher: `✓ ${descs.length} refs loaded` }));
    }).catch(() => {
      setDebug(d => ({ ...d, refMatcher: "✗ Failed to load" }));
    });
  }, []);

  // ── Mock mode detection (desktop / no camera) ─────────────────────────────
  useEffect(() => {
    const ua = navigator.userAgent.toLowerCase();
    setIsMock(!(/android|iphone|ipad|ipod|mobile/i.test(ua)) && !window.location.search.includes("force-ar"));
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // Target found / lost
  // ─────────────────────────────────────────────────────────────────────────
  function handleTargetFound(result: RecognitionResult) {
    if (graceRef.current) { clearTimeout(graceRef.current); graceRef.current = null; }
    const t = result.target;
    setMatchedTarget(t);
    setPhase("matched");
    setDebug(d => ({
      ...d,
      detectedTarget: t.name,
      method: result.method,
      confidence: (result.finalConfidence * 100).toFixed(0) + "%",
      video: t.videoUrl.split("/").pop() ?? t.videoUrl,
      status: "PLAYING",
      agreement: result.hasAgreement,
      lastRef: result.debug.reference.detected
        ? { url: result.debug.reference.refImageUrl!, conf: result.debug.reference.confidence!, region: result.debug.reference.region! }
        : d.lastRef,
    }));
    console.log(`[Scanner] ✅ ${t.name} | method:${result.method} | conf:${result.finalConfidence.toFixed(2)} | video:${t.videoUrl}`);
  }

  function handleTargetLost() {
    // Small grace — don't immediately reset if MindAR briefly loses tracking
    if (graceRef.current) clearTimeout(graceRef.current);
    graceRef.current = setTimeout(() => {
      setMatchedTarget(null);
      setPhase("camera");
      setDebug(d => ({ ...d, detectedTarget: "NONE", method: "—", confidence: "—", video: "—", status: "Scanning" }));
    }, 3000);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MindAR callbacks (passed to ARScanner)
  // ─────────────────────────────────────────────────────────────────────────
  const onMindARTargetFound = useCallback((arTarget: ARTargetConfig) => {
    engineRef.current?.ingestMindar(arTarget.targetIndex);
  }, []);

  const onMindARTargetLost = useCallback(() => {
    engineRef.current?.ingestMindarLost();
  }, []);

  const onCameraError = useCallback((msg: string) => {
    setCameraError(msg);
    setDebug(d => ({ ...d, camera: "✗ Error", mindar: `✗ ${msg.slice(0, 50)}` }));
  }, []);

  const onSceneReady = useCallback(() => {
    setDebug(d => ({ ...d, mindar: "✓ Ready" }));
    setPhase("camera");
  }, []);

  const onTelemetryUpdate = useCallback((t: ARTelemetryState) => {
    setDebug(d => ({
      ...d,
      camera: t.cameraStatus === "ready" ? "✓ Active" : t.cameraStatus === "error" ? "✗ Error" : t.cameraStatus,
      mindar:  t.mindarStatus === "running" ? "✓ Running" : t.mindarStatus === "error" ? "✗ Error" : t.mindarStatus,
    }));
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // Get MindAR's internal video element (for photo capture)
  // ─────────────────────────────────────────────────────────────────────────
  function findCameraVideo(): HTMLVideoElement | null {
    for (const sel of ["a-scene video", "video[autoplay]", "video[playsinline]"]) {
      const el = document.querySelector<HTMLVideoElement>(sel);
      if (el && el.videoWidth > 0) return el;
    }
    return null;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CAPTURE PHOTO → analyse
  // ─────────────────────────────────────────────────────────────────────────
  const handleCapture = useCallback(async () => {
    const video  = findCameraVideo();
    const canvas = captureCanvasRef.current;
    if (!video || !canvas) return;

    // ── Freeze frame ──────────────────────────────────────────────────────
    canvas.width  = video.videoWidth  || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    setCapturedUrl(canvas.toDataURL("image/jpeg", 0.92));

    setPhase("analysing");
    setScanProgress(0);
    setStatusText("Scanning for reference image…");
    engineRef.current?.reset();

    const captureData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let matched = false;
    const t0 = performance.now();

    // ── Step 1: HOG Reference matching ───────────────────────────────────
    setScanProgress(20);
    if (refDescsRef.current && refDescsRef.current.length > 0) {
      const matches = matchReferenceImages(captureData, refDescsRef.current);
      if (matches.length > 0) {
        const best = matches[0];
        console.log(`[Scanner] 🎨 Ref match: ${best.targetId} | conf:${best.confidence.toFixed(3)} | region:${best.region}`);
        engineRef.current?.ingestReferenceResult(best);
        matched = true;
      }
    }
    setScanProgress(55);

    // ── Step 2: Colour / hash fallback ───────────────────────────────────
    if (!matched) {
      setStatusText("Trying colour & structure matching…");

      if (!fallbackRefsRef.current) {
        fallbackRefsRef.current = await Promise.all(
          Object.values(AR_TARGETS).map(t =>
            loadFallbackRef(t.targetIndex, t.title, t.targetImagePreview)
          )
        );
      }

      const scores = computeFallbackScores(captureData, fallbackRefsRef.current);
      scores.sort((a, b) => b.combinedScore - a.combinedScore);
      setDebug(d => ({ ...d, fallbackScores: scores }));

      const best   = scores[0];
      const runner = scores[1];
      if (best && best.combinedScore >= FALLBACK_COLOR_THRESHOLD) {
        const gap = runner ? best.combinedScore - runner.combinedScore : 999;
        if (gap >= 8) {
          engineRef.current?.ingestColorResult(best.targetIndex, best.combinedScore);
          matched = true;
        }
      }
    }

    const ms = Math.round(performance.now() - t0);
    setDebug(d => ({ ...d, scanMs: ms }));
    setScanProgress(100);

    if (!matched) {
      setPhase("no_match");
      setStatusText("");
    }
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // Video autoplay
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase === "matched" && matchedTarget && playVideoRef.current) {
      const v = playVideoRef.current;
      v.src = matchedTarget.videoUrl;
      v.muted = isMuted;
      v.currentTime = 0;
      v.play().catch(console.warn);
    }
  }, [phase, matchedTarget]); // eslint-disable-line

  useEffect(() => {
    if (playVideoRef.current) playVideoRef.current.muted = isMuted;
  }, [isMuted]);

  // ─────────────────────────────────────────────────────────────────────────
  // Reset
  // ─────────────────────────────────────────────────────────────────────────
  const handleReset = useCallback(() => {
    if (graceRef.current) { clearTimeout(graceRef.current); graceRef.current = null; }
    setCapturedUrl(null);
    setMatchedTarget(null);
    engineRef.current?.reset();
    setDebug(d => ({ ...d, detectedTarget: "NONE", method: "—", confidence: "—", video: "—", status: "Scanning", fallbackScores: [], agreement: false }));
    setPhase("camera");
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // Start
  // ─────────────────────────────────────────────────────────────────────────
  const handleStart = useCallback(() => {
    setCameraError(null);
    setPhase("camera");
    setIsScanning(true);
  }, []);

  // Cleanup
  useEffect(() => () => {
    setIsScanning(false);
    if (graceRef.current) clearTimeout(graceRef.current);
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <main className="relative w-full min-h-screen bg-[#07030f] overflow-hidden flex flex-col">
      <canvas ref={captureCanvasRef} className="hidden" />

      {/* ── ARScanner (owns camera + MindAR) ── */}
      {phase !== "idle" && (
        <ARScanner
          isScanning={isScanning}
          activeTargetIndex={
            matchedTarget
              ? (RECOGNITION_TARGETS.find(r => r.id === matchedTarget.id)?.mindarTargetIndices[0] ?? null)
              : null
          }
          isMuted={isMuted}
          isMockMode={isMock}
          onTargetFound={onMindARTargetFound}
          onTargetLost={onMindARTargetLost}
          onCameraError={onCameraError}
          onSceneReady={onSceneReady}
          onTelemetryUpdate={onTelemetryUpdate}
        />
      )}

      {/* ── Full-screen video on match ── */}
      <AnimatePresence>
        {phase === "matched" && matchedTarget && (
          <motion.div
            key="video"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-30 bg-black"
          >
            <video
              ref={playVideoRef}
              autoPlay loop playsInline muted={isMuted}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/90 to-transparent pointer-events-none" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Frozen capture during analysis ── */}
      <AnimatePresence>
        {capturedUrl && phase === "analysing" && (
          <motion.img
            key="freeze"
            src={capturedUrl} alt=""
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 w-full h-full object-cover z-20"
          />
        )}
      </AnimatePresence>

      {/* ── Analysing overlay ── */}
      <AnimatePresence>
        {phase === "analysing" && (
          <motion.div
            key="analysing"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/55 backdrop-blur-sm flex flex-col items-center justify-center gap-5"
          >
            <div className="relative w-24 h-24">
              <div className="absolute inset-0 rounded-full border-4 border-pink-500/30" />
              <div className="absolute inset-0 rounded-full border-4 border-t-pink-400 border-r-rose-400 border-b-transparent border-l-transparent animate-spin" />
              <div className="absolute inset-2 rounded-full border-2 border-amber-400/40 animate-spin" style={{ animationDirection: "reverse", animationDuration: "1.4s" }} />
              <ZoomIn className="absolute inset-0 m-auto w-8 h-8 text-pink-300 animate-pulse" />
            </div>
            <p className="text-white font-bold text-sm tracking-wide">{statusText}</p>
            <div className="w-56 h-1.5 rounded-full bg-white/10 overflow-hidden">
              <motion.div
                className="h-full bg-gradient-to-r from-pink-500 to-amber-400 rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${scanProgress}%` }}
                transition={{ duration: 0.4 }}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── No match overlay ── */}
      <AnimatePresence>
        {phase === "no_match" && (
          <motion.div
            key="nomatch"
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/80 backdrop-blur-md flex flex-col items-center justify-center gap-4 p-8 text-center overflow-y-auto"
          >
            <div className="w-16 h-16 rounded-2xl bg-amber-500/20 border border-amber-500/50 flex items-center justify-center">
              <AlertCircle className="w-9 h-9 text-amber-400" />
            </div>
            <h3 className="text-xl font-bold text-white">Photo not recognised</h3>
            <p className="text-sm text-pink-200/80 max-w-xs leading-relaxed">
              Make sure the photo fills the frame and is well-lit. Hold steady and try again.
            </p>
            {debug.fallbackScores.length > 0 && (
              <div className="w-full max-w-xs bg-black/60 rounded-xl border border-purple-500/30 p-3 text-[11px] font-mono text-left space-y-2">
                <p className="text-purple-300 font-bold">Colour scores (need ≥{FALLBACK_COLOR_THRESHOLD}):</p>
                {debug.fallbackScores.slice().sort((a, b) => b.combinedScore - a.combinedScore).map(s => (
                  <div key={s.targetIndex}>
                    <div className="flex justify-between text-gray-300">
                      <span>{AR_TARGETS[s.targetIndex]?.title ?? `#${s.targetIndex}`}</span>
                      <span className={s.combinedScore >= FALLBACK_COLOR_THRESHOLD ? "text-emerald-400 font-bold" : "text-rose-400"}>{s.combinedScore}/100</span>
                    </div>
                    <div className="h-1 rounded-full bg-white/10 mt-1 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${s.combinedScore >= FALLBACK_COLOR_THRESHOLD ? "bg-emerald-400" : "bg-rose-500"}`}
                        style={{ width: `${s.combinedScore}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
            <button
              onClick={handleReset}
              className="flex items-center gap-2 px-6 py-3.5 rounded-2xl bg-gradient-to-r from-pink-500 to-rose-600 text-white font-bold text-sm shadow-xl glow-rose active:scale-[0.97] transition-all"
            >
              <RefreshCw className="w-4 h-4" /> Try Again
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Viewfinder corners (camera active) ── */}
      <AnimatePresence>
        {phase === "camera" && (
          <motion.div
            key="vf"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-20 pointer-events-none flex items-center justify-center"
          >
            <div className="relative w-72 h-72 sm:w-80 sm:h-80">
              <div className="absolute top-0 left-0 w-10 h-10 border-t-[3px] border-l-[3px] border-pink-400 rounded-tl-xl" />
              <div className="absolute top-0 right-0 w-10 h-10 border-t-[3px] border-r-[3px] border-pink-400 rounded-tr-xl" />
              <div className="absolute bottom-0 left-0 w-10 h-10 border-b-[3px] border-l-[3px] border-pink-400 rounded-bl-xl" />
              <div className="absolute bottom-0 right-0 w-10 h-10 border-b-[3px] border-r-[3px] border-pink-400 rounded-br-xl" />
              <div className="absolute left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-pink-500 to-transparent shadow-[0_0_12px_4px_rgba(236,72,153,0.7)] animate-scan-laser" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Top bar ── */}
      <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between p-4 sm:p-5">
        <Link href="/" className="flex items-center gap-2 px-3.5 py-2 rounded-full glass-panel text-sm font-medium text-pink-200 hover:text-white transition-all backdrop-blur-md">
          <ArrowLeft className="w-4 h-4" /> Home
        </Link>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowDebug(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${showDebug ? "bg-purple-600/60 text-purple-100 border border-purple-400/50" : "glass-panel text-gray-400 hover:text-white"}`}
          >
            <Bug className="w-3.5 h-3.5" /> Debug
          </button>
          <AnimatePresence>
            {phase === "matched" && (
              <motion.button
                key="mute"
                initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}
                onClick={() => setIsMuted(m => !m)}
                className={`flex items-center gap-2 px-4 py-2 rounded-full font-semibold text-xs uppercase tracking-wider shadow-lg ${isMuted ? "bg-pink-600 text-white glow-rose animate-bounce" : "bg-emerald-500/80 text-white"}`}
              >
                {isMuted ? <><VolumeX className="w-4 h-4" />🔊 Sound</> : <><Volume2 className="w-4 h-4" />On</>}
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ── Debug panel ── */}
      <AnimatePresence>
        {showDebug && (
          <motion.div
            key="debug"
            initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="fixed top-16 left-4 right-4 z-50 glass-panel rounded-2xl border border-purple-500/40 p-4 max-w-sm mx-auto max-h-[65vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold text-purple-300 uppercase tracking-wider flex items-center gap-1.5"><Bug className="w-3.5 h-3.5" /> Debug</span>
              <button onClick={() => setShowDebug(false)} className="text-gray-400 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <div className="text-[11px] font-mono space-y-1">
              <DR label="Camera"          v={debug.camera}          ok={debug.camera.startsWith("✓")} />
              <DR label="MindAR"          v={debug.mindar}          ok={debug.mindar.startsWith("✓")} />
              <DR label="Ref matcher"     v={debug.refMatcher}      ok={debug.refMatcher.startsWith("✓")} />
              <div className="my-1.5 border-t border-purple-500/20" />
              <DR label="Detected target" v={debug.detectedTarget}  ok={debug.detectedTarget !== "NONE"} bold />
              <DR label="Method"          v={debug.method} />
              <DR label="Confidence"      v={debug.confidence}      ok={parseFloat(debug.confidence) > 70} />
              {debug.agreement && <div className="text-emerald-400 text-[10px]">✓ Agreement bonus</div>}
              <DR label="Video"           v={debug.video} />
              <DR label="Status"          v={debug.status}          ok={debug.status === "PLAYING"} />
              {debug.lastRef && (
                <>
                  <div className="my-1.5 border-t border-purple-500/20" />
                  <p className="text-purple-300 font-bold mb-0.5">Last reference match:</p>
                  <DR label="Image"  v={debug.lastRef.url.split("/").pop()!} />
                  <DR label="Conf"   v={(debug.lastRef.conf * 100).toFixed(1) + "%"} ok />
                  <DR label="Region" v={debug.lastRef.region} />
                </>
              )}
              <div className="my-1.5 border-t border-purple-500/20" />
              <DR label="Scan time" v={`${debug.scanMs}ms`} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Bottom action bar ── */}
      <div className="fixed bottom-0 left-0 right-0 z-40 px-4 pb-10 pt-4 flex flex-col items-center gap-3 bg-gradient-to-t from-black via-[#07030f]/95 to-transparent pointer-events-none">
        <div className="pointer-events-auto w-full flex flex-col items-center gap-3 max-w-sm">
          <AnimatePresence mode="wait">

            {/* ── Idle: start card ── */}
            {phase === "idle" && (
              <motion.div key="idle" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="w-full">
                <div className="glass-panel rounded-3xl p-6 border border-pink-500/20 backdrop-blur-xl text-center">
                  <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-pink-500 to-rose-600 flex items-center justify-center shadow-lg glow-rose animate-float">
                    <Camera className="w-7 h-7 text-white" />
                  </div>
                  <h1 className="text-2xl font-serif font-bold text-gradient-rose mb-2">Memories Alive</h1>
                  <p className="text-xs text-pink-200/80 mb-5 leading-relaxed">
                    Point your camera at one of the special photographs and press the shutter. The right memory video will play automatically.
                  </p>
                  <button
                    onClick={handleStart}
                    className="w-full py-4 rounded-2xl bg-gradient-to-r from-pink-500 via-rose-500 to-amber-500 text-white font-bold text-sm tracking-wide shadow-xl flex items-center justify-center gap-2 glow-rose active:scale-[0.98] transition-all"
                  >
                    <Sparkles className="w-5 h-5 text-amber-200" /> OPEN CAMERA
                  </button>
                </div>
              </motion.div>
            )}

            {/* ── Camera ready: shutter button ── */}
            {phase === "camera" && (
              <motion.div key="shutter" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-3">
                <p className="text-xs text-pink-200/80 font-medium text-center">
                  Fill the frame with the photo, then press the shutter
                </p>
                <button
                  onClick={handleCapture}
                  aria-label="Take photo"
                  className="w-20 h-20 rounded-full bg-white border-4 border-pink-500/60 shadow-[0_0_30px_rgba(236,72,153,0.5)] flex items-center justify-center active:scale-90 transition-transform"
                >
                  <div className="w-14 h-14 rounded-full bg-gradient-to-br from-pink-500 via-rose-500 to-amber-400" />
                </button>
              </motion.div>
            )}

            {/* ── Matched: bottom info card + rescan ── */}
            {phase === "matched" && matchedTarget && (
              <motion.div key="matched" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="w-full">
                <div className="glass-panel rounded-2xl border border-pink-500/40 p-4 backdrop-blur-xl flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${matchedTarget.previewColor ?? "from-pink-500 to-rose-600"} flex items-center justify-center shrink-0`}>
                      <CheckCircle2 className="w-5 h-5 text-white" />
                    </div>
                    <div className="min-w-0">
                      <span className="text-[10px] uppercase tracking-widest font-bold text-pink-400 block">
                        ✨ {debug.method === "mindar" ? "MindAR" : debug.method === "reference" ? "Visual match" : "Colour match"} • {matchedTarget.badge}
                      </span>
                      <p className="text-sm font-serif font-bold text-white truncate">{matchedTarget.name}</p>
                    </div>
                  </div>
                  <button onClick={handleReset} className="shrink-0 px-3 py-2 rounded-xl glass-panel text-xs font-bold text-pink-200 hover:text-white border border-pink-500/30 flex items-center gap-1.5">
                    <RefreshCw className="w-3.5 h-3.5" /> Scan
                  </button>
                </div>
              </motion.div>
            )}

          </AnimatePresence>
        </div>
      </div>
    </main>
  );
}

// ── Tiny debug row helper ─────────────────────────────────────────────────────
function DR({ label, v, ok, bold }: { label: string; v: string; ok?: boolean; bold?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-gray-400 shrink-0">{label}:</span>
      <span className={`text-right truncate max-w-[160px] ${bold ? "font-bold " : ""}${ok === true ? "text-emerald-400" : ok === false ? "text-rose-400" : "text-gray-300"}`}>{v}</span>
    </div>
  );
}
