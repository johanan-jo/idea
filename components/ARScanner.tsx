"use client";

import React, { useEffect, useRef, useState } from "react";
import { AR_TARGETS, ARTargetConfig, TARGET_MIND_FILE } from "@/config/arTargets";

export interface ARTelemetryState {
  cameraStatus: "idle" | "requesting" | "ready" | "error";
  mindarStatus: "uninitialized" | "loading_scripts" | "ready" | "starting" | "running" | "error";
  targetFileStatus: "checking" | "valid" | "missing" | "error";
  targetFileSize?: string;
  trackingStatus: "idle" | "scanning" | "target_found";
  detectedTargetIndex: number | null;
  detectedTargetName: string | null;
  videoStatus: "idle" | "loading" | "playing" | "paused" | "error";
  videoUrl: string | null;
  lastError: string | null;
}

interface ARScannerProps {
  isScanning: boolean;
  activeTargetIndex: number | null;
  isMuted: boolean;
  isMockMode: boolean;
  onTargetFound: (target: ARTargetConfig) => void;
  onTargetLost: () => void;
  onCameraError: (errorMsg: string) => void;
  onSceneReady: () => void;
  onTelemetryUpdate?: (telemetry: ARTelemetryState) => void;
}

export default function ARScanner({
  isScanning,
  activeTargetIndex,
  isMuted,
  isMockMode,
  onTargetFound,
  onTargetLost,
  onCameraError,
  onSceneReady,
  onTelemetryUpdate,
}: ARScannerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<any>(null);
  const [scriptsLoaded, setScriptsLoaded] = useState(false);
  const [targetFileVerified, setTargetFileVerified] = useState(false);
  const activeVideoRef = useRef<HTMLVideoElement | null>(null);
  const videoRefs = useRef<Map<number, HTMLVideoElement>>(new Map());

  const [telemetry, setTelemetry] = useState<ARTelemetryState>({
    cameraStatus: "idle",
    mindarStatus: "uninitialized",
    targetFileStatus: "checking",
    trackingStatus: "idle",
    detectedTargetIndex: null,
    detectedTargetName: null,
    videoStatus: "idle",
    videoUrl: null,
    lastError: null,
  });

  const updateTelemetry = (patch: Partial<ARTelemetryState>) => {
    setTelemetry((prev) => {
      const updated = { ...prev, ...patch };
      if (onTelemetryUpdate) {
        onTelemetryUpdate(updated);
      }
      return updated;
    });
  };

  // 1. Pre-flight Verification of /targets/targets.mind target file
  useEffect(() => {
    let isMounted = true;
    const verifyTargetFile = async () => {
      updateTelemetry({ targetFileStatus: "checking" });
      try {
        const response = await fetch(TARGET_MIND_FILE, { method: "HEAD" });
        if (!response.ok && response.status !== 405) {
          // If HEAD fails, try GET fallback
          const getRes = await fetch(TARGET_MIND_FILE, { method: "GET" });
          if (!getRes.ok) {
            throw new Error(`HTTP ${getRes.status} ${getRes.statusText}`);
          }
          const blob = await getRes.blob();
          const sizeKb = (blob.size / 1024).toFixed(1) + " KB";
          if (isMounted) {
            setTargetFileVerified(true);
            updateTelemetry({ targetFileStatus: "valid", targetFileSize: sizeKb });
          }
          return;
        }

        const sizeHeader = response.headers.get("content-length");
        const sizeKb = sizeHeader ? (parseInt(sizeHeader, 10) / 1024).toFixed(1) + " KB" : "Verified";

        if (isMounted) {
          setTargetFileVerified(true);
          updateTelemetry({ targetFileStatus: "valid", targetFileSize: sizeKb });
        }
      } catch (err: any) {
        console.error("Target file verification error:", err);
        const msg = `Target file targets.mind could not be loaded from ${TARGET_MIND_FILE} (${err.message}). Check /public/targets/targets.mind`;
        if (isMounted) {
          setTargetFileVerified(false);
          updateTelemetry({
            targetFileStatus: "missing",
            lastError: msg,
          });
          onCameraError(msg);
        }
      }
    };

    verifyTargetFile();

    return () => {
      isMounted = false;
    };
  }, []);

  // 2. Dynamically load A-Frame and MindAR scripts safely on client
  useEffect(() => {
    let isMounted = true;
    updateTelemetry({ mindarStatus: "loading_scripts" });

    const loadScript = (src: string, id: string): Promise<void> => {
      return new Promise((resolve, reject) => {
        if (document.getElementById(id)) {
          resolve();
          return;
        }
        const script = document.createElement("script");
        script.id = id;
        script.src = src;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
        document.head.appendChild(script);
      });
    };

    const initScripts = async () => {
      try {
        if (!(window as any).AFRAME) {
          await loadScript(
            "https://aframe.io/releases/1.4.2/aframe.min.js",
            "aframe-script"
          );
        }
        if (!(window as any).MINDAR) {
          await loadScript(
            "https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image-aframe.prod.js",
            "mindar-script"
          );
        }

        if (isMounted) {
          setScriptsLoaded(true);
          updateTelemetry({ mindarStatus: "ready" });
          onSceneReady();
        }
      } catch (err: any) {
        console.warn("Could not load MindAR scripts online.", err);
        if (isMounted) {
          updateTelemetry({
            mindarStatus: "error",
            lastError: "Failed to load A-Frame or MindAR CDN script",
          });
          setScriptsLoaded(true);
          onSceneReady();
        }
      }
    };

    initScripts();

    return () => {
      isMounted = false;
    };
  }, []);

  // 3. Manage Body & HTML class for transparent background when scanning
  useEffect(() => {
    if (isScanning && !isMockMode) {
      document.body.classList.add("ar-active");
      document.documentElement.classList.add("ar-active");
    } else {
      document.body.classList.remove("ar-active");
      document.documentElement.classList.remove("ar-active");
    }

    return () => {
      document.body.classList.remove("ar-active");
      document.documentElement.classList.remove("ar-active");
    };
  }, [isScanning, isMockMode]);

  // 4. Start/Stop MindAR engine on user action
  useEffect(() => {
    if (!scriptsLoaded || isMockMode || !sceneRef.current) return;

    const sceneEl = sceneRef.current;

    const startAR = async () => {
      try {
        updateTelemetry({ mindarStatus: "starting", cameraStatus: "requesting" });

        // Ensure scene is loaded first
        if (!sceneEl.hasLoaded) {
          await new Promise((res) => sceneEl.addEventListener("loaded", res, { once: true }));
        }

        const arSystem = sceneEl.systems && sceneEl.systems["mindar-image-system"];
        if (arSystem && isScanning) {
          // Safeguard against missing UI object in MindAR system internals
          if (!arSystem.ui) {
            arSystem.ui = {
              showLoading: () => {},
              hideLoading: () => {},
              showScanning: () => {},
              hideScanning: () => {},
              showError: () => {},
            };
          }
          await arSystem.start();
          updateTelemetry({
            mindarStatus: "running",
            cameraStatus: "ready",
            trackingStatus: "scanning",
          });
        }
      } catch (err: any) {
        console.error("MindAR camera startup error:", err);
        const errorMsg = `AR Initialization Failed: ${err.message || "Camera access failed or binary targets.mind incompatible."}`;
        updateTelemetry({
          mindarStatus: "error",
          cameraStatus: "error",
          lastError: errorMsg,
        });
        onCameraError(errorMsg);
      }
    };

    if (isScanning) {
      startAR();
    } else {
      try {
        const arSystem = sceneEl.systems && sceneEl.systems["mindar-image-system"];
        if (arSystem) {
          arSystem.stop();
        }
        updateTelemetry({
          mindarStatus: "ready",
          trackingStatus: "idle",
          detectedTargetIndex: null,
          detectedTargetName: null,
          videoStatus: "idle",
        });
      } catch (e) {}
    }

    return () => {
      try {
        const arSystem = sceneEl.systems && sceneEl.systems["mindar-image-system"];
        if (arSystem) {
          arSystem.stop();
        }
      } catch (e) {}
    };
  }, [isScanning, scriptsLoaded, isMockMode]);

  // 5. Audio state management across videos
  useEffect(() => {
    videoRefs.current.forEach((video) => {
      if (video) {
        video.muted = isMuted;
      }
    });
  }, [isMuted]);

  // 6. Target Found & Target Lost Handler Attachments
  useEffect(() => {
    if (!scriptsLoaded || isMockMode || !sceneRef.current) return;

    const sceneEl = sceneRef.current;

    const attachListeners = () => {
      const targetElements = sceneEl.querySelectorAll("a-mindar-image-target");
      const cleanups: Array<() => void> = [];

      targetElements.forEach((targetEl: any) => {
        const targetIndex = parseInt(targetEl.getAttribute("targetindex"), 10);

        const handleFound = () => {
          console.log(`[MindAR Event] targetFound triggered for Target Index: ${targetIndex}`);
          const config = AR_TARGETS[targetIndex];
          if (!config) {
            console.warn(`No target configuration mapped for index ${targetIndex}`);
            return;
          }

          // Pause all other target videos
          videoRefs.current.forEach((vid, idx) => {
            if (idx !== targetIndex && vid) {
              vid.pause();
              vid.currentTime = 0;
            }
          });

          // Play corresponding target video
          const targetVideo = videoRefs.current.get(targetIndex);
          if (targetVideo) {
            activeVideoRef.current = targetVideo;
            targetVideo.currentTime = 0;
            targetVideo.muted = isMuted;
            
            const playPromise = targetVideo.play();
            if (playPromise !== undefined) {
              playPromise
                .then(() => {
                  console.log(`[Video] Playback started for Target #${targetIndex} (${config.videoUrl})`);
                  updateTelemetry({
                    trackingStatus: "target_found",
                    detectedTargetIndex: targetIndex,
                    detectedTargetName: config.title,
                    videoStatus: "playing",
                    videoUrl: config.videoUrl,
                  });
                })
                .catch((e) => {
                  console.warn(`[Video] Playback promise rejected (Autoplay blocked or format error):`, e);
                  updateTelemetry({
                    trackingStatus: "target_found",
                    detectedTargetIndex: targetIndex,
                    detectedTargetName: config.title,
                    videoStatus: "error",
                    videoUrl: config.videoUrl,
                    lastError: `Video playback error: ${e.message}`,
                  });
                });
            }
          }

          onTargetFound(config);
        };

        const handleLost = () => {
          console.log(`[MindAR Event] targetLost triggered for Target Index: ${targetIndex}`);
          const targetVideo = videoRefs.current.get(targetIndex);
          if (targetVideo) {
            targetVideo.pause();
          }

          updateTelemetry({
            trackingStatus: "scanning",
            detectedTargetIndex: null,
            detectedTargetName: null,
            videoStatus: "paused",
          });

          onTargetLost();
        };

        targetEl.addEventListener("targetFound", handleFound);
        targetEl.addEventListener("targetLost", handleLost);

        cleanups.push(() => {
          targetEl.removeEventListener("targetFound", handleFound);
          targetEl.removeEventListener("targetLost", handleLost);
        });
      });

      return cleanups;
    };

    let activeCleanups: Array<() => void> = [];

    if (sceneEl.hasLoaded) {
      activeCleanups = attachListeners();
    } else {
      sceneEl.addEventListener(
        "loaded",
        () => {
          activeCleanups = attachListeners();
        },
        { once: true }
      );
    }

    return () => {
      activeCleanups.forEach((cleanup) => cleanup());
    };
  }, [scriptsLoaded, isMockMode, isMuted]);

  // Helper to store video element refs
  const setVideoRef = (index: number, el: HTMLVideoElement | null) => {
    if (el) {
      videoRefs.current.set(index, el);
    } else {
      videoRefs.current.delete(index);
    }
  };

  const targetsList = Object.values(AR_TARGETS);

  return (
    <div
      ref={containerRef}
      className={`fixed inset-0 w-full h-full min-h-screen overflow-hidden ${
        isScanning ? "bg-transparent" : "bg-black"
      }`}
    >
      {/* MindAR + A-Frame Scene Container */}
      {scriptsLoaded && !isMockMode && (
        <a-scene
          ref={sceneRef}
          mindar-image={`imageTargetSrc: ${TARGET_MIND_FILE}; autoStart: false; uiLoading: no; uiError: no; uiScanning: no; filterMinCF: 0.0001; filterBeta: 0.001;`}
          embedded
          color-space="sRGB"
          renderer="colorManagement: true, physicallyCorrectLights"
          vr-mode-ui="enabled: false"
          device-orientation-permission-ui="enabled: false"
          className="absolute inset-0 w-full h-full z-10"
        >
          {/* AR Video Assets */}
          <a-assets>
            {targetsList.map((target) => (
              <video
                key={target.targetIndex}
                id={`ar-video-${target.targetIndex}`}
                ref={(el: HTMLVideoElement | null) => setVideoRef(target.targetIndex, el)}
                src={target.videoUrl}
                preload="auto"
                loop
                crossOrigin="anonymous"
                playsInline
                webkit-playsinline="true"
                muted={isMuted}
              />
            ))}
          </a-assets>

          {/* AR Camera */}
          <a-camera position="0 0 0" look-controls="enabled: false" />

          {/* Image Targets Anchored 3D Video Planes */}
          {targetsList.map((target) => (
            <a-mindar-image-target
              key={target.targetIndex}
              targetindex={target.targetIndex}
            >
              {/* Video texture plane anchored directly to physical photo */}
              <a-plane
                src={`#ar-video-${target.targetIndex}`}
                position="0 0 0"
                height={target.planeHeight || 1}
                width={target.planeWidth || 1}
                rotation="0 0 0"
              />
            </a-mindar-image-target>
          ))}
        </a-scene>
      )}

      {/* Mock / Desktop Preview Mode Video Player Container */}
      {isMockMode && activeTargetIndex !== null && (
        <div className="absolute inset-0 flex items-center justify-center p-4 z-20 bg-black/80 backdrop-blur-sm">
          <div className="relative w-full max-w-sm aspect-square rounded-2xl overflow-hidden shadow-2xl border border-pink-500/30 glow-rose">
            <video
              src={AR_TARGETS[activeTargetIndex]?.videoUrl}
              autoPlay
              loop
              playsInline
              muted={isMuted}
              className="w-full h-full object-cover"
            />
            <div className="absolute bottom-2 left-2 right-2 p-3 glass-panel rounded-xl text-center">
              <span className="text-xs uppercase tracking-widest text-pink-400 font-semibold">
                Simulated Target #{activeTargetIndex}
              </span>
              <p className="text-sm font-bold text-white">
                {AR_TARGETS[activeTargetIndex]?.title}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

