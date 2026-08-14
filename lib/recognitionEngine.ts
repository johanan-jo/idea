// ─────────────────────────────────────────────────────────────────────────────
// recognitionEngine.ts
//
// Centralised recognition decision engine.
//
// Combines three recognition methods with priority + confidence scoring:
//   Priority 1 — MindAR image-target tracking
//   Priority 2 — Reference-image HOG feature matching
//   Priority 3 — Hue histogram + dHash + Saturation fallback
//
// Rules:
//   • A method must meet its confidence threshold to be accepted.
//   • When ≥2 methods agree on the SAME target, a bonus is added.
//   • The same target is never re-emitted unless it changes.
//   • Methods run in priority order; stop once a confident result exists.
// ─────────────────────────────────────────────────────────────────────────────

import {
  RecognitionTarget,
  getTargetById,
  getTargetByMindarIndex,
  AGREEMENT_BONUS,
  FALLBACK_COLOR_THRESHOLD,
} from "@/config/recognitionTargets";

import type { ReferenceMatchResult } from "@/lib/referenceImageMatcher";

// ── Types ─────────────────────────────────────────────────────────────────────

export type RecognitionMethod = "mindar" | "reference" | "color" | "none";

export interface RecognitionResult {
  targetId: string;
  target: RecognitionTarget;
  method: RecognitionMethod;
  /** Primary confidence from the winning method (0–1) */
  confidence: number;
  /** Whether a second method agreed, triggering bonus */
  hasAgreement: boolean;
  /** Final confidence after agreement bonus */
  finalConfidence: number;
  /** Debug details from each method */
  debug: {
    mindar: { detected: boolean; index?: number; confidence?: number };
    reference: { detected: boolean; refImageUrl?: string; confidence?: number; region?: string };
    color: { detected: boolean; score?: number };
  };
}

export interface EngineOptions {
  /**
   * Callback fired when a confident target is found or changes.
   * Not called when the same target is detected again.
   */
  onTargetChanged: (result: RecognitionResult) => void;
  /** Callback fired when target is lost (no method produces a confident match) */
  onTargetLost: () => void;
}

// ── Confidence thresholds ─────────────────────────────────────────────────────

const MINDAR_CONFIDENCE     = 0.95; // MindAR hardware tracking — always high confidence
const REFERENCE_MIN         = 0.70; // Minimum HOG similarity to consider reference match
const COLOR_MIN_SCORE       = FALLBACK_COLOR_THRESHOLD; // 0–100

// ── Engine ────────────────────────────────────────────────────────────────────

export class RecognitionEngine {
  private opts: EngineOptions;
  private currentTargetId: string | null = null;

  // Pending results from each method (hold latest, combine in flush)
  private pendingMindar: { targetIndex: number; ts: number } | null = null;
  private pendingReference: ReferenceMatchResult | null = null;
  private pendingColor: { targetIndex: number; score: number } | null = null;

  // Staleness window — results older than this are ignored in decision
  private readonly STALE_MS = 2000;

  constructor(opts: EngineOptions) {
    this.opts = opts;
  }

  // ── Ingestion methods (called by each recognition source) ──────────────────

  /** Call when MindAR fires targetFound */
  ingestMindar(targetIndex: number): void {
    this.pendingMindar = { targetIndex, ts: Date.now() };
    console.log(`[Engine] MindAR ingested: Target #${targetIndex}`);
    this.decide();
  }

  /** Call when MindAR fires targetLost */
  ingestMindarLost(): void {
    this.pendingMindar = null;
    this.decide();
  }

  /** Call with reference matcher results */
  ingestReferenceResult(
    result: ReferenceMatchResult | null
  ): void {
    this.pendingReference = result;
    this.decide();
  }

  /** Call with fallback colour/hash score */
  ingestColorResult(targetIndex: number, score: number): void {
    this.pendingColor = { targetIndex, score };
    this.decide();
  }

  /** Reset all pending state (e.g., after user requests rescan) */
  reset(): void {
    this.pendingMindar    = null;
    this.pendingReference = null;
    this.pendingColor     = null;
    this.currentTargetId  = null;
  }

  // ── Decision engine ───────────────────────────────────────────────────────

  private decide(): void {
    const now = Date.now();

    // Expire stale MindAR result
    if (this.pendingMindar && now - this.pendingMindar.ts > this.STALE_MS) {
      this.pendingMindar = null;
    }

    const debug: RecognitionResult["debug"] = {
      mindar:    { detected: false },
      reference: { detected: false },
      color:     { detected: false },
    };

    // ── Priority 1: MindAR ─────────────────────────────────────────────────
    let winnerTargetId: string | null = null;
    let winnerMethod: RecognitionMethod = "none";
    let winnerConfidence = 0;

    if (this.pendingMindar) {
      const t = getTargetByMindarIndex(this.pendingMindar.targetIndex);
      if (t) {
        winnerTargetId   = t.id;
        winnerMethod     = "mindar";
        winnerConfidence = MINDAR_CONFIDENCE;
        debug.mindar = { detected: true, index: this.pendingMindar.targetIndex, confidence: MINDAR_CONFIDENCE };
      }
    }

    // ── Priority 2: Reference image match ─────────────────────────────────
    if (!winnerTargetId && this.pendingReference) {
      const r = this.pendingReference;
      if (r.confidence >= REFERENCE_MIN) {
        const t = getTargetById(r.targetId);
        if (t) {
          winnerTargetId   = t.id;
          winnerMethod     = "reference";
          winnerConfidence = r.confidence;
          debug.reference = { detected: true, refImageUrl: r.refImageUrl, confidence: r.confidence, region: r.region };
        }
      }
    }

    // ── Priority 3: Colour / hash fallback ────────────────────────────────
    if (!winnerTargetId && this.pendingColor && this.pendingColor.score >= COLOR_MIN_SCORE) {
      const t = getTargetByMindarIndex(this.pendingColor.targetIndex);
      if (t) {
        winnerTargetId   = t.id;
        winnerMethod     = "color";
        winnerConfidence = this.pendingColor.score / 100;
        debug.color = { detected: true, score: this.pendingColor.score };
      }
    }

    // ── Agreement bonus ────────────────────────────────────────────────────
    let hasAgreement = false;
    if (winnerTargetId) {
      let agreers = 0;
      if (debug.mindar.detected    && getTargetByMindarIndex(this.pendingMindar!.targetIndex)?.id === winnerTargetId) agreers++;
      if (this.pendingReference    && this.pendingReference.confidence >= REFERENCE_MIN && this.pendingReference.targetId === winnerTargetId) agreers++;
      if (this.pendingColor        && this.pendingColor.score >= COLOR_MIN_SCORE && getTargetByMindarIndex(this.pendingColor.targetIndex)?.id === winnerTargetId) agreers++;
      hasAgreement = agreers >= 2;
    }

    const finalConf = winnerTargetId
      ? Math.min(1.0, winnerConfidence + (hasAgreement ? AGREEMENT_BONUS : 0))
      : 0;

    // ── Emit changes ───────────────────────────────────────────────────────
    if (!winnerTargetId) {
      if (this.currentTargetId !== null) {
        this.currentTargetId = null;
        this.opts.onTargetLost();
      }
      return;
    }

    // Same target as before — do nothing (no duplicate events)
    if (winnerTargetId === this.currentTargetId) return;

    const target = getTargetById(winnerTargetId)!;
    this.currentTargetId = winnerTargetId;

    const result: RecognitionResult = {
      targetId: winnerTargetId,
      target,
      method: winnerMethod,
      confidence: winnerConfidence,
      hasAgreement,
      finalConfidence: finalConf,
      debug,
    };

    console.log(
      `[Engine] 🎯 TARGET CHANGED → ${target.name} | method:${winnerMethod} | conf:${finalConf.toFixed(2)} | agreement:${hasAgreement}`
    );

    this.opts.onTargetChanged(result);
  }
}
