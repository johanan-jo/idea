// ─────────────────────────────────────────────────────────────────────────────
// recognitionTargets.ts
//
// SINGLE CONFIGURATION FILE for the hybrid recognition system.
//
// To add a new target:
//   1. Add a reference image to public/references/
//   2. Add a new entry below
//   3. No other code changes required
//
// Recognition methods (in priority order):
//   1. MindAR  — image-target tracking via .mind file
//   2. Reference image matching — HOG feature comparison
//   3. Hue + dHash + Saturation fallback
// ─────────────────────────────────────────────────────────────────────────────

export interface RecognitionTarget {
  /** Unique string ID for this target */
  id: string;

  /** Human-readable display name */
  name: string;

  /** Video to play when this target is recognized */
  videoUrl: string;

  /**
   * MindAR target indices that map to this target.
   * Leave empty [] if no MindAR target is registered for this photo.
   */
  mindarTargetIndices: number[];

  /**
   * Reference images for HOG-based visual feature matching.
   * These should be placed in public/references/ or public/targets/.
   * Multiple images can point to the same target (e.g., different angles).
   */
  referenceImages: string[];

  /** Minimum HOG similarity score (0–1) to accept a reference match */
  referenceThreshold?: number;

  // ── Display metadata ────────────────────────────────────────────────────────
  badge?: string;
  description?: string;
  previewColor?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// TARGET DEFINITIONS
// Edit this array to add / remove / modify targets.
// ─────────────────────────────────────────────────────────────────────────────
export const RECOGNITION_TARGETS: RecognitionTarget[] = [
  {
    id: "spiderman",
    name: "Spider-Man",
    videoUrl: "/videos/video1.mp4",
    mindarTargetIndices: [0],
    referenceImages: [
      "/references/spiderman_marker.png",
      "/targets/spiderman_target.jpg",
    ],
    referenceThreshold: 0.72,
    badge: "Memory #0",
    description: "Physical comic book photo brought to life",
    previewColor: "from-red-600 to-rose-700",
  },
  {
    id: "saibaba",
    name: "Sai Baba",
    videoUrl: "/videos/video2.mp4",
    mindarTargetIndices: [1],
    referenceImages: ["/targets/target2.jpg"],
    referenceThreshold: 0.72,
    badge: "Memory #1",
    description: "Sai Baba blessing memory",
    previewColor: "from-amber-400 to-orange-500",
  },
  {
    id: "memory3",
    name: "Beach Sunset",
    videoUrl: "/videos/video3.mp4",
    mindarTargetIndices: [2],
    // Only the thumbs-up marker image — NOT the full photo (too generic, causes false matches)
    referenceImages: ["/references/thumbs_up.png"],
    referenceThreshold: 0.76,   // thumbs-up has a very distinct HOG shape; needs a confident match
    badge: "Memory #2",
    description: "Girls with thumbs up",
    previewColor: "from-amber-400 to-rose-500",
  },
  {
    id: "birthday",
    name: "Birthday Celebration",
    videoUrl: "/videos/video4.mp4",
    mindarTargetIndices: [3],
    referenceImages: [],
    referenceThreshold: 0.75,
    badge: "Memory #3",
    description: "To many more chapters written together",
    previewColor: "from-purple-500 to-amber-500",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Lookups — used internally by the recognition engine
// ─────────────────────────────────────────────────────────────────────────────

/** Get target by its unique string ID */
export const getTargetById = (id: string): RecognitionTarget | undefined =>
  RECOGNITION_TARGETS.find(t => t.id === id);

/** Get target by MindAR target index */
export const getTargetByMindarIndex = (index: number): RecognitionTarget | undefined =>
  RECOGNITION_TARGETS.find(t => t.mindarTargetIndices.includes(index));

/** All targets that have at least one reference image configured */
export const getTargetsWithReferenceImages = (): RecognitionTarget[] =>
  RECOGNITION_TARGETS.filter(t => t.referenceImages.length > 0);

/** Default HOG confidence threshold (used when target doesn't specify its own) */
export const DEFAULT_REFERENCE_THRESHOLD = 0.72;

/** Minimum fallback (Hue+dHash+Sat) combined score to accept a match (0–100) */
export const FALLBACK_COLOR_THRESHOLD = 52;

/** Confidence bonus added when two or more methods agree on the same target */
export const AGREEMENT_BONUS = 0.10;
