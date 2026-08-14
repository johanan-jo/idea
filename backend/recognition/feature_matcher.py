"""
OpenCV Visual Feature Matcher using ORB / AKAZE / SIFT + RANSAC Geometric Verification.
Provides scale, rotation, illumination, and perspective invariant matching.
"""

import cv2
import numpy as np
from typing import Dict, List, Optional, Tuple, Any
import os

class FeatureDescriptor:
    def __init__(self, target_id: str, filename: str, keypoints: List[cv2.KeyPoint], descriptors: np.ndarray, shape: Tuple[int, int]):
        self.target_id = target_id
        self.filename = filename
        self.keypoints = keypoints
        self.descriptors = descriptors
        self.shape = shape  # (h, w)

class FeatureMatcher:
    def __init__(self, algorithm: str = "ORB"):
        self.algorithm = algorithm.upper()
        if self.algorithm == "SIFT" and hasattr(cv2, "SIFT_create"):
            self.detector = cv2.SIFT_create(nfeatures=1500)
            self.norm_type = cv2.NORM_L2
        elif self.algorithm == "AKAZE":
            self.detector = cv2.AKAZE_create()
            self.norm_type = cv2.NORM_HAMMING
        else:
            # Default: ORB with 1500 features for fast and accurate embedded matching
            self.detector = cv2.ORB_create(nfeatures=1500, scaleFactor=1.2, nlevels=8, edgeThreshold=15)
            self.norm_type = cv2.NORM_HAMMING
            
        self.matcher = cv2.BFMatcher(self.norm_type, crossCheck=False)
        self.descriptors_db: List[FeatureDescriptor] = []

    def extract_features(self, image_bgr: np.ndarray) -> Tuple[List[cv2.KeyPoint], Optional[np.ndarray]]:
        """Extract keypoints and descriptors from an image."""
        if image_bgr is None or image_bgr.size == 0:
            return [], None
        gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
        # Apply CLAHE to normalize contrast/lighting
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        gray = clahe.apply(gray)
        keypoints, descriptors = self.detector.detectAndCompute(gray, None)
        return keypoints, descriptors

    def add_reference(self, target_id: str, filename: str, image_bgr: np.ndarray) -> bool:
        """Precompute and store descriptors for a reference image."""
        kp, desc = self.extract_features(image_bgr)
        if desc is not None and len(kp) >= 10:
            self.descriptors_db.append(
                FeatureDescriptor(
                    target_id=target_id,
                    filename=filename,
                    keypoints=kp,
                    descriptors=desc,
                    shape=(image_bgr.shape[0], image_bgr.shape[1])
                )
            )
            return True
        return False

    def match(self, query_bgr: np.ndarray, min_inliers: int = 12, ratio_thresh: float = 0.75) -> List[Dict[str, Any]]:
        """
        Match a query camera frame against all stored reference descriptors.
        Returns ranked list of matches with geometric verification scores.
        """
        q_kp, q_desc = self.extract_features(query_bgr)
        if q_desc is None or len(q_kp) < 10:
            return []

        results = []

        for ref in self.descriptors_db:
            if ref.descriptors is None:
                continue

            try:
                # k-NN match with k=2 for Lowe's ratio test
                matches = self.matcher.knnMatch(ref.descriptors, q_desc, k=2)
            except Exception:
                continue

            good_matches = []
            for m_n in matches:
                if len(m_n) == 2:
                    m, n = m_n
                    if m.distance < ratio_thresh * n.distance:
                        good_matches.append(m)

            if len(good_matches) < min_inliers:
                continue

            # Geometric verification via Homography + RANSAC
            ref_pts = np.float32([ref.keypoints[m.queryIdx].pt for m in good_matches]).reshape(-1, 1, 2)
            q_pts = np.float32([q_kp[m.trainIdx].pt for m in good_matches]).reshape(-1, 1, 2)

            try:
                H, mask = cv2.findHomography(ref_pts, q_pts, cv2.RANSAC, 5.0)
            except Exception:
                H, mask = None, None

            if H is not None and mask is not None:
                inliers = int(np.sum(mask))
                inlier_ratio = inliers / max(len(good_matches), 1)

                if inliers >= min_inliers:
                    # Calculate confidence score based on inlier count and consistency
                    # Inlier score scaled between 0.70 and 0.99
                    inlier_score = min(1.0, 0.70 + (inliers / 50.0) * 0.28)
                    confidence = min(0.99, (inlier_score * 0.75) + (inlier_ratio * 0.25))

                    results.append({
                        "target_id": ref.target_id,
                        "reference": ref.filename,
                        "confidence": float(confidence),
                        "inliers": inliers,
                        "good_matches": len(good_matches),
                        "method": "feature_orb"
                    })

        # Sort by confidence descending and deduplicate by target_id (keep highest confidence per target)
        target_map = {}
        for r in sorted(results, key=lambda x: x["confidence"], reverse=True):
            tid = r["target_id"]
            if tid not in target_map or r["confidence"] > target_map[tid]["confidence"]:
                target_map[tid] = r

        return list(target_map.values())
