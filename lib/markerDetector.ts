// ─────────────────────────────────────────────────────────────────────────────
// markerDetector.ts
//
// Pure client-side visual fiducial marker detector.
// No external libraries required — runs entirely in the browser.
//
// Marker format: 6×6 binary grid
//   ■ ■ ■ ■ ■ ■   ← solid black border (all 6 cells)
//   ■ · · · · ■   ← border
//   ■ · D D · ■   ← data rows (D = data bit)
//   ■ · D D · ■
//   ■ · · · · ■   ← border
//   ■ ■ ■ ■ ■ ■   ← solid black border
//
// Detection pipeline:
//   1. Downsample frame to 480×360 max
//   2. Convert to grayscale
//   3. Otsu's global threshold → binary image
//   4. Sliding window at multiple scales
//   5. At each candidate: sample 6×6 grid (9-point average per cell)
//   6. Verify: all border cells must be dark
//   7. Read 4×4 inner data bits
//   8. Try all 4 rotations, match against known patterns
//   9. Return best match if bit-errors ≤ MAX_BIT_ERRORS
// ─────────────────────────────────────────────────────────────────────────────

import { MARKER_PATTERNS, MAX_BIT_ERRORS } from "@/config/markerTargets";

// ── Result type ───────────────────────────────────────────────────────────────
export interface DetectedMarker {
  id: number;
  errors: number;       // number of bit mismatches (0 = perfect)
  confidence: number;   // 0–1 (1 - errors/16)
  cx: number;           // center x in the processed image
  cy: number;           // center y in the processed image
  size: number;         // side length in pixels (in processed image)
}

// ── Grayscale ─────────────────────────────────────────────────────────────────
function toGrayscale(data: Uint8ClampedArray, len: number): Uint8Array {
  const gray = new Uint8Array(len);
  for (let i = 0, j = 0; j < len; i += 4, j++) {
    gray[j] = (77 * data[i] + 150 * data[i + 1] + 29 * data[i + 2]) >> 8;
  }
  return gray;
}

// ── Otsu threshold ────────────────────────────────────────────────────────────
function otsuThreshold(gray: Uint8Array): number {
  const hist = new Int32Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, max = 0, threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > max) { max = between; threshold = t; }
  }
  return threshold;
}

// ── Sample one 6×6 cell (9-point average) ────────────────────────────────────
function sampleCell(
  gray: Uint8Array, W: number, H: number,
  markerX: number, markerY: number, cellW: number, cellH: number,
  row: number, col: number
): number {
  const cx = markerX + col * cellW;
  const cy = markerY + row * cellH;
  let sum = 0;
  // 3×3 sample grid inside the cell
  for (let fy = 0.25; fy <= 0.75; fy += 0.25) {
    for (let fx = 0.25; fx <= 0.75; fx += 0.25) {
      const px = Math.min(W - 1, Math.max(0, Math.round(cx + fx * cellW)));
      const py = Math.min(H - 1, Math.max(0, Math.round(cy + fy * cellH)));
      sum += gray[py * W + px];
    }
  }
  return sum / 9; // 0–255 average intensity
}

// ── Rotate 4×4 pattern 90° clockwise ─────────────────────────────────────────
function rotate90(p: number[]): number[] {
  // new[r][c] = old[3-c][r]
  const n = new Array<number>(16);
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++)
      n[r * 4 + c] = p[(3 - c) * 4 + r];
  return n;
}

// ── Hamming distance between two 16-bit patterns ──────────────────────────────
function hamming(a: number[], b: number[]): number {
  let d = 0;
  for (let i = 0; i < 16; i++) if (a[i] !== b[i]) d++;
  return d;
}

// ── Match bits against all known patterns (4 rotations each) ──────────────────
function matchBits(bits: number[]): { id: number; errors: number; rotation: number } | null {
  let best = { id: -1, errors: 999, rotation: 0 };
  for (const [idStr, basePat] of Object.entries(MARKER_PATTERNS)) {
    const id = parseInt(idStr);
    let p = [...basePat];
    for (let rot = 0; rot < 4; rot++) {
      const err = hamming(bits, p);
      if (err < best.errors) best = { id, errors: err, rotation: rot };
      p = rotate90(p);
    }
  }
  return best.errors <= MAX_BIT_ERRORS ? best : null;
}

// ── Main detection ────────────────────────────────────────────────────────────

/**
 * Detect fiducial markers in an ImageData frame.
 * Returns an array of detected markers sorted by confidence (best first).
 *
 * @param imageData  Raw ImageData from a canvas.
 * @param maxResults Maximum number of markers to return (default 1).
 */
export function detectMarkers(
  imageData: ImageData,
  maxResults = 1
): DetectedMarker[] {
  const W = imageData.width;
  const H = imageData.height;

  const gray = toGrayscale(imageData.data, W * H);
  const threshold = otsuThreshold(gray);

  const results: DetectedMarker[] = [];
  const seen = new Set<string>();

  // Scale range: marker should be 6%–55% of the shorter image dimension
  const minSize = Math.round(Math.min(W, H) * 0.06);
  const maxSize = Math.round(Math.min(W, H) * 0.55);

  let size = minSize;
  while (size <= maxSize) {
    const cellW = size / 6;
    const cellH = size / 6;
    // Step: 25% of marker size (50% overlap)
    const stepX = Math.max(2, Math.round(size * 0.25));
    const stepY = Math.max(2, Math.round(size * 0.25));

    for (let y = 0; y <= H - size; y += stepY) {
      for (let x = 0; x <= W - size; x += stepX) {

        // ── 1. Border check: rows 0, 5 and cols 0, 5 must be dark ──────────
        let borderOk = true;

        // Top and bottom rows
        for (let c = 0; c < 6 && borderOk; c++) {
          if (sampleCell(gray, W, H, x, y, cellW, cellH, 0, c) > threshold) borderOk = false;
          if (sampleCell(gray, W, H, x, y, cellW, cellH, 5, c) > threshold) borderOk = false;
        }
        // Left and right columns (skip already-checked corners)
        for (let r = 1; r < 5 && borderOk; r++) {
          if (sampleCell(gray, W, H, x, y, cellW, cellH, r, 0) > threshold) borderOk = false;
          if (sampleCell(gray, W, H, x, y, cellW, cellH, r, 5) > threshold) borderOk = false;
        }
        if (!borderOk) continue;

        // ── 2. Inner area must NOT be entirely dark (avoid solid blocks) ──
        const innerSamples = [
          sampleCell(gray, W, H, x, y, cellW, cellH, 1, 1),
          sampleCell(gray, W, H, x, y, cellW, cellH, 1, 4),
          sampleCell(gray, W, H, x, y, cellW, cellH, 4, 1),
          sampleCell(gray, W, H, x, y, cellW, cellH, 4, 4),
        ];
        const avgInner = innerSamples.reduce((a, b) => a + b, 0) / 4;
        // At least some inner cells should be light
        if (avgInner < threshold * 0.5) continue;

        // ── 3. Read 4×4 data bits (rows 1–4, cols 1–4) ─────────────────
        const bits: number[] = [];
        for (let r = 1; r <= 4; r++)
          for (let c = 1; c <= 4; c++)
            bits.push(sampleCell(gray, W, H, x, y, cellW, cellH, r, c) < threshold ? 1 : 0);

        // ── 4. Match against known patterns ────────────────────────────
        const match = matchBits(bits);
        if (!match) continue;

        // ── 5. De-duplicate nearby detections ───────────────────────────
        const cx = x + size / 2;
        const cy = y + size / 2;
        const bucket = `${Math.round(cx / (size * 0.5))}_${Math.round(cy / (size * 0.5))}_${match.id}`;
        if (seen.has(bucket)) continue;
        seen.add(bucket);

        results.push({
          id: match.id,
          errors: match.errors,
          confidence: 1 - match.errors / 16,
          cx: Math.round(cx),
          cy: Math.round(cy),
          size,
        });

        if (results.length >= maxResults * 4) break; // Early exit
      }
      if (results.length >= maxResults * 4) break;
    }
    size = Math.round(size * 1.4);
  }

  // Return best results sorted by confidence
  results.sort((a, b) => a.errors - b.errors || b.size - a.size);
  return results.slice(0, maxResults);
}

// ─────────────────────────────────────────────────────────────────────────────
// HSV Fallback matcher (kept as secondary method for images without markers)
// ─────────────────────────────────────────────────────────────────────────────

export interface FallbackMatchResult {
  targetIndex: number;
  hueScore: number;
  dHashScore: number;
  satScore: number;
  combinedScore: number;
}

const ZONES = 4, H_BINS = 16, S_BINS = 8, SAT_THR = 0.15;
const FLOATS_PER_ZONE = H_BINS + S_BINS;

function rgbToHsv(r: number, g: number, b: number) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r)      h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else                h = (r - g) / d + 4;
    h = h / 6; if (h < 0) h += 1;
  }
  return { h, s: max ? d / max : 0 };
}

function extractHSVHist(data: ImageData): Float32Array {
  const { width: W, height: H } = data;
  const zW = Math.floor(W / ZONES), zH = Math.floor(H / ZONES);
  const out = new Float32Array(ZONES * ZONES * FLOATS_PER_ZONE);
  for (let zr = 0; zr < ZONES; zr++) {
    for (let zc = 0; zc < ZONES; zc++) {
      const base = (zr * ZONES + zc) * FLOATS_PER_ZONE;
      let hCount = 0, sCount = 0;
      for (let y = zr * zH; y < (zr + 1) * zH; y += 2) {
        for (let x = zc * zW; x < (zc + 1) * zW; x += 2) {
          const i = (y * W + x) * 4;
          const { h, s } = rgbToHsv(data.data[i], data.data[i+1], data.data[i+2]);
          out[base + H_BINS + Math.min(Math.floor(s * S_BINS), S_BINS - 1)]++; sCount++;
          if (s >= SAT_THR) { out[base + Math.min(Math.floor(h * H_BINS), H_BINS - 1)]++; hCount++; }
        }
      }
      if (hCount) for (let b = 0; b < H_BINS; b++) out[base + b] /= hCount;
      if (sCount) for (let b = 0; b < S_BINS; b++)  out[base + H_BINS + b] /= sCount;
    }
  }
  return out;
}

function bhatt(a: Float32Array | number[], b: Float32Array | number[], len: number): number {
  let c = 0; for (let i = 0; i < len; i++) c += Math.sqrt(a[i] * b[i]); return c;
}

function computeDHash(data: ImageData): Uint8Array {
  const W = 17, H = 16;
  const tmp = document.createElement("canvas"); tmp.width = W; tmp.height = H;
  const ctx = tmp.getContext("2d")!;
  const src = document.createElement("canvas"); src.width = data.width; src.height = data.height;
  src.getContext("2d")!.putImageData(data, 0, 0);
  ctx.drawImage(src, 0, 0, W, H);
  const px = ctx.getImageData(0, 0, W, H).data;
  const grays: number[] = [];
  for (let i = 0; i < px.length; i += 4) grays.push(0.299*px[i]+0.587*px[i+1]+0.114*px[i+2]);
  const bits = new Uint8Array((W - 1) * H);
  for (let r = 0; r < H; r++)
    for (let c = 0; c < W - 1; c++)
      bits[r * (W-1) + c] = grays[r*W+c] > grays[r*W+c+1] ? 1 : 0;
  return bits;
}

function hammingU8(a: Uint8Array, b: Uint8Array): number {
  let d = 0; const L = Math.min(a.length, b.length); for (let i = 0; i < L; i++) if (a[i] !== b[i]) d++; return d;
}

export interface FallbackRef {
  targetIndex: number;
  hsvHist: Float32Array;
  dHash: Uint8Array;
  hasImage: boolean;
  name: string;
}

const REF_SIZE = 200;

export async function loadFallbackRef(
  targetIndex: number,
  name: string,
  previewUrl: string | undefined
): Promise<FallbackRef> {
  const empty: FallbackRef = { targetIndex, name, hsvHist: new Float32Array(0), dHash: new Uint8Array(0), hasImage: false };
  if (!previewUrl) return empty;
  return new Promise(resolve => {
    const img = new Image(); img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const c = document.createElement("canvas"); c.width = REF_SIZE; c.height = REF_SIZE;
        const ctx = c.getContext("2d")!; ctx.drawImage(img, 0, 0, REF_SIZE, REF_SIZE);
        const d = ctx.getImageData(0, 0, REF_SIZE, REF_SIZE);
        resolve({ targetIndex, name, hsvHist: extractHSVHist(d), dHash: computeDHash(d), hasImage: true });
      } catch { resolve(empty); }
    };
    img.onerror = () => resolve(empty);
    img.src = previewUrl + "?t=" + Date.now();
  });
}

export function computeFallbackScores(
  captureData: ImageData,
  refs: FallbackRef[]
): FallbackMatchResult[] {
  const norm = document.createElement("canvas"); norm.width = REF_SIZE; norm.height = REF_SIZE;
  const normCtx = norm.getContext("2d")!;
  const src = document.createElement("canvas"); src.width = captureData.width; src.height = captureData.height;
  src.getContext("2d")!.putImageData(captureData, 0, 0);
  normCtx.drawImage(src, 0, 0, REF_SIZE, REF_SIZE);
  const capData = normCtx.getImageData(0, 0, REF_SIZE, REF_SIZE);
  const capHSV = extractHSVHist(capData);
  const capDH  = computeDHash(capData);

  const ZSQ = ZONES * ZONES;
  return refs.filter(r => r.hasImage).map(ref => {
    let hueBC = 0, satBC = 0;
    for (let z = 0; z < ZSQ; z++) {
      const b = z * FLOATS_PER_ZONE;
      hueBC += bhatt(Array.from(capHSV.slice(b, b + H_BINS)), Array.from(ref.hsvHist.slice(b, b + H_BINS)), H_BINS);
      satBC += bhatt(Array.from(capHSV.slice(b + H_BINS, b + H_BINS + S_BINS)), Array.from(ref.hsvHist.slice(b + H_BINS, b + H_BINS + S_BINS)), S_BINS);
    }
    const hueScore  = (hueBC / ZSQ) * 100;
    const satScore  = (satBC / ZSQ) * 100;
    const dDist     = hammingU8(capDH, ref.dHash);
    const dHashScore = ((256 - dDist) / 256) * 100;
    const combined  = Math.round(hueScore * 0.55 + dHashScore * 0.30 + satScore * 0.15);
    return { targetIndex: ref.targetIndex, hueScore: Math.round(hueScore), dHashScore: Math.round(dHashScore), satScore: Math.round(satScore), combinedScore: combined };
  });
}
