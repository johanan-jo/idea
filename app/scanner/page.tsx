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

  // Camera Permission Error Handler
  const handleCameraError = useCallback((errorMsg: string) => {
    setPermissionError(errorMsg);
    setScannerState("permission-denied");
  }, []);

  // Start Scanning Trigger with explicit user-gesture camera permission request
  const handleStartScanning = useCallback(async () => {
    setPermissionError(null);

    if (isMockMode) {
      setScannerState("scanning");
      return;
    }

    // Explicit getUserMedia call inside user click handler to satisfy iOS Safari & mobile Chrome security requirements
    if (typeof window !== "undefined" && navigator?.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });

        // Release temporary test stream so MindAR can claim camera stream
        stream.getTracks().forEach((track) => track.stop());
        setScannerState("scanning");
      } catch (err: any) {
        console.error("Camera permission request failed:", err);
        const isNotAllowed =
          err.name === "NotAllowedError" || err.name === "PermissionDeniedError";
        handleCameraError(
          isNotAllowed
            ? "Camera access denied. Please allow camera permissions in your browser site settings and try again."
            : "Could not access mobile camera. Please ensure HTTPS connection and camera availability."
        );
      }
    } else {
      setScannerState("scanning");
    }
  }, [isMockMode, handleCameraError]);

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

  // Audio Mute Toggle
  const handleToggleMute = useCallback(() => {
    setIsMuted((prev) => !prev);
  }, []);

  // Simulation Mode Toggle for Desktop testing
  const handleToggleMockMode = useCallback(() => {
    setIsMockMode((prev) => {
      const nextMode = !prev;
      if (nextMode) {
        setScannerState("scanning");
      }
      return nextMode;
    });
  }, []);

  // Simulate Target Selection in Mock Mode
  const handleSimulateTarget = useCallback(
    (index: number) => {
      const config = getARTarget(index);
      if (config) {
        handleTargetFound(config);
      }
    },
    [handleTargetFound]
  );

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
