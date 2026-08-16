"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Gift, Heart, Sparkles, ArrowLeft, Camera, PartyPopper } from "lucide-react";
import confetti from "canvas-confetti";
import BackgroundParticles from "@/components/BackgroundParticles";

export default function SurprisePage() {
  const [opened, setOpened] = useState(false);

  const triggerCelebration = () => {
    setOpened(true);
    // Fire confetti cannon
    confetti({
      particleCount: 120,
      spread: 80,
      origin: { y: 0.6 },
      colors: ["#ff4b72", "#ff85a1", "#f7d070", "#ffffff"],
    });

    // Secondary delayed burst
    setTimeout(() => {
      confetti({
        particleCount: 80,
        angle: 60,
        spread: 55,
        origin: { x: 0 },
        colors: ["#ff4b72", "#f7d070"],
      });
      confetti({
        particleCount: 80,
        angle: 120,
        spread: 55,
        origin: { x: 1 },
        colors: ["#ff85a1", "#ffffff"],
      });
    }, 400);
  };

  useEffect(() => {
    // Fire initial gentle confetti on load
    triggerCelebration();
  }, []);

  return (
    <main className="relative min-h-screen w-full p-4 sm:p-8 overflow-x-hidden flex flex-col justify-between selection:bg-pink-500 selection:text-white">
      <BackgroundParticles />

      <div className="relative z-10 max-w-xl mx-auto w-full my-auto py-8 text-center flex flex-col items-center gap-6">
        {/* Navigation */}
        <div className="w-full flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-2 px-4 py-2 rounded-full glass-panel text-xs font-medium text-pink-200 hover:text-white transition-all"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Home</span>
          </Link>

          <Link
            href="/scanner"
            className="flex items-center gap-2 px-4 py-2 rounded-full bg-pink-600 text-white text-xs font-bold shadow-lg glow-rose hover:scale-105 transition-all"
          >
            <Camera className="w-4 h-4" />
            <span>Scan Memories</span>
          </Link>
        </div>

        {/* Surprise Box Card */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full glass-panel-gold p-8 sm:p-10 rounded-3xl border border-amber-500/40 shadow-2xl flex flex-col items-center relative overflow-hidden"
        >
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-bold uppercase tracking-widest mb-6">
            <PartyPopper className="w-4 h-4" />
            <span>Birthday Grand Finale</span>
          </div>

          <div
            onClick={triggerCelebration}
            className="w-24 h-24 rounded-3xl bg-gradient-to-tr from-amber-400 via-rose-500 to-pink-500 flex items-center justify-center text-white shadow-2xl glow-gold mb-6 cursor-pointer hover:scale-110 active:scale-95 transition-transform duration-300 animate-float"
          >
            <Gift className="w-12 h-12" />
          </div>

          <h1 className="text-3xl sm:text-5xl font-serif font-bold text-gradient-gold mb-3">
            Happppyyyyyyyyyyyyy Birthdayyyyyyyyyyyyy Ajitha❤️✨
          </h1>

          <p className="text-sm text-amber-100/90 leading-relaxed font-light mb-8 max-w-md">
            You&apos;ve seen a little of what we&apos;ve shared so far. But there&apos;s still so much more to come, more laughter, more memories, and more moments that we&apos;ll one day look back on and smile.
          </p>

          <button
            onClick={triggerCelebration}
            className="py-4 px-8 rounded-2xl bg-gradient-to-r from-amber-400 via-rose-500 to-pink-500 text-white font-bold text-sm uppercase tracking-wider shadow-xl hover:shadow-amber-500/30 hover:scale-[1.03] active:scale-[0.98] transition-all flex items-center justify-center gap-2 glow-gold"
          >
            <Sparkles className="w-5 h-5 text-amber-200" />
            <span>CELEBRATE MEMORIES AGAIN</span>
          </button>
        </motion.div>
      </div>

      <div className="relative z-10 text-center py-4 text-xs text-amber-200/50">
        Created with ❤️ for a unforgettable birthday experience
      </div>
    </main>
  );
}
