"use client";

import React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Heart, ArrowLeft, Camera, Sparkles, Gift } from "lucide-react";
import BackgroundParticles from "@/components/BackgroundParticles";

export default function BirthdayPage() {
  return (
    <main className="relative min-h-screen w-full p-4 sm:p-8 overflow-x-hidden selection:bg-pink-500 selection:text-white">
      <BackgroundParticles />

      <div className="relative z-10 max-w-2xl mx-auto flex flex-col gap-8 py-6">
        {/* Top Navigation */}
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-2 px-4 py-2 rounded-full glass-panel text-xs font-medium text-pink-200 hover:text-white transition-all"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Home</span>
          </Link>
        </div>

        {/* Romantic Letter Banner */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-panel p-8 sm:p-10 rounded-3xl border border-pink-500/30 shadow-2xl text-center flex flex-col items-center relative overflow-hidden"
        >
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-pink-500 to-rose-600 flex items-center justify-center text-white shadow-xl glow-rose mb-6 animate-float">
            <Heart className="w-8 h-8 fill-white" />
          </div>

          <span className="text-xs uppercase tracking-widest text-pink-400 font-semibold mb-2">
            A Birthday Gift of Memories
          </span>

          <h1 className="text-3xl sm:text-5xl font-serif font-bold text-gradient-rose mb-6">
            Happy Birthday, My Love ✨
          </h1>

          <div className="text-sm text-pink-100/90 leading-relaxed font-serif space-y-4 max-w-lg text-left border-l-2 border-pink-500/40 pl-6 py-2">
            <p className="italic">
              Every photograph with you holds more than just a moment frozen in time. It carries pieces of us, little memories, quiet emotions, laughter, and moments that words could never fully explain. Every moment spent with you has its own kind of beauty, and these pictures hold a little piece of all of that.
            </p>
            <p className="italic">
              But this time, I want you to experience a few of those memories through the words, stories, and wishes of the people who know and love you too.
            </p>
            <p className="italic">
              So, take a moment, listen, and let yourself relive a little bit of what makes you so special.
            </p>
            <p className="not-italic text-pink-300 font-medium mt-2">
              With Love<br />— Jo ✨
            </p>
          </div>
        </motion.div>

        {/* Scan Memories CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="glass-panel p-8 rounded-3xl border border-pink-500/30 text-center flex flex-col items-center gap-5"
        >
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-pink-500 via-rose-500 to-amber-400 flex items-center justify-center shadow-xl glow-rose animate-float">
            <Camera className="w-8 h-8 text-white" />
          </div>

          <div>
            <h2 className="text-2xl font-serif font-bold text-white mb-2 flex items-center justify-center gap-2">
              <Sparkles className="w-5 h-5 text-amber-300" />
              Scan Your Memories
            </h2>
            <p className="text-sm text-pink-200/80 max-w-sm leading-relaxed">
              Point your camera at any printed photo and tap the shutter. Each photograph reveals a hidden memory video made just for you.
            </p>
          </div>

          <Link
            href="/scanner"
            className="w-full max-w-xs py-4 rounded-2xl bg-gradient-to-r from-pink-500 via-rose-500 to-amber-500 text-white font-bold text-sm tracking-wide shadow-xl flex items-center justify-center gap-2 glow-rose hover:scale-[1.02] active:scale-[0.98] transition-all"
          >
            <Camera className="w-5 h-5" /> Open Memory Scanner
          </Link>
        </motion.div>

        {/* Final Surprise Link Banner */}
        <div className="glass-panel-gold p-6 rounded-3xl border border-amber-500/30 text-center flex flex-col items-center gap-3">
          <Gift className="w-8 h-8 text-amber-300 animate-bounce" />
          <h3 className="text-xl font-serif font-bold text-amber-100">Ready for the final surprise?</h3>
          <p className="text-xs text-amber-200/80 max-w-sm">
            Once you have scanned the memories, open your special birthday celebration page!
          </p>
          <Link
            href="/surprise"
            className="mt-2 py-3 px-6 rounded-xl bg-gradient-to-r from-amber-400 to-rose-500 text-white font-bold text-xs uppercase tracking-wider shadow-lg glow-gold hover:scale-105 transition-all"
          >
            Unlock Final Surprise 🎉
          </Link>
        </div>
      </div>
    </main>
  );
}
