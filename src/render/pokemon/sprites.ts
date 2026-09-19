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
 * Every GIF frame is baked at native resolution: Showdown sprites animate at 33 fps and are
 * pixel art, so dropping frames makes them stutter and downscaling makes them soft. The only
 * reason to ever sample frames is a sheet that would exceed a mobile GPU's texture limit.
 */
const MAX_SHEET_EDGE = 4096;

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

interface Baked { canvas: HTMLCanvasElement; cols: number; rows: number; frames: number; frameTime: number; aspect: number; fill: number }

/** Composite every GIF frame (honouring disposal) into one native-resolution spritesheet. */
function bake(buf: ArrayBuffer): Baked {
  const gif = parseGIF(buf);
  const all = decompressFrames(gif, true);
  if (!all.length) throw new Error('no frames');
  const W = gif.lsd.width, H = gif.lsd.height;
  const fits = (k: number) => { const c = Math.ceil(Math.sqrt(k)); return c * W <= MAX_SHEET_EDGE && Math.ceil(k / c) * H <= MAX_SHEET_EDGE; };
  let n = all.length;
  while (n > 1 && !fits(n)) n--;
  const pick = n === all.length ? null : new Set(Array.from({ length: n }, (_, i) => Math.floor((i / n) * all.length)));
  const cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
  const sheet = document.createElement('canvas');
  sheet.width = cols * W; sheet.height = rows * H;
  const sg = sheet.getContext('2d')!;
  const work = document.createElement('canvas'); work.width = W; work.height = H;
  const wg = work.getContext('2d')!;
  const patch = document.createElement('canvas');
  const pg = patch.getContext('2d')!;
  let prevDisposal = 0, prevDims: { left: number; top: number; width: number; height: number } | null = null;
  let totalDelay = 0, opaque = 0, baked = 0;
  for (let i = 0; i < all.length; i++) {
    const f = all[i];
    if (prevDisposal === 2 && prevDims) wg.clearRect(prevDims.left, prevDims.top, prevDims.width, prevDims.height);
    const d = f.dims;
    if (patch.width !== d.width || patch.height !== d.height) { patch.width = d.width; patch.height = d.height; }
    pg.putImageData(new ImageData(new Uint8ClampedArray(f.patch) as unknown as Uint8ClampedArray<ArrayBuffer>, d.width, d.height), 0, 0);
    wg.drawImage(patch, d.left, d.top);
    totalDelay += f.delay || 80;
    if (!pick || pick.has(i)) {
      sg.drawImage(work, (baked % cols) * W, Math.floor(baked / cols) * H);
      if (baked === 0) {
        const px = wg.getImageData(0, 0, W, H).data;
        let k = 0; for (let j = 3; j < px.length; j += 4) if (px[j] > 40) k++;
        opaque = k / (W * H);
      }
      baked++;
    }
    prevDisposal = f.disposalType; prevDims = d;
  }
  // Whole-clip duration over the frames we show: identical to native playback when nothing is sampled.
  return { canvas: sheet, cols, rows, frames: n, frameTime: Math.max(0.03, totalDelay / n / 1000), aspect: W / H, fill: opaque };
}

/**
 * The compressed GIF behind each live sheet. A few KB each — kept so a sheet can be rebuilt if the
 * GPU context is lost, which lets us throw its decoded pixels away the moment they're uploaded.
 */
const sources = new Map<string, { buf: ArrayBuffer; texture: THREE.Texture; bytes: number }>();

/**
 * Uploads a texture to the GPU immediately (renderer.initTexture). Without it, sheets that aren't
 * drawn yet — bosses, reserve companions — keep their CPU pixels until they first appear.
 */
let uploader: ((t: THREE.Texture) => void) | null = null;
export function bindTextureUploader(fn: ((t: THREE.Texture) => void) | null) {
  uploader = fn;
  if (fn) for (const src of sources.values()) fn(src.texture);
}

/** Sprite memory right now: GPU-resident sheet bytes and any CPU pixels not yet released. */
export function spriteMemoryStats() {
  let gpu = 0, cpu = 0;
  for (const src of sources.values()) {
    gpu += src.bytes;
    const img = src.texture.image as HTMLCanvasElement;
    if (img && img.width > 1) cpu += img.width * img.height * 4;
  }
  return { sheets: sources.size, gpuMB: +(gpu / 1048576).toFixed(1), cpuMB: +(cpu / 1048576).toFixed(1) };
}

/**
 * After the first GPU upload the canvas is a redundant second copy of every pixel (the texture
 * lives on the GPU). Releasing it halves sprite memory with no visual cost.
 */
function releaseOnUpload(tex: THREE.Texture) {
  tex.onUpdate = () => {
    const img = tex.image as HTMLCanvasElement | undefined;
    if (img && img.width > 1) { img.width = 1; img.height = 1; }
  };
}

async function decode(speciesId: string, variant: SpriteVariant = 'front'): Promise<SpriteSheet> {
  const front = SPECIES[speciesId].sprite;
  const url = front.replace('/sprites/pokemon/', VARIANT_PATH[variant]);
  const res = await fetch(url, { cache: 'force-cache' });
  if (!res.ok) throw new Error(`sprite ${speciesId} HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const b = bake(buf);
  const tex = new THREE.CanvasTexture(b.canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  releaseOnUpload(tex);
  sources.set(sheetKey(speciesId, variant), { buf, texture: tex, bytes: b.canvas.width * b.canvas.height * 4 });
  uploader?.(tex);
  return { speciesId, texture: tex, cols: b.cols, rows: b.rows, frames: b.frames, frameTime: b.frameTime, aspect: b.aspect, fill: b.fill, fallback: false };
}

/** Rebuild every live sheet from its GIF after a WebGL context loss wiped the GPU copies. */
export function rebakeAllSheets() {
  for (const src of sources.values()) {
    try { src.texture.image = bake(src.buf).canvas; src.texture.needsUpdate = true; } catch { /* leave it blank */ }
  }
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
    sources.delete(key);
    p.then((sheet) => {
      sheet.texture.dispose();
      const img = sheet.texture.image as HTMLCanvasElement | undefined;
      if (img && 'width' in img) { img.width = 1; img.height = 1; } // drop the pixel buffer too
    }).catch(() => {});
    freed++;
  }
  return freed;
}
