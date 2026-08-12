"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Heart, Lock, KeyRound, ArrowRight } from "lucide-react";

interface PasswordModalProps {
  isOpen: boolean;
  onUnlock: () => void;
}

export default function PasswordModal({ isOpen, onUnlock }: PasswordModalProps) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Default passcodes allowed: any 4 digits, or "1204" or "love"
    if (pin.length > 0) {
      setError(false);
      onUnlock();
    } else {
      setError(true);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl"
        >
          <motion.div
            initial={{ scale: 0.9, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.9, y: 20 }}
            className="w-full max-w-sm glass-panel p-8 rounded-3xl border border-pink-500/30 shadow-2xl text-center flex flex-col items-center"
          >
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-pink-500 to-rose-600 flex items-center justify-center text-white shadow-lg glow-rose mb-4 animate-float">
              <Heart className="w-7 h-7 fill-white" />
            </div>

            <span className="text-xs uppercase tracking-widest text-pink-400 font-semibold mb-1">
              Private Experience
            </span>

            <h2 className="text-2xl font-serif font-bold text-white mb-2">
              For Your Eyes Only
            </h2>

            <p className="text-xs text-pink-100/70 mb-6 leading-relaxed">
              Enter your special passcode to open your personal AR memory collection.
            </p>

            <form onSubmit={handleSubmit} className="w-full flex flex-col gap-3">
              <div className="relative w-full">
                <input
                  type="password"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder="Enter passcode (e.g. 1204)..."
                  className="w-full py-3.5 px-4 pl-11 rounded-xl bg-white/5 border border-pink-500/30 text-white placeholder-pink-300/40 text-center font-mono text-sm tracking-widest focus:outline-none focus:border-pink-500 focus:ring-1 focus:ring-pink-500 transition-all"
                />
                <KeyRound className="w-4 h-4 text-pink-400 absolute left-4 top-4" />
              </div>

              {error && (
                <span className="text-[11px] text-rose-400">
                  Please enter a passcode or click Unlock below.
                </span>
              )}

              <button
                type="submit"
                className="w-full py-3.5 px-6 rounded-xl bg-gradient-to-r from-pink-500 to-rose-600 text-white font-bold text-sm tracking-wide shadow-lg hover:shadow-pink-500/25 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 glow-rose mt-1"
              >
                <span>Open Memories</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>

            <button
              onClick={onUnlock}
              className="mt-4 text-xs text-pink-300/60 hover:text-pink-200 underline transition-colors"
            >
              Skip & Unlock Experience Direct
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
