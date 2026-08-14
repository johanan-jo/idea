"""
FastAPI Vision Embedding Recognition Service for Render Deployment.
Powered by OpenCLIP Vision Embedder + OpenCV Geometric Verification.
"""

import os
import io
import time
import json
import cv2
import numpy as np
from PIL import Image
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, File, UploadFile, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from recognition.vision_embedder import VisionEmbedder
from recognition.reference_matcher import ReferenceMatcher
from recognition.decision_engine import DecisionEngine

# Base paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(BASE_DIR, "config", "targets.json")
REFERENCES_DIR = os.path.join(BASE_DIR, "references")
CACHE_DIR = os.path.join(BASE_DIR, "cache")

# Global recognition engines
vision_engine: Optional[VisionEmbedder] = None
opencv_matcher: Optional[ReferenceMatcher] = None
decision_engine = DecisionEngine(
    match_threshold=float(os.environ.get("MATCH_THRESHOLD", "0.78")),
    min_margin=float(os.environ.get("MIN_MARGIN", "0.05")),
    agreement_bonus=0.08
)

target_videos: dict = {}
target_thresholds: dict = {}

@asynccontextmanager
async def lifespan(app: FastAPI):
    global vision_engine, opencv_matcher, target_videos, target_thresholds

    print("[Backend] ==================================================")
    print("[Backend] Initializing Pretrained Vision Embedding Engine...")
    print("[Backend] ==================================================")
    
    # 1. Load target configuration
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        config_data = json.load(f)
    
    for t in config_data.get("targets", []):
        tid = t["id"]
        target_videos[tid] = t.get("video", "")
        target_thresholds[tid] = t.get("threshold", 0.78)

    # 2. Initialize and precompute Vision Embeddings (MobileNetV3-Large, ~21MB weights)
    model_name = os.environ.get("VISION_MODEL", "mobilenet_v3_large")
    
    vision_engine = VisionEmbedder(model_name=model_name)
    vision_engine.load_model()
    num_embeddings = vision_engine.load_and_precompute_references(
        config_path=CONFIG_PATH,
        base_dir=BASE_DIR,
        cache_dir=CACHE_DIR
    )
    print(f"[Backend] Precomputed {num_embeddings} reference vision embeddings.")

    # 3. Initialize OpenCV supporting descriptors
    opencv_matcher = ReferenceMatcher(config_path=CONFIG_PATH, references_dir=REFERENCES_DIR)
    loaded_opencv = opencv_matcher.load_targets()
    print(f"[Backend] Precomputed {loaded_opencv} OpenCV feature descriptors.")
    print("[Backend] Server is READY for recognition requests.")
    print("[Backend] ==================================================")

    yield
    print("[Backend] Shutting down recognition engine.")

app = FastAPI(
    title="Vision Embedding Image Recognition API",
    version="2.0.0",
    lifespan=lifespan
)

# CORS Configuration
ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

# ── Health Endpoint ───────────────────────────────────────────────────────────

@app.get("/health")
async def health_check():
    """Health check reporting ready status, loaded model, and precomputed embeddings."""
    ready = (vision_engine is not None and len(vision_engine.references_db) > 0)
    return {
        "status": "ok" if ready else "initializing",
        "service": "vision-embedding-recognition-api",
        "model": vision_engine.model_name if vision_engine else "none",
        "reference_embeddings_count": len(vision_engine.references_db) if vision_engine else 0,
        "ready": ready
    }

# ── Target Catalogue ──────────────────────────────────────────────────────────

@app.get("/targets")
async def list_targets():
    """Return all configured target items and video links."""
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data

# ── Recognition Endpoint ──────────────────────────────────────────────────────

@app.post("/recognize")
async def recognize_image(image: UploadFile = File(...)):
    """
    Accepts an uploaded image frame, encodes it via OpenCLIP vision embedding,
    computes cosine similarity against precomputed reference embeddings,
    and returns the best confident matching target.
    """
    if not vision_engine or not vision_engine.model:
        raise HTTPException(status_code=503, detail="Vision recognition engine not initialized")

    t_start = time.perf_counter()

    # 1. Read & Validate Uploaded Image (in-memory only, no disk saving)
    try:
        contents = await image.read()
        if not contents or len(contents) == 0:
            raise HTTPException(status_code=400, detail="Empty image payload")

        # Decode via PIL
        pil_img = Image.open(io.BytesIO(contents)).convert("RGB")
        
        # Decode via OpenCV for secondary feature verification
        nparr = np.frombuffer(contents, np.uint8)
        cv_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Image decode failed: {str(e)}")

    t_decode = time.perf_counter()

    # 2. Vision Embedding Generation & Cosine Similarity Matching
    query_emb = vision_engine.encode_pil(pil_img)
    vision_results = vision_engine.match_embedding(query_emb)
    t_vision = time.perf_counter()

    # 3. OpenCV Feature Verification (Secondary / Corroboration)
    opencv_results = {"features": [], "color": [], "dhash": []}
    if opencv_matcher and cv_bgr is not None:
        try:
            opencv_results = opencv_matcher.match_all(cv_bgr)
        except Exception as e:
            print(f"[Recognize] OpenCV check warning: {e}")
    t_opencv = time.perf_counter()

    # 4. Decision Engine
    decision = decision_engine.decide(
        vision_result=vision_results,
        opencv_matches=opencv_results,
        target_videos=target_videos,
        target_thresholds=target_thresholds
    )
    t_decision = time.perf_counter()

    # Calculate timings in milliseconds
    decode_ms = round((t_decode - t_start) * 1000, 1)
    vision_ms = round((t_vision - t_decode) * 1000, 1)
    opencv_ms = round((t_opencv - t_vision) * 1000, 1)
    decide_ms = round((t_decision - t_opencv) * 1000, 1)
    total_ms = round((t_decision - t_start) * 1000, 1)

    if "debug" not in decision or decision["debug"] is None:
        decision["debug"] = {}

    decision["debug"]["timing"] = {
        "decode_ms": decode_ms,
        "vision_embedding_ms": vision_ms,
        "opencv_ms": opencv_ms,
        "total_ms": total_ms
    }
    decision["debug"]["processing_time_ms"] = total_ms

    print(
        f"[Recognize] Match: {decision['matched']} | Target: {decision['target_id']} "
        f"| Conf: {decision['confidence']} | Margin: {decision.get('margin')} | Time: {total_ms}ms"
    )

    return JSONResponse(content=decision)

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
