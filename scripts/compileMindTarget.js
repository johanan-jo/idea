const fs = require('fs');
const path = require('path');
const http = require('http');

async function compileTarget() {
  console.log("Starting MindAR target binary compilation...");

  const targetImgPath = path.join(__dirname, '..', 'public', 'targets', 'spiderman_target.jpg');
  if (!fs.existsSync(targetImgPath)) {
    console.error("Target image not found at", targetImgPath);
    console.log("Tip: You can use the in-app Web Compiler at http://localhost:3000/compiler to compile any photo targets!");
    process.exit(1);
  }

  const imgBase64 = fs.readFileSync(targetImgPath).toString('base64');
  const imgDataUrl = `data:image/jpeg;base64,${imgBase64}`;

  // Create a temporary local HTTP server to serve the compiler page to Puppeteer
  const htmlContent = `
  <!DOCTYPE html>
  <html>
  <head>
    <script src="https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image-target.prod.js"></script>
  </head>
  <body>
    <canvas id="canvas" width="400" height="400"></canvas>
    <script>
      async function runCompile() {
        return new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = async () => {
            try {
              console.log("Image loaded, scaling canvas to 400px...");
              const canvas = document.getElementById('canvas');
              const ctx = canvas.getContext('2d');
              ctx.drawImage(img, 0, 0, 400, 400);

              const scaledImg = new Image();
              scaledImg.onload = async () => {
                console.log("Initializing MindAR Compiler...");
                const compiler = new window.MINDAR.IMAGE.Compiler();
                await compiler.compileImageTargets([scaledImg], (progress) => {
                  console.log("Compilation progress:", progress.toFixed(2) + "%");
                });
                const exportedData = await compiler.exportData();
                const array = Array.from(new Uint8Array(exportedData));
                resolve(array);
              };
              scaledImg.src = canvas.toDataURL("image/jpeg", 0.9);
            } catch(e) {
              reject(e.toString());
            }
          };
          img.onerror = () => reject("Failed to load target image in browser DOM");
          img.src = "${imgDataUrl}";
        });
      }
    </script>
  </body>
  </html>
  `;

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(htmlContent);
  });

  await new Promise((resolve) => server.listen(9876, resolve));
  console.log("Local compiler server listening on http://localhost:9876");

  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({
    headless: true,
    protocolTimeout: 300000,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(300000);
    page.on('console', msg => console.log('BROWSER LOG:', msg.text()));

    await page.goto('http://localhost:9876');
    console.log("Compiler page loaded. Running feature detection compile...");

    const binaryArray = await page.evaluate(async () => {
      return await window.runCompile();
    });

    const buffer = Buffer.from(binaryArray);
    const outputPath = path.join(__dirname, '..', 'public', 'targets', 'targets.mind');
    fs.writeFileSync(outputPath, buffer);

    console.log(`Successfully compiled targets.mind (${buffer.length} bytes)! Saved to ${outputPath}`);
  } catch (err) {
    console.error("Compilation error:", err);
    console.log("Recommended Alternative: Open http://localhost:3000/compiler in your browser to generate targets.mind with 1 click!");
  } finally {
    await browser.close();
    server.close();
  }
}

compileTarget();

