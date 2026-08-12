export interface ARTargetConfig {
  targetIndex: number;
  title: string;
  subtitle: string;
  description: string;
  videoUrl: string;
  targetImagePreview?: string;
  aspectRatio?: number;
  planeWidth?: number;
  planeHeight?: number;
  badge?: string;
  date?: string;
  location?: string;
  previewColor?: string;
}

export const AR_TARGETS: Record<number, ARTargetConfig> = {
  0: {
    targetIndex: 0,
    title: "Spider-Man: Am I Crazy??",
    subtitle: "Comic Photo AR Target",
    description: "Physical comic book photo recognized by MindAR and brought to life in 3D AR space.",
    videoUrl: "/videos/video1.mp4",
    targetImagePreview: "/targets/spiderman_target.jpg",
    aspectRatio: 1.77,
    planeWidth: 1,
    planeHeight: 0.56,
    badge: "Sample Photo Target #0",
    date: "Comic Edition",
    location: "Multiverse",
    previewColor: "from-red-600 to-rose-700",
  },
  1: {
    targetIndex: 1,
    title: "Our First Memory",
    subtitle: "Starlight romance",
    description: "Hand in hand watching the evening stars unfold.",
    videoUrl: "/videos/video2.mp4",
    aspectRatio: 1.0,
    planeWidth: 1,
    planeHeight: 1,
    badge: "Memory #1",
    date: "Summer Starlight",
    location: "The Little Cafe",
    previewColor: "from-pink-500 to-rose-600",
  },
  2: {
    targetIndex: 2,
    title: "Beach Sunset Walk",
    subtitle: "Golden hour magic",
    description: "Hand in hand, watching waves fade into night.",
    videoUrl: "/videos/video3.mp4",
    aspectRatio: 1.0,
    planeWidth: 1,
    planeHeight: 1,
    badge: "Memory #2",
    date: "Autumn Sunset",
    location: "Whispering Coast",
    previewColor: "from-amber-400 to-rose-500",
  },
  3: {
    targetIndex: 3,
    title: "Forever Birthday Celebration",
    subtitle: "A gift of memories",
    description: "To many more chapters written together with love.",
    videoUrl: "/videos/video4.mp4",
    aspectRatio: 1.0,
    planeWidth: 1,
    planeHeight: 1,
    badge: "Memory #3",
    date: "Today & Always",
    location: "Our Heart's Home",
    previewColor: "from-purple-500 to-amber-500",
  },
};

export const TARGET_MIND_FILE = "/targets/targets.mind";

export const getARTarget = (index: number): ARTargetConfig | undefined => {
  return AR_TARGETS[index];
};

export const getAllARTargets = (): ARTargetConfig[] => {
  return Object.values(AR_TARGETS);
};
