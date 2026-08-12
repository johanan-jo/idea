"use client";

import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Camera, Volume2, VolumeX, Sparkles, ArrowLeft, RefreshCw, AlertCircle, Eye, Film } from "lucide-react";
import Link from "next/link";
import { ARTargetConfig, getAllARTargets } from "@/config/arTargets";

interface ScannerUIProps {
  scannerState: "idle" | "scanning" | "target-found" | "permission-denied";
  activeTarget: ARTargetConfig | null;
  isMuted: boolean;
  isMockMode: boolean;
  permissionError: string | null;
  unlockedTargets: number[];
  onStartScanning: () => void;
  onStopScanning: () => void;
  onToggleMute: () => void;
  onToggleMockMode: () => void;
  onSimulateTarget: (index: number) => void;
  onClearSimulateTarget: () => void;
}

export default function ScannerUI({
  scannerState,
  activeTarget,
  isMuted,
  isMockMode,
  permissionError,
  unlockedTargets,
  onStartScanning,
  onStopScanning,
  onToggleMute,
  onToggleMockMode,
  onSimulateTarget,
  onClearSimulateTarget,
}: ScannerUIProps) {
  const allTargets = getAllARTargets();

  return (
    <div className="relative z-30 pointer-events-none w-full h-full min-h-screen flex flex-col justify-between p-4 sm:p-6 overflow-hidden select-none">
      {/* Top Header Bar */}
      <div className="w-full flex items-center justify-between pointer-events-auto">
        <Link
          href="/"
          className="flex items-center gap-2 px-3.5 py-2 rounded-full glass-panel text-xs sm:text-sm font-medium text-pink-200 hover:text-white transition-all hover:border-pink-500/50"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Home</span>
        </Link>

        {/* Status / Mode Pill */}
        <div className="flex items-center gap-2">
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

                <p className="text-sm text-pink-100/80 mb-8 leading-relaxed">
                  Point your camera at any of your physical photographs. The app will automatically recognize the memory and bring it to life.
                </p>

                <button
                  onClick={onStartScanning}
                  className="w-full py-4 px-8 rounded-2xl bg-gradient-to-r from-pink-500 via-rose-500 to-amber-500 text-white font-bold text-base tracking-wide shadow-xl hover:shadow-pink-500/25 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-3 glow-rose"
                >
                  <Sparkles className="w-5 h-5 text-amber-200" />
                  <span>START SCANNING</span>
                </button>

                {/* Unlocked Memories Progress Counter */}
                <div className="mt-6 pt-6 border-t border-pink-500/10 w-full flex items-center justify-between text-xs text-pink-300/70">
                  <span>Memories Discovered</span>
                  <span className="font-semibold text-pink-200">
                    {unlockedTargets.length} / {allTargets.length}
                  </span>
                </div>
              </div>
            </motion.div>
          )}

          {/* 2. SCANNING STATE */}
          {scannerState === "scanning" && (
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
              <div className="mt-8 glass-panel px-6 py-3 rounded-full text-center border border-pink-500/30">
                <p className="text-sm font-medium text-pink-100 animate-pulse">
                  Point your camera at a photo...
                </p>
              </div>
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
                    ✨ Memory Found • {activeTarget.badge || `Photo #${activeTarget.targetIndex + 1}`}
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

          {/* 4. CAMERA PERMISSION DENIED STATE */}
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
                  Camera Access Required
                </h2>

                <p className="text-xs text-rose-200/80 mb-6 leading-relaxed">
                  {permissionError ||
                    "Camera access is required for the AR experience. Please allow camera access in your browser settings and try again."}
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
