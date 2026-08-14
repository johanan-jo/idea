"""
dHash (Difference Hash) Structural Matcher.
Computes 64-bit and 256-bit difference hashes for lighting-resilient structural matching.
"""

import cv2
import numpy as np
from typing import Dict, List, Any

class DHashDescriptor:
    def __init__(self, target_id: str, filename: str, hash_bits: np.ndarray):
        self.target_id = target_id
        self.filename = filename
        self.hash_bits = hash_bits

class DHashMatcher:
    def __init__(self, hash_size: int = 16):
        self.hash_size = hash_size
        self.descriptors_db: List[DHashDescriptor] = []

    def compute_dhash(self, image_bgr: np.ndarray) -> np.ndarray:
        """Compute difference hash array of (hash_size * hash_size) boolean bits."""
        if image_bgr is None or image_bgr.size == 0:
            return np.zeros((self.hash_size * self.hash_size,), dtype=np.uint8)

        # Resize to (hash_size + 1, hash_size) in grayscale
        gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
        resized = cv2.resize(gray, (self.hash_size + 1, self.hash_size), interpolation=cv2.INTER_AREA)

        # Compute differences between adjacent horizontal pixels
        diff = resized[:, 1:] > resized[:, :-1]
        return diff.flatten().astype(np.uint8)

    def add_reference(self, target_id: str, filename: str, image_bgr: np.ndarray) -> bool:
        """Precompute and store dHash for a reference image."""
        h = self.compute_dhash(image_bgr)
        self.descriptors_db.append(DHashDescriptor(target_id, filename, h))
        return True

    def match(self, query_bgr: np.ndarray) -> List[Dict[str, Any]]:
        """Compute Hamming distance similarity against stored references."""
        q_hash = self.compute_dhash(query_bgr)
        results = []

        total_bits = len(q_hash)

        for ref in self.descriptors_db:
            hamming_dist = int(np.count_nonzero(ref.hash_bits != q_hash))
            similarity = max(0.0, 1.0 - (hamming_dist / float(total_bits)))

            results.append({
                "target_id": ref.target_id,
                "reference": ref.filename,
                "confidence": similarity,
                "hamming_distance": hamming_dist,
                "method": "dhash"
            })

        # Deduplicate by target_id (keep highest score)
        target_map = {}
        for r in sorted(results, key=lambda x: x["confidence"], reverse=True):
            tid = r["target_id"]
            if tid not in target_map or r["confidence"] > target_map[tid]["confidence"]:
                target_map[tid] = r

        return list(target_map.values())
