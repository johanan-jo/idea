"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, Upload, SlidersHorizontal, Download, Sparkles, CheckCircle2, AlertCircle } from "lucide-react";

export default function CompilerPage() {
  const [images, setImages] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [isCompiling, setIsCompiling] = useState(false);
  const [progress, setProgress] = useState(0);
  const [compiledData, setCompiledData] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [compilerReady, setCompilerReady] = useState(false);

  useEffect(() => {
    // Dynamically load MindAR target compiler script
    if ((window as any).MINDAR?.IMAGE?.Compiler) {
      setCompilerReady(true);
      return;
    }

    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image-target.prod.js";
    script.async = true;
    script.onload = () => setCompilerReady(true);
    script.onerror = () => setError("Failed to load MindAR image target compiler library");
    document.head.appendChild(script);
  }, []);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const fileList = Array.from(e.target.files);
    setImages(fileList);

    const previewUrls = fileList.map((file) => URL.createObjectURL(file));
    setPreviews(previewUrls);
    setCompiledData(null);
    setError(null);
  };

  const handleCompile = async () => {
    if (images.length === 0) return;
    setIsCompiling(true);
    setProgress(0);
    setError(null);

    try {
      if (!(window as any).MINDAR?.IMAGE?.Compiler) {
        throw new Error("MindAR Compiler library not loaded yet.");
      }

      const compiler = new (window as any).MINDAR.IMAGE.Compiler();

      // Convert uploaded file list to HTMLImageElements
      const imgElements: HTMLImageElement[] = [];
      for (const previewUrl of previews) {
        const img = new Image();
        img.src = previewUrl;
        await new Promise((res) => {
          img.onload = res;
        });
        imgElements.push(img);
      }

      // Run MindAR Target compilation
      await compiler.compileImageTargets(imgElements, (prog: number) => {
        setProgress(Math.round(prog));
      });

      const exportedBuffer = await compiler.exportData();
      const u8Data = new Uint8Array(exportedBuffer);
      setCompiledData(u8Data);
      setIsCompiling(false);
    } catch (err: any) {
      console.error("Compilation error:", err);
      setError(err.message || "Failed to compile image targets.");
      setIsCompiling(false);
    }
  };

  const handleDownload = () => {
    if (!compiledData) return;
    const blob = new Blob([compiledData.buffer as BlobPart], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "targets.mind";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <main className="min-h-screen w-full bg-[#090510] text-white p-4 sm:p-8 flex flex-col items-center">
      <div className="w-full max-w-2xl flex flex-col gap-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <Link
            href="/scanner"
            className="flex items-center gap-2 px-4 py-2 rounded-full glass-panel text-xs font-semibold text-pink-200 hover:text-white transition-all"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Scanner</span>
          </Link>

          <span className="text-xs uppercase tracking-widest text-pink-400 font-semibold">
            MindAR Target Tool
          </span>
        </div>

        {/* Card Panel */}
        <div className="glass-panel p-6 sm:p-8 rounded-3xl border border-pink-500/30 shadow-2xl flex flex-col gap-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-pink-500 to-rose-600 flex items-center justify-center text-white shadow-lg glow-rose">
              <SlidersHorizontal className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-serif font-bold text-gradient-rose">
                MindAR Target Compiler
              </h1>
              <p className="text-xs text-pink-200/80">
                Compile your physical photographs into a binary <code className="text-pink-300">targets.mind</code> target file.
              </p>
            </div>
          </div>

          {/* Workflow Pipeline Explainer */}
          <div className="p-4 rounded-2xl bg-white/5 border border-pink-500/20 text-xs flex flex-col gap-2">
            <span className="font-bold text-pink-300">Compilation Pipeline:</span>
            <div className="flex items-center justify-between text-[11px] text-pink-100/80 font-mono flex-wrap gap-1">
              <span>Source Photos</span>
              <span>→</span>
              <span>MindAR Compiler</span>
              <span>→</span>
              <span>targets.mind</span>
              <span>→</span>
              <span className="text-amber-300">public/targets/targets.mind</span>
            </div>
          </div>

          {/* Upload Area */}
          <div className="flex flex-col gap-3">
            <label className="text-xs font-semibold text-pink-200 uppercase tracking-wider">
              1. Select Physical Photos (in order: Target #0, Target #1, Target #2...)
            </label>
            <label className="border-2 border-dashed border-pink-500/40 rounded-2xl p-8 flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-pink-400 hover:bg-pink-500/5 transition-all">
              <Upload className="w-8 h-8 text-pink-400" />
              <span className="text-sm font-medium text-pink-100">
                Click to upload JPG / PNG photos
              </span>
              <span className="text-xs text-gray-400">Multiple files supported</span>
              <input
                type="file"
                multiple
                accept="image/png, image/jpeg"
                onChange={handleImageUpload}
                className="hidden"
              />
            </label>
          </div>

          {/* Previews List */}
          {previews.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold text-pink-200 uppercase tracking-wider">
                Selected Photos ({previews.length}):
              </span>
              <div className="grid grid-cols-4 gap-2">
                {previews.map((url, idx) => (
                  <div
                    key={idx}
                    className="relative aspect-square rounded-xl overflow-hidden border border-pink-500/30 group"
                  >
                    <img src={url} alt={`Target ${idx}`} className="w-full h-full object-cover" />
                    <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-black/70 text-[10px] font-bold text-pink-300">
                      Target #{idx}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Compile Button & Progress */}
          {previews.length > 0 && !compiledData && (
            <button
              onClick={handleCompile}
              disabled={isCompiling || !compilerReady}
              className="w-full py-4 rounded-2xl bg-gradient-to-r from-pink-500 via-rose-500 to-amber-500 text-white font-bold text-sm tracking-wide shadow-xl flex items-center justify-center gap-2 glow-rose disabled:opacity-50"
            >
              <Sparkles className="w-5 h-5 text-amber-200" />
              <span>{isCompiling ? `COMPILING FEATURES (${progress}%)...` : "START COMPILATION"}</span>
            </button>
          )}

          {/* Download Output */}
          {compiledData && (
            <div className="p-5 rounded-2xl bg-emerald-950/40 border border-emerald-500/40 flex flex-col gap-3">
              <div className="flex items-center gap-2 text-emerald-300 font-bold text-sm">
                <CheckCircle2 className="w-5 h-5" />
                <span>Compilation Complete! ({(compiledData.length / 1024).toFixed(1)} KB)</span>
              </div>
              <p className="text-xs text-emerald-200/80 leading-relaxed">
                Download your compiled <code className="text-emerald-100">targets.mind</code> file and save it to <code className="text-amber-300">/public/targets/targets.mind</code>.
              </p>
              <button
                onClick={handleDownload}
                className="w-full py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs uppercase tracking-wider shadow-lg flex items-center justify-center gap-2"
              >
                <Download className="w-4 h-4" />
                <span>DOWNLOAD TARGETS.MIND</span>
              </button>
            </div>
          )}

          {error && (
            <div className="p-4 rounded-2xl bg-rose-950/50 border border-rose-500/40 text-xs text-rose-300 flex items-center gap-2">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
