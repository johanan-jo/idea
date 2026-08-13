# MindAR Target Compilation Guide

To recognize physical photographs in this AR web application, the physical photos MUST be compiled into a MindAR binary target file (`targets.mind`).

## Target Compilation Pipeline

```text
Source Photos (JPG / PNG)
         ↓
MindAR Image Target Compiler (In-App at /compiler OR Online Compiler)
         ↓
targets.mind binary file
         ↓
public/targets/targets.mind
```

## How to Compile Your Own Photos

### Method 1: Using the In-App Target Compiler (Recommended)
1. Run the app (`npm run dev`) and navigate to `/compiler` (or click "Compile New Photo Targets" on the Scanner home screen).
2. Upload your physical photographs in target order:
   - Target #0 = Photo 1
   - Target #1 = Photo 2
   - Target #2 = Photo 3
3. Click **Start Compilation**.
4. Click **Download targets.mind** and place the file in `public/targets/targets.mind`.

### Method 2: Using Official Online MindAR Compiler
1. Open the [MindAR Online Image Target Compiler](https://hiukim.github.io/mind-ar-js-doc/tools/image-compiler).
2. Drag and drop your target photos.
3. Click **Start** to process feature points.
4. Download `targets.mind` and place it in `public/targets/targets.mind`.

### Method 3: Using Node CLI Compiler Script
Run:
```bash
node scripts/compileMindTarget.js
```
