# Image Recognition Python Backend (FastAPI + OpenCV)

This backend service performs image recognition using OpenCV visual feature matching (ORB/AKAZE + RANSAC), multi-zone HSV color histograms, and dHash structural analysis.

---

## Local Development

### 1. Install Requirements
```bash
cd backend
pip install -r requirements.txt
```

### 2. Run the Development Server
```bash
python main.py
# Or using uvicorn directly:
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

The API will be live at `http://localhost:8000`.
- Health Check: `http://localhost:8000/health`
- Target Catalogue: `http://localhost:8000/targets`
- Interactive API Docs: `http://localhost:8000/docs`

---

## Deploying to Render

### Option A: Deploy from GitHub Repository (Recommended)

1. Push your code to GitHub.
2. Log in to your [Render Dashboard](https://dashboard.render.com/).
3. Click **New +** → **Web Service**.
4. Connect your GitHub repository: `https://github.com/johanan-jo/idea`.
5. Configure the Web Service settings:
   - **Name**: `idea-recognition-api` (or your preferred name)
   - **Root Directory**: `backend`
   - **Runtime**: `Python 3`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `gunicorn -k uvicorn.workers.UvicornWorker main:app --bind 0.0.0.0:$PORT --workers 2 --timeout 120`
   - **Instance Type**: `Free`
6. Click **Deploy Web Service**.

Once deployed, Render will provide a public HTTPS URL such as:
```text
https://idea-recognition-api.onrender.com
```

---

## Connecting with Next.js (Vercel)

1. Open your Vercel project dashboard.
2. Go to **Settings** → **Environment Variables**.
3. Add the following variable:
   - **Key**: `NEXT_PUBLIC_RECOGNITION_API_URL`
   - **Value**: `https://YOUR-RENDER-SERVICE.onrender.com` (e.g. `https://idea-recognition-api.onrender.com`)
4. Redeploy on Vercel so the environment variable takes effect.

---

## API Endpoints

### 1. `GET /health`
Verify server health and number of loaded targets.

**Response:**
```json
{
  "status": "ok",
  "service": "image-recognition-api",
  "targets_loaded": 8
}
```

### 2. `POST /recognize`
Send a single captured camera frame as `multipart/form-data`.

**Form Parameter:**
- `image`: File (JPEG / WebP / PNG)

**Success Response:**
```json
{
  "matched": true,
  "target_id": "spiderman",
  "method": "reference",
  "reference": "spiderman_marker.png",
  "confidence": 0.92,
  "video": "/videos/video1.mp4",
  "debug": {
    "primary_score": 0.92,
    "inliers": 34,
    "has_agreement": true,
    "processing_time_ms": 78.4
  }
}
```

**No Match Response:**
```json
{
  "matched": false,
  "target_id": null,
  "method": null,
  "reference": null,
  "confidence": 0.0,
  "video": null
}
```
