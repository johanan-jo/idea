// ─────────────────────────────────────────────────────────────────────────────
// recognitionTargets.ts
//
// SINGLE CONFIGURATION FILE for the hybrid recognition system.
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
    id: "girls_thumbsup",
    name: "Tan's Wish",
    videoUrl: "/videos/tan_wish.mp4",
    mindarTargetIndices: [0],
    referenceImages: [
      "/targets/target3.jpg",
      "/references/thumbs_up.png",
    ],
    referenceThreshold: 0.78,
    badge: "Memory #1",
    description: "Tan's birthday wish memory",
    previewColor: "from-pink-500 to-rose-600",
  },
  {
    id: "birthday",
    name: "Sipi's Wish",
    videoUrl: "/videos/sipi_wish.mp4",
    mindarTargetIndices: [1],
    referenceImages: [
      "/targets/target4.jpg",
    ],
    referenceThreshold: 0.78,
    badge: "Memory #2",
    description: "Sipi's birthday wish memory",
    previewColor: "from-pink-600 to-purple-600",
  },
  {
    id: "group_friends",
    name: "Shriya's Wish",
    videoUrl: "/videos/shriya_wish.mp4",
    mindarTargetIndices: [2],
    referenceImages: [
      "/targets/target5.jpg",
    ],
    referenceThreshold: 0.78,
    badge: "Memory #3",
    description: "Joyful memories together",
    previewColor: "from-amber-500 to-rose-600",
  },
  {
    id: "sv_wish",
    name: "SV's Wish",
    videoUrl: "/videos/sv_wish.mp4",
    mindarTargetIndices: [3],
    referenceImages: [
      "/targets/target6.jpg",
    ],
    referenceThreshold: 0.78,
    badge: "Memory #4",
    description: "SV's special memory",
    previewColor: "from-sky-500 to-indigo-600",
  },
  {
    id: "yuvan_wish",
    name: "Yuvan's Wish",
    videoUrl: "/videos/yuvan_wish.mp4",
    mindarTargetIndices: [4],
    referenceImages: [
      "/targets/target7.jpg",
    ],
    referenceThreshold: 0.78,
    badge: "Memory #5",
    description: "Theater celebration memory",
    previewColor: "from-emerald-500 to-teal-600",
  },
  {
    id: "adhi_wish",
    name: "Adhi's Wish",
    videoUrl: "/videos/adhi_wish.mp4",
    mindarTargetIndices: [5],
    referenceImages: [
      "/targets/target8.jpg",
    ],
    referenceThreshold: 0.78,
    badge: "Memory #6",
    description: "Van trip celebration memory",
    previewColor: "from-amber-500 to-orange-600",
  },
  {
    id: "thishi_wish",
    name: "Thishi's Wish",
    videoUrl: "/videos/thishi_wish.mp4",
    mindarTargetIndices: [6],
    referenceImages: [
      "/targets/target9.jpg",
    ],
    referenceThreshold: 0.78,
    badge: "Memory #7",
    description: "Thishi's birthday wish memory",
    previewColor: "from-violet-500 to-pink-600",
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
