const fs = require('fs');
const path = require('path');
const http = require('http');

async function compileTarget() {
  console.log("Starting MindAR target binary compilation...");

  const targetImgPath = path.join(__dirname, '..', 'public', 'targets', 'spiderman_target.jpg');
  if (!fs.existsSync(targetImgPath)) {
    console.error("Target image not found at", targetImgPath);
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
    <img id="target-img" src="${imgDataUrl}" style="max-width: 800px; max-height: 800px;" />
    <script>
      async function runCompile() {
        return new Promise((resolve, reject) => {
          const img = document.getElementById('target-img');
          img.onload = async () => {
            try {
              console.log("Image loaded, initializing MindAR Compiler...");
              const compiler = new window.MINDAR.IMAGE.Compiler();
              await compiler.compileImageTargets([img], (progress) => {
                console.log("Compilation progress:", progress.toFixed(2) + "%");
              });
              const exportedData = await compiler.exportData();
              const array = Array.from(new Uint8Array(exportedData));
              resolve(array);
            } catch(e) {
              reject(e.toString());
            }
          };
          img.onerror = () => reject("Failed to load target image in browser DOM");
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
  } finally {
    await browser.close();
    server.close();
  }
}

compileTarget();
