/** Uniform grid spatial hash for fast neighbour queries in 3D (cell size ≈ typical interaction radius). */
export class SpatialHash<T extends { x: number; y: number; z: number }> {
  private cells = new Map<number, T[]>();
  constructor(private cellSize = 12) {}

  private key(cx: number, cy: number, cz: number): number {
    return ((cx & 0x3ff) << 20) | ((cy & 0x3ff) << 10) | (cz & 0x3ff);
  }

  clear() { this.cells.clear(); }

  insert(item: T) {
    const cs = this.cellSize;
    const k = this.key(Math.floor(item.x / cs) + 512, Math.floor(item.y / cs) + 512, Math.floor(item.z / cs) + 512);
    let arr = this.cells.get(k);
    if (!arr) { arr = []; this.cells.set(k, arr); }
    arr.push(item);
  }

  /** Calls fn for each item within radius (approximate by cells, exact by distance check). */
  query(x: number, y: number, z: number, radius: number, fn: (item: T, d2: number) => void) {
    const cs = this.cellSize;
    const r2 = radius * radius;
    const x0 = Math.floor((x - radius) / cs), x1 = Math.floor((x + radius) / cs);
    const y0 = Math.floor((y - radius) / cs), y1 = Math.floor((y + radius) / cs);
    const z0 = Math.floor((z - radius) / cs), z1 = Math.floor((z + radius) / cs);
    for (let cx = x0; cx <= x1; cx++)
      for (let cy = y0; cy <= y1; cy++)
        for (let cz = z0; cz <= z1; cz++) {
          const arr = this.cells.get(this.key(cx + 512, cy + 512, cz + 512));
          if (!arr) continue;
          for (let i = 0; i < arr.length; i++) {
            const it = arr[i];
            const dx = it.x - x, dy = it.y - y, dz = it.z - z;
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 <= r2) fn(it, d2);
          }
        }
  }
}
