"use client";

import React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Heart, ArrowLeft, Camera, Sparkles, Calendar, MapPin, Gift } from "lucide-react";
import BackgroundParticles from "@/components/BackgroundParticles";
import { getAllARTargets } from "@/config/arTargets";

export default function BirthdayPage() {
  const targets = getAllARTargets();

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

          <Link
            href="/scanner"
            className="flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-pink-500 to-rose-600 text-white text-xs font-bold shadow-lg glow-rose hover:scale-[1.03] transition-all"
          >
            <Camera className="w-4 h-4" />
            <span>Open AR Scanner</span>
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
            Happy Birthday, My Love
          </h1>

          <div className="text-sm text-pink-100/90 leading-relaxed font-serif space-y-4 max-w-lg text-left italic border-l-2 border-pink-500/40 pl-6 py-2">
            <p>
              "Every photograph holds a secret moment in time. But standard pictures are only still frames—today, your favorite memories come alive."
            </p>
            <p>
              "Use the AR scanner below to point your camera at our printed photos. Watch each memory play as a living video, surrounded by love."
            </p>
          </div>
        </motion.div>

        {/* Memory Timeline List */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="flex flex-col gap-4"
        >
          <h2 className="text-xl font-serif font-bold text-white flex items-center gap-2 px-2">
            <Sparkles className="w-5 h-5 text-amber-300" />
            <span>AR Memories Gallery</span>
          </h2>

          <div className="space-y-4">
            {targets.map((t) => (
              <div
                key={t.targetIndex}
                className="glass-panel p-5 rounded-2xl border border-pink-500/20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 group hover:border-pink-500/40 transition-all"
              >
                <div className="flex items-start gap-4">
                  <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${t.previewColor || 'from-pink-500 to-rose-600'} flex items-center justify-center font-bold text-white text-base shadow-lg shrink-0`}>
                    #{t.targetIndex}
                  </div>

                  <div>
                    <span className="text-[10px] uppercase font-semibold text-pink-400 tracking-wider">
                      {t.badge}
                    </span>
                    <h3 className="text-lg font-serif font-bold text-white">
                      {t.title}
                    </h3>
                    <p className="text-xs text-pink-100/70 mt-1">
                      {t.description}
                    </p>

                    <div className="flex items-center gap-4 mt-3 text-[11px] text-pink-300/80">
                      {t.date && (
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3 text-amber-300" />
                          <span>{t.date}</span>
                        </span>
                      )}
                      {t.location && (
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3 h-3 text-pink-400" />
                          <span>{t.location}</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <Link
                  href="/scanner"
                  className="w-full sm:w-auto px-4 py-2 rounded-xl bg-white/5 hover:bg-pink-500/20 text-xs font-semibold text-pink-200 border border-white/10 hover:border-pink-500/40 transition-all text-center"
                >
                  Scan Photo #{t.targetIndex}
                </Link>
              </div>
            ))}
          </div>
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
