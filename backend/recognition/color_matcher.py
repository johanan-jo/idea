"""
HSV & Color Histogram Matcher.
Computes spatial multi-zone Hue and Saturation histograms with Bhattacharyya distance.
"""

import cv2
import numpy as np
from typing import Dict, List, Any

class ColorDescriptor:
    def __init__(self, target_id: str, filename: str, hsv_hist: np.ndarray):
        self.target_id = target_id
        self.filename = filename
        self.hsv_hist = hsv_hist

class ColorMatcher:
    def __init__(self, zones: int = 4, h_bins: int = 16, s_bins: int = 8):
        self.zones = zones
        self.h_bins = h_bins
        self.s_bins = s_bins
        self.descriptors_db: List[ColorDescriptor] = []

    def extract_color_hist(self, image_bgr: np.ndarray) -> np.ndarray:
        """Extract normalized spatial multi-zone HSV histogram."""
        if image_bgr is None or image_bgr.size == 0:
            return np.zeros((self.zones * self.zones * (self.h_bins + self.s_bins),), dtype=np.float32)

        # Standardize size
        resized = cv2.resize(image_bgr, (192, 192), interpolation=cv2.INTER_AREA)
        hsv = cv2.cvtColor(resized, cv2.COLOR_BGR2HSV)
        
        H, W, _ = hsv.shape
        zh, zw = H // self.zones, W // self.zones
        hist_parts = []

        for r in range(self.zones):
            for c in range(self.zones):
                zone = hsv[r * zh:(r + 1) * zh, c * zw:(c + 1) * zw]
                
                # Hue histogram (0-180 in OpenCV)
                h_hist = cv2.calcHist([zone], [0], None, [self.h_bins], [0, 180])
                cv2.normalize(h_hist, h_hist, 0, 1, cv2.NORM_MINMAX)
                
                # Saturation histogram (0-256)
                s_hist = cv2.calcHist([zone], [1], None, [self.s_bins], [0, 256])
                cv2.normalize(s_hist, s_hist, 0, 1, cv2.NORM_MINMAX)
                
                hist_parts.append(h_hist.flatten())
                hist_parts.append(s_hist.flatten())

        return np.concatenate(hist_parts).astype(np.float32)

    def add_reference(self, target_id: str, filename: str, image_bgr: np.ndarray) -> bool:
        """Precompute and store color histogram for a reference image."""
        hist = self.extract_color_hist(image_bgr)
        self.descriptors_db.append(ColorDescriptor(target_id, filename, hist))
        return True

    def match(self, query_bgr: np.ndarray) -> List[Dict[str, Any]]:
        """Compare query frame histogram against stored references using Bhattacharyya distance."""
        q_hist = self.extract_color_hist(query_bgr)
        results = []

        for ref in self.descriptors_db:
            # cv2.HISTCMP_BHATTACHARYYA returns 0 for perfect match, 1 for maximum difference
            d = cv2.compareHist(ref.hsv_hist, q_hist, cv2.HISTCMP_BHATTACHARYYA)
            score = max(0.0, 1.0 - float(d))
            
            results.append({
                "target_id": ref.target_id,
                "reference": ref.filename,
                "confidence": score,
                "method": "color_hsv"
            })

        # Deduplicate by target_id (keep highest score)
        target_map = {}
        for r in sorted(results, key=lambda x: x["confidence"], reverse=True):
            tid = r["target_id"]
            if tid not in target_map or r["confidence"] > target_map[tid]["confidence"]:
                target_map[tid] = r

        return list(target_map.values())
