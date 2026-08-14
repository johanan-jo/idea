"""
Decision Engine for Multi-Algorithm Recognition.
Combines Vision Embedding (Primary), OpenCV Feature Verification (Secondary),
and Color/dHash (Tertiary Fallback) with margin checks and agreement bonuses.
"""

import os
from typing import Dict, List, Optional, Any

class DecisionEngine:
    def __init__(
        self,
        match_threshold: Optional[float] = None,
        min_margin: Optional[float] = None,
        agreement_bonus: float = 0.08,
        opencv_inliers_thresh: int = 12
    ):
        # Allow environment variable overrides
        self.match_threshold = match_threshold or float(os.environ.get("MATCH_THRESHOLD", "0.78"))
        self.min_margin = min_margin or float(os.environ.get("MIN_MARGIN", "0.05"))
        self.agreement_bonus = agreement_bonus
        self.opencv_inliers_thresh = opencv_inliers_thresh

    def decide(
        self,
        vision_result: Dict[str, Any],
        opencv_matches: Dict[str, List[Dict[str, Any]]],
        target_videos: Dict[str, str],
        target_thresholds: Dict[str, float]
    ) -> Dict[str, Any]:
        """
        Evaluate candidate matches from Vision Embedder and OpenCV pipelines.
        Returns clean standardized recognition decision with debug metrics.
        """
        top_tid = vision_result.get("top_target")
        top_score = vision_result.get("top_score", 0.0)
        second_tid = vision_result.get("second_target")
        second_score = vision_result.get("second_score", 0.0)
        margin = vision_result.get("margin", 0.0)
        best_ref = vision_result.get("best_reference")

        # Extract OpenCV features and fallback
        feature_matches = opencv_matches.get("features", [])
        color_matches = opencv_matches.get("color", [])
        dhash_matches = opencv_matches.get("dhash", [])

        # Check OpenCV agreement
        opencv_agree = False
        opencv_inliers = 0
        opencv_top_target = None

        if feature_matches:
            top_feat = feature_matches[0]
            opencv_top_target = top_feat.get("target_id")
            opencv_inliers = top_feat.get("inliers", 0)
            if opencv_top_target == top_tid and opencv_inliers >= self.opencv_inliers_thresh:
                opencv_agree = True

        effective_threshold = target_thresholds.get(top_tid, self.match_threshold) if top_tid else self.match_threshold

        # ── PRIORITY 1: Vision Embedding Match ────────────────────────────────
        if top_tid and top_score >= effective_threshold and margin >= self.min_margin:
            final_conf = top_score
            method = "vision_embedding"

            if opencv_agree:
                final_conf = min(0.99, final_conf + self.agreement_bonus)
                method = "vision_plus_opencv"

            return {
                "matched": True,
                "target_id": top_tid,
                "method": method,
                "reference": best_ref,
                "confidence": round(float(final_conf), 3),
                "margin": round(float(margin), 3),
                "video": target_videos.get(top_tid),
                "debug": {
                    "vision_score": round(float(top_score), 4),
                    "second_best_target": second_tid,
                    "second_best_score": round(float(second_score), 4),
                    "margin": round(float(margin), 4),
                    "opencv_inliers": opencv_inliers,
                    "opencv_agreed": opencv_agree,
                    "ranked_targets": vision_result.get("ranked_targets", [])
                }
            }

        # ── PRIORITY 2: Secondary OpenCV Fallback (If Vision Embedding is Borderline) ─
        if feature_matches:
            top_feat = feature_matches[0]
            feat_tid = top_feat["target_id"]
            inliers = top_feat.get("inliers", 0)

            # If OpenCV finds strong geometric match (>= 15 inliers)
            if inliers >= 15 and top_feat.get("confidence", 0.0) >= 0.75:
                return {
                    "matched": True,
                    "target_id": feat_tid,
                    "method": "opencv",
                    "reference": top_feat.get("reference"),
                    "confidence": round(float(top_feat["confidence"]), 3),
                    "margin": round(float(margin), 3),
                    "video": target_videos.get(feat_tid),
                    "debug": {
                        "vision_score": round(float(top_score), 4),
                        "opencv_inliers": inliers,
                        "method": "opencv_fallback"
                    }
                }

        # ── PRIORITY 3: Tertiary Color + dHash Fallback ───────────────────────
        color_by_target = {m["target_id"]: m["confidence"] for m in color_matches}
        dhash_by_target = {m["target_id"]: m["confidence"] for m in dhash_matches}

        all_tids = set(color_by_target.keys()).union(dhash_by_target.keys())
        fallback_candidates = []
        for tid in all_tids:
            c = color_by_target.get(tid, 0.0)
            d = dhash_by_target.get(tid, 0.0)
            combined = (d * 0.55) + (c * 0.45)
            fallback_candidates.append({"target_id": tid, "combined": combined})

        fallback_candidates.sort(key=lambda x: x["combined"], reverse=True)
        if fallback_candidates:
            best_fb = fallback_candidates[0]
            if best_fb["combined"] >= 0.85:
                return {
                    "matched": True,
                    "target_id": best_fb["target_id"],
                    "method": "color_fallback",
                    "reference": None,
                    "confidence": round(float(best_fb["combined"]), 3),
                    "margin": 0.0,
                    "video": target_videos.get(best_fb["target_id"]),
                    "debug": {
                        "fallback_score": round(float(best_fb["combined"]), 3),
                        "vision_score": round(float(top_score), 4)
                    }
                }

        # ── NO CONFIDENT MATCH ──────────────────────────────────────────────────
        return {
            "matched": False,
            "target_id": None,
            "method": "none",
            "reference": best_ref,
            "confidence": round(float(top_score), 3),
            "margin": round(float(margin), 3),
            "video": None,
            "debug": {
                "top_vision_score": round(float(top_score), 4),
                "second_vision_score": round(float(second_score), 4),
                "margin": round(float(margin), 4),
                "threshold_required": effective_threshold
            }
        }
