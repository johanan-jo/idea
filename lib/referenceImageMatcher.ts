// ─────────────────────────────────────────────────────────────────────────────
// referenceImageMatcher.ts
//
// HOG (Histogram of Oriented Gradients) based reference image matcher.
// Works entirely in the browser — no external dependencies.
//
// Why HOG?
//   • Gradient-based → invariant to overall brightness / lighting shifts
//   • Captures shape/texture structure → distinguishes different photo subjects
//   • Robust to moderate scale and lighting changes
//   • No WASM or large library needed
//
// Detection strategy for reference-within-larger-frame:
//   • Compare full captured frame vs reference
//   • Compare center 60% crop vs reference
//   • Compare each quadrant vs reference
//   • Return maximum confidence across all regions
// ─────────────────────────────────────────────────────────────────────────────

import {
  RecognitionTarget,
  getTargetsWithReferenceImages,
  DEFAULT_REFERENCE_THRESHOLD,
} from "@/config/recognitionTargets";

// ── Constants ─────────────────────────────────────────────────────────────────
const HOG_SIZE     = 96;   // Normalise all images to 96×96 before HOG
const CELL_SIZE    = 8;    // Pixels per HOG cell
const ANGLE_BINS   = 9;    // Gradient orientation bins (0°–180° unsigned)
const CELLS        = HOG_SIZE / CELL_SIZE; // 12×12 = 144 cells

// ── Types ─────────────────────────────────────────────────────────────────────
export interface ReferenceDescriptor {
  targetId: string;
  refImageUrl: string;
  hog: Float32Array;
  threshold: number;
}

export interface ReferenceMatchResult {
  targetId: string;
  refImageUrl: string;
  confidence: number; // 0–1
  region: string;     // which region gave the best score
}

// ── HOG computation ───────────────────────────────────────────────────────────

function toGray(data: Uint8ClampedArray, len: number): Float32Array {
  const g = new Float32Array(len);
  for (let i = 0, j = 0; j < len; i += 4, j++)
    g[j] = (77 * data[i] + 150 * data[i + 1] + 29 * data[i + 2]) / 256;
  return g;
}

/**
 * Compute HOG descriptor for a given ImageData.
 * Returns Float32Array of length CELLS*CELLS*ANGLE_BINS.
 */
function computeHOG(imageData: ImageData): Float32Array {
  const { width: W, height: H } = imageData;
  const gray = toGray(imageData.data, W * H);

  // Compute gradient magnitude and orientation
  const mag = new Float32Array(W * H);
  const ang = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i  = y * W + x;
      const dx = gray[i + 1]     - gray[i - 1];
      const dy = gray[i + W]     - gray[i - W];
      mag[i] = Math.sqrt(dx * dx + dy * dy);
      // Unsigned orientation: map atan2 from (-π, π] to [0, π)
      let a = Math.atan2(dy, dx);
      if (a < 0) a += Math.PI;
      ang[i] = a;
    }
  }

  // Build HOG cell histograms
  const numCells = CELLS * CELLS;
  const hog = new Float32Array(numCells * ANGLE_BINS);

  for (let cy = 0; cy < CELLS; cy++) {
    for (let cx = 0; cx < CELLS; cx++) {
      const cellBase = (cy * CELLS + cx) * ANGLE_BINS;
      for (let py = 0; py < CELL_SIZE; py++) {
        for (let px = 0; px < CELL_SIZE; px++) {
          const x = cx * CELL_SIZE + px;
          const y = cy * CELL_SIZE + py;
          if (x >= W || y >= H) continue;
          const idx = y * W + x;
          const m   = mag[idx];
          if (m < 1e-4) continue;
          // Soft assignment to two neighbouring bins
          const normA   = ang[idx] / Math.PI; // 0–1
          const binF    = normA * ANGLE_BINS;
          const b0      = Math.floor(binF) % ANGLE_BINS;
          const b1      = (b0 + 1) % ANGLE_BINS;
          const w1      = binF - Math.floor(binF);
          hog[cellBase + b0] += m * (1 - w1);
          hog[cellBase + b1] += m * w1;
        }
      }
    }
  }

  // L2-block normalisation (2×2 blocks, stride 1)
  const eps = 1e-5;
  for (let by = 0; by < CELLS - 1; by++) {
    for (let bx = 0; bx < CELLS - 1; bx++) {
      let norm2 = eps;
      for (let dy = 0; dy <= 1; dy++)
        for (let dx = 0; dx <= 1; dx++) {
          const base = ((by + dy) * CELLS + (bx + dx)) * ANGLE_BINS;
          for (let b = 0; b < ANGLE_BINS; b++) norm2 += hog[base + b] ** 2;
        }
      const invNorm = 1 / Math.sqrt(norm2);
      for (let dy = 0; dy <= 1; dy++)
        for (let dx = 0; dx <= 1; dx++) {
          const base = ((by + dy) * CELLS + (bx + dx)) * ANGLE_BINS;
          for (let b = 0; b < ANGLE_BINS; b++) hog[base + b] *= invNorm;
        }
    }
  }

  return hog;
}

/** Cosine similarity between two normalised HOG descriptors */
function cosineSim(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na  += a[i] * a[i];
    nb  += b[i] * b[i];
  }
  const denom = Math.sqrt(na * nb) + 1e-10;
  return Math.max(0, dot / denom);
}

// ── Canvas helpers ────────────────────────────────────────────────────────────

function imageDataFromUrl(url: string): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = HOG_SIZE; c.height = HOG_SIZE;
      c.getContext("2d")!.drawImage(img, 0, 0, HOG_SIZE, HOG_SIZE);
      resolve(c.getContext("2d")!.getImageData(0, 0, HOG_SIZE, HOG_SIZE));
    };
    img.onerror = reject;
    img.src = url + "?t=" + Date.now();
  });
}

function cropToCanvas(
  src: ImageData,
  x: number, y: number, w: number, h: number
): ImageData {
  // Draw src into an offscreen canvas then crop
  const srcC = document.createElement("canvas");
  srcC.width = src.width; srcC.height = src.height;
  srcC.getContext("2d")!.putImageData(src, 0, 0);

  const dstC = document.createElement("canvas");
  dstC.width = HOG_SIZE; dstC.height = HOG_SIZE;
  dstC.getContext("2d")!.drawImage(srcC, x, y, w, h, 0, 0, HOG_SIZE, HOG_SIZE);
  return dstC.getContext("2d")!.getImageData(0, 0, HOG_SIZE, HOG_SIZE);
}

function resizeToHOG(src: ImageData): ImageData {
  return cropToCanvas(src, 0, 0, src.width, src.height);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Pre-load and compute HOG descriptors for all configured reference images.
 * Call once at startup; the result is cached in the matcher.
 */
export async function buildReferenceDescriptors(): Promise<ReferenceDescriptor[]> {
  const targets = getTargetsWithReferenceImages();
  const descriptors: ReferenceDescriptor[] = [];

  for (const target of targets) {
    for (const imgUrl of target.referenceImages) {
      try {
        const imageData = await imageDataFromUrl(imgUrl);
        const hog = computeHOG(imageData);
        descriptors.push({
          targetId: target.id,
          refImageUrl: imgUrl,
          hog,
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

/**
 * Match a captured camera frame against all pre-built reference descriptors.
 *
 * Tests multiple regions of the captured frame so that a reference image
 * appearing in a corner or partial area of the photo can still be detected.
 *
 * @param captureData  ImageData from a canvas (any resolution)
 * @param descriptors  Pre-built reference descriptors from buildReferenceDescriptors()
 * @returns            Array of matches above their threshold, sorted by confidence
 */
export function matchReferenceImages(
  captureData: ImageData,
  descriptors: ReferenceDescriptor[]
): ReferenceMatchResult[] {
  if (descriptors.length === 0) return [];

  const W = captureData.width;
  const H = captureData.height;

  // Build HOG for several regions of the captured frame
  const regions: Array<{ name: string; data: ImageData }> = [
    { name: "full",         data: resizeToHOG(captureData) },
    { name: "center60",     data: cropToCanvas(captureData, W*0.2, H*0.2, W*0.6, H*0.6) },
    { name: "top-left",     data: cropToCanvas(captureData, 0,     0,     W*0.55, H*0.55) },
    { name: "top-right",    data: cropToCanvas(captureData, W*0.45,0,     W*0.55, H*0.55) },
    { name: "bottom-left",  data: cropToCanvas(captureData, 0,     H*0.45,W*0.55, H*0.55) },
    { name: "bottom-right", data: cropToCanvas(captureData, W*0.45,H*0.45,W*0.55, H*0.55) },
  ];

  const regionHOGs = regions.map(r => ({ name: r.name, hog: computeHOG(r.data) }));

  const results: ReferenceMatchResult[] = [];

  for (const desc of descriptors) {
    let bestConf = 0;
    let bestRegion = "none";

    for (const { name, hog } of regionHOGs) {
      const sim = cosineSim(desc.hog, hog);
      if (sim > bestConf) {
        bestConf = sim;
        bestRegion = name;
      }
    }

    if (bestConf >= desc.threshold) {
      results.push({
        targetId: desc.targetId,
        refImageUrl: desc.refImageUrl,
        confidence: bestConf,
        region: bestRegion,
      });
    }
  }

  // Sort best-first, deduplicate by targetId (keep best confidence per target)
  const seen = new Set<string>();
  const ranked = results
    .sort((a, b) => b.confidence - a.confidence)
    .filter(r => { if (seen.has(r.targetId)) return false; seen.add(r.targetId); return true; });

  // Require minimum confidence gap between 1st and 2nd place.
  // If two different targets score too similarly, refuse to guess.
  const MIN_GAP = 0.06;
  if (ranked.length >= 2 && ranked[0].confidence - ranked[1].confidence < MIN_GAP) {
    console.log(`[RefMatcher] Ambiguous — gap too small (${(ranked[0].confidence - ranked[1].confidence).toFixed(3)} < ${MIN_GAP}). Rejecting.`);
    return [];
  }

  return ranked;
}
