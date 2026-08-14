import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))

import cv2
import numpy as np
from recognition.reference_matcher import ReferenceMatcher
from recognition.decision_engine import DecisionEngine

def main():
    config_path = os.path.join("backend", "config", "targets.json")
    ref_dir = os.path.join("backend", "references")

    matcher = ReferenceMatcher(config_path, ref_dir)
    loaded = matcher.load_targets()
    print(f"Successfully loaded and precomputed {loaded} reference descriptors.")

    engine = DecisionEngine(
        feature_threshold=0.75,
        fallback_threshold=0.80,
        agreement_bonus=0.10,
        min_gap=0.05
    )

    test_images = {
        "Spider-Man Photo": "backend/references/spiderman_target.jpg",
        "Spider-Man Marker": "backend/references/spiderman_marker.png",
        "Sai Baba Notebook": "backend/references/target2.jpg",
        "Girls Photo": "backend/references/target3.jpg",
        "Thumbs Up Marker": "backend/references/thumbs_up.png",
        "Beach Photo (Star)": "backend/references/target4.jpg",
        "Pink Star Marker": "backend/references/pink_star_marker.png",
    }

    print("\n--- Testing Target Matching ---")
    for name, path in test_images.items():
        img = cv2.imread(path)
        if img is None:
            print(f"Could not load: {path}")
            continue

        matches = matcher.match_all(img)
        decision = engine.decide(matches, matcher.target_videos, matcher.target_thresholds)
        
        status = "PASS" if decision["matched"] else "FAIL"
        print(f"[{status}] {name.ljust(22)} -> Matched: {str(decision['matched']).ljust(5)} | Target: {str(decision['target_id']).ljust(15)} | Conf: {decision['confidence']} | Video: {decision['video']}")

    # Test random noise / blank image
    print("\n--- Testing False Positive Noise Rejection ---")
    noise = np.random.randint(0, 255, (480, 640, 3), dtype=np.uint8)
    noise_matches = matcher.match_all(noise)
    noise_dec = engine.decide(noise_matches, matcher.target_videos, matcher.target_thresholds)
    print(f"[{'PASS' if not noise_dec['matched'] else 'FAIL'}] Random Noise Image    -> Matched: {noise_dec['matched']} (Should be False)")

    table_img = np.full((480, 640, 3), (120, 100, 80), dtype=np.uint8) # plain brown background
    table_matches = matcher.match_all(table_img)
    table_dec = engine.decide(table_matches, matcher.target_videos, matcher.target_thresholds)
    print(f"[{'PASS' if not table_dec['matched'] else 'FAIL'}] Plain Brown Wall      -> Matched: {table_dec['matched']} (Should be False)")

if __name__ == "__main__":
    main()
