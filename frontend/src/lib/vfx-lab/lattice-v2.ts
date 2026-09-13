import * as THREE from "three";
import type { Lattice } from "./schema-v2";

// ---------------------------------------------------------------------------
// The spherical hex lattice generator.
//
// The cells a `material.lattice` draws are the Voronoi regions of a point set
// on the unit sphere: uniform, pole-free, seam-free — a Goldberg sphere with no
// authored mesh and no UV seam to hide. A raw Fibonacci set tiles into rhombi,
// so the sites are relaxed with Lloyd's algorithm (a centroidal Voronoi
// tessellation against a much denser Fibonacci probe set) until they settle
// into near-regular hexagons.
//
// Relaxation is O(iterations * probes * cells), which is a tenth of a second at
// the top of the schema's range, so the result is cached by (cells, seed) and
// shared by every layer that asks for the same lattice. The fragment shader
// then looks the nearest TWO sites up per pixel and reads their distance
// difference as the cell wall (see glslLattice in shaders-v2.ts).
//
// The sites are sorted by descending y and the shader only scans a band of
// indices around the fragment's own latitude, which is what keeps a 600-cell
// lattice to ~100 texture fetches instead of 600.
// ---------------------------------------------------------------------------

/** Width of the site texture; the schema caps `lattice.cells` well under it. */
export const LATTICE_TEXTURE_WIDTH = 1024;
/** Lloyd iterations. Twelve is where the cell-area spread stops improving. */
const RELAX_ITERATIONS = 12;
/** Probe samples per site. Below ~10 the relaxation is visibly lumpy. */
const PROBES_PER_SITE = 12;
/** Index band the shader scans either side of a fragment's own latitude. */
export const LATTICE_SCAN = 52;

export interface LatticeSites {
  /** RGBA rows of (x, y, z, 1), one site per texel, sorted by descending y. */
  data: Float32Array;
  count: number;
  /** Hexagon circumradius on the unit sphere for this many sites. */
  cellRadius: number;
}

const cache = new Map<string, LatticeSites>();

/** The i-th point of an `n`-point Fibonacci sphere, rotated by `phase` turns. */
function fibonacci(i: number, n: number, phase: number): [number, number, number] {
  const y = 1 - (2 * i + 1) / n;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const a = 2 * Math.PI * (i * 0.61803398875 + phase);
  return [Math.cos(a) * r, y, Math.sin(a) * r];
}

/**
 * Relaxed sites for `cells` cells. Deterministic in (cells, seed) and cached,
 * so two layers sharing a lattice share one texture and one relaxation pass.
 */
export function latticeSites(cells: number, seed: number): LatticeSites {
  const key = `${cells}:${seed}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const phase = ((seed % 9973) / 9973) * 0.5;
  const sites: [number, number, number][] = [];
  for (let i = 0; i < cells; i++) sites.push(fibonacci(i, cells, phase));

  const probes = cells * PROBES_PER_SITE;
  for (let pass = 0; pass < RELAX_ITERATIONS; pass++) {
    const accumulator = new Float64Array(cells * 3);
    for (let k = 0; k < probes; k++) {
      const q = fibonacci(k, probes, phase);
      let best = 0;
      let bestDistance = 9;
      for (let i = 0; i < cells; i++) {
        const s = sites[i];
        const dx = s[0] - q[0];
        const dy = s[1] - q[1];
        const dz = s[2] - q[2];
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestDistance) {
          bestDistance = d;
          best = i;
        }
      }
      accumulator[best * 3] += q[0];
      accumulator[best * 3 + 1] += q[1];
      accumulator[best * 3 + 2] += q[2];
    }
    for (let i = 0; i < cells; i++) {
      const length = Math.hypot(
        accumulator[i * 3],
        accumulator[i * 3 + 1],
        accumulator[i * 3 + 2],
      );
      // A site that captured no probe keeps its place rather than collapsing.
      if (length > 1e-6)
        sites[i] = [
          accumulator[i * 3] / length,
          accumulator[i * 3 + 1] / length,
          accumulator[i * 3 + 2] / length,
        ];
    }
  }

  // The shader indexes by latitude, so the table has to be ordered by it.
  sites.sort((a, b) => b[1] - a[1]);
  const data = new Float32Array(LATTICE_TEXTURE_WIDTH * 4);
  for (let i = 0; i < cells; i++) {
    data[i * 4] = sites[i][0];
    data[i * 4 + 1] = sites[i][1];
    data[i * 4 + 2] = sites[i][2];
    data[i * 4 + 3] = 1;
  }
  // A regular hexagon of circumradius a has area 2.598 a^2; each cell owns
  // 4*pi/N of the unit sphere, so a = sqrt(4.836 / N).
  const result: LatticeSites = {
    data,
    count: cells,
    cellRadius: Math.sqrt(4.836 / Math.max(cells, 1)),
  };
  cache.set(key, result);
  return result;
}

/** The site table as the data texture the fragment shader samples. */
export function latticeTexture(lattice: Lattice, seed: number) {
  const sites = latticeSites(lattice.cells, seed);
  const texture = new THREE.DataTexture(
    sites.data,
    LATTICE_TEXTURE_WIDTH,
    1,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  texture.minFilter = texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return { texture, sites };
}
