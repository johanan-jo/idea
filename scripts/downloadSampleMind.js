const fs = require('fs');
const path = require('path');
const https = require('https');

const outputPath = path.join(__dirname, '..', 'public', 'targets', 'targets.mind');
const targetUrl = 'https://raw.githubusercontent.com/hiukim/mind-ar-js/master/examples/image-tracking/assets/card-example/card.mind';

console.log(`Downloading valid MindAR compiled targets.mind from ${targetUrl}...`);

const file = fs.createWriteStream(outputPath);
https.get(targetUrl, (response) => {
  if (response.statusCode !== 200) {
    console.error(`Download failed with status ${response.statusCode}`);
    process.exit(1);
  }
  response.pipe(file);
  file.on('finish', () => {
    file.close(() => {
      console.log(`Successfully downloaded valid MindAR targets.mind binary file (${fs.statSync(outputPath).size} bytes)!`);
    });
  });
}).on('error', (err) => {
  fs.unlink(outputPath, () => {});
  console.error('Download error:', err.message);
});
