"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Camera,
  Volume2,
  VolumeX,
  Sparkles,
  ArrowLeft,
  RefreshCw,
  AlertCircle,
  Eye,
  Film,
  Bug,
  HelpCircle,
  X,
  CheckCircle2,
  SlidersHorizontal,
  Info,
} from "lucide-react";
import Link from "next/link";
import { ARTargetConfig, getAllARTargets } from "@/config/arTargets";
import { ARTelemetryState } from "./ARScanner";

interface ScannerUIProps {
  scannerState: "idle" | "scanning" | "target-found" | "permission-denied";
  activeMode: "live" | "capture";
  activeTarget: ARTargetConfig | null;
  isMuted: boolean;
  isMockMode: boolean;
  permissionError: string | null;
  unlockedTargets: number[];
  telemetry: ARTelemetryState;
  onModeChange: (mode: "live" | "capture") => void;
  onStartScanning: () => void;
  onStopScanning: () => void;
  onToggleMute: () => void;
  onToggleMockMode: () => void;
  onSimulateTarget: (index: number) => void;
  onClearSimulateTarget: () => void;
}

export default function ScannerUI({
  scannerState,
  activeMode,
  activeTarget,
  isMuted,
  isMockMode,
  permissionError,
  unlockedTargets,
  telemetry,
  onModeChange,
  onStartScanning,
  onStopScanning,
  onToggleMute,
  onToggleMockMode,
  onSimulateTarget,
  onClearSimulateTarget,
}: ScannerUIProps) {
  const allTargets = getAllARTargets();

  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [showTips, setShowTips] = useState(false);
  const [showFallbackNotice, setShowFallbackNotice] = useState(false);
  const [scanDuration, setScanDuration] = useState(0);

  // Track scanning time to surface fallback recommendation if target not detected in 12s
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (scannerState === "scanning" && activeMode === "live") {
      interval = setInterval(() => {
        setScanDuration((prev) => {
          const next = prev + 1;
          if (next >= 12 && !showFallbackNotice) {
            setShowFallbackNotice(true);
          }
          return next;
        });
      }, 1000);
    } else {
      setScanDuration(0);
      setShowFallbackNotice(false);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [scannerState, activeMode, showFallbackNotice]);

  return (
    <div className="relative z-30 pointer-events-none w-full h-full min-h-screen flex flex-col justify-between p-4 sm:p-6 overflow-hidden select-none">
      {/* Top Header Bar */}
      <div className="w-full flex items-center justify-between pointer-events-auto flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Link
            href="/"
            className="flex items-center gap-2 px-3.5 py-2 rounded-full glass-panel text-xs sm:text-sm font-medium text-pink-200 hover:text-white transition-all hover:border-pink-500/50"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Home</span>
          </Link>

          {/* Mode Switcher Tabs */}
          {scannerState !== "idle" && (
            <div className="flex items-center p-1 rounded-full glass-panel border border-pink-500/30">
              <button
                onClick={() => onModeChange("live")}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                  activeMode === "live"
                    ? "bg-gradient-to-r from-pink-500 to-rose-600 text-white shadow-md glow-rose"
                    : "text-pink-200/70 hover:text-white"
                }`}
              >
                LIVE AR
              </button>
              <button
                onClick={() => onModeChange("capture")}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                  activeMode === "capture"
                    ? "bg-gradient-to-r from-pink-500 to-rose-600 text-white shadow-md glow-rose"
                    : "text-pink-200/70 hover:text-white"
                }`}
              >
                TAKE PHOTO
              </button>
            </div>
          )}
        </div>

        {/* Status / Controls */}
        <div className="flex items-center gap-2">
          {/* Debug Telemetry Toggle */}
          <button
            onClick={() => setShowDebugPanel((prev) => !prev)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all pointer-events-auto ${
              showDebugPanel
                ? "bg-purple-600/40 text-purple-200 border border-purple-500/50"
                : "glass-panel text-gray-300 hover:text-white"
            }`}
            title="Open Target Recognition Debug Telemetry"
          >
            <Bug className="w-3.5 h-3.5 text-purple-400" />
            <span>Debug</span>
          </button>

          {/* Photo Quality Tips Button */}
          <button
            onClick={() => setShowTips((prev) => !prev)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-full glass-panel text-xs text-pink-200 hover:text-white transition-all"
            title="Image Quality Tips"
          >
            <HelpCircle className="w-3.5 h-3.5" />
            <span>Tips</span>
          </button>

          {/* Audio Unmute Button */}
          {scannerState === "target-found" && (
            <motion.button
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              onClick={onToggleMute}
              className={`flex items-center gap-2 px-4 py-2 rounded-full font-semibold text-xs tracking-wider uppercase transition-all shadow-lg pointer-events-auto ${
                isMuted
                  ? "bg-pink-600 text-white glow-rose animate-bounce"
                  : "bg-emerald-500/80 text-white backdrop-blur-md"
              }`}
            >
              {isMuted ? (
                <>
                  <VolumeX className="w-4 h-4" />
                  <span>🔊 Tap for sound</span>
                </>
              ) : (
                <>
                  <Volume2 className="w-4 h-4" />
                  <span>Sound On</span>
                </>
              )}
            </motion.button>
          )}

          {/* Desktop Simulation Toggle Button */}
          <button
            onClick={onToggleMockMode}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all pointer-events-auto ${
              isMockMode
                ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                : "glass-panel text-gray-400 hover:text-gray-200"
            }`}
            title="Toggle simulation mode for desktop testing"
          >
            <Eye className="w-3.5 h-3.5" />
            <span>{isMockMode ? "Sim Mode ON" : "Sim Mode"}</span>
          </button>
        </div>
      </div>

      {/* Main Viewport Content according to Scanner State */}
      <div className="flex-1 flex flex-col items-center justify-center relative my-4">
        <AnimatePresence mode="wait">
          {/* 1. IDLE STATE */}
          {scannerState === "idle" && (
            <motion.div
              key="idle-state"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="w-full max-w-md mx-auto text-center px-4 pointer-events-auto"
            >
              <div className="glass-panel p-8 rounded-3xl backdrop-blur-xl border border-pink-500/20 shadow-2xl flex flex-col items-center">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-pink-500 to-rose-600 flex items-center justify-center shadow-lg glow-rose mb-6 animate-float">
                  <Camera className="w-8 h-8 text-white" />
                </div>

                <span className="text-xs uppercase tracking-widest text-pink-400 font-semibold mb-2">
                  Interactive Memory Scanner
                </span>

                <h1 className="text-3xl sm:text-4xl font-serif font-bold text-gradient-rose mb-3">
                  Memories Alive
                </h1>

                <p className="text-sm text-pink-100/80 mb-6 leading-relaxed">
                  Point your smartphone camera at physical photographs. The app automatically recognizes each photo target and brings its memory video to life.
                </p>

                {/* Main Scanning Mode Action Buttons */}
                <div className="flex flex-col w-full gap-3">
                  <button
                    onClick={() => {
                      onModeChange("live");
                      onStartScanning();
                    }}
                    className="w-full py-4 px-8 rounded-2xl bg-gradient-to-r from-pink-500 via-rose-500 to-amber-500 text-white font-bold text-base tracking-wide shadow-xl hover:shadow-pink-500/25 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-3 glow-rose"
                  >
                    <Sparkles className="w-5 h-5 text-amber-200" />
                    <span>START LIVE AR SCANNER</span>
                  </button>

                  <button
                    onClick={() => {
                      onModeChange("capture");
                      onStartScanning();
                    }}
                    className="w-full py-3 px-6 rounded-2xl glass-panel text-pink-200 hover:text-white font-semibold text-xs tracking-wider uppercase transition-all flex items-center justify-center gap-2 border border-pink-500/30"
                  >
                    <Camera className="w-4 h-4 text-pink-400" />
                    <span>OPTION 2: TAKE PHOTO FALLBACK</span>
                  </button>
                </div>

                {/* Target Compiler Route Link */}
                <div className="mt-6 pt-4 border-t border-pink-500/10 w-full flex items-center justify-between text-xs text-pink-300/70">
                  <Link
                    href="/compiler"
                    className="text-amber-300 hover:text-amber-200 underline text-xs font-medium flex items-center gap-1"
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5" />
                    <span>Compile New Photo Targets (.mind)</span>
                  </Link>

                  <span className="font-semibold text-pink-200">
                    {unlockedTargets.length} / {allTargets.length} Discovered
                  </span>
                </div>
              </div>
            </motion.div>
          )}

          {/* 2. SCANNING STATE (Live Mode) */}
          {scannerState === "scanning" && activeMode === "live" && (
            <motion.div
              key="scanning-state"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="w-full h-full absolute inset-0 flex flex-col items-center justify-center pointer-events-none"
            >
              {/* Camera Scanner Viewfinder Framing */}
              <div className="relative w-64 h-64 sm:w-72 sm:h-72 border-2 border-pink-500/30 rounded-3xl overflow-hidden shadow-2xl">
                {/* Laser scanning line */}
                <div className="absolute left-0 right-0 h-1 bg-gradient-to-r from-transparent via-pink-500 to-transparent shadow-[0_0_15px_#ff4b72] animate-scan-laser" />

                {/* Frame Corner Accents */}
                <div className="absolute top-2 left-2 w-6 h-6 border-t-2 border-l-2 border-pink-400 rounded-tl-lg" />
                <div className="absolute top-2 right-2 w-6 h-6 border-t-2 border-r-2 border-pink-400 rounded-tr-lg" />
                <div className="absolute bottom-2 left-2 w-6 h-6 border-b-2 border-l-2 border-pink-400 rounded-bl-lg" />
                <div className="absolute bottom-2 right-2 w-6 h-6 border-b-2 border-r-2 border-pink-400 rounded-br-lg" />
              </div>

              {/* Instructional Overlay Text */}
              <div className="mt-8 glass-panel px-6 py-3 rounded-full text-center border border-pink-500/30 pointer-events-auto">
                <p className="text-sm font-medium text-pink-100 animate-pulse">
                  Point camera at physical photograph...
                </p>
              </div>

              {/* Fallback Switcher Notice (if target not detected after 12s) */}
              {showFallbackNotice && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-4 max-w-sm glass-panel p-4 rounded-2xl border border-amber-500/40 text-center pointer-events-auto flex flex-col items-center gap-2 shadow-xl"
                >
                  <div className="flex items-center gap-2 text-amber-300 font-semibold text-xs">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>Having trouble recognizing the photo?</span>
                  </div>
                  <p className="text-[11px] text-pink-200/80 leading-relaxed">
                    Ensure good lighting, avoid reflections, or switch to photo capture mode:
                  </p>
                  <button
                    onClick={() => onModeChange("capture")}
                    className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-rose-500 text-white font-bold text-xs shadow-md glow-rose"
                  >
                    TAKE PHOTO INSTEAD
                  </button>
                </motion.div>
              )}
            </motion.div>
          )}

          {/* 3. TARGET DETECTED STATE */}
          {scannerState === "target-found" && activeTarget && (
            <motion.div
              key="target-found-state"
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="w-full max-w-sm mx-auto pointer-events-auto"
            >
              <div className="glass-panel p-4 rounded-2xl border border-pink-500/40 shadow-2xl backdrop-blur-md flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase font-bold tracking-wider px-2.5 py-1 rounded-full bg-pink-500/20 text-pink-300 border border-pink-500/30">
                    ✨ Memory Found • {activeTarget.badge || `Target #${activeTarget.targetIndex}`}
                  </span>
                  {activeTarget.date && (
                    <span className="text-xs text-amber-200/80 font-serif italic">
                      {activeTarget.date}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  {activeTarget.targetImagePreview && (
                    <div className="w-14 h-14 rounded-xl overflow-hidden border border-pink-500/40 shrink-0 shadow-md">
                      <img
                        src={activeTarget.targetImagePreview}
                        alt={activeTarget.title}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}
                  <div>
                    <h2 className="text-lg font-serif font-bold text-white mb-0.5">
                      {activeTarget.title}
                    </h2>
                    <p className="text-xs text-pink-200/80 line-clamp-2">
                      {activeTarget.description}
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* 4. CAMERA PERMISSION / TARGET ERROR STATE */}
          {scannerState === "permission-denied" && (
            <motion.div
              key="denied-state"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-md mx-auto text-center px-4 pointer-events-auto"
            >
              <div className="glass-panel p-8 rounded-3xl border border-rose-500/40 shadow-2xl flex flex-col items-center">
                <div className="w-14 h-14 rounded-2xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400 mb-4">
                  <AlertCircle className="w-8 h-8" />
                </div>

                <h2 className="text-xl font-bold text-white mb-2">
                  AR Pipeline Initialization Failed
                </h2>

                <p className="text-xs text-rose-200/80 mb-6 leading-relaxed">
                  {permissionError ||
                    "Target file /public/targets/targets.mind could not be verified or camera access was denied."}
                </p>

                <div className="flex flex-col w-full gap-3">
                  <button
                    onClick={onStartScanning}
                    className="w-full py-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-sm transition-all flex items-center justify-center gap-2"
                  >
                    <RefreshCw className="w-4 h-4" />
                    <span>Try Again</span>
                  </button>

                  <button
                    onClick={onToggleMockMode}
                    className="w-full py-3 rounded-xl glass-panel text-amber-300 font-semibold text-xs transition-all hover:bg-white/10"
                  >
                    Switch to Simulation Preview Mode
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Target Recognition Debug Telemetry Drawer Modal */}
      <AnimatePresence>
        {showDebugPanel && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-16 left-4 right-4 max-w-md mx-auto z-50 glass-panel p-5 rounded-3xl border border-purple-500/40 shadow-2xl backdrop-blur-2xl text-left pointer-events-auto"
          >
            <div className="flex items-center justify-between border-b border-purple-500/20 pb-3 mb-3">
              <div className="flex items-center gap-2">
                <Bug className="w-4 h-4 text-purple-400" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-purple-200">
                  AR Pipeline Debug Telemetry
                </h4>
              </div>
              <button
                onClick={() => setShowDebugPanel(false)}
                className="text-gray-400 hover:text-white p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs font-mono mb-3">
              <div className="bg-purple-950/40 p-2 rounded-xl border border-purple-500/20">
                <span className="text-gray-400 block text-[10px]">Camera Status:</span>
                <span className="font-bold text-emerald-400">
                  {telemetry.cameraStatus === "ready" ? "✓ READY" : telemetry.cameraStatus.toUpperCase()}
                </span>
              </div>

              <div className="bg-purple-950/40 p-2 rounded-xl border border-purple-500/20">
                <span className="text-gray-400 block text-[10px]">MindAR Engine:</span>
                <span className="font-bold text-emerald-400">
                  {telemetry.mindarStatus === "running" ? "✓ RUNNING" : telemetry.mindarStatus.toUpperCase()}
                </span>
              </div>

              <div className="bg-purple-950/40 p-2 rounded-xl border border-purple-500/20">
                <span className="text-gray-400 block text-[10px]">Target File:</span>
                <span className="font-bold text-emerald-400">
                  {telemetry.targetFileStatus === "valid"
                    ? `✓ ${telemetry.targetFileSize || "LOADED"}`
                    : telemetry.targetFileStatus.toUpperCase()}
                </span>
              </div>

              <div className="bg-purple-950/40 p-2 rounded-xl border border-purple-500/20">
                <span className="text-gray-400 block text-[10px]">Tracking State:</span>
                <span className="font-bold text-amber-300">
                  {telemetry.trackingStatus.toUpperCase()}
                </span>
              </div>

              <div className="bg-purple-950/40 p-2 rounded-xl border border-purple-500/20 col-span-2">
                <span className="text-gray-400 block text-[10px]">Detected Target:</span>
                <span className="font-bold text-pink-300">
                  {telemetry.detectedTargetIndex !== null
                    ? `Target #${telemetry.detectedTargetIndex} (${telemetry.detectedTargetName})`
                    : "None"}
                </span>
              </div>

              <div className="bg-purple-950/40 p-2 rounded-xl border border-purple-500/20 col-span-2">
                <span className="text-gray-400 block text-[10px]">Video Playback:</span>
                <span className="font-bold text-cyan-300">
                  {telemetry.videoUrl ? `${telemetry.videoUrl} (${telemetry.videoStatus.toUpperCase()})` : "None"}
                </span>
              </div>
            </div>

            {telemetry.lastError && (
              <div className="p-2 rounded-xl bg-rose-950/50 border border-rose-500/30 text-[10px] text-rose-300 font-mono mb-3">
                Error Log: {telemetry.lastError}
              </div>
            )}

            <div className="flex items-center justify-between text-[11px] text-purple-300/80 pt-2 border-t border-purple-500/20">
              <span>Target File: /public/targets/targets.mind</span>
              <Link href="/compiler" className="underline text-amber-300 hover:text-amber-200">
                Compiler Tool
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Image Quality Tips Modal Overlay */}
      <AnimatePresence>
        {showTips && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 pointer-events-auto"
          >
            <div className="w-full max-w-sm glass-panel p-6 rounded-3xl border border-pink-500/40 shadow-2xl relative flex flex-col gap-4">
              <button
                onClick={() => setShowTips(false)}
                className="absolute top-4 right-4 text-gray-400 hover:text-white p-1"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-pink-500/20 border border-pink-500/40 flex items-center justify-center text-pink-300">
                  <Info className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">For Best Recognition</h3>
                  <span className="text-xs text-pink-300">Image Scanning Tips</span>
                </div>
              </div>

              <ul className="space-y-2 text-xs text-pink-100/90">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>Keep the entire photo visible inside camera view</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>Hold your smartphone steady 15 to 30 cm away</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>Avoid glare or strong direct light reflections</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>Ensure the photo has good contrast and bright room lighting</span>
                </li>
              </ul>

              <button
                onClick={() => setShowTips(false)}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-pink-500 to-rose-600 text-white font-bold text-xs uppercase tracking-wider shadow-lg glow-rose"
              >
                GOT IT
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom Bar & Desktop Simulation Selector Controls */}
      <div className="w-full flex flex-col items-center gap-3 pointer-events-auto">
        {/* Simulation Selector Bar (When Mock Mode is enabled) */}
        {isMockMode && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-md glass-panel p-3 rounded-2xl flex flex-col gap-2 border border-amber-500/30"
          >
            <div className="flex items-center justify-between text-[11px] text-amber-200/90 font-medium px-1">
              <span className="flex items-center gap-1">
                <Film className="w-3.5 h-3.5 text-amber-400" />
                <span>Simulate Physical Photo Recognition:</span>
              </span>
              {activeTarget && (
                <button
                  onClick={onClearSimulateTarget}
                  className="text-gray-400 hover:text-white underline text-[10px]"
                >
                  Clear Target
                </button>
              )}
            </div>

            <div className="grid grid-cols-4 gap-1.5">
              {allTargets.map((target) => {
                const isSelected = activeTarget?.targetIndex === target.targetIndex;
                return (
                  <button
                    key={target.targetIndex}
                    onClick={() => onSimulateTarget(target.targetIndex)}
                    className={`py-2 px-1 rounded-xl text-xs font-bold transition-all text-center flex flex-col items-center justify-center relative overflow-hidden ${
                      isSelected
                        ? "bg-gradient-to-r from-pink-500 to-rose-600 text-white shadow-lg glow-rose"
                        : "bg-white/5 hover:bg-white/10 text-gray-300 border border-white/10"
                    }`}
                  >
                    <span>Target #{target.targetIndex}</span>
                    <span className="text-[9px] font-normal truncate opacity-80 max-w-full px-1">
                      {target.title.split(":")[0]}
                    </span>
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}

        {/* Scanning Cancel / Stop Controls */}
        {scannerState !== "idle" && (
          <button
            onClick={onStopScanning}
            className="px-5 py-2 rounded-full glass-panel text-xs text-gray-300 hover:text-white border border-white/10 transition-all hover:bg-white/10"
          >
            Stop Scanner
          </button>
        )}
      </div>
    </div>
  );
}

