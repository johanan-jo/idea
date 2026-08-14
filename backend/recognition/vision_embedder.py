"""
High-Performance, Low-Memory Vision Embedding Engine.
Uses Pretrained MobileNetV3-Large / Vision Backbone to generate 960-dim normalized embeddings.
Ultra-lightweight (~21MB weights, <80MB RAM) designed specifically for 512MB RAM constraints on Render.
"""

import os
import io
import time
import json
import torch
import torchvision.models as models
import numpy as np
from PIL import Image, ImageEnhance
from typing import Dict, List, Optional, Tuple, Any

class ReferenceVector:
    def __init__(self, target_id: str, relative_path: str, embedding: np.ndarray):
        self.target_id = target_id
        self.relative_path = relative_path
        self.embedding = embedding  # (960,) float32 unit vector

class VisionEmbedder:
    def __init__(
        self,
        model_name: str = "mobilenet_v3_large",
        device: Optional[str] = None
    ):
        self.model_name = model_name
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        
        self.model = None
        self.preprocess = None
        self.references_db: List[ReferenceVector] = []
        self.ref_matrix: Optional[np.ndarray] = None  # (N, 960)
        self.ref_metadata: List[Tuple[str, str]] = [] # [(target_id, path), ...]

    def load_model(self):
        """Load pretrained vision encoder with classification head removed."""
        print(f"[VisionEmbedder] Loading lightweight Vision Encoder '{self.model_name}' on {self.device}...")
        t0 = time.perf_counter()
        
        # Load MobileNetV3-Large (only 21MB, extremely fast on CPU)
        weights = models.MobileNet_V3_Large_Weights.DEFAULT
        self.preprocess = weights.transforms()
        
        model = models.mobilenet_v3_large(weights=weights)
        model.classifier = torch.nn.Identity() # Extract raw 960-dim visual embeddings
        model.eval()
        
        self.model = model.to(self.device)
        t_elapsed = round(time.perf_counter() - t0, 2)
        print(f"[VisionEmbedder] Model ready in {t_elapsed}s (~21MB RAM).")

    def preprocess_pil(self, img: Image.Image) -> Image.Image:
        """Apply contrast and illumination stabilization."""
        img = img.convert("RGB")
        enhancer = ImageEnhance.Contrast(img)
        return enhancer.enhance(1.05)

    def encode_pil(self, image_pil: Image.Image) -> np.ndarray:
        """Generate a 960-dimensional L2-normalized embedding vector from a PIL Image."""
        if self.model is None:
            self.load_model()

        clean_img = self.preprocess_pil(image_pil)
        tensor = self.preprocess(clean_img).unsqueeze(0).to(self.device)

        with torch.no_grad():
            features = self.model(tensor)
            # L2 Unit Normalization
            features = features / features.norm(dim=-1, keepdim=True)
            emb = features.cpu().numpy().flatten().astype(np.float32)

        return emb

    def encode_bytes(self, image_bytes: bytes) -> np.ndarray:
        """Decode image bytes and compute normalized embedding vector."""
        pil_img = Image.open(io.BytesIO(image_bytes))
        return self.encode_pil(pil_img)

    def encode_bgr(self, bgr_array: np.ndarray) -> np.ndarray:
        """Convert OpenCV BGR numpy array to PIL and compute embedding."""
        import cv2
        rgb = cv2.cvtColor(bgr_array, cv2.COLOR_BGR2RGB)
        pil_img = Image.fromarray(rgb)
        return self.encode_pil(pil_img)

    def load_and_precompute_references(
        self,
        config_path: str,
        base_dir: str,
        cache_dir: Optional[str] = None
    ) -> int:
        """
        Load target definitions and precompute embeddings for all registered references.
        Caches/loads from disk cache to speed up restarts.
        """
        if self.model is None:
            self.load_model()

        with open(config_path, "r", encoding="utf-8") as f:
            targets_data = json.load(f).get("targets", [])

        self.references_db = []
        cache_file = os.path.join(cache_dir, f"embeddings_{self.model_name}.npz") if cache_dir else None

        cache_loaded = False
        if cache_file and os.path.exists(cache_file):
            try:
                print(f"[VisionEmbedder] Loading precomputed embeddings from cache: {cache_file}")
                cached = np.load(cache_file, allow_pickle=True)
                target_ids = cached["target_ids"]
                paths = cached["paths"]
                embeddings = cached["embeddings"]

                for tid, p, emb in zip(target_ids, paths, embeddings):
                    self.references_db.append(ReferenceVector(str(tid), str(p), emb.astype(np.float32)))

                cache_loaded = True
                print(f"[VisionEmbedder] Restored {len(self.references_db)} reference embeddings from cache.")
            except Exception as e:
                print(f"[VisionEmbedder] Cache read failed ({e}), recomputing from scratch...")

        if not cache_loaded:
            print("[VisionEmbedder] Computing reference embeddings from image library...")
            for t in targets_data:
                tid = t["id"]
                refs = t.get("references", [])
                
                ref_dir = t.get("reference_dir")
                if ref_dir:
                    full_ref_dir = os.path.join(base_dir, ref_dir)
                    if os.path.exists(full_ref_dir):
                        for fname in os.listdir(full_ref_dir):
                            if fname.lower().endswith((".jpg", ".jpeg", ".png", ".webp")):
                                rel_p = os.path.join(ref_dir, fname).replace("\\", "/")
                                if rel_p not in refs:
                                    refs.append(rel_p)

                for rel_path in refs:
                    full_path = os.path.join(base_dir, rel_path)
                    if not os.path.exists(full_path):
                        print(f"[VisionEmbedder] Warning: Reference file missing: {full_path}")
                        continue

                    try:
                        pil_img = Image.open(full_path)
                        emb = self.encode_pil(pil_img)
                        self.references_db.append(ReferenceVector(tid, rel_path, emb))
                        print(f"[VisionEmbedder] Precomputed embedding for '{tid}' <- {rel_path}")
                    except Exception as err:
                        print(f"[VisionEmbedder] Could not encode {full_path}: {err}")

            if cache_file and len(self.references_db) > 0:
                try:
                    os.makedirs(os.path.dirname(cache_file), exist_ok=True)
                    np.savez_compressed(
                        cache_file,
                        target_ids=np.array([r.target_id for r in self.references_db]),
                        paths=np.array([r.relative_path for r in self.references_db]),
                        embeddings=np.array([r.embedding for r in self.references_db])
                    )
                    print(f"[VisionEmbedder] Saved {len(self.references_db)} embeddings to cache: {cache_file}")
                except Exception as ce:
                    print(f"[VisionEmbedder] Cache save warning: {ce}")

        if self.references_db:
            self.ref_matrix = np.stack([r.embedding for r in self.references_db], axis=0) # (N, 960)
            self.ref_metadata = [(r.target_id, r.relative_path) for r in self.references_db]

        return len(self.references_db)

    def match_embedding(self, query_embedding: np.ndarray) -> Dict[str, Any]:
        """
        Compare query vector against all reference embeddings via Cosine Similarity.
        Groups similarities by target ID, calculates margin and rankings.
        """
        if self.ref_matrix is None or len(self.references_db) == 0:
            return {
                "matched": False,
                "target_id": None,
                "confidence": 0.0,
                "margin": 0.0,
                "ranked_targets": []
            }

        # Matrix dot product of normalized vectors = Cosine Similarity (-1.0 to 1.0)
        sims = np.dot(self.ref_matrix, query_embedding) # (N,)
        
        target_scores: Dict[str, float] = {}
        best_ref_per_target: Dict[str, str] = {}
        all_ref_scores: Dict[str, List[float]] = {}

        for i, (tid, rel_path) in enumerate(self.ref_metadata):
            score = float(sims[i])
            if tid not in target_scores or score > target_scores[tid]:
                target_scores[tid] = score
                best_ref_per_target[tid] = rel_path
            
            all_ref_scores.setdefault(tid, []).append(score)

        # Rank targets by highest reference similarity
        ranked = sorted(
            [
                {
                    "target_id": tid,
                    "score": round(target_scores[tid], 4),
                    "best_reference": best_ref_per_target[tid],
                    "all_scores": [round(s, 4) for s in all_ref_scores[tid]]
                }
                for tid in target_scores
            ],
            key=lambda x: x["score"],
            reverse=True
        )

        top1 = ranked[0] if len(ranked) >= 1 else None
        top2 = ranked[1] if len(ranked) >= 2 else None

        margin = round(top1["score"] - top2["score"], 4) if (top1 and top2) else (top1["score"] if top1 else 0.0)

        return {
            "top_target": top1["target_id"] if top1 else None,
            "top_score": top1["score"] if top1 else 0.0,
            "best_reference": top1["best_reference"] if top1 else None,
            "second_target": top2["target_id"] if top2 else None,
            "second_score": top2["score"] if top2 else 0.0,
            "margin": margin,
            "ranked_targets": ranked
        }
