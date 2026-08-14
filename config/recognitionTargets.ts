// ─────────────────────────────────────────────────────────────────────────────
// recognitionTargets.ts
//
// SINGLE CONFIGURATION FILE for the hybrid recognition system.
//
// Target Mapping:
//   Photo 1 (Spider-Man)  -> /videos/video1.mp4
//   Photo 2 (Sai Baba)    -> /videos/video2.mp4
//   Photo 3 (Girls + 👍)  -> /videos/video3.mp4
//   Photo 4 (Birthday)    -> /videos/video4.mp4
// ─────────────────────────────────────────────────────────────────────────────

export interface RecognitionTarget {
  id: string;
  name: string;
  videoUrl: string;
  mindarTargetIndices: number[];
  referenceImages: string[];
  referenceThreshold?: number;
  badge?: string;
  description?: string;
  previewColor?: string;
}

export const RECOGNITION_TARGETS: RecognitionTarget[] = [
  {
    id: "spiderman",
    name: "Spider-Man",
    videoUrl: "/videos/video1.mp4",
    mindarTargetIndices: [0],
    referenceImages: [
      "/targets/spiderman_target.jpg",
      "/references/spiderman_marker.png",
    ],
    referenceThreshold: 0.78,
    badge: "Memory #1",
    description: "Physical comic book photo",
    previewColor: "from-red-600 to-rose-700",
  },
  {
    id: "saibaba",
    name: "Sai Baba",
    videoUrl: "/videos/video2.mp4",
    mindarTargetIndices: [1],
    referenceImages: [
      "/targets/target2.jpg",
    ],
    referenceThreshold: 0.78,
    badge: "Memory #2",
    description: "Sai Baba blessing memory",
    previewColor: "from-amber-400 to-orange-500",
  },
  {
    id: "girls_thumbsup",
    name: "Thumbs Up Memories",
    videoUrl: "/videos/video3.mp4",
    mindarTargetIndices: [2],
    referenceImages: [
      "/targets/target3.jpg",
      "/references/thumbs_up.png",
    ],
    referenceThreshold: 0.78,
    badge: "Memory #3",
    description: "Special memory with thumbs up",
    previewColor: "from-pink-500 to-rose-600",
  },
  {
    id: "birthday",
    name: "Beach Celebration",
    videoUrl: "/videos/video4.mp4",
    mindarTargetIndices: [3],
    referenceImages: [
      "/targets/target4.jpg",
      "/references/star_marker.png",
    ],
    referenceThreshold: 0.78,
    badge: "Memory #4",
    description: "Beach memories with yellow star marker",
    previewColor: "from-purple-500 to-amber-500",
  },
];

export const getTargetById = (id: string): RecognitionTarget | undefined =>
  RECOGNITION_TARGETS.find(t => t.id === id);

export const getTargetByMindarIndex = (index: number): RecognitionTarget | undefined =>
  RECOGNITION_TARGETS.find(t => t.mindarTargetIndices.includes(index));

export const getTargetsWithReferenceImages = (): RecognitionTarget[] =>
  RECOGNITION_TARGETS.filter(t => t.referenceImages.length > 0);

/** Threshold: 0.78 (Real targets score >95%, random images score <35%) */
export const DEFAULT_REFERENCE_THRESHOLD = 0.78;
export const FALLBACK_COLOR_THRESHOLD = 75;
export const AGREEMENT_BONUS = 0.10;
