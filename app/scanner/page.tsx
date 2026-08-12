"use client";

import React, { useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { ARTargetConfig, getARTarget } from "@/config/arTargets";
import ScannerUI from "@/components/ScannerUI";

// Dynamically import ARScanner with ssr: false to prevent SSR hydration issues with A-Frame custom elements
const ARScanner = dynamic(() => import("@/components/ARScanner"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full min-h-screen bg-black flex items-center justify-center text-pink-300 font-serif text-sm">
      Loading AR Engine...
    </div>
  ),
});

export default function ScannerPage() {
  const [scannerState, setScannerState] = useState<
    "idle" | "scanning" | "target-found" | "permission-denied"
  >("idle");
  const [activeTarget, setActiveTarget] = useState<ARTargetConfig | null>(null);
  const [activeTargetIndex, setActiveTargetIndex] = useState<number | null>(null);
  const [isMuted, setIsMuted] = useState(true);
  const [isMockMode, setIsMockMode] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [unlockedTargets, setUnlockedTargets] = useState<number[]>([]);
  const [isSceneReady, setIsSceneReady] = useState(false);

  // Start Scanning Trigger
  const handleStartScanning = useCallback(() => {
    setPermissionError(null);
    setScannerState("scanning");
  }, []);

  // Stop Scanning Trigger
  const handleStopScanning = useCallback(() => {
    setScannerState("idle");
    setActiveTarget(null);
    setActiveTargetIndex(null);
  }, []);

  // Target Found Handler
  const handleTargetFound = useCallback((target: ARTargetConfig) => {
    setActiveTarget(target);
    setActiveTargetIndex(target.targetIndex);
    setScannerState("target-found");

    // Track unlocked targets count
    setUnlockedTargets((prev) =>
      prev.includes(target.targetIndex) ? prev : [...prev, target.targetIndex]
    );
  }, []);

  // Target Lost Handler
  const handleTargetLost = useCallback(() => {
    setActiveTarget(null);
    setActiveTargetIndex(null);
    setScannerState((prev) => (prev === "target-found" ? "scanning" : prev));
  }, []);

  // Camera Permission Error Handler
  const handleCameraError = useCallback((errorMsg: string) => {
    setPermissionError(errorMsg);
    setScannerState("permission-denied");
  }, []);

  // Audio Mute Toggle
  const handleToggleMute = useCallback(() => {
    setIsMuted((prev) => !prev);
  }, []);

  // Simulation Mode Toggle for Desktop testing
  const handleToggleMockMode = useCallback(() => {
    setIsMockMode((prev) => {
      const nextMode = !prev;
      if (nextMode) {
        // Automatically start scanning in mock mode
        setScannerState("scanning");
      }
      return nextMode;
    });
  }, []);

  // Simulate Target Selection in Mock Mode
  const handleSimulateTarget = useCallback((index: number) => {
    const config = getARTarget(index);
    if (config) {
      handleTargetFound(config);
    }
  }, [handleTargetFound]);

  // Clear Simulated Target
  const handleClearSimulateTarget = useCallback(() => {
    handleTargetLost();
  }, [handleTargetLost]);

  return (
    <main className="relative w-full h-full min-h-screen bg-black overflow-hidden select-none">
      {/* 3D AR Camera & Video Layer */}
      <ARScanner
        isScanning={scannerState === "scanning" || scannerState === "target-found"}
        activeTargetIndex={activeTargetIndex}
        isMuted={isMuted}
        isMockMode={isMockMode}
        onTargetFound={handleTargetFound}
        onTargetLost={handleTargetLost}
        onCameraError={handleCameraError}
        onSceneReady={() => setIsSceneReady(true)}
      />

      {/* Romantic Full-Screen UI Layer */}
      <ScannerUI
        scannerState={scannerState}
        activeTarget={activeTarget}
        isMuted={isMuted}
        isMockMode={isMockMode}
        permissionError={permissionError}
        unlockedTargets={unlockedTargets}
        onStartScanning={handleStartScanning}
        onStopScanning={handleStopScanning}
        onToggleMute={handleToggleMute}
        onToggleMockMode={handleToggleMockMode}
        onSimulateTarget={handleSimulateTarget}
        onClearSimulateTarget={handleClearSimulateTarget}
      />
    </main>
  );
}
