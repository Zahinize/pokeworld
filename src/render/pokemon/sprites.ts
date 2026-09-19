/**
 * Loads each species' animated GIF, decodes it (gifuct-js) and bakes all frames into a single spritesheet
 * canvas → one texture per species, animated in the shader via per-instance frame index. Zero texture
 * uploads per frame.
 */
import * as THREE from 'three';
import { parseGIF, decompressFrames } from 'gifuct-js';
import { SPECIES } from '@/data/species';

export interface SpriteSheet {
  speciesId: string;
  texture: THREE.Texture;
  cols: number;
  rows: number;
  frames: number;
  /** Seconds per frame. */
  frameTime: number;
  /** width / height of a single frame. */
  aspect: number;
  /** Fraction of the frame that is non-transparent (for hit feel). */
  fill: number;
  fallback: boolean;
}

export type SpriteVariant = 'front' | 'back' | 'shiny' | 'shinyback';

const cache = new Map<string, Promise<SpriteSheet>>();
/**
 * Memory budget. Each sheet costs cols*cellW * rows*cellH * 4 bytes TWICE — once for the canvas
 * the browser keeps and once for the GPU texture — so these two numbers dominate the game's
 * footprint. 30 frames still reads as smooth animation, and a 104px cell is larger than these
 * sprites are ever drawn on screen.
 */
const MAX_FRAMES = 30;
const MAX_CELL = 104;

export function sheetKey(speciesId: string, variant: SpriteVariant = 'front') {
  return variant === 'front' ? speciesId : `${speciesId}:${variant}`;
}

function makeFallback(speciesId: string): SpriteSheet {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const g = c.getContext('2d')!;
  const hue = (speciesId.split('').reduce((n, ch) => n + ch.charCodeAt(0), 0) * 37) % 360;
  g.fillStyle = `hsl(${hue} 70% 60%)`;
  g.beginPath(); g.ellipse(64, 64, 50, 32, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = `hsl(${hue} 70% 40%)`;
  g.beginPath(); g.moveTo(14, 64); g.lineTo(-4, 40); g.lineTo(-4, 88); g.fill();
  g.fillStyle = '#fff'; g.beginPath(); g.arc(92, 56, 7, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#111'; g.beginPath(); g.arc(94, 56, 3.5, 0, Math.PI * 2); g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  return { speciesId, texture: tex, cols: 1, rows: 1, frames: 1, frameTime: 1, aspect: 1, fill: 0.5, fallback: true };
}

const VARIANT_PATH: Record<SpriteVariant, string> = {
  front: '/sprites/pokemon/', back: '/sprites/pokemon/back/', shiny: '/sprites/pokemon/shiny/', shinyback: '/sprites/pokemon/back/shiny/',
};

async function decode(speciesId: string, variant: SpriteVariant = 'front'): Promise<SpriteSheet> {
  const front = SPECIES[speciesId].sprite;
  const url = front.replace('/sprites/pokemon/', VARIANT_PATH[variant]);
  const res = await fetch(url, { cache: 'force-cache' });
  if (!res.ok) throw new Error(`sprite ${speciesId} HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const gif = parseGIF(buf);
  const all = decompressFrames(gif, true);
  if (!all.length) throw new Error('no frames');
  const W = gif.lsd.width, H = gif.lsd.height;
  // Sample evenly if the GIF has too many frames
  let frames = all;
  if (all.length > MAX_FRAMES) {
    frames = [];
    for (let i = 0; i < MAX_FRAMES; i++) frames.push(all[Math.floor((i / MAX_FRAMES) * all.length)]);
  }
  const cols = Math.ceil(Math.sqrt(frames.length));
  const rows = Math.ceil(frames.length / cols);
  // Bake at most MAX_CELL per cell — Showdown art runs up to 200px, far more than we ever draw.
  const cellScale = Math.min(1, MAX_CELL / Math.max(W, H));
  const CW = Math.max(1, Math.round(W * cellScale)), CH = Math.max(1, Math.round(H * cellScale));
  const sheet = document.createElement('canvas');
  sheet.width = cols * CW; sheet.height = rows * CH;
  const sg = sheet.getContext('2d')!;
  sg.imageSmoothingEnabled = true; sg.imageSmoothingQuality = 'high';
  const work = document.createElement('canvas'); work.width = W; work.height = H;
  const wg = work.getContext('2d')!;
  const patch = document.createElement('canvas');
  const pg = patch.getContext('2d')!;
  let prevDisposal = 0, prevDims: any = null;
  let totalDelay = 0, opaque = 0;
  // We must composite sequentially through ALL frames to respect disposal, but only bake sampled ones.
  const sampledSet = new Set(frames);
  let baked = 0;
  for (let i = 0; i < all.length; i++) {
    const f = all[i];
    if (prevDisposal === 2 && prevDims) wg.clearRect(prevDims.left, prevDims.top, prevDims.width, prevDims.height);
    const d = f.dims;
    if (patch.width !== d.width || patch.height !== d.height) { patch.width = d.width; patch.height = d.height; }
    const img = new ImageData(new Uint8ClampedArray(f.patch) as unknown as Uint8ClampedArray<ArrayBuffer>, d.width, d.height);
    pg.putImageData(img, 0, 0);
    wg.drawImage(patch, d.left, d.top);
    totalDelay += f.delay || 80;   // full clip duration, so sampling never changes playback speed
    if (sampledSet.has(f)) {
      const cx = (baked % cols) * CW, cy = Math.floor(baked / cols) * CH;
      sg.drawImage(work, 0, 0, W, H, cx, cy, CW, CH);
      baked++;
      if (baked === 1) {
        const px = wg.getImageData(0, 0, W, H).data;
        let n = 0; for (let k = 3; k < px.length; k += 4) if (px[k] > 40) n++;
        opaque = n / (W * H);
      }
    }
    prevDisposal = f.disposalType; prevDims = d;
  }
  const tex = new THREE.CanvasTexture(sheet);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return { speciesId, texture: tex, cols, rows, frames: frames.length, frameTime: Math.max(0.03, (totalDelay / frames.length) / 1000), aspect: W / H, fill: opaque, fallback: false };
}

export function loadSpriteSheet(speciesId: string, variant: SpriteVariant = 'front'): Promise<SpriteSheet> {
  const key = sheetKey(speciesId, variant);
  let p = cache.get(key);
  if (!p) {
    p = decode(speciesId, variant).catch((err) => {
      console.warn('[sprites] fallback for', key, err);
      // missing variant → fall back toward the plain front sheet
      return variant !== 'front' ? loadSpriteSheet(speciesId, variant === 'shinyback' ? 'shiny' : 'front') : makeFallback(speciesId);
    });
    cache.set(key, p);
  }
  return p;
}

export async function preloadSprites(ids: string[], onProgress?: (done: number, total: number) => void): Promise<Map<string, SpriteSheet>> {
  let done = 0;
  const out = new Map<string, SpriteSheet>();
  await Promise.all(ids.map(async (id) => { out.set(id, await loadSpriteSheet(id)); done++; onProgress?.(done, ids.length); }));
  return out;
}

/**
 * Release every cached sheet whose key is not in `keep`, freeing both the GPU texture and the
 * backing canvas. Called on each level transition — without it the cache grows to the entire
 * roster (front + back + shiny + shinyback) and never shrinks.
 */
export function disposeSheetsExcept(keep: Set<string>): number {
  let freed = 0;
  for (const [key, p] of [...cache]) {
    if (keep.has(key)) continue;
    cache.delete(key);
    p.then((sheet) => {
      sheet.texture.dispose();
      const img = sheet.texture.image as HTMLCanvasElement | undefined;
      if (img && 'width' in img) { img.width = 1; img.height = 1; } // drop the pixel buffer too
    }).catch(() => {});
    freed++;
  }
  return freed;
}
