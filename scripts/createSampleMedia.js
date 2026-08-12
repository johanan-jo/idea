const fs = require('fs');
const path = require('path');

const targetsDir = path.join(__dirname, '..', 'public', 'targets');
const videosDir = path.join(__dirname, '..', 'public', 'videos');

if (!fs.existsSync(targetsDir)) {
  fs.mkdirSync(targetsDir, { recursive: true });
}
if (!fs.existsSync(videosDir)) {
  fs.mkdirSync(videosDir, { recursive: true });
}

// Create a placeholder targets.mind file with a notice inside
const mindFilePath = path.join(targetsDir, 'targets.mind');
if (!fs.existsSync(mindFilePath)) {
  // Write binary placeholder bytes / header for targets.mind
  const dummyBuffer = Buffer.from("MINDAR_TARGET_FILE_PLACEHOLDER_REPLACE_WITH_COMPILED_MIND_FILE");
  fs.writeFileSync(mindFilePath, dummyBuffer);
  console.log('Created placeholder public/targets/targets.mind');
}

// Sample MP4 video placeholders (valid small MP4 header or sample binary buffer so browser can load/fetch without 404)
// Standard 1-second silent MP4 base64 encoding
const sampleMp4Base64 = "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAAAsbWRhdAAAAAA=";

for (let i = 1; i <= 4; i++) {
  const videoPath = path.join(videosDir, `video${i}.mp4`);
  if (!fs.existsSync(videoPath)) {
    fs.writeFileSync(videoPath, Buffer.from(sampleMp4Base64, 'base64'));
    console.log(`Created placeholder public/videos/video${i}.mp4`);
  }
}

// Also generate target reference images for UI previews & mind compilation instructions
const readmeTargetsPath = path.join(targetsDir, 'README_TARGETS.txt');
fs.writeFileSync(readmeTargetsPath, `
=== MindAR Target File Instructions ===
1. Place your physical photographs in this folder (e.g. photo1.jpg, photo2.jpg, photo3.jpg, photo4.jpg).
2. Go to MindAR Online Image Compiler: https://hiukim.github.io/mind-ar-js-doc/tools/image-compiler
3. Drag and drop your photos into the compiler.
4. Click "Download" to download your compiled targets.mind file.
5. Replace public/targets/targets.mind with your downloaded file.
`);

console.log('Sample media setup complete.');
