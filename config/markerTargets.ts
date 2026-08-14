// ─────────────────────────────────────────────────────────────────────────────
// Marker Target Configuration
//
// Each marker ID maps to exactly one video.
// To add/change a target:
//   1. Update this file with the new video URL and name
//   2. Print the matching marker from /markers page
//   3. Attach the printed marker to the physical photograph
// ─────────────────────────────────────────────────────────────────────────────

export interface MarkerTarget {
  id: number;
  name: string;
  videoUrl: string;
  description: string;
  badge: string;
  previewColor: string;
}

export const MARKER_TARGETS: Record<number, MarkerTarget> = {
  0: {
    id: 0,
    name: "Spider-Man",
    videoUrl: "/videos/video1.mp4",
    description: "Spider-Man AR memory — physical comic photo",
    badge: "Marker #0",
    previewColor: "from-red-600 to-rose-700",
  },
  1: {
    id: 1,
    name: "Sai Baba",
    videoUrl: "/videos/video2.mp4",
    description: "Sai Baba blessing — notebook cover photo",
    badge: "Marker #1",
    previewColor: "from-amber-400 to-orange-500",
  },
  2: {
    id: 2,
    name: "Music",
    videoUrl: "/videos/video3.mp4",
    description: "Music memory video",
    badge: "Marker #2",
    previewColor: "from-blue-500 to-purple-600",
  },
  3: {
    id: 3,
    name: "Birthday",
    videoUrl: "/videos/video4.mp4",
    description: "Birthday celebration memory",
    badge: "Marker #3",
    previewColor: "from-pink-500 to-rose-600",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Marker bit patterns (4×4 inner grid — 0=white, 1=black)
//
// The physical marker is a 6×6 grid:
//   • Outer 1-cell ring: all BLACK (finder border)
//   • Inner 4×4 cells:  data bits below
//
// Patterns are chosen so that:
//   • Any two patterns differ by ≥ 6 bits (Hamming distance)
//   • No rotation of one pattern equals another
//   • Up to 2 bit-read errors are tolerated without misidentification
// ─────────────────────────────────────────────────────────────────────────────
export const MARKER_PATTERNS: Record<number, number[]> = {
  //              row1        row2        row3        row4
  0: [ 0,1,0,0,  0,0,1,0,  1,0,0,1,  0,1,0,0 ],
  1: [ 1,0,0,1,  0,1,1,0,  0,1,1,0,  1,0,0,1 ],
  2: [ 1,1,0,0,  0,0,1,1,  1,1,0,0,  0,0,1,1 ],
  3: [ 0,0,1,1,  1,1,0,0,  0,0,1,1,  1,1,0,0 ],
};

// Maximum number of bit errors allowed for a valid marker read
export const MAX_BIT_ERRORS = 2;

export const getMarkerTarget = (id: number): MarkerTarget | undefined =>
  MARKER_TARGETS[id];

export const getAllMarkerTargets = (): MarkerTarget[] =>
  Object.values(MARKER_TARGETS);
