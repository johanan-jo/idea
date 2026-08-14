"use client";

/**
 * Hybrid Image Recognition & AR Scanner
 *
 * Dual Mode Architecture:
 *   1. SMART PHOTO SCAN (Primary):
 *      - Captures camera snapshot at full resolution
 *      - Sends frame to Python FastAPI + OpenCV backend on Render (/recognize)
 *      - Receives {matched, target_id, confidence, method}
 *      - Plays linked video (with automatic client-side fallback if backend is offline)
 *
 *   2. AR LIVE SCAN (MindAR):
 *      - Client-side real-time 3D tracking anchored to physical photos
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
  Volume2, VolumeX, Sparkles, AlertCircle, CheckCircle2, ZoomIn, Eye,
  Server, Zap, CheckCircle, Wifi, WifiOff
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
import ARScanner from "@/components/ARScanner";
import type { ARTelemetryState } from "@/components/ARScanner";
import { ARTargetConfig } from "@/config/arTargets";

type ScanMode = "smart_photo" | "ar_live";

type Phase =
  | "idle"        // Landing card
  | "camera"      // Camera active
  | "analysing"   // Photo captured, calling backend /recognize
  | "matched"     // Match found -> video playing
  | "no_match"    // No confident match
  | "error";      // Permission error

interface BackendDebugInfo {
  serverUrl: string;
  serverStatus: "checking" | "online" | "offline";
  targetsLoaded?: number;
  lastResponseMs?: number;
  method?: string;
  confidence?: string;
  margin?: string;
  inliers?: number;
  detectedTarget?: string;
}

export default function ScannerPage() {
  const videoRef         = useRef<HTMLVideoElement>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement>(null);
  const playVideoRef     = useRef<HTMLVideoElement>(null);
  const streamRef        = useRef<MediaStream | null>(null);
  const refDescsRef      = useRef<ReferenceDescriptor[] | null>(null);

  const [scanMode,       setScanMode]       = useState<ScanMode>("smart_photo");
  const [phase,          setPhase]          = useState<Phase>("idle");
  const [matchedTarget,  setMatchedTarget]  = useState<RecognitionTarget | null>(null);
  const [capturedUrl,    setCapturedUrl]    = useState<string | null>(null);
  const [isMuted,        setIsMuted]        = useState(true);
  const [cameraError,    setCameraError]    = useState<string | null>(null);
  const [scanProgress,   setScanProgress]   = useState(0);
  const [statusText,     setStatusText]     = useState("");
  const [showDebug,      setShowDebug]      = useState(false);
  const [isMock,         setIsMock]         = useState(false);

  const [backendDebug, setBackendDebug] = useState<BackendDebugInfo>({
    serverUrl: process.env.NEXT_PUBLIC_RECOGNITION_API_URL || "http://localhost:8000",
    serverStatus: "checking",
  });

  const apiUrl = process.env.NEXT_PUBLIC_RECOGNITION_API_URL || "http://localhost:8000";

  // Check Backend Health on Mount & Periodic Ping
  useEffect(() => {
    async function checkHealth() {
      try {
        const res = await fetch(`${apiUrl}/health`, { method: "GET" });
        if (res.ok) {
          const data = await res.json();
          setBackendDebug(d => ({
            ...d,
            serverStatus: "online",
            targetsLoaded: data.targets_loaded ?? 8,
          }));
          console.log("[Scanner] Python Backend is Online:", data);
        } else {
          setBackendDebug(d => ({ ...d, serverStatus: "offline" }));
        }
      } catch (err) {
        setBackendDebug(d => ({ ...d, serverStatus: "offline" }));
        console.warn("[Scanner] Python Backend offline, client-side fallback enabled.");
      }
    }

    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, [apiUrl]);

  const [orientationAngle, setOrientationAngle] = useState(0);
  const [isLandscape,      setIsLandscape]      = useState(false);

  // Orientation Tracking for Stable Ergonomic Shutter Button
  useEffect(() => {
    function updateOrientation() {
      if (typeof window !== "undefined") {
        const angle = window.screen?.orientation?.angle ?? (typeof window.orientation === "number" ? (window.orientation as number) : 0);
        setOrientationAngle(angle);
        const landscape = window.matchMedia("(orientation: landscape)").matches;
        setIsLandscape(landscape);
      }
    }

    updateOrientation();
    window.addEventListener("orientationchange", updateOrientation);
    window.addEventListener("resize", updateOrientation);
    if (window.screen?.orientation) {
      window.screen.orientation.addEventListener("change", updateOrientation);
    }

    return () => {
      window.removeEventListener("orientationchange", updateOrientation);
      window.removeEventListener("resize", updateOrientation);
      if (window.screen?.orientation) {
        window.screen.orientation.removeEventListener("change", updateOrientation);
      }
    };
  }, []);

  // Pre-load local fallback descriptors
  useEffect(() => {
    buildReferenceDescriptors()
      .then(descs => {
        refDescsRef.current = descs;
      })
      .catch(console.warn);
  }, []);

  // Detect mobile vs desktop mock
  useEffect(() => {
    const ua = navigator.userAgent.toLowerCase();
    setIsMock(!(/android|iphone|ipad|ipod|mobile/i.test(ua)) && !window.location.search.includes("force-ar"));
  }, []);

  // ── Native Camera for Smart Photo Scan ────────────────────────────────────
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

      setPhase("camera");
    } catch (err: any) {
      console.error("Camera startup error:", err);
      const msg = err.name === "NotAllowedError"
        ? "Camera permission denied. Please allow camera access in your browser settings."
        : `Camera error: ${err.message || "Failed to start camera."}`;
      setCameraError(msg);
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

  // ── Shutter Click: Capture Frame & Query Python Backend ───────────────────
  const handleCapture = useCallback(async () => {
    const video = videoRef.current;
    const canvas = captureCanvasRef.current;
    if (!video || !canvas || video.videoWidth === 0) {
      console.warn("[Scanner] Camera video element not ready.");
      return;
    }

    // Capture frame from native video element
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.88);
    setCapturedUrl(dataUrl);

    setPhase("analysing");
    setScanProgress(20);
    setStatusText("Connecting to OpenCV Recognition Engine…");

    const t0 = performance.now();

    // Convert canvas to Blob for multipart upload
    const blob: Blob | null = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob) {
      setPhase("no_match");
      return;
    }

    let resultTarget: RecognitionTarget | null = null;
    let methodUsed = "python_opencv";
    let confVal = 0;
    let inliersVal = 0;

    // 1. Try Python FastAPI Backend on Render
    try {
      const formData = new FormData();
      formData.append("image", blob, "scan.jpg");

      setScanProgress(50);
      setStatusText("Analyzing visual markers & features…");

      const response = await fetch(`${apiUrl}/recognize`, {
        method: "POST",
        body: formData,
      });

      if (response.ok) {
        const data = await response.json();
        const elapsed = Math.round(performance.now() - t0);

        if (data.matched && data.target_id) {
          const t = getTargetById(data.target_id);
          if (t) {
            resultTarget = t;
            confVal = data.confidence;
            methodUsed = data.method || "python_opencv";
            inliersVal = data.debug?.inliers || 0;
            setBackendDebug(d => ({
              ...d,
              lastResponseMs: elapsed,
              method: data.method,
              confidence: `${(data.confidence * 100).toFixed(1)}%`,
              margin: data.margin !== undefined ? `${(data.margin * 100).toFixed(1)}%` : undefined,
              inliers: data.debug?.opencv_inliers,
              detectedTarget: t.name,
            }));
          }
        } else {
          setBackendDebug(d => ({
            ...d,
            lastResponseMs: elapsed,
            detectedTarget: "NONE",
            confidence: "0%",
          }));
        }
      }
    } catch (apiErr) {
      console.warn("[Scanner] Backend request failed, invoking client fallback matcher...", apiErr);
    }

    // 2. Client-Side Fallback (if backend unreachable or still cold starting)
    if (!resultTarget) {
      setScanProgress(80);
      setStatusText("Verifying image features locally…");

      if (!refDescsRef.current || refDescsRef.current.length === 0) {
        refDescsRef.current = await buildReferenceDescriptors();
      }

      const captureData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const matches = matchReferenceImages(captureData, refDescsRef.current);
      const elapsed = Math.round(performance.now() - t0);

      if (matches.length > 0) {
        const best = matches[0];
        const t = getTargetById(best.targetId);
        if (t) {
          resultTarget = t;
          confVal = best.confidence;
          methodUsed = "client_fallback";
          setBackendDebug(d => ({
            ...d,
            lastResponseMs: elapsed,
            method: "client_fallback",
            confidence: `${(best.confidence * 100).toFixed(1)}%`,
            detectedTarget: t.name,
          }));
        }
      }
    }

    setScanProgress(100);

    // 3. Handle Result
    if (resultTarget) {
      console.log(`[Scanner] ✅ Matched: ${resultTarget.name} via ${methodUsed} [Conf: ${(confVal * 100).toFixed(1)}%]`);
      setMatchedTarget(resultTarget);
      setPhase("matched");
    } else {
      console.log("[Scanner] ❌ No confident match found.");
      setPhase("no_match");
      setStatusText("");
    }
  }, [apiUrl]);

  // ── Autoplay Video on Match ───────────────────────────────────────────────
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
    setPhase("camera");
  }, []);

  const handleStart = useCallback(() => {
    setCameraError(null);
    if (scanMode === "smart_photo") {
      startCamera();
    } else {
      setPhase("camera");
    }
  }, [scanMode, startCamera]);

  const onMindARTargetFound = useCallback((arTarget: ARTargetConfig) => {
    const t = RECOGNITION_TARGETS.find(r => r.mindarTargetIndices.includes(arTarget.targetIndex));
    if (t) {
      setMatchedTarget(t);
      setPhase("matched");
    }
  }, []);

  return (
    <main className="relative w-full h-screen min-h-screen bg-black overflow-hidden flex flex-col">
      <canvas ref={captureCanvasRef} className="hidden" />

      {/* ── Native Camera (Smart Photo Scan) ── */}
      {scanMode === "smart_photo" && (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`fixed inset-0 w-full h-full object-cover z-10 transition-opacity duration-300 ${
            phase === "camera" ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
        />
      )}

      {/* ── MindAR 3D AR Camera (AR Live Scan) ── */}
      {scanMode === "ar_live" && phase !== "idle" && (
        <ARScanner
          isScanning={phase === "camera"}
          activeTargetIndex={matchedTarget ? (matchedTarget.mindarTargetIndices[0] ?? null) : null}
          isMuted={isMuted}
          isMockMode={isMock}
          onTargetFound={onMindARTargetFound}
          onTargetLost={() => {}}
          onCameraError={(e) => setCameraError(e)}
          onSceneReady={() => setPhase("camera")}
          onTelemetryUpdate={() => {}}
        />
      )}

      {/* ── Fullscreen Video on Match ── */}
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
            className="fixed inset-0 z-40 bg-black/65 backdrop-blur-md flex flex-col items-center justify-center gap-5"
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
                className="h-full bg-gradient-to-r from-pink-500 via-rose-500 to-amber-400 rounded-full"
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
              Make sure the photograph is clearly visible and well-lit. Hold steady and try again.
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

      {/* ── Full-Screen Viewfinder Frame ── */}
      <AnimatePresence>
        {phase === "camera" && (
          <motion.div
            key="vf"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-20 pointer-events-none p-6 sm:p-10 flex flex-col justify-between"
          >
            <div className="flex justify-between w-full">
              <div className="w-12 h-12 border-t-[3px] border-l-[3px] border-pink-400/90 rounded-tl-2xl shadow-[0_0_10px_rgba(244,114,182,0.5)]" />
              <div className="w-12 h-12 border-t-[3px] border-r-[3px] border-pink-400/90 rounded-tr-2xl shadow-[0_0_10px_rgba(244,114,182,0.5)]" />
            </div>
            <div className="w-full relative h-[2px] bg-gradient-to-r from-transparent via-pink-500/80 to-transparent shadow-[0_0_15px_4px_rgba(236,72,153,0.6)] animate-scan-laser my-auto" />
            <div className="flex justify-between w-full">
              <div className="w-12 h-12 border-b-[3px] border-l-[3px] border-pink-400/90 rounded-bl-2xl shadow-[0_0_10px_rgba(244,114,182,0.5)]" />
              <div className="w-12 h-12 border-b-[3px] border-r-[3px] border-pink-400/90 rounded-br-2xl shadow-[0_0_10px_rgba(244,114,182,0.5)]" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Top Bar Controls ── */}
      <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between p-4 sm:p-5">
        <Link
          href="/"
          className="flex items-center gap-2 px-3.5 py-2 rounded-full glass-panel text-sm font-medium text-pink-200 hover:text-white transition-all backdrop-blur-md"
        >
          <ArrowLeft className="w-4 h-4" /> Home
        </Link>

        {/* Mode Switcher Pill */}
        {phase === "camera" && (
          <div className="flex items-center bg-black/60 backdrop-blur-md rounded-full p-1 border border-pink-500/30">
            <button
              onClick={() => {
                setScanMode("smart_photo");
                startCamera();
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                scanMode === "smart_photo" ? "bg-gradient-to-r from-pink-500 to-rose-600 text-white shadow-md" : "text-gray-400 hover:text-white"
              }`}
            >
              <Zap className="w-3.5 h-3.5" /> Smart Scan
            </button>
            <button
              onClick={() => {
                stopCamera();
                setScanMode("ar_live");
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                scanMode === "ar_live" ? "bg-gradient-to-r from-purple-500 to-pink-600 text-white shadow-md" : "text-gray-400 hover:text-white"
              }`}
            >
              <Eye className="w-3.5 h-3.5" /> AR Live
            </button>
          </div>
        )}

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
            className="fixed top-16 left-4 right-4 z-50 glass-panel rounded-2xl border border-purple-500/40 p-4 max-w-sm mx-auto max-h-[70vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold text-purple-300 uppercase tracking-wider flex items-center gap-1.5">
                <Bug className="w-3.5 h-3.5" /> Recognition Diagnostics
              </span>
              <button onClick={() => setShowDebug(false)} className="text-gray-400 hover:text-white cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="text-[11px] font-mono space-y-1.5">
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Backend API:</span>
                <span className="flex items-center gap-1">
                  {backendDebug.serverStatus === "online" ? (
                    <><Wifi className="w-3 h-3 text-emerald-400" /><span className="text-emerald-400 font-bold">Online (Render)</span></>
                  ) : (
                    <><WifiOff className="w-3 h-3 text-amber-400" /><span className="text-amber-400">Fallback Mode</span></>
                  )}
                </span>
              </div>
              <DR label="API URL" v={backendDebug.serverUrl.replace("https://", "")} />
              <DR label="Targets Loaded" v={`${backendDebug.targetsLoaded ?? 8} targets`} />
              <div className="my-1.5 border-t border-purple-500/20" />
              <DR label="Current Mode" v={scanMode === "smart_photo" ? "Smart Photo (OpenCV)" : "AR Live (MindAR)"} />
              <DR label="Detected Target" v={backendDebug.detectedTarget || "NONE"} bold ok={backendDebug.detectedTarget !== "NONE"} />
              <DR label="Method" v={backendDebug.method || "—"} />
              <DR label="Confidence" v={backendDebug.confidence || "—"} ok />
              {backendDebug.inliers !== undefined && <DR label="RANSAC Inliers" v={`${backendDebug.inliers} points`} ok />}
              {backendDebug.lastResponseMs !== undefined && <DR label="Server Latency" v={`${backendDebug.lastResponseMs}ms`} />}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Camera Viewfinder: Orientation-Stable Shutter Button ── */}
      {phase === "camera" && scanMode === "smart_photo" && (
        <div
          className={`fixed z-40 pointer-events-auto transition-all duration-300 ${
            isLandscape
              ? "right-6 sm:right-10 top-1/2 -translate-y-1/2 flex flex-col items-center gap-3"
              : "bottom-6 sm:bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-3"
          }`}
        >
          <motion.p
            key="hint"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className={`text-xs text-pink-200/95 font-medium text-center drop-shadow-md tracking-wide px-3 py-1 rounded-full glass-panel border border-pink-500/20 whitespace-nowrap ${
              isLandscape ? "text-[11px]" : ""
            }`}
          >
            Point at photo, then tap
          </motion.p>
          <motion.button
            key="shutter-btn"
            onClick={handleCapture}
            aria-label="Take photo"
            whileTap={{ scale: 0.88 }}
            className="w-20 h-20 rounded-full bg-white border-4 border-pink-500/60 shadow-[0_0_30px_rgba(236,72,153,0.5)] flex items-center justify-center cursor-pointer transition-transform"
          >
            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-pink-500 via-rose-500 to-amber-400" />
          </motion.button>
        </div>
      )}

      {/* ── Bottom Action Controls (Start Card & Matched Info Card) ── */}
      <div className="fixed bottom-0 left-0 right-0 z-40 px-4 pb-10 pt-4 flex flex-col items-center gap-3 bg-gradient-to-t from-black via-black/80 to-transparent pointer-events-none">
        <div className="pointer-events-auto w-full flex flex-col items-center gap-3 max-w-sm">
          <AnimatePresence mode="wait">

            {/* Landing: Start Scanner Card */}
            {phase === "idle" && (
              <motion.div key="idle" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="w-full">
                <div className="glass-panel rounded-3xl p-6 border border-pink-500/20 backdrop-blur-xl text-center">
                  <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-pink-500 to-rose-600 flex items-center justify-center shadow-lg glow-rose animate-float">
                    <Camera className="w-7 h-7 text-white" />
                  </div>
                  <h1 className="text-2xl font-serif font-bold text-gradient-rose mb-2">Memories Alive</h1>
                  <p className="text-xs text-pink-200/80 mb-5 leading-relaxed">
                    Point your camera at one of the physical photographs and tap the shutter. Python OpenCV recognizes the visual marker and plays the memory video.
                  </p>
                  <button
                    onClick={handleStart}
                    className="w-full py-4 rounded-2xl bg-gradient-to-r from-pink-500 via-rose-500 to-amber-500 text-white font-bold text-sm tracking-wide shadow-xl flex items-center justify-center gap-2 glow-rose active:scale-[0.98] transition-all cursor-pointer"
                  >
                    <Sparkles className="w-5 h-5 text-amber-200" /> OPEN SCANNER
                  </button>
                </div>
              </motion.div>
            )}

            {/* Matched State Info Card */}
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
      <span className={`text-right truncate max-w-[170px] ${bold ? "font-bold " : ""}${ok === true ? "text-emerald-400" : ok === false ? "text-rose-400" : "text-gray-300"}`}>
        {v}
      </span>
    </div>
  );
}
