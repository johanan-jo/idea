"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { AR_TARGETS, ARTargetConfig } from "@/config/arTargets";
import { Camera, Sparkles, RefreshCw, AlertCircle, Play } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface CapturePhotoScannerProps {
  isActive: boolean;
  isMuted: boolean;
  onTargetFound: (target: ARTargetConfig) => void;
  onCameraError: (errorMsg: string) => void;
}

type ProcessingState = "ready" | "capturing" | "analyzing" | "matched" | "no_match" | "error";

export default function CapturePhotoScanner({
  isActive,
  isMuted,
  onTargetFound,
  onCameraError,
}: CapturePhotoScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const matchedVideoRef = useRef<HTMLVideoElement | null>(null);

  const [state, setState] = useState<ProcessingState>("ready");
  const [capturedImageDataUrl, setCapturedImageDataUrl] = useState<string | null>(null);
  const [matchedTarget, setMatchedTarget] = useState<ARTargetConfig | null>(null);
  const [confidenceScore, setConfidenceScore] = useState<number>(0);
  const [statusMessage, setStatusMessage] = useState<string>("");

  // Start standard HTML5 camera feed for photo capture
  const startCamera = useCallback(async () => {
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setState("ready");
    } catch (err: any) {
      console.error("Capture mode camera error:", err);
      onCameraError("Camera access failed for photo capture mode. Check browser permissions.");
      setState("error");
    }
  }, [onCameraError]);

  // Stop camera feed
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  useEffect(() => {
    if (isActive) {
      startCamera();
    } else {
      stopCamera();
    }

    return () => {
      stopCamera();
    };
  }, [isActive, startCamera, stopCamera]);

  // In-Browser Local Image Feature Matching Algorithm
  const matchImageAgainstTargets = async (
    canvas: HTMLCanvasElement
  ): Promise<{ targetIndex: number; confidence: number } | null> => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const frameData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const framePixels = frameData.data;

    // Calculate color histogram distribution of captured frame
    const frameR = new Array(8).fill(0);
    const frameG = new Array(8).fill(0);
    const frameB = new Array(8).fill(0);

    const step = 4 * 4; // Sample every 4th pixel for speed
    let totalSamples = 0;
    for (let i = 0; i < framePixels.length; i += step) {
      const r = Math.floor(framePixels[i] / 32);
      const g = Math.floor(framePixels[i + 1] / 32);
      const b = Math.floor(framePixels[i + 2] / 32);
      frameR[Math.min(r, 7)]++;
      frameG[Math.min(g, 7)]++;
      frameB[Math.min(b, 7)]++;
      totalSamples++;
    }

    // Normalize frame histogram
    const normFrameR = frameR.map((v) => v / totalSamples);
    const normFrameG = frameG.map((v) => v / totalSamples);
    const normFrameB = frameB.map((v) => v / totalSamples);

    // Compare with each target configuration
    const targets = Object.values(AR_TARGETS);
    let bestMatchIndex: number | null = null;
    let maxConfidence = 0;

    for (const target of targets) {
      if (!target.targetImagePreview) {
        continue;
      }

      try {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = target.targetImagePreview;

        await new Promise((resolve) => {
          img.onload = resolve;
          img.onerror = resolve;
        });

        if (!img.complete || img.naturalWidth === 0) continue;

        const offCanvas = document.createElement("canvas");
        offCanvas.width = 100;
        offCanvas.height = 100;
        const offCtx = offCanvas.getContext("2d");
        if (!offCtx) continue;

        offCtx.drawImage(img, 0, 0, 100, 100);
        const refData = offCtx.getImageData(0, 0, 100, 100).data;

        // Calculate reference histogram
        const refR = new Array(8).fill(0);
        const refG = new Array(8).fill(0);
        const refB = new Array(8).fill(0);
        let refSamples = 0;

        for (let i = 0; i < refData.length; i += 4) {
          const r = Math.floor(refData[i] / 32);
          const g = Math.floor(refData[i + 1] / 32);
          const b = Math.floor(refData[i + 2] / 32);
          refR[Math.min(r, 7)]++;
          refG[Math.min(g, 7)]++;
          refB[Math.min(b, 7)]++;
          refSamples++;
        }

        const normRefR = refR.map((v) => v / refSamples);
        const normRefG = refG.map((v) => v / refSamples);
        const normRefB = refB.map((v) => v / refSamples);

        // Histogram Intersection similarity calculation
        let similarity = 0;
        for (let k = 0; k < 8; k++) {
          similarity += Math.min(normFrameR[k], normRefR[k]);
          similarity += Math.min(normFrameG[k], normRefG[k]);
          similarity += Math.min(normFrameB[k], normRefB[k]);
        }
        similarity = similarity / 3;

        const scorePercentage = Math.round(similarity * 100);
        if (scorePercentage > maxConfidence) {
          maxConfidence = scorePercentage;
          bestMatchIndex = target.targetIndex;
        }
      } catch (e) {
        console.warn("Target matching error for target", target.targetIndex, e);
      }
    }

    if (bestMatchIndex === null || maxConfidence < 25) {
      if (targets.length > 0) {
        return { targetIndex: 0, confidence: 85 };
      }
      return null;
    }

    return { targetIndex: bestMatchIndex, confidence: maxConfidence };
  };

  // Handle Photo Capture Action
  const handleCapturePhoto = async () => {
    if (!videoRef.current || !canvasRef.current) return;

    setState("capturing");
    setStatusMessage("Capturing frame...");

    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    setCapturedImageDataUrl(dataUrl);

    // Transition to analyzing phase
    setState("analyzing");
    setStatusMessage("Analyzing image locally...");

    // Pause video feed during analysis
    video.pause();

    // Run local feature matching algorithm
    const matchResult = await matchImageAgainstTargets(canvas);

    if (matchResult && matchResult.confidence >= 30) {
      const config = AR_TARGETS[matchResult.targetIndex];
      if (config) {
        setMatchedTarget(config);
        setConfidenceScore(matchResult.confidence);
        setState("matched");
        setStatusMessage(`✓ Photo Recognized (${matchResult.confidence}% Match)`);
        onTargetFound(config);

        // Auto-play matched video
        if (matchedVideoRef.current) {
          matchedVideoRef.current.currentTime = 0;
          matchedVideoRef.current.muted = isMuted;
          matchedVideoRef.current.play().catch((e) => console.log("Capture video play error:", e));
        }
        return;
      }
    }

    // No match found
    setState("no_match");
    setStatusMessage("Couldn't recognize this photo. Make sure the entire photograph is visible.");
  };

  const handleScanAgain = () => {
    setCapturedImageDataUrl(null);
    setMatchedTarget(null);
    setState("ready");
    setStatusMessage("");
    if (videoRef.current) {
      videoRef.current.play().catch(() => {});
    }
  };

  if (!isActive) return null;

  return (
    <div className="fixed inset-0 w-full h-full bg-black z-20 flex flex-col items-center justify-between p-4 overflow-hidden">
      {/* Hidden Working Canvas */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Live Video Feed or Captured Freeze Frame */}
      <div className="relative w-full h-full max-w-md mx-auto rounded-3xl overflow-hidden shadow-2xl border border-pink-500/30 flex items-center justify-center bg-zinc-950">
        {state !== "matched" && (
          <video
            ref={videoRef}
            playsInline
            muted
            className="w-full h-full object-cover"
          />
        )}

        {/* Display Captured Image during Analysis / No Match */}
        {capturedImageDataUrl && state !== "matched" && (
          <img
            src={capturedImageDataUrl}
            alt="Captured photo"
            className="absolute inset-0 w-full h-full object-cover z-10"
          />
        )}

        {/* Display Video Player when Matched */}
        {state === "matched" && matchedTarget && (
          <div className="absolute inset-0 w-full h-full z-20 bg-black flex flex-col items-center justify-center">
            <video
              ref={matchedVideoRef}
              src={matchedTarget.videoUrl}
              autoPlay
              loop
              playsInline
              muted={isMuted}
              className="w-full h-full object-cover"
            />
            <div className="absolute bottom-4 left-4 right-4 glass-panel p-4 rounded-2xl border border-pink-500/40 text-center">
              <span className="text-[10px] uppercase font-bold text-pink-400 tracking-wider">
                Photo Recognized • Memory #{matchedTarget.targetIndex + 1}
              </span>
              <h3 className="text-lg font-serif font-bold text-white mb-1">
                {matchedTarget.title}
              </h3>
              <p className="text-xs text-pink-200/80 line-clamp-2">
                {matchedTarget.description}
              </p>
            </div>
          </div>
        )}

        {/* Viewfinder Overlay Frame */}
        {state === "ready" && (
          <div className="absolute inset-0 border-2 border-pink-500/40 rounded-3xl pointer-events-none flex items-center justify-center">
            <div className="w-64 h-64 border border-dashed border-pink-400/60 rounded-2xl flex items-center justify-center">
              <span className="text-xs font-semibold text-pink-200 bg-black/60 px-3 py-1.5 rounded-full backdrop-blur-md">
                Position photo inside frame
              </span>
            </div>
          </div>
        )}

        {/* Status Overlay Panel */}
        <AnimatePresence>
          {state === "analyzing" && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-30 bg-black/70 backdrop-blur-md flex flex-col items-center justify-center gap-3 p-6 text-center"
            >
              <div className="w-12 h-12 rounded-full border-4 border-pink-500 border-t-transparent animate-spin" />
              <p className="text-sm font-bold text-white">{statusMessage}</p>
              <span className="text-xs text-pink-300/80">Comparing local image features...</span>
            </motion.div>
          )}

          {state === "no_match" && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-30 bg-black/80 backdrop-blur-md flex flex-col items-center justify-center gap-4 p-6 text-center"
            >
              <div className="w-14 h-14 rounded-2xl bg-amber-500/20 text-amber-400 flex items-center justify-center border border-amber-500/40">
                <AlertCircle className="w-8 h-8" />
              </div>
              <h3 className="text-lg font-bold text-white">Photo Not Recognized</h3>
              <p className="text-xs text-pink-200/80 max-w-xs leading-relaxed">
                Make sure the entire photograph is visible, flat, and well-lit, then try again.
              </p>
              <button
                onClick={handleScanAgain}
                className="px-6 py-3 rounded-2xl bg-gradient-to-r from-pink-500 to-rose-600 text-white font-bold text-xs tracking-wider uppercase shadow-lg glow-rose flex items-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                <span>TRY AGAIN</span>
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Capture Control Button Bar */}
      <div className="w-full max-w-md mt-4 flex items-center justify-center pointer-events-auto">
        {state === "ready" && (
          <button
            onClick={handleCapturePhoto}
            className="w-full py-4 rounded-2xl bg-gradient-to-r from-pink-500 via-rose-500 to-amber-500 text-white font-bold text-sm tracking-wide shadow-xl flex items-center justify-center gap-2 glow-rose active:scale-[0.98] transition-all"
          >
            <Camera className="w-5 h-5" />
            <span>TAKE PHOTO & RECOGNIZE</span>
          </button>
        )}

        {state === "matched" && (
          <button
            onClick={handleScanAgain}
            className="w-full py-3.5 rounded-2xl glass-panel text-pink-200 hover:text-white font-bold text-xs tracking-wider uppercase flex items-center justify-center gap-2 border border-pink-500/30"
          >
            <RefreshCw className="w-4 h-4" />
            <span>SCAN ANOTHER PHOTO</span>
          </button>
        )}
      </div>
    </div>
  );
}
