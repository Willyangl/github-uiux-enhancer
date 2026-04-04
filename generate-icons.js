/**
 * Run this script once with Node.js to generate PNG icons:
 *   node generate-icons.js
 *
 * Requires: npm install canvas
 * Or use any image editor to create icons/icon16.png, icon48.png, icon128.png
 * with the GitHub cat logo or any preferred icon.
 *
 * For quick testing, you can also use any 16x16, 48x48, 128x128 PNG files.
 */

const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

function generateIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // Background circle
  ctx.fillStyle = '#24292f';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();

  // "GH" text
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${Math.round(size * 0.38)}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('GH', size / 2, size / 2);

  return canvas.toBuffer('image/png');
}

[16, 48, 128].forEach(size => {
  const buf = generateIcon(size);
  const outPath = path.join(__dirname, 'icons', `icon${size}.png`);
  fs.writeFileSync(outPath, buf);
  console.log(`Generated ${outPath}`);
});
