"""
Vision Embedding Model Calibration & Benchmark Script.
Evaluates registered references and test photographs to verify accuracy, confidence scores, and margins.
"""

import os
import sys
import time
from PIL import Image
import numpy as np

# Add backend to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from recognition.vision_embedder import VisionEmbedder
from recognition.decision_engine import DecisionEngine
from recognition.reference_matcher import ReferenceMatcher

def run_calibration():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    config_path = os.path.join(base_dir, "config", "targets.json")
    cache_dir = os.path.join(base_dir, "cache")
    refs_dir = os.path.join(base_dir, "references")

    print("\n=======================================================")
    print("  VISION EMBEDDING RECOGNITION CALIBRATION SUITE")
    print("=======================================================\n")

    # 1. Initialize Vision Embedder (Lightweight MobileNetV3-Large, ~21MB)
    embedder = VisionEmbedder(model_name="mobilenet_v3_large")
    embedder.load_model()
    num_refs = embedder.load_and_precompute_references(config_path, base_dir, cache_dir)
    print(f"Loaded {num_refs} reference embeddings across all targets.\n")

    # 2. Initialize OpenCV Matcher
    opencv_matcher = ReferenceMatcher(config_path, refs_dir)
    opencv_matcher.load_targets()

    # 3. Decision Engine
    decision_engine = DecisionEngine(match_threshold=0.78, min_margin=0.05, agreement_bonus=0.08)

    # Test cases: (Image Path, Expected Target ID)
    test_cases = [
        # Target 1: Spider-Man
        ("references/spiderman/spiderman_target.jpg", "spiderman"),
        ("references/spiderman/spiderman_marker.png", "spiderman"),
        ("references/spiderman/sample_photo.jpg", "spiderman"),

        # Target 2: Sai Baba
        ("references/saibaba/target2.jpg", "saibaba"),

        # Target 3: Girls + Thumbs Up
        ("references/girls_thumbsup/target3.jpg", "girls_thumbsup"),
        ("references/girls_thumbsup/thumbs_up.png", "girls_thumbsup"),

        # Target 4: Beach + Pink Star
        ("references/birthday/target4.jpg", "birthday"),
        ("references/birthday/target4_pink_star.png", "birthday"),
        ("references/birthday/pink_star_marker.png", "birthday"),
        ("references/birthday/star_marker.png", "birthday"),
    ]

    import cv2

    print("-" * 90)
    print(f"{'Image Tested':<38} | {'Expected':<14} | {'Predicted':<14} | {'Score':<7} | {'Margin':<7} | {'Status'}")
    print("-" * 90)

    passed = 0
    total = len(test_cases)

    for rel_path, expected in test_cases:
        full_path = os.path.join(base_dir, rel_path)
        if not os.path.exists(full_path):
            print(f"{rel_path:<38} | {expected:<14} | {'NOT FOUND':<14} | {'-':<7} | {'-':<7} | [FAIL]")
            continue

        pil_img = Image.open(full_path)
        cv_bgr = cv2.imread(full_path)

        # 1. Vision Embedding
        query_emb = embedder.encode_pil(pil_img)
        v_res = embedder.match_embedding(query_emb)

        # 2. OpenCV
        cv_res = opencv_matcher.match_all(cv_bgr)

        # 3. Decision
        dec = decision_engine.decide(
            vision_result=v_res,
            opencv_matches=cv_res,
            target_videos=opencv_matcher.target_videos,
            target_thresholds=opencv_matcher.target_thresholds
        )

        pred = dec["target_id"] or "NONE"
        score = f"{dec['confidence']:.3f}"
        margin = f"{dec.get('margin', 0.0):.3f}"
        
        is_correct = (dec["matched"] and pred == expected)
        status = "[PASS]" if is_correct else "[FAIL]"
        if is_correct:
            passed += 1

        fname = os.path.basename(rel_path)
        folder = os.path.basename(os.path.dirname(rel_path))
        display_name = f"{folder}/{fname}"

        print(f"{display_name:<38} | {expected:<14} | {pred:<14} | {score:<7} | {margin:<7} | {status}")

    print("-" * 90)
    print(f"\nCalibration Accuracy: {passed}/{total} ({(passed/total)*100:.1f}%)")

    # Test random noise rejection
    print("\nTesting False Positive Noise Rejection...")
    noise_img = Image.fromarray(np.random.randint(0, 255, (480, 640, 3), dtype=np.uint8))
    noise_emb = embedder.encode_pil(noise_img)
    noise_res = embedder.match_embedding(noise_emb)
    noise_dec = decision_engine.decide(noise_res, {"features": [], "color": [], "dhash": []}, {}, {})

    noise_passed = not noise_dec["matched"]
    print(f"Random Noise Image: Matched = {noise_dec['matched']} (Top Score: {noise_res['top_score']:.3f}) -> {'[REJECTED - OK]' if noise_passed else '[FALSE POSITIVE - FAIL]'}")
    print("\n=======================================================\n")

if __name__ == "__main__":
    run_calibration()
