// Minimal PNG statistics, so a material change can be reported as numbers instead of adjectives.
// Decodes 8-bit RGB/RGBA non-interlaced PNGs with node's zlib (no dependency) and reports mean
// luminance, luminance spread, and how much of the frame sits in the saturated gold range.
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

export function pngStats(path) {
  const buffer = readFileSync(path);
  let offset = 8;
  let width = 0, height = 0, bitDepth = 0, colourType = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colourType = data[9];
      if (data[12] !== 0) throw new Error('interlaced PNG not supported');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  if (bitDepth !== 8) throw new Error('only 8-bit PNG supported');
  const channels = colourType === 6 ? 4 : colourType === 2 ? 3 : colourType === 0 ? 1 : 0;
  if (!channels) throw new Error('unsupported colour type ' + colourType);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const rowStart = y * stride;
    for (let x = 0; x < stride; x++) {
      const value = raw[pos++];
      const left = x >= channels ? out[rowStart + x - channels] : 0;
      const up = y > 0 ? out[rowStart - stride + x] : 0;
      const upLeft = (y > 0 && x >= channels) ? out[rowStart - stride + x - channels] : 0;
      let result;
      if (filter === 0) result = value;
      else if (filter === 1) result = value + left;
      else if (filter === 2) result = value + up;
      else if (filter === 3) result = value + ((left + up) >> 1);
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft);
        result = value + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
      } else throw new Error('bad filter ' + filter);
      out[rowStart + x] = result & 0xff;
    }
  }
  let sum = 0, sumSq = 0, gold = 0, pixels = 0, dark = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * stride + x * channels;
      const r = out[i] / 255, g = out[i + 1] / 255, b = out[i + 2] / 255;
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      sum += luma; sumSq += luma * luma; pixels += 1;
      if (luma < 0.18) dark += 1;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      if (max > 0.45 && (max - min) / max > 0.25 && r >= g && g > b && (r - b) > 0.18) gold += 1;
    }
  }
  const mean = sum / pixels;
  // Frame-wide sigma is dominated by the floor and sky, so it cannot answer "does the palace read
  // with more depth". Local gradient energy over the architecture band can: it measures how much
  // shading change the surfaces themselves carry.
  const lumaAt = (x, y) => {
    const i = y * stride + x * channels;
    return 0.2126 * out[i] / 255 + 0.7152 * out[i + 1] / 255 + 0.0722 * out[i + 2] / 255;
  };
  const gradient = (yFrom, yTo) => {
    let total = 0, count = 0;
    for (let y = yFrom; y < yTo; y += 2) {
      for (let x = 0; x < width - 2; x += 2) {
        total += Math.abs(lumaAt(x + 2, y) - lumaAt(x, y)) + Math.abs(lumaAt(x, y + 2) - lumaAt(x, y));
        count += 1;
      }
    }
    return count ? +(total / count).toFixed(5) : 0;
  };
  return {
    path, width, height,
    meanLuma: +mean.toFixed(4),
    lumaStdDev: +Math.sqrt(Math.max(0, sumSq / pixels - mean * mean)).toFixed(4),
    goldFraction: +(gold / pixels).toFixed(4),
    darkFraction: +(dark / pixels).toFixed(4),
    gradientFull: gradient(0, height - 2),
    gradientPalaceBand: gradient(Math.round(height * 0.05), Math.round(height * 0.55))
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const path of process.argv.slice(2)) console.log(JSON.stringify(pngStats(path)));
}
