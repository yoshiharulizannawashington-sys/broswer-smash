// Procedural tiling materials for the large worlds.
//
// Flat vertex colours made a 100-metre stone plaza and a 30-metre hangar floor read as
// untextured plastic. These generators draw small tileable maps (stone courses, riveted
// metal plates, timber planks, grass, marble veining) once per surface family, and every
// world material multiplies its palette colour by one of them. Geometry UVs are rescaled
// per part so one tile is a fixed number of metres regardless of how big the box is.
import * as THREE from 'three';

const SIZE = 256;
const textureCache = new Map();

function canvas(size = SIZE) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

function noise(ctx, size, amount, alpha) {
  const image = ctx.getImageData(0, 0, size, size);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const n = (Math.random() - .5) * amount;
    data[i] = Math.max(0, Math.min(255, data[i] + n));
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + n));
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + n));
    data[i + 3] = alpha == null ? data[i + 3] : alpha;
  }
  ctx.putImageData(image, 0, 0);
}

function drawStone(ctx, size) {
  ctx.fillStyle = '#d8d4cc';
  ctx.fillRect(0, 0, size, size);
  const rowHeight = size / 6;
  for (let row = 0; row < 6; row++) {
    const y = row * rowHeight;
    const offset = row % 2 ? rowHeight : 0;
    for (let col = -1; col < 4; col++) {
      const x = col * rowHeight * 1.35 + offset;
      const shade = 200 + Math.round(Math.random() * 34);
      ctx.fillStyle = `rgb(${shade},${shade - 4},${shade - 12})`;
      ctx.fillRect(x + 2, y + 2, rowHeight * 1.35 - 4, rowHeight - 4);
      // A little bevel so the courses catch light.
      ctx.fillStyle = 'rgba(255,255,255,.22)';
      ctx.fillRect(x + 2, y + 2, rowHeight * 1.35 - 4, 2);
      ctx.fillStyle = 'rgba(0,0,0,.14)';
      ctx.fillRect(x + 2, y + rowHeight - 4, rowHeight * 1.35 - 4, 2);
    }
  }
  noise(ctx, size, 16);
}

function drawPanel(ctx, size) {
  ctx.fillStyle = '#c9ccd2';
  ctx.fillRect(0, 0, size, size);
  const cell = size / 2;
  for (let gy = 0; gy < 2; gy++) {
    for (let gx = 0; gx < 2; gx++) {
      const x = gx * cell, y = gy * cell;
      const shade = 186 + Math.round(Math.random() * 24);
      ctx.fillStyle = `rgb(${shade},${shade + 3},${shade + 9})`;
      ctx.fillRect(x + 4, y + 4, cell - 8, cell - 8);
      ctx.strokeStyle = 'rgba(20,26,34,.55)';
      ctx.lineWidth = 3;
      ctx.strokeRect(x + 3, y + 3, cell - 6, cell - 6);
      // Rivets in the corners.
      for (const [rx, ry] of [[10, 10], [cell - 10, 10], [10, cell - 10], [cell - 10, cell - 10]]) {
        ctx.fillStyle = 'rgba(255,255,255,.5)';
        ctx.beginPath();
        ctx.arc(x + rx, y + ry, 2.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,.28)';
        ctx.beginPath();
        ctx.arc(x + rx + .8, y + ry + .8, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  noise(ctx, size, 12);
}

function drawWood(ctx, size) {
  ctx.fillStyle = '#cbb79b';
  ctx.fillRect(0, 0, size, size);
  const plank = size / 4;
  for (let i = 0; i < 4; i++) {
    const x = i * plank;
    const shade = 170 + Math.round(Math.random() * 30);
    ctx.fillStyle = `rgb(${shade},${Math.round(shade * .82)},${Math.round(shade * .6)})`;
    ctx.fillRect(x + 2, 0, plank - 4, size);
    ctx.strokeStyle = 'rgba(60,40,24,.35)';
    ctx.lineWidth = 1;
    for (let g = 0; g < 7; g++) {
      ctx.beginPath();
      const gx = x + 6 + Math.random() * (plank - 12);
      ctx.moveTo(gx, 0);
      for (let y = 0; y < size; y += 16) ctx.lineTo(gx + Math.sin(y * .05 + g) * 2.4, y);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.fillRect(x, 0, 2, size);
  }
  noise(ctx, size, 14);
}

function drawGrass(ctx, size) {
  ctx.fillStyle = '#cfe0bd';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 2600; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const light = Math.random() > .5;
    ctx.fillStyle = light ? 'rgba(255,255,240,.28)' : 'rgba(40,70,30,.26)';
    ctx.fillRect(x, y, 1 + Math.random() * 2, 1 + Math.random() * 3);
  }
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = 'rgba(90,120,70,.18)';
    ctx.fillRect(Math.random() * size, Math.random() * size, 2, 2);
  }
}

function drawMarble(ctx, size) {
  ctx.fillStyle = '#e3ded4';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 14; i++) {
    ctx.strokeStyle = `rgba(120,116,110,${.10 + Math.random() * .16})`;
    ctx.lineWidth = .6 + Math.random() * 1.4;
    ctx.beginPath();
    let x = Math.random() * size, y = Math.random() * size;
    ctx.moveTo(x, y);
    for (let s = 0; s < 6; s++) {
      x += (Math.random() - .5) * 70;
      y += (Math.random() - .5) * 70;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  noise(ctx, size, 8);
}

function drawShingle(ctx, size) {
  ctx.fillStyle = '#c8c6c2';
  ctx.fillRect(0, 0, size, size);
  const rowHeight = size / 8;
  for (let row = 0; row < 8; row++) {
    const y = row * rowHeight;
    const offset = row % 2 ? rowHeight * .6 : 0;
    for (let col = -1; col < 7; col++) {
      const x = col * rowHeight * 1.6 + offset;
      const shade = 150 + Math.round(Math.random() * 40);
      ctx.fillStyle = `rgb(${shade},${shade},${shade + 4})`;
      ctx.beginPath();
      ctx.ellipse(x + rowHeight * .8, y + rowHeight * .5, rowHeight * .78, rowHeight * .52, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(30,34,40,.35)';
      ctx.stroke();
    }
  }
  noise(ctx, size, 12);
}

const DRAW = { stone: drawStone, panel: drawPanel, wood: drawWood, grass: drawGrass, marble: drawMarble, shingle: drawShingle };

/**
 * Tileable surface texture for a family, sized so one tile covers `tileMetres`.
 * World geometry UVs are projected in metres, so the repeat is 1 / tile size. Materials
 * that ask for the same family and tile size share one GPU texture.
 */
export function surfaceTexture(kind, tileMetres = 4) {
  const cacheKey = `${kind}:${tileMetres}`;
  if (textureCache.has(cacheKey)) return textureCache.get(cacheKey);
  const draw = DRAW[kind];
  if (!draw) return null;
  const c = canvas();
  draw(c.getContext('2d'), SIZE);
  const texture = new THREE.CanvasTexture(c);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1 / tileMetres, 1 / tileMetres);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  textureCache.set(cacheKey, texture);
  return texture;
}

/** Families whose relief is worth a bump map. Marble and grass stay flat to save shader work. */
export const BUMPY = new Set(['stone', 'panel', 'wood', 'shingle']);

/**
 * Material key -> [surface family, metres per tile]. Emissive, transparent and tiny details
 * keep their flat colour, which keeps the texture count (and the draw-call count) low.
 */
export const SURFACES = {
  stone: ['stone', 4], stoneLight: ['stone', 4], stoneDark: ['stone', 4], rock: ['stone', 8],
  cliff: ['stone', 8], cobble: ['stone', 3], brick: ['stone', 3], building: ['stone', 5],
  buildingWarm: ['stone', 5], buildingBlue: ['stone', 5], marble: ['marble', 6],
  floorHall: ['stone', 4], floor: ['panel', 5], floorCommand: ['panel', 5],
  floorHangar: ['panel', 5], floorCorridor: ['panel', 5], metal: ['panel', 4],
  metalDark: ['panel', 4], steel: ['panel', 3], panel: ['panel', 3], dark: ['panel', 3],
  crate: ['wood', 2], wood: ['wood', 3], trunk: ['wood', 2], thatch: ['shingle', 3],
  roof: ['shingle', 4], roofCastle: ['shingle', 4], roofHall: ['shingle', 4],
  roofBlue: ['shingle', 4], roofGold: ['shingle', 3],
  grass: ['grass', 6], moss: ['grass', 4], leaf: ['grass', 3], sand: ['grass', 5], road: ['grass', 6],
  pitch: ['grass', 8]
};
