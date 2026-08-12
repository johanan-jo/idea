"use client";

import React, { useEffect, useRef, useState } from "react";
import { AR_TARGETS, ARTargetConfig, TARGET_MIND_FILE } from "@/config/arTargets";

interface ARScannerProps {
  isScanning: boolean;
  activeTargetIndex: number | null;
  isMuted: boolean;
  isMockMode: boolean;
  onTargetFound: (target: ARTargetConfig) => void;
  onTargetLost: () => void;
  onCameraError: (errorMsg: string) => void;
  onSceneReady: () => void;
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
}: ARScannerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<any>(null);
  const [scriptsLoaded, setScriptsLoaded] = useState(false);
  const [scriptError, setScriptError] = useState<string | null>(null);
  const activeVideoRef = useRef<HTMLVideoElement | null>(null);
  const videoRefs = useRef<Map<number, HTMLVideoElement>>(new Map());

  // 1. Dynamically load A-Frame and MindAR scripts safely on client
  useEffect(() => {
    let isMounted = true;

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
        // Load A-Frame first
        if (!(window as any).AFRAME) {
          await loadScript(
            "https://aframe.io/releases/1.4.2/aframe.min.js",
            "aframe-script"
          );
        }
        // Load MindAR for A-Frame next
        if (!(window as any).MINDAR) {
          await loadScript(
            "https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image-aframe.prod.js",
            "mindar-script"
          );
        }

        if (isMounted) {
          setScriptsLoaded(true);
          onSceneReady();
        }
      } catch (err: any) {
        console.warn("Could not load MindAR scripts online. Falling back to simulation mode.", err);
        if (isMounted) {
          setScriptError("WebAR scripts loading fallback.");
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

  // 2. Start/Stop MindAR engine on user action
  useEffect(() => {
    if (!scriptsLoaded || isMockMode || !sceneRef.current) return;

    const sceneEl = sceneRef.current;

    const startAR = async () => {
      try {
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
        }
      } catch (err: any) {
        console.error("Camera startup error:", err);
        onCameraError("Camera access denied or unavailable.");
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
      } catch (e) {
        // Ignore stop errors
      }
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

  // 3. Audio state management across videos
  useEffect(() => {
    videoRefs.current.forEach((video) => {
      if (video) {
        video.muted = isMuted;
      }
    });
  }, [isMuted]);

  // 4. Target Found & Target Lost Handler Attachments
  useEffect(() => {
    if (!scriptsLoaded || isMockMode || !sceneRef.current) return;

    const sceneEl = sceneRef.current;
    const targetElements = sceneEl.querySelectorAll("a-mindar-image-target");

    const cleanups: Array<() => void> = [];

    targetElements.forEach((targetEl: any) => {
      const targetIndex = parseInt(targetEl.getAttribute("targetindex"), 10);

      const handleFound = () => {
        const config = AR_TARGETS[targetIndex];
        if (!config) return;

        // Pause previous video if any
        if (activeVideoRef.current && activeVideoRef.current !== videoRefs.current.get(targetIndex)) {
          activeVideoRef.current.pause();
        }

        // Play corresponding target video
        const targetVideo = videoRefs.current.get(targetIndex);
        if (targetVideo) {
          activeVideoRef.current = targetVideo;
          targetVideo.muted = isMuted;
          targetVideo.play().catch((e) => console.log("Video play request handled:", e));
        }

        onTargetFound(config);
      };

      const handleLost = () => {
        const targetVideo = videoRefs.current.get(targetIndex);
        if (targetVideo) {
          targetVideo.pause();
        }
        onTargetLost();
      };

      targetEl.addEventListener("targetFound", handleFound);
      targetEl.addEventListener("targetLost", handleLost);

      cleanups.push(() => {
        targetEl.removeEventListener("targetFound", handleFound);
        targetEl.removeEventListener("targetLost", handleLost);
      });
    });

    return () => {
      cleanups.forEach((cleanup) => cleanup());
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
    <div ref={containerRef} className="relative w-full h-full overflow-hidden bg-black">
      {/* 5. MindAR + A-Frame Scene Container */}
      {scriptsLoaded && !isMockMode && (
        <a-scene
          ref={sceneRef}
          mindar-image={`imageTargetSrc: ${TARGET_MIND_FILE}; autoStart: false; uiLoading: yes; uiError: yes; uiScanning: yes; filterMinCF: 0.0001; filterBeta: 0.001;`}
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

      {/* 6. Mock / Desktop Preview Mode Video Player Container */}
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
