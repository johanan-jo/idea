"""
Reference Matcher Coordinator.
Manages loading target configurations, precomputing descriptors on startup,
and coordinating multi-scale / multi-rotation frame matching.
"""

import os
import json
import cv2
import numpy as np
from typing import Dict, List, Optional, Any

from .feature_matcher import FeatureMatcher
from .color_matcher import ColorMatcher
from .dhash_matcher import DHashMatcher

class ReferenceMatcher:
    def __init__(self, config_path: str, references_dir: str):
        self.config_path = config_path
        self.references_dir = references_dir
        
        self.feature_matcher = FeatureMatcher(algorithm="ORB")
        self.color_matcher = ColorMatcher(zones=4, h_bins=16, s_bins=8)
        self.dhash_matcher = DHashMatcher(hash_size=16)

        self.targets_config: Dict[str, Any] = {}
        self.target_videos: Dict[str, str] = {}
        self.target_thresholds: Dict[str, float] = {}

    def load_targets(self) -> int:
        """Load target definitions from JSON and precompute descriptors for all reference images."""
        if not os.path.exists(self.config_path):
            raise FileNotFoundError(f"Targets configuration not found at {self.config_path}")

        with open(self.config_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        targets = data.get("targets", [])
        loaded_count = 0

        for t in targets:
            tid = t["id"]
            self.targets_config[tid] = t
            self.target_videos[tid] = t.get("video", "")
            self.target_thresholds[tid] = t.get("threshold", 0.75)

            for ref_filename in t.get("references", []):
                ref_path = os.path.join(self.references_dir, ref_filename)
                if not os.path.exists(ref_path):
                    print(f"[ReferenceMatcher] Warning: Reference image not found: {ref_path}")
                    continue

                img_bgr = cv2.imread(ref_path)
                if img_bgr is None:
                    print(f"[ReferenceMatcher] Warning: Could not decode image: {ref_path}")
                    continue

                # Add to all matchers
                self.feature_matcher.add_reference(tid, ref_filename, img_bgr)
                self.color_matcher.add_reference(tid, ref_filename, img_bgr)
                self.dhash_matcher.add_reference(tid, ref_filename, img_bgr)
                loaded_count += 1
                print(f"[ReferenceMatcher] Loaded reference: {tid} <- {ref_filename}")

        return loaded_count

    def match_all(self, query_bgr: np.ndarray) -> Dict[str, List[Dict[str, Any]]]:
        """
        Run all matchers against the query camera frame.
        Includes multi-crop sampling to find smaller markers inside large photos.
        """
        if query_bgr is None or query_bgr.size == 0:
            return {"features": [], "color": [], "dhash": []}

        # Normalize query image size if very large
        H, W = query_bgr.shape[:2]
        max_dim = max(H, W)
        if max_dim > 1280:
            scale = 1280.0 / max_dim
            query_resized = cv2.resize(query_bgr, (int(W * scale), int(H * scale)), interpolation=cv2.INTER_AREA)
        else:
            query_resized = query_bgr

        # 1. Feature matching (ORB + RANSAC is naturally scale & rotation invariant across full frame)
        feature_matches = self.feature_matcher.match(query_resized, min_inliers=12, ratio_thresh=0.75)

        # 2. If feature matching produced a high-confidence match, we can corroborate with color/dHash
        color_matches = self.color_matcher.match(query_resized)
        dhash_matches = self.dhash_matcher.match(query_resized)

        # 3. Sub-region check if no feature match found yet (e.g. small marker in corner)
        if not feature_matches:
            # Check center and quadrants
            crops = [
                query_resized[int(H * 0.1):int(H * 0.9), int(W * 0.1):int(W * 0.9)],
                query_resized[0:int(H * 0.6), 0:int(W * 0.6)],
                query_resized[0:int(H * 0.6), int(W * 0.4):W],
                query_resized[int(H * 0.4):H, 0:int(W * 0.6)],
                query_resized[int(H * 0.4):H, int(W * 0.4):W],
            ]
            for crop in crops:
                if crop.shape[0] > 64 and crop.shape[1] > 64:
                    crop_matches = self.feature_matcher.match(crop, min_inliers=12, ratio_thresh=0.75)
                    if crop_matches:
                        feature_matches = crop_matches
                        break

        return {
            "features": feature_matches,
            "color": color_matches,
            "dhash": dhash_matches
        }
