# Memories Alive • Romantic WebAR Image Recognition Experience

A polished, romantic web-based Augmented Reality (AR) image recognition application built with **Next.js**, **React**, **TypeScript**, **Tailwind CSS**, and **MindAR (Image Tracking)** with **A-Frame**.

When users point their smartphone camera at physical photographs, MindAR recognizes the image target and automatically plays the corresponding memory video anchored directly over the photo in 3D perspective.

---

## 🌟 Key Features

* **Instant WebAR Recognition**: Recognizes standard physical photographs using WebAR image tracking.
* **No QR Codes or Markers**: Pure image target recognition without ugly barcodes, QR codes, or manual video selection buttons.
* **3D Perspective Anchoring**: Videos track the movement, angle, and perspective of physical photos as the camera moves.
* **Mobile-First Luxury UI**: Romantic dark aesthetic with glassmorphism, floating glow effects, and smooth state transitions.
* **Smart Audio Unmute Control**: Plays video muted initially (satisfying mobile browser autoplay policies) with an elegant **"🔊 Tap for sound"** button.
* **Desktop Simulation / Preview Mode**: Built-in simulation toggle allows full testing of target recognition without needing physical printouts immediately.
* **Simple Configurable Mapping**: Modular `config/arTargets.ts` file for effortlessly adding new photo/video pairs.

---

## 📁 File Structure

```text
├── app/
│   ├── layout.tsx             # Root layout & Google Fonts configuration
│   ├── globals.css            # Tailwind directives, animations & glassmorphism
│   ├── page.tsx               # Romantic Landing Page with passcode gateway
│   ├── scanner/
│   │   └── page.tsx           # Dedicated AR Scanner experience
│   ├── birthday/
│   │   └── page.tsx           # Birthday letter & Memory Timeline gallery
│   └── surprise/
│       └── page.tsx           # Final birthday surprise & confetti celebration
├── components/
│   ├── ARScanner.tsx          # MindAR + A-Frame 3D scene & event listeners
│   ├── ScannerUI.tsx          # Fullscreen overlay UI states (Idle, Scanning, Found, Denied)
│   ├── BackgroundParticles.tsx# Ambient floating particle background
│   └── PasswordModal.tsx      # Romantic passcode entry gateway
├── config/
│   └── arTargets.ts           # Central target mapping configuration
├── public/
│   ├── targets/
│   │   └── targets.mind       # Compiled MindAR image targets file
│   └── videos/
│       ├── video1.mp4         # Target #0 video overlay
│       ├── video2.mp4         # Target #1 video overlay
│       ├── video3.mp4         # Target #2 video overlay
│       └── video4.mp4         # Target #3 video overlay
└── README.md
```

---

## 🚀 Installation & Local Development

### 1. Install Dependencies

```bash
npm install
```

### 2. Run Local Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your web browser.

---

## 📱 Mobile Camera & HTTPS Requirements

Mobile operating systems (iOS Safari and Android Chrome) **strictly enforce HTTPS** for WebRTC camera access. When testing on a physical smartphone on your local network:

1. **Option A (Recommended: Ngrok)**:
   ```bash
   npx ngrok http 3000
   ```
   Open the generated `https://xxxx.ngrok-free.app` link on your phone camera.

2. **Option B (Vercel Deployment)**:
   Deploy directly to Vercel (which provides HTTPS automatically out of the box).

---

## 🎯 How to Generate the `.mind` Target File

MindAR uses a single compiled `.mind` binary file that contains feature tracking maps for all your physical photographs.

### Step 1: Prepare Your Photos
Prepare 1 to 10 clear, high-contrast physical photographs in JPG or PNG format. Avoid images that are purely blank or have repetitive patterns.

### Step 2: Compile online
1. Open the official [MindAR Online Image Compiler](https://hiukim.github.io/mind-ar-js-doc/tools/image-compiler).
2. Drag and drop your photos into the browser tool in order:
   * First photo = Target index `0`
   * Second photo = Target index `1`
   * Third photo = Target index `2`
   * Fourth photo = Target index `3`
3. Click **Start** to process the feature points.
4. Click **Download** to save the generated `targets.mind` file.

### Step 3: Place in Project
Move your downloaded `targets.mind` file into:
```text
public/targets/targets.mind
```

---

## 🎬 How to Add New Photo / Video Pairs

To add a new photo/video pair to your project:

1. Add your photo to the MindAR compiler (noted above) so it compiles into `targets.mind`.
2. Add your new video file (e.g. `video5.mp4`) into `public/videos/`.
3. Add a new entry to `config/arTargets.ts`:

```typescript
export const AR_TARGETS: Record<number, ARTargetConfig> = {
  // Existing targets 0..3
  4: {
    targetIndex: 4,
    title: "Our Summer Trip",
    subtitle: "By the lake",
    description: "Sunsets and laughter by the water.",
    videoUrl: "/videos/video5.mp4",
    aspectRatio: 1.0,
    planeWidth: 1,
    planeHeight: 1,
    badge: "Memory #5",
    date: "August",
    location: "Emerald Lake",
  },
};
```

---

## 🌐 Deploying to Vercel

1. Push your project to GitHub.
2. Import the repository in [Vercel](https://vercel.com).
3. Vercel will automatically detect Next.js and build with `npm run build`.
4. Once deployed, open the Vercel HTTPS production link on your mobile browser!

---

## 🛠️ Troubleshooting

* **Camera permissions prompt denied**:
  * On iOS: Settings → Safari → Camera → Set to "Allow".
  * On Android: Chrome Settings → Site Settings → Camera → Allow.
* **Target not recognized quickly**:
  * Ensure good room lighting without heavy reflections on printed photo paper.
  * Hold camera parallel to the photograph at a distance of 15 to 30 cm.
* **Video has no sound initially**:
  * Mobile browser policies prohibit unmuted video autoplay. Tap the **"🔊 Tap for sound"** button at the top right of the scanner when a target is detected to unmute.
* **Testing without physical photos**:
  * Toggle **"Sim Mode"** at the top right of the scanner screen to test target switching on desktop.
