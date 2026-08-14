"use client";

/**
 * Clean, Full-Screen Photo-Capture Scanner
 *
 * Uses native HTML5 Camera (getUserMedia) for 100% reliable full-screen capture
 * without A-Frame / MindAR canvas conflicts or blank screens.
 *
 * Recognition Pipeline:
 *   1. User points camera at physical photo
 *   2. User taps shutter button
 *   3. Frame analyzed via 60% HOG Structure + 40% Color Distribution
 *   4. Highest scoring target (>= 60%) plays its linked video
 *
 * Target Mapping:
 *   Photo 1 (Spider-Man)  -> /videos/video1.mp4
 *   Photo 2 (Sai Baba)    -> /videos/video2.mp4
 *   Photo 3 (Girls + 👍)  -> /videos/video3.mp4
 *   Photo 4 (Birthday)    -> /videos/video4.mp4
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, Bug, X, Camera, RefreshCw,
  Volume2, VolumeX, Sparkles, AlertCircle, CheckCircle2, ZoomIn,
} from "lucide-react";

import {
  RECOGNITION_TARGETS,
  getTargetById,
} from "@/config/recognitionTargets";
import type { RecognitionTarget } from "@/config/recognitionTargets";
import {
  buildReferenceDescriptors,
  matchReferenceImages,
} from "@/lib/referenceImageMatcher";
import type { ReferenceDescriptor, ReferenceMatchResult } from "@/lib/referenceImageMatcher";

type Phase =
  | "idle"        // Start page
  | "camera"      // Native camera active
  | "analysing"   // Photo captured, running feature + color matcher
  | "matched"     // Match found -> video playing
  | "no_match"    // No confident match
  | "error";      // Permission error

interface DebugState {
  camera: string;
  refMatcher: string;
  detectedTarget: string;
  confidence: string;
  video: string;
  status: string;
  matches: ReferenceMatchResult[];
  scanMs: number;
}

const INIT_DEBUG: DebugState = {
  camera: "Idle",
  refMatcher: "Loading",
  detectedTarget: "NONE",
  confidence: "—",
  video: "—",
  status: "Idle",
  matches: [],
  scanMs: 0,
};

export default function ScannerPage() {
  const videoRef         = useRef<HTMLVideoElement>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement>(null);
  const playVideoRef     = useRef<HTMLVideoElement>(null);
  const streamRef        = useRef<MediaStream | null>(null);
  const refDescsRef      = useRef<ReferenceDescriptor[] | null>(null);

  const [phase,         setPhase]         = useState<Phase>("idle");
  const [matchedTarget, setMatchedTarget] = useState<RecognitionTarget | null>(null);
  const [capturedUrl,   setCapturedUrl]   = useState<string | null>(null);
  const [isMuted,       setIsMuted]       = useState(true);
  const [cameraError,   setCameraError]   = useState<string | null>(null);
  const [scanProgress,  setScanProgress]  = useState(0);
  const [statusText,    setStatusText]    = useState("");
  const [showDebug,     setShowDebug]     = useState(false);
  const [debug,         setDebug]         = useState<DebugState>(INIT_DEBUG);

  // Pre-load reference image descriptors on startup
  useEffect(() => {
    buildReferenceDescriptors()
      .then(descs => {
        refDescsRef.current = descs;
        setDebug(d => ({ ...d, refMatcher: `✓ ${descs.length} references ready` }));
        console.log(`[Scanner] Loaded ${descs.length} reference descriptors.`);
      })
      .catch(err => {
        setDebug(d => ({ ...d, refMatcher: "✗ Load error" }));
        console.warn("[Scanner] Reference loading error:", err);
      });
  }, []);

  // ── Native Camera Management ──────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920, min: 640 },
          height: { ideal: 1080, min: 480 },
        },
        audio: false,
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setDebug(d => ({ ...d, camera: "✓ Live (Native)" }));
      setPhase("camera");
    } catch (err: any) {
      console.error("Camera startup error:", err);
      const msg = err.name === "NotAllowedError"
        ? "Camera permission denied. Please allow camera access in your browser settings."
        : `Camera error: ${err.message || "Failed to start camera."}`;
      setCameraError(msg);
      setDebug(d => ({ ...d, camera: "✗ Error" }));
      setPhase("error");
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  // ── Photo Capture & Feature Matching ──────────────────────────────────────
  const handleCapture = useCallback(async () => {
    const video = videoRef.current;
    const canvas = captureCanvasRef.current;
    if (!video || !canvas || video.videoWidth === 0) {
      console.warn("[Scanner] Video stream not ready for capture.");
      return;
    }

    // Capture crisp frame at native resolution
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    setCapturedUrl(dataUrl);

    setPhase("analysing");
    setScanProgress(30);
    setStatusText("Analyzing visual patterns & colors…");

    const t0 = performance.now();
    const captureData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    if (!refDescsRef.current || refDescsRef.current.length === 0) {
      refDescsRef.current = await buildReferenceDescriptors();
    }

    setScanProgress(75);
    setStatusText("Matching photo against memories…");

    const matches = matchReferenceImages(captureData, refDescsRef.current);
    const ms = Math.round(performance.now() - t0);

    setScanProgress(100);

    if (matches.length > 0) {
      const best = matches[0];
      const target = getTargetById(best.targetId);

      if (target) {
        console.log(`[Scanner] ✅ Matched: ${target.name} (${target.id}) -> ${target.videoUrl} [Score: ${(best.confidence * 100).toFixed(1)}%]`);
        setMatchedTarget(target);
        setPhase("matched");
        setDebug(d => ({
          ...d,
          detectedTarget: target.name,
          confidence: `${(best.confidence * 100).toFixed(1)}%`,
          video: target.videoUrl.split("/").pop() ?? target.videoUrl,
          status: "PLAYING",
          matches,
          scanMs: ms,
        }));
        return;
      }
    }

    // No confident match
    console.log("[Scanner] ❌ No confident match found.");
    setPhase("no_match");
    setStatusText("");
    setDebug(d => ({
      ...d,
      detectedTarget: "NONE",
      confidence: "—",
      video: "—",
      status: "No Match",
      matches,
      scanMs: ms,
    }));
  }, []);

  // Video Autoplay
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

  const handleReset = useCallback(() => {
    setCapturedUrl(null);
    setMatchedTarget(null);
    setDebug(d => ({
      ...d,
      detectedTarget: "NONE",
      confidence: "—",
      video: "—",
      status: "Scanning",
      matches: [],
    }));
    setPhase("camera");
  }, []);

  const handleStart = useCallback(() => {
    setCameraError(null);
    startCamera();
  }, [startCamera]);

  return (
    <main className="relative w-full h-screen min-h-screen bg-black overflow-hidden flex flex-col">
      <canvas ref={captureCanvasRef} className="hidden" />

      {/* ── Real Fullscreen Native Camera Video ── */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={`fixed inset-0 w-full h-full object-cover z-10 transition-opacity duration-300 ${
          phase === "camera" ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      />

      {/* ── Matched Video Fullscreen Overlay ── */}
      <AnimatePresence>
        {phase === "matched" && matchedTarget && (
          <motion.div
            key="video"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-30 bg-black"
          >
            <video
              ref={playVideoRef}
              autoPlay
              loop
              playsInline
              muted={isMuted}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/90 to-transparent pointer-events-none" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Snapshot Freeze Frame During Analysis ── */}
      <AnimatePresence>
        {capturedUrl && phase === "analysing" && (
          <motion.img
            key="freeze"
            src={capturedUrl}
            alt="Captured photo"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 w-full h-full object-cover z-20"
          />
        )}
      </AnimatePresence>

      {/* ── Analysis Spinner ── */}
      <AnimatePresence>
        {phase === "analysing" && (
          <motion.div
            key="analysing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center gap-5"
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
                transition={{ duration: 0.3 }}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── No Match Overlay ── */}
      <AnimatePresence>
        {phase === "no_match" && (
          <motion.div
            key="nomatch"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/85 backdrop-blur-md flex flex-col items-center justify-center gap-4 p-8 text-center"
          >
            <div className="w-16 h-16 rounded-2xl bg-amber-500/20 border border-amber-500/50 flex items-center justify-center">
              <AlertCircle className="w-9 h-9 text-amber-400" />
            </div>
            <h3 className="text-xl font-bold text-white">Photo not recognised</h3>
            <p className="text-sm text-pink-200/80 max-w-xs leading-relaxed">
              Make sure the photo is well-lit and fills the viewfinder frame. Hold steady and try again.
            </p>
            <button
              onClick={handleReset}
              className="flex items-center gap-2 px-6 py-3.5 rounded-2xl bg-gradient-to-r from-pink-500 to-rose-600 text-white font-bold text-sm shadow-xl glow-rose active:scale-[0.97] transition-all cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" /> Try Again
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Error Overlay ── */}
      <AnimatePresence>
        {phase === "error" && (
          <motion.div
            key="error"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/90 flex flex-col items-center justify-center p-6 text-center"
          >
            <AlertCircle className="w-12 h-12 text-rose-400 mb-3" />
            <h3 className="text-lg font-bold text-white mb-2">Camera Access Error</h3>
            <p className="text-xs text-rose-200/80 max-w-sm mb-6">{cameraError}</p>
            <button
              onClick={handleStart}
              className="px-6 py-3 rounded-2xl bg-gradient-to-r from-pink-500 to-rose-600 text-white font-bold text-xs"
            >
              Retry Camera
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Viewfinder Overlay ── */}
      <AnimatePresence>
        {phase === "camera" && (
          <motion.div
            key="vf"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-20 pointer-events-none flex items-center justify-center"
          >
            <div className="relative w-72 h-72 sm:w-84 sm:h-84">
              <div className="absolute top-0 left-0 w-10 h-10 border-t-[3px] border-l-[3px] border-pink-400 rounded-tl-xl" />
              <div className="absolute top-0 right-0 w-10 h-10 border-t-[3px] border-r-[3px] border-pink-400 rounded-tr-xl" />
              <div className="absolute bottom-0 left-0 w-10 h-10 border-b-[3px] border-l-[3px] border-pink-400 rounded-bl-xl" />
              <div className="absolute bottom-0 right-0 w-10 h-10 border-b-[3px] border-r-[3px] border-pink-400 rounded-br-xl" />
              <div className="absolute left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-pink-500 to-transparent shadow-[0_0_12px_4px_rgba(236,72,153,0.7)] animate-scan-laser" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Top Bar ── */}
      <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between p-4 sm:p-5">
        <Link
          href="/"
          className="flex items-center gap-2 px-3.5 py-2 rounded-full glass-panel text-sm font-medium text-pink-200 hover:text-white transition-all backdrop-blur-md"
        >
          <ArrowLeft className="w-4 h-4" /> Home
        </Link>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowDebug(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all cursor-pointer ${
              showDebug ? "bg-purple-600/60 text-purple-100 border border-purple-400/50" : "glass-panel text-gray-400 hover:text-white"
            }`}
          >
            <Bug className="w-3.5 h-3.5" /> Debug
          </button>
          <AnimatePresence>
            {phase === "matched" && (
              <motion.button
                key="mute"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                onClick={() => setIsMuted(m => !m)}
                className={`flex items-center gap-2 px-4 py-2 rounded-full font-semibold text-xs uppercase tracking-wider shadow-lg cursor-pointer ${
                  isMuted ? "bg-pink-600 text-white glow-rose animate-bounce" : "bg-emerald-500/80 text-white"
                }`}
              >
                {isMuted ? <><VolumeX className="w-4 h-4" />🔊 Sound</> : <><Volume2 className="w-4 h-4" />On</>}
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ── Diagnostic Debug Panel ── */}
      <AnimatePresence>
        {showDebug && (
          <motion.div
            key="debug"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="fixed top-16 left-4 right-4 z-50 glass-panel rounded-2xl border border-purple-500/40 p-4 max-w-sm mx-auto max-h-[65vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold text-purple-300 uppercase tracking-wider flex items-center gap-1.5">
                <Bug className="w-3.5 h-3.5" /> Diagnostic Panel
              </span>
              <button onClick={() => setShowDebug(false)} className="text-gray-400 hover:text-white cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="text-[11px] font-mono space-y-1">
              <DR label="Camera"          v={debug.camera}          ok={debug.camera.startsWith("✓")} />
              <DR label="Ref Matcher"     v={debug.refMatcher}      ok={debug.refMatcher.startsWith("✓")} />
              <div className="my-1.5 border-t border-purple-500/20" />
              <DR label="Detected Target" v={debug.detectedTarget}  ok={debug.detectedTarget !== "NONE"} bold />
              <DR label="Confidence"      v={debug.confidence}      ok={parseFloat(debug.confidence) > 60} />
              <DR label="Video"           v={debug.video} />
              <DR label="Status"          v={debug.status}          ok={debug.status === "PLAYING"} />
              <div className="my-1.5 border-t border-purple-500/20" />
              <DR label="Analysis Time"   v={`${debug.scanMs}ms`} />
              {debug.matches.length > 0 && (
                <div className="pt-2">
                  <p className="text-purple-300 font-bold mb-1">Ranked Matches:</p>
                  {debug.matches.map((m, i) => (
                    <div key={i} className="flex justify-between text-[10px] text-gray-300">
                      <span>{m.targetId} ({m.region})</span>
                      <span className="text-emerald-400">{(m.confidence * 100).toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Bottom Action Controls ── */}
      <div className="fixed bottom-0 left-0 right-0 z-40 px-4 pb-10 pt-4 flex flex-col items-center gap-3 bg-gradient-to-t from-black via-black/80 to-transparent pointer-events-none">
        <div className="pointer-events-auto w-full flex flex-col items-center gap-3 max-w-sm">
          <AnimatePresence mode="wait">

            {/* Landing: Open Camera */}
            {phase === "idle" && (
              <motion.div key="idle" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="w-full">
                <div className="glass-panel rounded-3xl p-6 border border-pink-500/20 backdrop-blur-xl text-center">
                  <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-pink-500 to-rose-600 flex items-center justify-center shadow-lg glow-rose animate-float">
                    <Camera className="w-7 h-7 text-white" />
                  </div>
                  <h1 className="text-2xl font-serif font-bold text-gradient-rose mb-2">Memories Alive</h1>
                  <p className="text-xs text-pink-200/80 mb-5 leading-relaxed">
                    Point your camera at one of the physical photographs and press the shutter. The linked memory video will play automatically.
                  </p>
                  <button
                    onClick={handleStart}
                    className="w-full py-4 rounded-2xl bg-gradient-to-r from-pink-500 via-rose-500 to-amber-500 text-white font-bold text-sm tracking-wide shadow-xl flex items-center justify-center gap-2 glow-rose active:scale-[0.98] transition-all cursor-pointer"
                  >
                    <Sparkles className="w-5 h-5 text-amber-200" /> OPEN CAMERA
                  </button>
                </div>
              </motion.div>
            )}

            {/* Camera Viewfinder: Shutter Button */}
            {phase === "camera" && (
              <motion.div key="shutter" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-3">
                <p className="text-xs text-pink-200/90 font-medium text-center drop-shadow-md">
                  Frame the photo inside the corners, then tap
                </p>
                <button
                  onClick={handleCapture}
                  aria-label="Take photo"
                  className="w-20 h-20 rounded-full bg-white border-4 border-pink-500/60 shadow-[0_0_30px_rgba(236,72,153,0.5)] flex items-center justify-center active:scale-90 transition-transform cursor-pointer"
                >
                  <div className="w-14 h-14 rounded-full bg-gradient-to-br from-pink-500 via-rose-500 to-amber-400" />
                </button>
              </motion.div>
            )}

            {/* Matched State Card */}
            {phase === "matched" && matchedTarget && (
              <motion.div key="matched" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="w-full">
                <div className="glass-panel rounded-2xl border border-pink-500/40 p-4 backdrop-blur-xl flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${matchedTarget.previewColor ?? "from-pink-500 to-rose-600"} flex items-center justify-center shrink-0`}>
                      <CheckCircle2 className="w-5 h-5 text-white" />
                    </div>
                    <div className="min-w-0">
                      <span className="text-[10px] uppercase tracking-widest font-bold text-pink-400 block">
                        ✨ {matchedTarget.badge}
                      </span>
                      <p className="text-sm font-serif font-bold text-white truncate">{matchedTarget.name}</p>
                    </div>
                  </div>
                  <button
                    onClick={handleReset}
                    className="shrink-0 px-3 py-2 rounded-xl glass-panel text-xs font-bold text-pink-200 hover:text-white border border-pink-500/30 flex items-center gap-1.5 cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> Scan Another
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

function DR({ label, v, ok, bold }: { label: string; v: string; ok?: boolean; bold?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-gray-400 shrink-0">{label}:</span>
      <span className={`text-right truncate max-w-[160px] ${bold ? "font-bold " : ""}${ok === true ? "text-emerald-400" : ok === false ? "text-rose-400" : "text-gray-300"}`}>
        {v}
      </span>
    </div>
  );
}
