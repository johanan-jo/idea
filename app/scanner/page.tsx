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

// ─────────────────────────────────────────────────────────────────────────────
// Perceptual hash helper — converts an image to a 64-bit fingerprint
// using a 8×8 DCT-like average-hash (aHash). Fast enough for real-time browser use.
// ─────────────────────────────────────────────────────────────────────────────
function computeAHash(ctx: CanvasRenderingContext2D, w: number, h: number): number[] {
  // Downscale to 8×8 grayscale
  const SIZE = 8;
  const small = document.createElement("canvas");
  small.width = SIZE;
  small.height = SIZE;
  const sCtx = small.getContext("2d")!;
  sCtx.drawImage(ctx.canvas, 0, 0, w, h, 0, 0, SIZE, SIZE);
  const px = sCtx.getImageData(0, 0, SIZE, SIZE).data;

  const grays: number[] = [];
  for (let i = 0; i < px.length; i += 4) {
    grays.push(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
  }

  const avg = grays.reduce((a, b) => a + b, 0) / grays.length;
  return grays.map((g) => (g >= avg ? 1 : 0));
}

// Hamming distance between two 64-bit hashes (0 = identical, 64 = opposite)
function hammingDistance(a: number[], b: number[]): number {
  let dist = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) dist++;
  return dist;
}

// ─────────────────────────────────────────────────────────────────────────────
// Load all reference images up-front and compute their hashes
// ─────────────────────────────────────────────────────────────────────────────
async function buildReferenceHashes(): Promise<
  Array<{ targetIndex: number; hash: number[]; hasImage: boolean }>
> {
  const results: Array<{ targetIndex: number; hash: number[]; hasImage: boolean }> = [];

  for (const target of Object.values(AR_TARGETS)) {
    if (!target.targetImagePreview) {
      results.push({ targetIndex: target.targetIndex, hash: [], hasImage: false });
      continue;
    }

    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej();
        img.src = target.targetImagePreview!;
      });

      const off = document.createElement("canvas");
      off.width = img.naturalWidth;
      off.height = img.naturalHeight;
      const offCtx = off.getContext("2d")!;
      offCtx.drawImage(img, 0, 0);
      const hash = computeAHash(offCtx, off.width, off.height);
      results.push({ targetIndex: target.targetIndex, hash, hasImage: true });
    } catch {
      results.push({ targetIndex: target.targetIndex, hash: [], hasImage: false });
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

  const [phase, setPhase] = useState<ScanPhase>("idle");
  const [capturedUrl, setCapturedUrl] = useState<string | null>(null);
  const [matchedTarget, setMatchedTarget] = useState<ARTargetConfig | null>(null);
  const [isMuted, setIsMuted] = useState(true);
  const [statusText, setStatusText] = useState("");
  const [refHashes, setRefHashes] = useState<
    Array<{ targetIndex: number; hash: number[]; hasImage: boolean }>
  >([]);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scanProgress, setScanProgress] = useState(0);

  // ── Camera ──────────────────────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    setCameraError(null);
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
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

  // ── Matching ─────────────────────────────────────────────────────────────
  const runMatch = useCallback(
    async (canvas: HTMLCanvasElement) => {
      setStatusText("Scanning image...");
      setScanProgress(10);

      // Build reference hashes if not already done
      let hashes = refHashes;
      if (hashes.length === 0) {
        setStatusText("Loading reference images...");
        hashes = await buildReferenceHashes();
        setRefHashes(hashes);
      }
      setScanProgress(40);

      // Hash the captured frame
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const captureHash = computeAHash(ctx, canvas.width, canvas.height);
      setScanProgress(70);

      // Find best match (minimum Hamming distance)
      let bestIndex = -1;
      let bestDist = 999;
      const MAX_DIST = 20; // out of 64 — tune this threshold

      for (const ref of hashes) {
        if (!ref.hasImage || ref.hash.length === 0) continue;
        const dist = hammingDistance(captureHash, ref.hash);
        console.log(`[pHash] Target #${ref.targetIndex} distance: ${dist}`);
        if (dist < bestDist) {
          bestDist = dist;
          bestIndex = ref.targetIndex;
        }
      }

      setScanProgress(95);

      const hasTargetsWithImages = hashes.some((h) => h.hasImage);

      if (!hasTargetsWithImages) {
        // No reference images configured — use Target 0 as demo
        console.warn("[Match] No reference images found in AR_TARGETS config. Defaulting to Target #0 demo.");
        setMatchedTarget(AR_TARGETS[0]);
        setStatusText("✨ Memory Found!");
        setPhase("matched");
        setScanProgress(100);
        return;
      }

      if (bestIndex !== -1 && bestDist <= MAX_DIST) {
        const config = AR_TARGETS[bestIndex];
        if (config) {
          setMatchedTarget(config);
          setStatusText("✨ Memory Found!");
          setPhase("matched");
          setScanProgress(100);
          return;
        }
      }

      // No match
      setPhase("no_match");
      setStatusText("");
      setScanProgress(0);
    },
    [refHashes]
  );

  // ── Shutter ───────────────────────────────────────────────────────────────
  const handleCapture = useCallback(async () => {
    if (!liveVideoRef.current || !captureCanvasRef.current) return;

    const video = liveVideoRef.current;
    const canvas = captureCanvasRef.current;
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;

    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    setCapturedUrl(dataUrl);

    // Shutter flash then analyze
    setPhase("shutter_flash");
    await new Promise((r) => setTimeout(r, 350));
    setPhase("analyzing");
    setScanProgress(0);

    await runMatch(canvas);
  }, [runMatch]);

  // ── Auto-play matched video ───────────────────────────────────────────────
  useEffect(() => {
    if (phase === "matched" && playVideoRef.current) {
      playVideoRef.current.muted = isMuted;
      playVideoRef.current.currentTime = 0;
      playVideoRef.current.play().catch(console.warn);
    }
  }, [phase, matchedTarget, isMuted]);

  // ── Mute toggle propagate ─────────────────────────────────────────────────
  useEffect(() => {
    if (playVideoRef.current) playVideoRef.current.muted = isMuted;
  }, [isMuted]);

  // ── Cleanup ───────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => stopCamera();
  }, [stopCamera]);

  // ── Reset / scan again ────────────────────────────────────────────────────
  const handleScanAgain = useCallback(async () => {
    setCapturedUrl(null);
    setMatchedTarget(null);
    setStatusText("");
    setScanProgress(0);
    await startCamera();
  }, [startCamera]);

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <main className="relative w-full min-h-screen bg-[#07030f] overflow-hidden flex flex-col">
      {/* Hidden canvas for pixel capture */}
      <canvas ref={captureCanvasRef} className="hidden" />

      {/* ── Full-screen camera / captured / video layer ── */}
      <div className="relative flex-1 w-full flex items-stretch justify-center overflow-hidden">

        {/* Live camera feed */}
        <video
          ref={liveVideoRef}
          playsInline
          muted
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
            phase === "camera_ready" ? "opacity-100" : "opacity-0"
          }`}
        />

        {/* Captured freeze frame (shown during analyzing / no_match) */}
        <AnimatePresence>
          {capturedUrl && phase !== "matched" && (
            <motion.img
              key="captured"
              src={capturedUrl}
              alt="Captured"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 w-full h-full object-cover"
            />
          )}
        </AnimatePresence>

        {/* Shutter flash overlay */}
        <AnimatePresence>
          {phase === "shutter_flash" && (
            <motion.div
              key="flash"
              initial={{ opacity: 1 }}
              animate={{ opacity: 0 }}
              transition={{ duration: 0.35 }}
              className="absolute inset-0 bg-white z-40"
            />
          )}
        </AnimatePresence>

        {/* Matched video player */}
        <AnimatePresence>
          {phase === "matched" && matchedTarget && (
            <motion.div
              key="video-player"
              initial={{ opacity: 0, scale: 1.04 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-20"
            >
              <video
                ref={playVideoRef}
                src={matchedTarget.videoUrl}
                autoPlay
                loop
                playsInline
                muted={isMuted}
                className="w-full h-full object-cover"
              />
              {/* Gradient overlay at bottom */}
              <div className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/90 to-transparent pointer-events-none" />
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Viewfinder overlay (camera ready state) ── */}
        <AnimatePresence>
          {phase === "camera_ready" && (
            <motion.div
              key="viewfinder"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-10 pointer-events-none flex items-center justify-center"
            >
              {/* Corner brackets */}
              <div className="relative w-64 h-64 sm:w-72 sm:h-72">
                {/* Top-left */}
                <div className="absolute top-0 left-0 w-8 h-8 border-t-[3px] border-l-[3px] border-pink-400 rounded-tl-lg" />
                {/* Top-right */}
                <div className="absolute top-0 right-0 w-8 h-8 border-t-[3px] border-r-[3px] border-pink-400 rounded-tr-lg" />
                {/* Bottom-left */}
                <div className="absolute bottom-0 left-0 w-8 h-8 border-b-[3px] border-l-[3px] border-pink-400 rounded-bl-lg" />
                {/* Bottom-right */}
                <div className="absolute bottom-0 right-0 w-8 h-8 border-b-[3px] border-r-[3px] border-pink-400 rounded-br-lg" />
                {/* Scan laser line */}
                <div className="absolute left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-pink-500 to-transparent shadow-[0_0_12px_3px_rgba(236,72,153,0.7)] animate-scan-laser" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Analyzing overlay ── */}
        <AnimatePresence>
          {phase === "analyzing" && (
            <motion.div
              key="analyzing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-30 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center gap-4"
            >
              {/* Animated ring scanner */}
              <div className="relative w-24 h-24">
                <div className="absolute inset-0 rounded-full border-4 border-pink-500/30" />
                <div className="absolute inset-0 rounded-full border-4 border-t-pink-400 border-r-rose-400 border-b-transparent border-l-transparent animate-spin" />
                <div className="absolute inset-2 rounded-full border-2 border-amber-400/40 animate-spin" style={{ animationDirection: "reverse", animationDuration: "1.4s" }} />
                <ZoomIn className="absolute inset-0 m-auto w-8 h-8 text-pink-300 animate-pulse" />
              </div>

              <p className="text-white font-bold text-base tracking-wide">{statusText}</p>

              {/* Progress bar */}
              <div className="w-48 h-1 rounded-full bg-white/10 overflow-hidden">
                <motion.div
                  className="h-full bg-gradient-to-r from-pink-500 to-amber-400 rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${scanProgress}%` }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── No match overlay ── */}
        <AnimatePresence>
          {phase === "no_match" && (
            <motion.div
              key="no-match"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-30 bg-black/75 backdrop-blur-md flex flex-col items-center justify-center gap-4 p-8 text-center"
            >
              <div className="w-16 h-16 rounded-2xl bg-amber-500/20 border border-amber-500/50 flex items-center justify-center">
                <AlertCircle className="w-9 h-9 text-amber-400" />
              </div>
              <h3 className="text-xl font-bold text-white">Couldn't recognize this photo</h3>
              <p className="text-sm text-pink-200/80 max-w-xs leading-relaxed">
                Make sure the entire photograph is in frame, well-lit, and held steady.
              </p>
              <ul className="text-xs text-pink-300/70 text-left space-y-1 mt-1">
                <li>• Fill the frame with the photo</li>
                <li>• Avoid glare and shadows</li>
                <li>• Hold camera parallel to photo</li>
                <li>• Ensure good lighting</li>
              </ul>
              <button
                onClick={handleScanAgain}
                className="mt-2 flex items-center gap-2 px-6 py-3.5 rounded-2xl bg-gradient-to-r from-pink-500 to-rose-600 text-white font-bold text-sm shadow-xl glow-rose active:scale-[0.97] transition-all"
              >
                <RefreshCw className="w-4 h-4" />
                Try Again
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Error overlay ── */}
        <AnimatePresence>
          {phase === "error" && (
            <motion.div
              key="error"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-30 bg-black/80 backdrop-blur-md flex flex-col items-center justify-center gap-4 p-8 text-center"
            >
              <div className="w-16 h-16 rounded-2xl bg-rose-500/20 border border-rose-500/50 flex items-center justify-center">
                <AlertCircle className="w-9 h-9 text-rose-400" />
              </div>
              <h3 className="text-xl font-bold text-white">Camera Error</h3>
              <p className="text-sm text-rose-200/80 max-w-xs leading-relaxed">{cameraError}</p>
              <button
                onClick={startCamera}
                className="flex items-center gap-2 px-6 py-3.5 rounded-2xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-sm shadow-xl active:scale-[0.97] transition-all"
              >
                <RefreshCw className="w-4 h-4" />
                Try Again
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Top nav bar ── */}
        <div className="absolute top-0 left-0 right-0 z-50 flex items-center justify-between p-4 sm:p-5">
          <Link
            href="/"
            className="flex items-center gap-2 px-3.5 py-2 rounded-full glass-panel text-sm font-medium text-pink-200 hover:text-white transition-all backdrop-blur-md"
          >
            <ArrowLeft className="w-4 h-4" />
            Home
          </Link>

          {/* Mute control shown during video playback */}
          <AnimatePresence>
            {phase === "matched" && (
              <motion.button
                key="mute-btn"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                onClick={() => setIsMuted((m) => !m)}
                className={`flex items-center gap-2 px-4 py-2 rounded-full font-semibold text-xs uppercase tracking-wider shadow-lg transition-all ${
                  isMuted
                    ? "bg-pink-600 text-white glow-rose animate-bounce"
                    : "bg-emerald-500/80 text-white backdrop-blur-md"
                }`}
              >
                {isMuted ? (
                  <>
                    <VolumeX className="w-4 h-4" />
                    🔊 Tap for sound
                  </>
                ) : (
                  <>
                    <Volume2 className="w-4 h-4" />
                    Sound On
                  </>
                )}
              </motion.button>
            )}
          </AnimatePresence>
        </div>

        {/* ── Bottom matched card ── */}
        <AnimatePresence>
          {phase === "matched" && matchedTarget && (
            <motion.div
              key="match-card"
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              transition={{ delay: 0.3 }}
              className="absolute bottom-0 left-0 right-0 z-30 p-4 sm:p-5"
            >
              <div className="glass-panel rounded-2xl border border-pink-500/40 p-4 backdrop-blur-xl flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  {matchedTarget.targetImagePreview && (
                    <img
                      src={matchedTarget.targetImagePreview}
                      alt={matchedTarget.title}
                      className="w-12 h-12 rounded-xl object-cover border border-pink-500/40 shrink-0"
                    />
                  )}
                  <div className="min-w-0">
                    <span className="text-[10px] uppercase tracking-widest font-bold text-pink-400 block">
                      ✨ {matchedTarget.badge || `Memory #${matchedTarget.targetIndex + 1}`}
                    </span>
                    <p className="text-sm font-serif font-bold text-white truncate">{matchedTarget.title}</p>
                  </div>
                </div>
                <button
                  onClick={handleScanAgain}
                  className="shrink-0 px-3 py-2 rounded-xl glass-panel text-xs font-bold text-pink-200 hover:text-white border border-pink-500/30 flex items-center gap-1.5 transition-all"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Scan
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Bottom action bar ── */}
      <div className="relative z-40 w-full px-4 pb-8 pt-4 flex flex-col items-center gap-4 bg-gradient-to-t from-black via-[#07030f]/90 to-transparent">
        {/* Idle / Start state */}
        <AnimatePresence mode="wait">
          {phase === "idle" && (
            <motion.div
              key="start"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="w-full max-w-sm flex flex-col items-center gap-4 text-center"
            >
              <div className="glass-panel rounded-3xl p-6 border border-pink-500/20 backdrop-blur-xl w-full">
                <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-pink-500 to-rose-600 flex items-center justify-center shadow-lg glow-rose animate-float">
                  <Camera className="w-7 h-7 text-white" />
                </div>
                <h1 className="text-2xl font-serif font-bold text-gradient-rose mb-2">
                  Memories Alive
                </h1>
                <p className="text-xs text-pink-200/80 mb-5 leading-relaxed">
                  Point camera at a physical photograph, press the shutter button, and watch the memory come to life.
                </p>
                <button
                  onClick={startCamera}
                  className="w-full py-4 rounded-2xl bg-gradient-to-r from-pink-500 via-rose-500 to-amber-500 text-white font-bold text-sm tracking-wide shadow-xl flex items-center justify-center gap-2 glow-rose active:scale-[0.98] transition-all"
                >
                  <Sparkles className="w-5 h-5 text-amber-200" />
                  OPEN CAMERA & SCAN
                </button>
              </div>
            </motion.div>
          )}

          {/* Camera ready — big shutter button */}
          {phase === "camera_ready" && (
            <motion.div
              key="shutter"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-3"
            >
              <p className="text-xs text-pink-200/80 font-medium tracking-wide text-center">
                Point at a photo, then press the shutter
              </p>
              {/* Large circular shutter button */}
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
