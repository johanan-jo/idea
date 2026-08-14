// ─────────────────────────────────────────────────────────────────────────────
// referenceImageMatcher.ts
//
// Robust Visual Feature + Color Hybrid Matcher.
// Works entirely in the browser using HTML5 Canvas — zero heavy dependencies.
//
// Algorithm:
//   • 60% Multi-scale HOG (Histogram of Oriented Gradients) - Structure & Edges
//   • 40% Color Distribution Histogram (RGB 24 bins) - Chromatic Signature
//   • Multi-region sampling (Full frame, 80% center, 60% center, 4 quadrants)
//
// Invariance:
//   • Lighting invariant (HOG gradient normalization + relative color distribution)
//   • Scale invariant (multi-region crop checks)
//   • Background noise resilient
// ─────────────────────────────────────────────────────────────────────────────

import {
  RecognitionTarget,
  getTargetsWithReferenceImages,
  DEFAULT_REFERENCE_THRESHOLD,
} from "@/config/recognitionTargets";

const HOG_SIZE   = 96;
const CELL_SIZE  = 8;
const ANGLE_BINS = 9;
const CELLS      = HOG_SIZE / CELL_SIZE; // 12x12

export interface ReferenceDescriptor {
  targetId: string;
  refImageUrl: string;
  hog: Float32Array;
  colorHist: Float32Array;
  threshold: number;
}

export interface ReferenceMatchResult {
  targetId: string;
  refImageUrl: string;
  confidence: number; // 0–1
  region: string;
}

// ── Feature Extractors ────────────────────────────────────────────────────────

function computeHOG(imageData: ImageData): Float32Array {
  const { width: W, height: H } = imageData;
  const gray = new Float32Array(W * H);
  const data = imageData.data;

  for (let i = 0, j = 0; j < W * H; i += 4, j++) {
    gray[j] = (77 * data[i] + 150 * data[i + 1] + 29 * data[i + 2]) / 256;
  }

  const mag = new Float32Array(W * H);
  const ang = new Float32Array(W * H);

  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const dx = gray[i + 1] - gray[i - 1];
      const dy = gray[i + W] - gray[i - W];
      mag[i] = Math.sqrt(dx * dx + dy * dy);
      let a = Math.atan2(dy, dx);
      if (a < 0) a += Math.PI;
      ang[i] = a;
    }
  }

  const hog = new Float32Array(CELLS * CELLS * ANGLE_BINS);

  for (let cy = 0; cy < CELLS; cy++) {
    for (let cx = 0; cx < CELLS; cx++) {
      const base = (cy * CELLS + cx) * ANGLE_BINS;
      for (let py = 0; py < CELL_SIZE; py++) {
        for (let px = 0; px < CELL_SIZE; px++) {
          const x = cx * CELL_SIZE + px;
          const y = cy * CELL_SIZE + py;
          if (x >= W || y >= H) continue;
          const idx = y * W + x;
          const m = mag[idx];
          if (m < 1e-4) continue;

          const normA = ang[idx] / Math.PI;
          const binF = normA * ANGLE_BINS;
          const b0 = Math.floor(binF) % ANGLE_BINS;
          const b1 = (b0 + 1) % ANGLE_BINS;
          const w1 = binF - Math.floor(binF);
          hog[base + b0] += m * (1 - w1);
          hog[base + b1] += m * w1;
        }
      }
    }
  }

  // L2 unit normalization
  let sumSq = 1e-6;
  for (let i = 0; i < hog.length; i++) sumSq += hog[i] * hog[i];
  const invNorm = 1 / Math.sqrt(sumSq);
  for (let i = 0; i < hog.length; i++) hog[i] *= invNorm;

  return hog;
}

function computeColorHist(imageData: ImageData): Float32Array {
  const data = imageData.data;
  const bins = new Float32Array(24); // 8 R, 8 G, 8 B

  for (let i = 0; i < data.length; i += 4) {
    bins[Math.min(7, Math.floor(data[i] / 32))]++;
    bins[8 + Math.min(7, Math.floor(data[i + 1] / 32))]++;
    bins[16 + Math.min(7, Math.floor(data[i + 2] / 32))]++;
  }

  const total = data.length / 4;
  for (let i = 0; i < bins.length; i++) bins[i] /= total;
  return bins;
}

function cosineSim(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return Math.max(0, Math.min(1, dot));
}

function bhattacharyya(a: Float32Array, b: Float32Array): number {
  let score = 0;
  for (let i = 0; i < a.length; i++) score += Math.sqrt(a[i] * b[i]);
  return Math.max(0, Math.min(1, score / 3)); // 3 channels
}

// ── Canvas helper ─────────────────────────────────────────────────────────────

function cropToCanvas(
  src: ImageData,
  x: number, y: number, w: number, h: number
): ImageData {
  const srcC = document.createElement("canvas");
  srcC.width = src.width;
  srcC.height = src.height;
  srcC.getContext("2d")!.putImageData(src, 0, 0);

  const dstC = document.createElement("canvas");
  dstC.width = HOG_SIZE;
  dstC.height = HOG_SIZE;
  dstC.getContext("2d")!.drawImage(srcC, x, y, w, h, 0, 0, HOG_SIZE, HOG_SIZE);
  return dstC.getContext("2d")!.getImageData(0, 0, HOG_SIZE, HOG_SIZE);
}

function imageDataFromUrl(url: string): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = HOG_SIZE;
      c.height = HOG_SIZE;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0, HOG_SIZE, HOG_SIZE);
      resolve(ctx.getImageData(0, 0, HOG_SIZE, HOG_SIZE));
    };
    img.onerror = reject;
    img.src = url + "?t=" + Date.now();
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function buildReferenceDescriptors(): Promise<ReferenceDescriptor[]> {
  const targets = getTargetsWithReferenceImages();
  const descriptors: ReferenceDescriptor[] = [];

  for (const target of targets) {
    for (const imgUrl of target.referenceImages) {
      try {
        const imageData = await imageDataFromUrl(imgUrl);
        const hog = computeHOG(imageData);
        const colorHist = computeColorHist(imageData);
        descriptors.push({
          targetId: target.id,
          refImageUrl: imgUrl,
          hog,
          colorHist,
          threshold: target.referenceThreshold ?? DEFAULT_REFERENCE_THRESHOLD,
        });
        console.log(`[RefMatcher] Loaded descriptor for ${target.id} ← ${imgUrl}`);
      } catch (e) {
        console.warn(`[RefMatcher] Could not load reference image: ${imgUrl}`, e);
      }
    }
  }

  return descriptors;
}

export function matchReferenceImages(
  captureData: ImageData,
  descriptors: ReferenceDescriptor[]
): ReferenceMatchResult[] {
  if (descriptors.length === 0) return [];

  const W = captureData.width;
  const H = captureData.height;

  // Multi-region sampling for robust detection across distance/crops
  const regions: Array<{ name: string; data: ImageData }> = [
    { name: "full",         data: cropToCanvas(captureData, 0, 0, W, H) },
    { name: "center80",     data: cropToCanvas(captureData, W * 0.1, H * 0.1, W * 0.8, H * 0.8) },
    { name: "center60",     data: cropToCanvas(captureData, W * 0.2, H * 0.2, W * 0.6, H * 0.6) },
    { name: "top-left",     data: cropToCanvas(captureData, 0, 0, W * 0.6, H * 0.6) },
    { name: "top-right",    data: cropToCanvas(captureData, W * 0.4, 0, W * 0.6, H * 0.6) },
    { name: "bottom-left",  data: cropToCanvas(captureData, 0, H * 0.4, W * 0.6, H * 0.6) },
    { name: "bottom-right", data: cropToCanvas(captureData, W * 0.4, H * 0.4, W * 0.6, H * 0.6) },
  ];

  const regionDescs = regions.map(r => ({
    name: r.name,
    hog: computeHOG(r.data),
    colorHist: computeColorHist(r.data),
  }));

  const results: ReferenceMatchResult[] = [];

  for (const desc of descriptors) {
    let bestScore = 0;
    let bestRegion = "none";

    for (const r of regionDescs) {
      const hogScore = cosineSim(desc.hog, r.hog);
      const colorScore = bhattacharyya(desc.colorHist, r.colorHist);

      // 60% HOG structure + 40% Color distribution
      const score = (hogScore * 0.60) + (colorScore * 0.40);

      if (score > bestScore) {
        bestScore = score;
        bestRegion = r.name;
      }
    }

    if (bestScore >= desc.threshold) {
      results.push({
        targetId: desc.targetId,
        refImageUrl: desc.refImageUrl,
        confidence: bestScore,
        region: bestRegion,
      });
    }
  }

  // Deduplicate by targetId (keep best confidence per target)
  const targetMap = new Map<string, ReferenceMatchResult>();
  for (const res of results) {
    const existing = targetMap.get(res.targetId);
    if (!existing || res.confidence > existing.confidence) {
      targetMap.set(res.targetId, res);
    }
  }

  const ranked = Array.from(targetMap.values()).sort((a, b) => b.confidence - a.confidence);

  // Require minimum confidence gap if multiple targets passed threshold
  const MIN_GAP = 0.05;
  if (ranked.length >= 2 && (ranked[0].confidence - ranked[1].confidence) < MIN_GAP) {
    console.log(`[RefMatcher] Ambiguous match: ${ranked[0].targetId} (${ranked[0].confidence.toFixed(2)}) vs ${ranked[1].targetId} (${ranked[1].confidence.toFixed(2)})`);
    return [];
  }

  return ranked;
}
