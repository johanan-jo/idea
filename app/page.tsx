"use client";

import React, { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Sparkles, Camera, Heart, Gift, BookOpen, ChevronRight, Image as ImageIcon, ShieldCheck } from "lucide-react";
import BackgroundParticles from "@/components/BackgroundParticles";
import PasswordModal from "@/components/PasswordModal";
import { getAllARTargets } from "@/config/arTargets";

export default function LandingPage() {
  const [isLocked, setIsLocked] = useState(false); // Can set to true for lock default
  const targets = getAllARTargets();

  return (
    <main className="relative min-h-screen w-full flex flex-col justify-between p-4 sm:p-8 overflow-x-hidden selection:bg-pink-500 selection:text-white">
      <BackgroundParticles />
      <PasswordModal isOpen={isLocked} onUnlock={() => setIsLocked(false)} />

      {/* Main Content Area */}
      <div className="relative z-10 w-full max-w-2xl mx-auto flex flex-col gap-8 my-auto py-8">
        {/* Header Badge & Title */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center flex flex-col items-center"
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass-panel border border-pink-500/30 text-xs font-semibold uppercase tracking-widest text-pink-300 mb-6 glow-rose">
            <Sparkles className="w-3.5 h-3.5 text-amber-300 animate-spin" style={{ animationDuration: "6s" }} />
            <span>Romantic WebAR Birthday Edition</span>
          </div>

          <h1 className="text-4xl sm:text-6xl font-serif font-bold text-gradient-rose tracking-tight mb-4 leading-tight">
            Memories Brought To Life
          </h1>

          <p className="text-sm sm:text-base text-pink-100/80 max-w-lg leading-relaxed font-light">
            Point your camera at your physical photographs. Watch your special moments unfold in 3D augmented reality video.
          </p>
        </motion.div>

        {/* Primary Action Card: Launch AR Scanner */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="glass-panel p-6 sm:p-8 rounded-3xl border border-pink-500/30 shadow-2xl relative overflow-hidden group hover:border-pink-500/50 transition-all"
        >
          {/* Subtle glowing background highlight */}
          <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-bl from-pink-500/20 via-rose-500/10 to-transparent rounded-full blur-2xl pointer-events-none group-hover:scale-110 transition-transform duration-700" />

          <div className="relative z-10 flex flex-col sm:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-4 text-left">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-pink-500 via-rose-500 to-amber-500 flex items-center justify-center text-white shadow-xl glow-rose shrink-0 animate-float">
                <Camera className="w-8 h-8" />
              </div>

              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-pink-400">
                  Core Experience
                </span>
                <h2 className="text-2xl font-serif font-bold text-white mb-1">
                  AR Photo Scanner
                </h2>
                <p className="text-xs text-pink-100/70">
                  Instant image tracking • No QR codes • 3D Video Overlay
                </p>
              </div>
            </div>

            <Link
              href="/scanner"
              className="w-full sm:w-auto py-4 px-8 rounded-2xl bg-gradient-to-r from-pink-500 via-rose-500 to-amber-500 text-white font-bold text-sm tracking-wider uppercase shadow-xl hover:shadow-pink-500/30 hover:scale-[1.03] active:scale-[0.98] transition-all flex items-center justify-center gap-2 glow-rose whitespace-nowrap"
            >
              <span>OPEN SCANNER</span>
              <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
        </motion.div>

        {/* Secondary Birthday Flow Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="grid grid-cols-1 sm:grid-cols-2 gap-4"
        >
          <Link
            href="/birthday"
            className="glass-panel p-5 rounded-2xl border border-pink-500/20 hover:border-pink-500/40 transition-all flex items-center justify-between group"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-pink-500/20 flex items-center justify-center text-pink-300 group-hover:scale-110 transition-transform">
                <BookOpen className="w-5 h-5" />
              </div>
              <div className="text-left">
                <h3 className="text-sm font-serif font-bold text-white">Birthday Letter</h3>
                <p className="text-[11px] text-pink-200/70">Read love notes & timeline</p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-pink-400 group-hover:translate-x-1 transition-transform" />
          </Link>

          <Link
            href="/surprise"
            className="glass-panel-gold p-5 rounded-2xl border border-amber-500/30 hover:border-amber-500/50 transition-all flex items-center justify-between group"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center text-amber-300 group-hover:scale-110 transition-transform">
                <Gift className="w-5 h-5" />
              </div>
              <div className="text-left">
                <h3 className="text-sm font-serif font-bold text-amber-100">Final Surprise</h3>
                <p className="text-[11px] text-amber-200/70">Unlock secret gift box</p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-amber-400 group-hover:translate-x-1 transition-transform" />
          </Link>
        </motion.div>

        {/* Configured Memory Targets Preview */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.5 }}
          className="glass-panel p-6 rounded-3xl border border-pink-500/20 text-left"
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-serif font-bold text-white flex items-center gap-2">
              <ImageIcon className="w-4 h-4 text-pink-400" />
              <span>Configured Photo Memories ({targets.length})</span>
            </h3>
            <span className="text-xs text-pink-300/60 font-mono">targets.mind</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {targets.map((t) => (
              <div
                key={t.targetIndex}
                className="p-3 rounded-xl bg-white/5 border border-white/10 flex items-center gap-3"
              >
                <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${t.previewColor || 'from-pink-500 to-rose-600'} flex items-center justify-center font-bold text-white text-xs shrink-0 shadow-md`}>
                  #{t.targetIndex}
                </div>
                <div className="min-w-0">
                  <h4 className="text-xs font-bold text-white truncate">{t.title}</h4>
                  <p className="text-[10px] text-pink-200/70 truncate">{t.subtitle}</p>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      </div>

      {/* Footer Info */}
      <div className="relative z-10 text-center py-4 text-xs text-pink-200/50 flex items-center justify-center gap-2 font-light">
        <ShieldCheck className="w-3.5 h-3.5 text-pink-400" />
        <span>Mobile-First WebAR • Powered by MindAR & Next.js</span>
      </div>
    </main>
  );
}
