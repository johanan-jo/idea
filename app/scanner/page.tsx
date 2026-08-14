"use client";

/**
 * Hybrid Recognition Scanner
 *
 * Architecture:
 *   MindAR (primary) → ARScanner component (owns the camera stream)
 *   Reference Matcher (secondary) → samples MindAR's <video> element via canvas
 *   Hue+dHash Fallback (tertiary) → runs when user taps "Take Photo"
 *
 * Recognition engine centralises all decisions.
 * One camera stream. No duplicates. No redundant detection.
 */

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, Bug, X, Camera, RefreshCw, Volume2, VolumeX,
  Sparkles, AlertCircle, CheckCircle2, ScanLine, ImageIcon, Info,
} from "lucide-react";

import { AR_TARGETS, ARTargetConfig, TARGET_MIND_FILE } from "@/config/arTargets";
import {
  RECOGNITION_TARGETS,
  RecognitionTarget,
  getTargetById,
  getTargetByMindarIndex,
  FALLBACK_COLOR_THRESHOLD,
} from "@/config/recognitionTargets";
import {
  ReferenceDescriptor,
  ReferenceMatchResult,
  buildReferenceDescriptors,
  matchReferenceImages,
} from "@/lib/referenceImageMatcher";
import {
  RecognitionEngine,
  RecognitionResult,
  RecognitionMethod,
} from "@/lib/recognitionEngine";
import {
  loadFallbackRef,
  computeFallbackScores,
  FallbackRef,
  FallbackMatchResult,
} from "@/lib/markerDetector";
import ARScanner, { ARTelemetryState } from "@/components/ARScanner";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
type ScanMode  = "live" | "photo";
type ScanPhase =
  | "idle"          // Not started
  | "initialising"  // Loading scripts, loading reference descriptors
  | "scanning"      // Camera active, searching
  | "matched"       // Target confidently found
  | "no_match"      // Photo captured but nothing found
  | "error";        // Fatal error

interface DebugState {
  camera: string;
  mindar: string;
  referenceMatcher: string;
  colorMatcher: string;
  detectedTarget: string;
  method: RecognitionMethod | "none";
  confidence: string;
  video: string;
  status: string;
  lastRefMatch?: { url: string; conf: number; region: string };
  fallbackScores: FallbackMatchResult[];
  frameCount: number;
  scanMs: number;
  hasAgreement: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Live-scan interval (ms) — lower = more responsive, higher = better perf
// ─────────────────────────────────────────────────────────────────────────────
const LIVE_REF_INTERVAL_MS = 700; // reference matching every 700 ms
const GRACE_PERIOD_MS      = 2500; // keep playing after target disappears

// ─────────────────────────────────────────────────────────────────────────────
export default function ScannerPage() {
  // ── Refs ──────────────────────────────────────────────────────────────────
  const frameCanvasRef     = useRef<HTMLCanvasElement>(null);
  const captureCanvasRef   = useRef<HTMLCanvasElement>(null);
  const playVideoRef       = useRef<HTMLVideoElement>(null);
  const graceTimerRef      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refScanTimerRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const engineRef          = useRef<RecognitionEngine | null>(null);
  const refDescriptorsRef  = useRef<ReferenceDescriptor[] | null>(null);
  const fallbackRefsRef    = useRef<FallbackRef[] | null>(null);
  const arVideoElRef       = useRef<HTMLVideoElement | null>(null); // MindAR's camera <video>

  // ── State ─────────────────────────────────────────────────────────────────
  const [scanMode,       setScanMode]       = useState<ScanMode>("live");
  const [phase,          setPhase]          = useState<ScanPhase>("idle");
  const [isScanning,     setIsScanning]     = useState(false);
  const [matchedTarget,  setMatchedTarget]  = useState<RecognitionTarget | null>(null);
  const [isMuted,        setIsMuted]        = useState(true);
  const [capturedUrl,    setCapturedUrl]    = useState<string | null>(null);
  const [cameraError,    setCameraError]    = useState<string | null>(null);
  const [arTelemetry,    setArTelemetry]    = useState<ARTelemetryState | null>(null);
  const [isMockMode,     setIsMockMode]     = useState(false);
  const [showDebug,      setShowDebug]      = useState(false);
  const [scanProgress,   setScanProgress]   = useState(0);
  const [statusText,     setStatusText]     = useState("");
  const [debug, setDebug] = useState<DebugState>({
    camera: "Idle", mindar: "Uninitialized", referenceMatcher: "Loading",
    colorMatcher: "Ready", detectedTarget: "NONE", method: "none",
    confidence: "—", video: "—", status: "Idle",
    fallbackScores: [], frameCount: 0, scanMs: 0, hasAgreement: false,
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Recognition Engine setup
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    engineRef.current = new RecognitionEngine({
      onTargetChanged: (result) => handleTargetFound(result),
      onTargetLost:    ()       => handleTargetLost(),
    });
  }, []); // eslint-disable-line

  // ─────────────────────────────────────────────────────────────────────────
  // Load reference descriptors at startup
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    setDebug(d => ({ ...d, referenceMatcher: "Loading…" }));
    buildReferenceDescriptors()
      .then(descs => {
        refDescriptorsRef.current = descs;
        setDebug(d => ({ ...d, referenceMatcher: descs.length > 0 ? `✓ ${descs.length} descriptors` : "✓ (no refs configured)" }));
        console.log(`[Scanner] Reference descriptors loaded: ${descs.length}`);
      })
      .catch(e => {
        setDebug(d => ({ ...d, referenceMatcher: "✗ Error loading" }));
        console.warn("[Scanner] Failed to load reference descriptors:", e);
      });
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // Find MindAR's internal <video> element (for frame capture)
  // ─────────────────────────────────────────────────────────────────────────
  const findMindARVideoElement = useCallback((): HTMLVideoElement | null => {
    if (arVideoElRef.current) return arVideoElRef.current;
    // MindAR renders a <video> into the DOM — try to locate it
    const selectors = [
      "video[webkit-playsinline]",
      "a-scene video",
      "#mindar-video",
      "video[autoplay]",
    ];
    for (const sel of selectors) {
      const el = document.querySelector<HTMLVideoElement>(sel);
      if (el && el.readyState >= 2 && el.videoWidth > 0) {
        arVideoElRef.current = el;
        return el;
      }
    }
    return null;
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // Target found / lost handlers
  // ─────────────────────────────────────────────────────────────────────────
  const handleTargetFound = useCallback((result: RecognitionResult) => {
    if (graceTimerRef.current) { clearTimeout(graceTimerRef.current); graceTimerRef.current = null; }

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
      hasAgreement: result.hasAgreement,
      lastRefMatch: result.debug.reference.detected
        ? { url: result.debug.reference.refImageUrl!, conf: result.debug.reference.confidence!, region: result.debug.reference.region! }
        : d.lastRefMatch,
    }));
  }, []);

  const handleTargetLost = useCallback(() => {
    // Start grace period before resetting
    if (graceTimerRef.current) clearTimeout(graceTimerRef.current);
    graceTimerRef.current = setTimeout(() => {
      setMatchedTarget(null);
      setPhase("scanning");
      graceTimerRef.current = null;
      setDebug(d => ({ ...d, detectedTarget: "NONE", method: "none", confidence: "—", video: "—", status: "Scanning" }));
    }, GRACE_PERIOD_MS);
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // MindAR event handlers (passed to ARScanner)
  // ─────────────────────────────────────────────────────────────────────────
  const handleMindARTargetFound = useCallback((arTarget: ARTargetConfig) => {
    engineRef.current?.ingestMindar(arTarget.targetIndex);
  }, []);

  const handleMindARTargetLost = useCallback(() => {
    engineRef.current?.ingestMindarLost();
  }, []);

  const handleCameraError = useCallback((msg: string) => {
    setCameraError(msg);
    setDebug(d => ({ ...d, camera: "✗ Error", mindar: `✗ ${msg.slice(0, 40)}` }));
  }, []);

  const handleSceneReady = useCallback(() => {
    setDebug(d => ({ ...d, mindar: "✓ Ready" }));
    setPhase("scanning");
  }, []);

  const handleTelemetryUpdate = useCallback((t: ARTelemetryState) => {
    setArTelemetry(t);
    setDebug(d => ({
      ...d,
      camera:  t.cameraStatus === "ready" ? "✓ Active" : t.cameraStatus === "error" ? "✗ Error" : t.cameraStatus,
      mindar:  t.mindarStatus  === "running" ? "✓ Running" : t.mindarStatus === "error" ? "✗ Error" : t.mindarStatus,
      status:  t.videoStatus   === "playing" ? "PLAYING" : t.trackingStatus,
    }));
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // Live reference scan — samples MindAR's camera video every LIVE_REF_INTERVAL_MS
  // ─────────────────────────────────────────────────────────────────────────
  const runLiveReferenceScan = useCallback(() => {
    if (!refDescriptorsRef.current || refDescriptorsRef.current.length === 0) return;

    const video  = findMindARVideoElement();
    const canvas = frameCanvasRef.current;
    if (!video || !canvas) return;

    const W = Math.min(480, video.videoWidth  || 480);
    const H = Math.round((video.videoHeight || 640) * W / (video.videoWidth || 480));
    canvas.width = W; canvas.height = H;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, W, H);

    const t0 = performance.now();
    const imageData = ctx.getImageData(0, 0, W, H);
    const matches = matchReferenceImages(imageData, refDescriptorsRef.current);
    const ms = Math.round(performance.now() - t0);

    setDebug(d => ({ ...d, frameCount: d.frameCount + 1, scanMs: ms }));

    if (matches.length > 0) {
      const best = matches[0];
      console.log(`[RefScan] Match: ${best.targetId} | conf:${best.confidence.toFixed(3)} | region:${best.region}`);
      engineRef.current?.ingestReferenceResult(best);
    } else {
      engineRef.current?.ingestReferenceResult(null);
    }
  }, [findMindARVideoElement]);

  // Start/stop live reference scan when scanning
  useEffect(() => {
    if (isScanning && scanMode === "live") {
      refScanTimerRef.current = setInterval(runLiveReferenceScan, LIVE_REF_INTERVAL_MS);
    } else {
      if (refScanTimerRef.current) { clearInterval(refScanTimerRef.current); refScanTimerRef.current = null; }
    }
    return () => { if (refScanTimerRef.current) clearInterval(refScanTimerRef.current); };
  }, [isScanning, scanMode, runLiveReferenceScan]);

  // ─────────────────────────────────────────────────────────────────────────
  // Video autoplay when target matched
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase === "matched" && matchedTarget && playVideoRef.current) {
      const v = playVideoRef.current;
      if (v.src !== window.location.origin + matchedTarget.videoUrl) {
        v.src = matchedTarget.videoUrl;
        v.load();
      }
      v.muted = isMuted;
      v.currentTime = 0;
      v.play().catch(console.warn);
    }
  }, [phase, matchedTarget, isMuted]);

  useEffect(() => {
    if (playVideoRef.current) playVideoRef.current.muted = isMuted;
  }, [isMuted]);

  // ─────────────────────────────────────────────────────────────────────────
  // Photo mode — capture + run all matchers
  // ─────────────────────────────────────────────────────────────────────────
  const handleCapture = useCallback(async () => {
    const video  = findMindARVideoElement();
    const canvas = captureCanvasRef.current;
    if (!video || !canvas) return;

    canvas.width  = video.videoWidth  || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    setCapturedUrl(canvas.toDataURL("image/jpeg", 0.9));

    setPhase("no_match"); // interim
    setScanProgress(0);
    setStatusText("Scanning for reference image…");
    engineRef.current?.reset();

    const captureData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let matched = false;

    // ── Step 1: Reference image matching ──────────────────────────────────
    setScanProgress(25);
    if (refDescriptorsRef.current && refDescriptorsRef.current.length > 0) {
      const refMatches = matchReferenceImages(captureData, refDescriptorsRef.current);
      if (refMatches.length > 0) {
        engineRef.current?.ingestReferenceResult(refMatches[0]);
        matched = true;
      }
    }

    // ── Step 2: Colour / hash fallback ────────────────────────────────────
    if (!matched) {
      setStatusText("Trying colour/structure matching…");
      setScanProgress(55);

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

    setScanProgress(100);

    if (!matched) {
      setPhase("no_match");
      setStatusText("");
    }
  }, [findMindARVideoElement]);

  // ─────────────────────────────────────────────────────────────────────────
  // Start scanning
  // ─────────────────────────────────────────────────────────────────────────
  const handleStart = useCallback((mode: ScanMode) => {
    setScanMode(mode);
    setPhase("initialising");
    setIsScanning(true);
    setCameraError(null);
    setCapturedUrl(null);
    setMatchedTarget(null);
    engineRef.current?.reset();
    setTimeout(() => setPhase("scanning"), 500);
  }, []);

  const handleReset = useCallback(() => {
    setCapturedUrl(null);
    setMatchedTarget(null);
    engineRef.current?.reset();
    if (graceTimerRef.current) { clearTimeout(graceTimerRef.current); graceTimerRef.current = null; }
    setDebug(d => ({ ...d, detectedTarget: "NONE", method: "none", confidence: "—", video: "—", status: "Scanning", fallbackScores: [], lastRefMatch: undefined, hasAgreement: false }));
    setPhase("scanning");
  }, []);

  // Detect mock mode (no camera available / desktop)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const ua = navigator.userAgent.toLowerCase();
    const isDesktop = !(/android|iphone|ipad|ipod|mobile/i.test(ua));
    setIsMockMode(isDesktop && !window.location.search.includes("force-ar"));
  }, []);

  // Cleanup on unmount
  useEffect(() => () => {
    setIsScanning(false);
    if (refScanTimerRef.current) clearInterval(refScanTimerRef.current);
    if (graceTimerRef.current)   clearTimeout(graceTimerRef.current);
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  const isActive = phase !== "idle";

  return (
    <main className="relative w-full min-h-screen bg-[#07030f] overflow-hidden flex flex-col">
      {/* Hidden canvases for frame capture */}
      <canvas ref={frameCanvasRef}   className="hidden" />
      <canvas ref={captureCanvasRef} className="hidden" />

      {/* ── ARScanner — owns camera + MindAR ── */}
      {isActive && (
        <ARScanner
          isScanning={isScanning}
          activeTargetIndex={matchedTarget
            ? RECOGNITION_TARGETS.find(r => r.id === matchedTarget.id)?.mindarTargetIndices[0] ?? null
            : null}
          isMuted={isMuted}
          isMockMode={isMockMode}
          onTargetFound={handleMindARTargetFound}
          onTargetLost={handleMindARTargetLost}
          onCameraError={handleCameraError}
          onSceneReady={handleSceneReady}
          onTelemetryUpdate={handleTelemetryUpdate}
        />
      )}

      {/* ── Matched video (photo mode: full screen above AR scene) ── */}
      <AnimatePresence>
        {phase === "matched" && matchedTarget && scanMode === "photo" && (
          <motion.div
            key="video-photo"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
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

      {/* ── Captured freeze frame (photo mode analysis) ── */}
      <AnimatePresence>
        {capturedUrl && phase === "no_match" && scanMode === "photo" && (
          <motion.img
            key="cap"
            src={capturedUrl} alt=""
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 w-full h-full object-cover z-25"
          />
        )}
      </AnimatePresence>

      {/* ── Viewfinder overlay (live scan) ── */}
      <AnimatePresence>
        {phase === "scanning" && scanMode === "live" && !isMockMode && (
          <motion.div
            key="live-vf"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-20 pointer-events-none flex flex-col items-center justify-center"
          >
            <div className="relative w-72 h-72 sm:w-80 sm:h-80">
              <div className="absolute top-0 left-0 w-10 h-10 border-t-[3px] border-l-[3px] border-pink-400 rounded-tl-xl" />
              <div className="absolute top-0 right-0 w-10 h-10 border-t-[3px] border-r-[3px] border-pink-400 rounded-tr-xl" />
              <div className="absolute bottom-0 left-0 w-10 h-10 border-b-[3px] border-l-[3px] border-pink-400 rounded-bl-xl" />
              <div className="absolute bottom-0 right-0 w-10 h-10 border-b-[3px] border-r-[3px] border-pink-400 rounded-br-xl" />
              <div className="absolute left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-pink-500 to-transparent shadow-[0_0_12px_4px_rgba(236,72,153,0.7)] animate-scan-laser" />
            </div>
            <p className="mt-6 text-xs text-pink-200/80 font-medium tracking-wide">
              Scanning… point at one of the special photos
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Live scan: inset video when matched ── */}
      <AnimatePresence>
        {phase === "matched" && matchedTarget && scanMode === "live" && (
          <motion.div
            key="video-live"
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="fixed bottom-36 left-4 right-4 z-30 rounded-2xl overflow-hidden border-2 border-pink-500/50 shadow-[0_0_30px_rgba(236,72,153,0.35)]"
            style={{ maxHeight: "38vh" }}
          >
            <video
              ref={playVideoRef}
              autoPlay loop playsInline muted={isMuted}
              className="w-full object-cover"
              style={{ maxHeight: "38vh" }}
            />
            <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/80 to-transparent pointer-events-none" />
            <div className="absolute bottom-2 left-3 right-3 flex items-center justify-between">
              <div>
                <span className="text-[9px] uppercase tracking-widest font-bold text-pink-400">
                  ✨ {matchedTarget.badge}
                </span>
                <p className="text-xs font-serif font-bold text-white">{matchedTarget.name}</p>
              </div>
              <button
                onClick={() => setIsMuted(m => !m)}
                className={`px-2.5 py-1 rounded-full text-[10px] font-bold transition-all ${isMuted ? "bg-pink-600/80 text-white" : "bg-emerald-500/80 text-white"}`}
              >
                {isMuted ? "🔊" : "🔇"}
              </button>
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
            <h3 className="text-xl font-bold text-white">No matching photo detected</h3>
            <p className="text-sm text-pink-200/80 max-w-xs leading-relaxed">
              Try moving closer and make sure the reference symbol/gesture is visible and well-lit.
            </p>
            <ul className="text-xs text-pink-300/70 text-left space-y-1 max-w-xs">
              <li>• Avoid shadows or glare on the photo</li>
              <li>• Fill the frame with the entire photograph</li>
              <li>• Good, even lighting works best</li>
              <li>• Make sure the reference image is included in the config</li>
            </ul>

            {/* Show colour fallback scores for debugging */}
            {debug.fallbackScores.length > 0 && (
              <div className="w-full max-w-xs bg-black/60 rounded-xl border border-purple-500/30 p-3 text-[11px] font-mono text-left space-y-2">
                <p className="text-purple-300 font-bold">Colour match scores (need ≥{FALLBACK_COLOR_THRESHOLD}):</p>
                {debug.fallbackScores.slice().sort((a,b) => b.combinedScore - a.combinedScore).map(s => (
                  <div key={s.targetIndex}>
                    <div className="flex justify-between text-gray-300">
                      <span>{AR_TARGETS[s.targetIndex]?.title ?? `#${s.targetIndex}`}</span>
                      <span className={s.combinedScore >= FALLBACK_COLOR_THRESHOLD ? "text-emerald-400 font-bold" : "text-rose-400"}>
                        {s.combinedScore}/100
                      </span>
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

      {/* ── Error overlay ── */}
      <AnimatePresence>
        {cameraError && (
          <motion.div
            key="error"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed bottom-40 left-4 right-4 z-50 glass-panel rounded-2xl border border-rose-500/40 p-4 text-sm text-rose-200"
          >
            <p className="font-bold text-rose-400 mb-1 flex items-center gap-2"><AlertCircle className="w-4 h-4" /> MindAR unavailable</p>
            <p className="text-xs opacity-80">{cameraError}</p>
            <p className="text-xs mt-1 text-pink-300">Reference matching and colour fallback are still active.</p>
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
            {phase === "matched" && scanMode === "photo" && (
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

      {/* ── Debug Panel ── */}
      <AnimatePresence>
        {showDebug && (
          <motion.div
            key="debug"
            initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="fixed top-16 left-4 right-4 z-50 glass-panel rounded-2xl border border-purple-500/40 p-4 max-w-sm mx-auto max-h-[70vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold text-purple-300 uppercase tracking-wider flex items-center gap-1.5">
                <Bug className="w-3.5 h-3.5" /> Recognition Debug
              </span>
              <button onClick={() => setShowDebug(false)} className="text-gray-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="text-[11px] font-mono space-y-1.5">
              {/* System status */}
              <div className="pb-1 border-b border-purple-500/20">
                <DebugRow label="Camera"            value={debug.camera}           ok={debug.camera.startsWith("✓")} />
                <DebugRow label="MindAR"            value={debug.mindar}           ok={debug.mindar.startsWith("✓")} />
                <DebugRow label="Reference matcher" value={debug.referenceMatcher} ok={debug.referenceMatcher.startsWith("✓")} />
                <DebugRow label="Colour matcher"    value={debug.colorMatcher}     ok />
              </div>
              {/* Detection result */}
              <div className="py-1 border-b border-purple-500/20">
                <DebugRow label="Detected target" value={debug.detectedTarget} bold ok={debug.detectedTarget !== "NONE"} />
                <DebugRow label="Method"          value={debug.method}         />
                <DebugRow label="Confidence"      value={debug.confidence}     ok={parseFloat(debug.confidence) > 70} />
                {debug.hasAgreement && (
                  <div className="text-emerald-400 text-[10px]">✓ Agreement bonus applied</div>
                )}
                <DebugRow label="Video"  value={debug.video}  />
                <DebugRow label="Status" value={debug.status} ok={debug.status === "PLAYING"} />
              </div>
              {/* Reference match detail */}
              {debug.lastRefMatch && (
                <div className="py-1 border-b border-purple-500/20">
                  <p className="text-purple-300 font-bold mb-1">Last reference match:</p>
                  <DebugRow label="Image"      value={debug.lastRefMatch.url.split("/").pop()!} />
                  <DebugRow label="Confidence" value={(debug.lastRefMatch.conf * 100).toFixed(1) + "%"} ok />
                  <DebugRow label="Region"     value={debug.lastRefMatch.region} />
                </div>
              )}
              {/* Performance */}
              <div className="pt-1">
                <DebugRow label="Frames scanned" value={String(debug.frameCount)} />
                <DebugRow label="Last scan"      value={`${debug.scanMs}ms`} />
                <p className="text-purple-400/60 text-[10px] mt-1">Ref scan every {LIVE_REF_INTERVAL_MS}ms</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Bottom action bar ── */}
      <div className="fixed bottom-0 left-0 right-0 z-40 w-full px-4 pb-10 pt-4 flex flex-col items-center gap-3 bg-gradient-to-t from-black via-[#07030f]/95 to-transparent pointer-events-none">
        <div className="pointer-events-auto w-full flex flex-col items-center gap-3">

          {/* Mode tabs (when active) */}
          {isActive && (
            <div className="flex items-center gap-1 p-1 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-md">
              <button
                onClick={() => { setScanMode("live"); handleReset(); }}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all ${scanMode === "live" ? "bg-pink-600 text-white shadow-md" : "text-gray-400 hover:text-white"}`}
              >
                <ScanLine className="w-3.5 h-3.5" /> Live
              </button>
              <button
                onClick={() => setScanMode("photo")}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all ${scanMode === "photo" ? "bg-pink-600 text-white shadow-md" : "text-gray-400 hover:text-white"}`}
              >
                <ImageIcon className="w-3.5 h-3.5" /> Photo
              </button>
            </div>
          )}

          <AnimatePresence mode="wait">

            {/* Idle — start card */}
            {phase === "idle" && (
              <motion.div
                key="start"
                initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="w-full max-w-sm"
              >
                <div className="glass-panel rounded-3xl p-6 border border-pink-500/20 backdrop-blur-xl text-center">
                  <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-pink-500 to-rose-600 flex items-center justify-center shadow-lg glow-rose animate-float">
                    <Camera className="w-7 h-7 text-white" />
                  </div>
                  <h1 className="text-2xl font-serif font-bold text-gradient-rose mb-2">Memories Alive</h1>
                  <p className="text-xs text-pink-200/80 mb-5 leading-relaxed">
                    Point your camera at a physical photograph. The system recognises it using MindAR, visual feature matching, or colour analysis and plays the linked memory video.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleStart("live")}
                      className="flex-1 py-3.5 rounded-2xl bg-gradient-to-r from-pink-500 to-rose-600 text-white font-bold text-xs tracking-wide shadow-xl flex items-center justify-center gap-1.5 glow-rose active:scale-[0.98] transition-all"
                    >
                      <ScanLine className="w-4 h-4" /> Live Scan
                    </button>
                    <button
                      onClick={() => handleStart("photo")}
                      className="flex-1 py-3.5 rounded-2xl glass-panel border border-pink-500/30 text-pink-200 font-bold text-xs tracking-wide flex items-center justify-center gap-1.5 active:scale-[0.98] transition-all"
                    >
                      <ImageIcon className="w-4 h-4" /> Take Photo
                    </button>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Live scan status */}
            {scanMode === "live" && (phase === "scanning" || phase === "matched") && (
              <motion.div
                key="live-status"
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="flex flex-col items-center gap-2"
              >
                <div className={`flex items-center gap-2 px-4 py-2.5 rounded-full text-xs font-bold shadow-lg backdrop-blur-md ${phase === "matched" ? "bg-emerald-500/90 text-white" : "bg-pink-600/80 text-white"}`}>
                  {phase === "matched"
                    ? <><CheckCircle2 className="w-4 h-4" /> {matchedTarget?.name} — Playing</>
                    : <><div className="w-2 h-2 rounded-full bg-white animate-pulse" /> Scanning for photo…</>
                  }
                </div>
                {phase === "matched" && (
                  <button onClick={handleReset} className="text-xs text-pink-300 hover:text-white flex items-center gap-1">
                    <RefreshCw className="w-3 h-3" /> Reset scanner
                  </button>
                )}
              </motion.div>
            )}

            {/* Photo mode shutter */}
            {scanMode === "photo" && (phase === "scanning" || phase === "initialising") && (
              <motion.div
                key="shutter"
                initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="flex flex-col items-center gap-3"
              >
                <p className="text-xs text-pink-200/80 font-medium text-center">
                  Frame the photo, then press the shutter
                </p>
                <button
                  onClick={handleCapture}
                  aria-label="Capture"
                  className="w-20 h-20 rounded-full bg-white border-4 border-pink-500/60 shadow-[0_0_30px_rgba(236,72,153,0.5)] flex items-center justify-center active:scale-90 transition-transform"
                >
                  <div className="w-14 h-14 rounded-full bg-gradient-to-br from-pink-500 via-rose-500 to-amber-400" />
                </button>
              </motion.div>
            )}

            {/* Photo mode matched card */}
            {scanMode === "photo" && phase === "matched" && matchedTarget && (
              <motion.div
                key="photo-matched"
                initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="w-full max-w-sm"
              >
                <div className="glass-panel rounded-2xl border border-pink-500/40 p-4 backdrop-blur-xl flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${matchedTarget.previewColor ?? "from-pink-500 to-rose-600"} flex items-center justify-center shrink-0`}>
                      <CheckCircle2 className="w-5 h-5 text-white" />
                    </div>
                    <div className="min-w-0">
                      <span className="text-[10px] uppercase tracking-widest font-bold text-pink-400 block">
                        ✨ {debug.method === "mindar" ? "MindAR" : debug.method === "reference" ? "Reference image" : "Colour match"}
                      </span>
                      <p className="text-sm font-serif font-bold text-white truncate">{matchedTarget.name}</p>
                    </div>
                  </div>
                  <button
                    onClick={handleReset}
                    className="shrink-0 px-3 py-2 rounded-xl glass-panel text-xs font-bold text-pink-200 hover:text-white border border-pink-500/30 flex items-center gap-1.5"
                  >
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

// ─────────────────────────────────────────────────────────────────────────────
// Helper component
// ─────────────────────────────────────────────────────────────────────────────
function DebugRow({ label, value, ok, bold }: { label: string; value: string; ok?: boolean; bold?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-gray-400">{label}:</span>
      <span className={`text-right truncate max-w-[160px] ${bold ? "font-bold " : ""}${ok === true ? "text-emerald-400" : ok === false ? "text-rose-400" : "text-gray-300"}`}>
        {value}
      </span>
    </div>
  );
}
