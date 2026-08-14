"""
Decision Engine for Multi-Method Recognition.
Combines Feature Matching, HSV Color, and dHash results with priority rules and agreement bonuses.
"""

from typing import Dict, List, Optional, Any

class DecisionEngine:
    def __init__(
        self,
        feature_threshold: float = 0.75,
        fallback_threshold: float = 0.82,
        agreement_bonus: float = 0.10,
        min_gap: float = 0.05
    ):
        self.feature_threshold = feature_threshold
        self.fallback_threshold = fallback_threshold
        self.agreement_bonus = agreement_bonus
        self.min_gap = min_gap

    def decide(
        self,
        matches_dict: Dict[str, List[Dict[str, Any]]],
        target_videos: Dict[str, str],
        target_thresholds: Dict[str, float]
    ) -> Dict[str, Any]:
        """
        Evaluate candidate matches from all algorithms and produce the final decision.
        """
        feature_matches = matches_dict.get("features", [])
        color_matches = matches_dict.get("color", [])
        dhash_matches = matches_dict.get("dhash", [])

        # Index auxiliary scores by target_id
        color_by_target = {m["target_id"]: m["confidence"] for m in color_matches}
        dhash_by_target = {m["target_id"]: m["confidence"] for m in dhash_matches}

        # ── PRIORITY 1: Visual Feature / Reference Matching ──────────────────────
        if feature_matches:
            best_feat = feature_matches[0]
            tid = best_feat["target_id"]
            threshold = target_thresholds.get(tid, self.feature_threshold)

            # Check gap if there is a second feature match
            gap_ok = True
            if len(feature_matches) >= 2:
                gap = best_feat["confidence"] - feature_matches[1]["confidence"]
                if gap < self.min_gap:
                    gap_ok = False

            if best_feat["confidence"] >= threshold and gap_ok:
                # Check for agreement bonus with color or dHash
                has_agreement = False
                final_conf = best_feat["confidence"]

                if color_by_target.get(tid, 0.0) >= 0.70 or dhash_by_target.get(tid, 0.0) >= 0.70:
                    has_agreement = True
                    final_conf = min(1.0, final_conf + self.agreement_bonus)

                return {
                    "matched": True,
                    "target_id": tid,
                    "method": "reference",
                    "reference": best_feat.get("reference"),
                    "confidence": round(float(final_conf), 3),
                    "video": target_videos.get(tid),
                    "debug": {
                        "primary_score": round(best_feat["confidence"], 3),
                        "inliers": best_feat.get("inliers", 0),
                        "color_score": round(color_by_target.get(tid, 0.0), 3),
                        "dhash_score": round(dhash_by_target.get(tid, 0.0), 3),
                        "has_agreement": has_agreement,
                        "method": "feature_orb"
                    }
                }

        # ── PRIORITY 2: Hue (55%) + dHash (30%) + Saturation (15%) Fallback ──────
        # Combine color and dHash scores per target
        all_targets = set(color_by_target.keys()).union(dhash_by_target.keys())
        fallback_candidates = []

        for tid in all_targets:
            c_score = color_by_target.get(tid, 0.0)
            d_score = dhash_by_target.get(tid, 0.0)
            
            # Weighted: 70% dHash structure + 30% Color (or 55% color + 45% dHash)
            combined = (d_score * 0.55) + (c_score * 0.45)
            fallback_candidates.append({
                "target_id": tid,
                "combined": combined,
                "color_score": c_score,
                "dhash_score": d_score
            })

        fallback_candidates.sort(key=lambda x: x["combined"], reverse=True)

        if fallback_candidates:
            best_fb = fallback_candidates[0]
            tid = best_fb["target_id"]
            
            # Fallback requires high score and clear separation from second place
            gap_ok = True
            if len(fallback_candidates) >= 2:
                gap = best_fb["combined"] - fallback_candidates[1]["combined"]
                if gap < 0.08:
                    gap_ok = False

            if best_fb["combined"] >= self.fallback_threshold and gap_ok:
                return {
                    "matched": True,
                    "target_id": tid,
                    "method": "fallback_color_dhash",
                    "reference": None,
                    "confidence": round(float(best_fb["combined"]), 3),
                    "video": target_videos.get(tid),
                    "debug": {
                        "primary_score": round(best_fb["combined"], 3),
                        "color_score": round(best_fb["color_score"], 3),
                        "dhash_score": round(best_fb["dhash_score"], 3),
                        "has_agreement": True,
                        "method": "color_dhash_fallback"
                    }
                }

        # ── NO CONFIDENT MATCH ──────────────────────────────────────────────────
        return {
            "matched": False,
            "target_id": None,
            "method": None,
            "reference": None,
            "confidence": 0.0,
            "video": None,
            "debug": {
                "top_feature": feature_matches[0] if feature_matches else None,
                "top_fallback": fallback_candidates[0] if fallback_candidates else None
            }
        }
