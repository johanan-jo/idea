"""
FastAPI Image Recognition Backend for Render Deployment.
Provides /health and /recognize endpoints using OpenCV visual feature matching.
"""

import os
import time
import cv2
import numpy as np
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, File, UploadFile, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from recognition.reference_matcher import ReferenceMatcher
from recognition.decision_engine import DecisionEngine

# Base paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(BASE_DIR, "config", "targets.json")
REFERENCES_DIR = os.path.join(BASE_DIR, "references")

# Global instances
matcher: Optional[ReferenceMatcher] = None
engine = DecisionEngine(
    feature_threshold=0.75,
    fallback_threshold=0.82,
    agreement_bonus=0.10,
    min_gap=0.05
)

@asynccontextmanager
async def lifespan(app: FastAPI):
    global matcher
    print("[Backend] Initializing Reference Matcher & Precomputing Descriptors...")
    matcher = ReferenceMatcher(config_path=CONFIG_PATH, references_dir=REFERENCES_DIR)
    loaded = matcher.load_targets()
    print(f"[Backend] Precomputed {loaded} reference descriptors. Server ready for requests.")
    yield
    print("[Backend] Shutting down.")

app = FastAPI(
    title="Image Recognition API",
    version="1.0.0",
    lifespan=lifespan
)

# CORS Configuration
# Allows Vercel frontend, local Next.js dev server, and custom domains
ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]

# Allow any Vercel preview or production domain
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
    """Health check endpoint used by frontend and Render liveness probes."""
    loaded_count = len(matcher.feature_matcher.descriptors_db) if matcher else 0
    return {
        "status": "ok",
        "service": "image-recognition-api",
        "targets_loaded": loaded_count
    }

# ── Targets Catalogue ─────────────────────────────────────────────────────────

@app.get("/targets")
async def list_targets():
    """Return all configured recognition targets and mapped videos."""
    if not matcher:
        return {"targets": []}
    return {"targets": list(matcher.targets_config.values())}

# ── Recognition Endpoint ──────────────────────────────────────────────────────

@app.post("/recognize")
async def recognize_image(image: UploadFile = File(...)):
    """
    Accepts an uploaded image frame, runs multi-method OpenCV recognition,
    and returns the best confident matching target.
    """
    if not matcher:
        raise HTTPException(status_code=503, detail="Recognition engine not initialized")

    t_start = time.perf_counter()

    # 1. Read & Validate Uploaded Image
    try:
        contents = await image.read()
        if not contents or len(contents) == 0:
            raise HTTPException(status_code=400, detail="Empty image payload")

        # In-memory OpenCV decode (no disk persistence)
        nparr = np.frombuffer(contents, np.uint8)
        img_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if img_bgr is None or img_bgr.size == 0:
            raise HTTPException(status_code=400, detail="Invalid or unsupported image format")

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Image decode failed: {str(e)}")

    t_decode = time.perf_counter()

    # 2. Run Reference Matching
    matches_dict = matcher.match_all(img_bgr)
    t_match = time.perf_counter()

    # 3. Decision Engine
    decision = engine.decide(
        matches_dict=matches_dict,
        target_videos=matcher.target_videos,
        target_thresholds=matcher.target_thresholds
    )
    t_decision = time.perf_counter()

    # Calculate timings in milliseconds
    decode_ms = round((t_decode - t_start) * 1000, 1)
    match_ms = round((t_match - t_decode) * 1000, 1)
    decide_ms = round((t_decision - t_match) * 1000, 1)
    total_ms = round((t_decision - t_start) * 1000, 1)

    # Attach processing timing metrics
    if "debug" not in decision or decision["debug"] is None:
        decision["debug"] = {}

    decision["debug"]["timing"] = {
        "decode_ms": decode_ms,
        "match_ms": match_ms,
        "decide_ms": decide_ms,
        "total_ms": total_ms
    }
    decision["debug"]["processing_time_ms"] = total_ms

    print(
        f"[Recognize] Match: {decision['matched']} | Target: {decision['target_id']} "
        f"| Conf: {decision['confidence']} | Method: {decision['method']} | Time: {total_ms}ms"
    )

    return JSONResponse(content=decision)

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
