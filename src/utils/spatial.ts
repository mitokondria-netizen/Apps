import * as turf from '@turf/turf';
import { FeatureCollection } from 'geojson';

// Earth equatorial radius in meters
const R = 6378137;

// ─────────────────────────────────────────────────────────────────────────────
// CEA PROJECTION & AREA
// ─────────────────────────────────────────────────────────────────────────────

export function projectToCEA(lon: number, lat: number): [number, number] {
  const lambda = (lon * Math.PI) / 180;
  const phi    = (lat * Math.PI) / 180;
  return [R * lambda, R * Math.sin(phi)];
}

function calculateRingAreaCEA(ring: number[][]): number {
  if (ring.length < 3) return 0;
  const projected = ring.map(([lon, lat]) => projectToCEA(lon, lat));
  let area = 0;
  const n = projected.length;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = projected[i];
    const [x2, y2] = projected[(i + 1) % n];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}

export function getGeometryAreaCEA(geom: any): number {
  if (!geom) return 0;
  if (geom.type === 'Polygon') {
    const coords = geom.coordinates;
    let total = calculateRingAreaCEA(coords[0]);
    for (let i = 1; i < coords.length; i++) total -= calculateRingAreaCEA(coords[i]);
    return total;
  }
  if (geom.type === 'MultiPolygon') {
    let total = 0;
    for (const poly of geom.coordinates) {
      let polyArea = calculateRingAreaCEA(poly[0]);
      for (let i = 1; i < poly.length; i++) polyArea -= calculateRingAreaCEA(poly[i]);
      total += polyArea;
    }
    return total;
  }
  return 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// TURF API COMPAT — deteksi versi sekali saja saat modul dimuat,
// bukan di setiap pemanggilan safeIntersect / safeDifference.
// FIX: sebelumnya try-catch dijalankan ulang ribuan kali per pasang fitur.
// ─────────────────────────────────────────────────────────────────────────────

type TwoFeatureFn = (a: any, b: any) => any;

function resolveTurfFn(name: 'intersect' | 'difference'): TwoFeatureFn {
  const fn = (turf as any)[name];
  if (typeof fn !== 'function') return () => null;

  // Probe sekali untuk tau apakah versi ini pakai FeatureCollection (v7+) atau dua argumen (v6)
  const probe = turf.polygon([[[0, 0], [1, 0], [1, 1], [0, 0]]]);
  try {
    fn(turf.featureCollection([probe, probe]));
    // v7+ style berhasil
    return (a: any, b: any) => {
      try { return fn(turf.featureCollection([a, b])) ?? null; }
      catch { return null; }
    };
  } catch {
    // v6 style: dua argumen
    return (a: any, b: any) => {
      try { return fn(a, b) ?? null; }
      catch { return null; }
    };
  }
}

const turfIntersect  = resolveTurfFn('intersect');
const turfDifference = resolveTurfFn('difference');

export function safeIntersect(feat1: any, feat2: any): any  { return turfIntersect(feat1, feat2);  }
export function safeDifference(feat1: any, feat2: any): any { return turfDifference(feat1, feat2); }

// ─────────────────────────────────────────────────────────────────────────────
// RBUSH SPATIAL INDEX — ganti SimpleRTree yang linear O(n)
// rbush sudah ter-bundle di dalam @turf/turf sehingga tidak perlu install baru.
// FIX: sebelumnya search = iterasi semua LBS setiap query → O(n) per RTRW.
// ─────────────────────────────────────────────────────────────────────────────

// rbush tidak punya named export di semua bundler, import via require-style fallback
// agar kompatibel dengan Vite / webpack tanpa perlu tambah dependency.
// Kalau rbush tidak tersedia, fallback ke linear scan (tetap benar, hanya lebih lambat).
function buildSpatialIndex(entries: { minX: number; minY: number; maxX: number; maxY: number; idx: number }[]) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const RBush = require('rbush');
    const tree = new (RBush.default ?? RBush)();
    tree.load(entries);
    return {
      search: (minX: number, minY: number, maxX: number, maxY: number) =>
        tree.search({ minX, minY, maxX, maxY }) as typeof entries,
    };
  } catch {
    // Fallback linear scan (perilaku lama)
    return {
      search: (minX: number, minY: number, maxX: number, maxY: number) =>
        entries.filter(
          (e) => e.maxX >= minX && e.minX <= maxX && e.maxY >= minY && e.minY <= maxY
        ),
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GEOMETRY SIMPLIFICATION HELPER
// ─────────────────────────────────────────────────────────────────────────────

function simplifyFeature(feature: any): any {
  try {
    return turf.simplify(feature, { tolerance: 0.00005, highQuality: false });
  } catch {
    return feature;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FLATTEN MultiPolygon → Polygon[]
// ─────────────────────────────────────────────────────────────────────────────

function flattenPolygons(collection: FeatureCollection): any[] {
  const out: any[] = [];
  for (const f of collection.features) {
    if (!f.geometry) continue;
    if (f.geometry.type === 'Polygon') {
      // FIX: structuredClone jauh lebih cepat dari JSON.parse(JSON.stringify())
      out.push(structuredClone(f));
    } else if (f.geometry.type === 'MultiPolygon') {
      for (const polyCoords of f.geometry.coordinates) {
        out.push(turf.polygon(polyCoords, structuredClone(f.properties)));
      }
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN OVERLAY — async, chunked, rbush-accelerated
// ─────────────────────────────────────────────────────────────────────────────

export async function runSpatialOverlay(
  rtrwCollection: FeatureCollection,
  rtrwField: string,
  lbsCollection: FeatureCollection,
  lbsSawahField: string,
  rtrwKp2bField: string,
  onProgress?: (progress: number) => void
): Promise<any[]> {

  // ── 1. Flatten ─────────────────────────────────────────────────────────────
  const rtrwFlat = flattenPolygons(rtrwCollection);
  const lbsFlat  = flattenPolygons(lbsCollection);
  if (rtrwFlat.length === 0 || lbsFlat.length === 0) return [];

  // ── 2. Simplify + bbox ─────────────────────────────────────────────────────
  const rtrwReady = rtrwFlat.map((f) => {
    const simplified = simplifyFeature(f);
    return { feature: simplified, bbox: turf.bbox(simplified) };
  });

  const lbsReady = lbsFlat.map((f) => {
    const simplified = simplifyFeature(f);
    return { feature: simplified, bbox: turf.bbox(simplified) };
  });

  // ── 3. Build spatial index atas LBS ────────────────────────────────────────
  const spatialIndex = buildSpatialIndex(
    lbsReady.map((lb, idx) => ({
      minX: lb.bbox[0], minY: lb.bbox[1],
      maxX: lb.bbox[2], maxY: lb.bbox[3],
      idx,
    }))
  );

  // ── 4. Chunked async processing ────────────────────────────────────────────
  // FIX: chunk size 8 → 25 mengurangi overhead setTimeout ~3×.
  // Progress stuck di 24% sebelumnya karena fitur-fitur awal RTRW punya
  // lebih banyak kandidat LBS (area besar), jadi tiap chunk jauh lebih berat
  // dari chunk berikutnya → progress tampak berhenti lama di awal.
  const CHUNK_SIZE = 25;
  const results: any[] = [];

  for (let chunkStart = 0; chunkStart < rtrwReady.length; chunkStart += CHUNK_SIZE) {
    const chunkEnd = Math.min(chunkStart + CHUNK_SIZE, rtrwReady.length);

    for (let i = chunkStart; i < chunkEnd; i++) {
      const rw          = rtrwReady[i];
      const rtrwVal     = String(rw.feature.properties?.[rtrwField]     || 'Lainnya').trim();
      const rtrwKp2bVal = String(rw.feature.properties?.[rtrwKp2bField] || 'Tidak Ada').trim();

      const candidates = spatialIndex.search(rw.bbox[0], rw.bbox[1], rw.bbox[2], rw.bbox[3]);

      // `remaining` dilacak agar sisa RTRW di luar semua LBS bisa disimpan
      let remaining: any = rw.feature;

      for (const cand of candidates) {
        const lb          = lbsReady[cand.idx];
        const lbsSawahVal = String(lb.feature.properties?.[lbsSawahField] || 'Bukan Sawah').trim();

        const intersection = safeIntersect(rw.feature, lb.feature);
        if (!intersection?.geometry) continue;

        const areaSqM = getGeometryAreaCEA(intersection.geometry);
        if (areaSqM <= 0.05) continue; // buang sliver

        results.push({
          sawahType: lbsSawahVal,
          kp2bType:  rtrwKp2bVal,
          polaRuang: rtrwVal,
          areaM2:    areaSqM,
          geometry:  intersection.geometry,
        });

        // Kurangi area LBS yang sudah terintersect dari remaining RTRW
        if (remaining) {
          const diff = safeDifference(remaining, lb.feature);
          if (diff?.geometry) {
            remaining = diff;
            if (getGeometryAreaCEA(remaining.geometry) < 0.1) {
              remaining = null; // RTRW ini sudah habis tercakup LBS
            }
          } else {
            // diff null berarti LBS menutupi seluruh sisa remaining → tidak ada sisa
            remaining = null;
          }
        }
      }

      // Sisa RTRW yang tidak tercakup LBS mana pun → Bukan Sawah
      if (remaining?.geometry) {
        const areaSqM = getGeometryAreaCEA(remaining.geometry);
        if (areaSqM > 0.05) {
          results.push({
            sawahType: 'Bukan Sawah',
            kp2bType:  rtrwKp2bVal,
            polaRuang: rtrwVal,
            areaM2:    areaSqM,
            geometry:  remaining.geometry,
          });
        }
      }
    }

    if (onProgress) {
      onProgress(Math.min(99, Math.round((chunkEnd / rtrwReady.length) * 100)));
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  if (onProgress) onProgress(100);
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// MOCK DATA GENERATOR  (tidak diubah)
// ─────────────────────────────────────────────────────────────────────────────

export function generateMockDatasets(): { rtrw: FeatureCollection; lbs: FeatureCollection } {
  const centerLon = 119.65;
  const centerLat = -4.95;
  const mPerLonDeg = R * (Math.PI / 180);

  function createBox(
    targetAreaHa: number,
    offsetLonDeg: number,
    offsetLatDeg: number,
    properties: Record<string, any>
  ): any {
    const areaM2 = targetAreaHa * 10000;
    const sideM  = Math.sqrt(areaM2);
    const dLon   = sideM / mPerLonDeg;
    const dLat   = sideM / (R * Math.cos(((centerLat + offsetLatDeg) * Math.PI) / 180));
    const minLon = centerLon + offsetLonDeg - dLon / 2;
    const maxLon = centerLon + offsetLonDeg + dLon / 2;
    const minLat = centerLat + offsetLatDeg - dLat / 2;
    const maxLat = centerLat + offsetLatDeg + dLat / 2;
    return turf.polygon(
      [[[minLon, minLat], [maxLon, minLat], [maxLon, maxLat], [minLon, maxLat], [minLon, minLat]]],
      properties
    );
  }

  interface Allocation {
    sawahType: string; kp2bType: string; polaRuang: string;
    areaHa: number; lonOffset: number; latOffset: number;
  }

  const allocations: Allocation[] = [
    { sawahType: 'Sawah',       kp2bType: 'KP2B (K02A)',          polaRuang: 'Kawasan Tanaman Pangan',        areaHa: 1137.33, lonOffset: -0.05, latOffset: -0.04 },
    { sawahType: 'Sawah',       kp2bType: 'KP2B (K02A)',          polaRuang: 'Badan Air',                     areaHa:    3.71, lonOffset: -0.02, latOffset:  0.04 },
    { sawahType: 'Sawah',       kp2bType: 'KP2B (K02A)',          polaRuang: 'Kawasan Ekosistem Mangrove',    areaHa:    0.01, lonOffset: -0.08, latOffset:  0.08 },
    { sawahType: 'Sawah',       kp2bType: 'KP2B (K02A)',          polaRuang: 'Kawasan Hortikultura',          areaHa:   12.03, lonOffset:  0.02, latOffset: -0.06 },
    { sawahType: 'Sawah',       kp2bType: 'KP2B (K02A)',          polaRuang: 'Kawasan Hutan Lindung',         areaHa:  972.4,  lonOffset:  0.06, latOffset:  0.05 },
    { sawahType: 'Sawah',       kp2bType: 'Non KP2B (Tidak Ada)', polaRuang: 'Kawasan Perkebunan',            areaHa:    8.38, lonOffset: -0.04, latOffset: -0.01 },
    { sawahType: 'Sawah',       kp2bType: 'Non KP2B (Tidak Ada)', polaRuang: 'Kawasan Perlindungan Setempat', areaHa:    0.4,  lonOffset:  0.05, latOffset: -0.01 },
    { sawahType: 'Sawah',       kp2bType: 'Non KP2B (Tidak Ada)', polaRuang: 'Kawasan Permukiman Perdesaan',  areaHa:    9.89, lonOffset: -0.01, latOffset: -0.05 },
    { sawahType: 'Sawah',       kp2bType: 'Non KP2B (Tidak Ada)', polaRuang: 'Kawasan Permukiman Perkotaan',  areaHa:   23.01, lonOffset:  0.01, latOffset:  0.01 },
    { sawahType: 'Sawah',       kp2bType: 'Non KP2B (Tidak Ada)', polaRuang: 'Kawasan Tanaman Pangan',        areaHa:  295.59, lonOffset: -0.06, latOffset: -0.02 },
    { sawahType: 'Bukan Sawah', kp2bType: 'KP2B (K02A)',          polaRuang: 'Kawasan Tanaman Pangan',        areaHa: 1869.18, lonOffset:  0.08, latOffset: -0.04 },
  ];

  const rtrwFeatures: any[] = [];
  const lbsFeatures:  any[] = [];

  allocations.forEach((alloc, index) => {
    rtrwFeatures.push(createBox(alloc.areaHa, alloc.lonOffset, alloc.latOffset,
      { NAMOBJ: alloc.polaRuang, KP2B_2: alloc.kp2bType, OBJECTID: `RTRW_${index}`, WADMKK: 'Sabu Raijua' }));
    lbsFeatures.push(createBox(alloc.areaHa, alloc.lonOffset, alloc.latOffset,
      { QNAME23: alloc.sawahType, OBJECTID: `LBS_${index}` }));
  });

  return {
    rtrw: turf.featureCollection(rtrwFeatures) as FeatureCollection,
    lbs:  turf.featureCollection(lbsFeatures)  as FeatureCollection,
  };
}

export function generateForestMockDatasets(): { rtrw: FeatureCollection; hutan: FeatureCollection } {
  const centerLon = 119.65;
  const centerLat = -4.95;
  const mPerLonDeg = R * (Math.PI / 180);

  function createBox(
    targetAreaHa: number,
    offsetLonDeg: number,
    offsetLatDeg: number,
    properties: Record<string, any>
  ): any {
    const areaM2 = targetAreaHa * 10000;
    const sideM  = Math.sqrt(areaM2);
    const dLon   = sideM / mPerLonDeg;
    const dLat   = sideM / (R * Math.cos(((centerLat + offsetLatDeg) * Math.PI) / 180));
    const minLon = centerLon + offsetLonDeg - dLon / 2;
    const maxLon = centerLon + offsetLonDeg + dLon / 2;
    const minLat = centerLat + offsetLatDeg - dLat / 2;
    const maxLat = centerLat + offsetLatDeg + dLat / 2;
    return turf.polygon(
      [[[minLon, minLat], [maxLon, minLat], [maxLon, maxLat], [minLon, maxLat], [minLon, minLat]]],
      properties
    );
  }

  interface ForestAllocation {
    polaRuang: string;
    fungsiKws: string;
    hutanName: string;
    areaHa: number;
    lonOffset: number;
    latOffset: number;
  }

  const allocations: ForestAllocation[] = [
    // Sesuai cases
    { polaRuang: 'Kawasan Hutan Lindung',                        fungsiKws: '100100', hutanName: 'Hutan Lindung Bulusaraung', areaHa: 1250.0, lonOffset: -0.04, latOffset: 0.04 },
    { polaRuang: 'Cagar Alam',                                   fungsiKws: '100210', hutanName: 'CA Karaenta',               areaHa: 450.0,  lonOffset: 0.05,  latOffset: 0.05 },
    { polaRuang: 'Kawasan Hutan Produksi Tetap',                 fungsiKws: '100300', hutanName: 'HP Maros Timur',            areaHa: 850.0,  lonOffset: -0.06, latOffset: -0.06 },
    { polaRuang: 'Kawasan Hutan Produksi Terbatas',              fungsiKws: '100400', hutanName: 'HPT Cenrana',               areaHa: 620.0,  lonOffset: 0.06,  latOffset: -0.02 },
    
    // Tidak Sesuai cases (Budidaya non-kehutanan di hutan lindung/produksi)
    { polaRuang: 'Kawasan Permukiman Perkotaan',                 fungsiKws: '100100', hutanName: 'Hutan Lindung Bulusaraung', areaHa: 110.0,  lonOffset: -0.02, latOffset: 0.02 },
    { polaRuang: 'Kawasan Tanaman Pangan',                       fungsiKws: '100400', hutanName: 'HPT Cenrana',               areaHa: 340.0,  lonOffset: 0.03,  latOffset: -0.01 },
    { polaRuang: 'Kawasan Perkebunan',                           fungsiKws: '100300', hutanName: 'HP Maros Timur',            areaHa: 215.0,  lonOffset: -0.04, latOffset: -0.04 },
    
    // APL cases
    { polaRuang: 'Kawasan Tanaman Pangan',                       fungsiKws: '100700', hutanName: 'APL Maros',                 areaHa: 1550.0, lonOffset: 0.01,  latOffset: 0.01 },
    { polaRuang: 'Kawasan Permukiman Perdesaan',                 fungsiKws: '100700', hutanName: 'APL Bantimurung',           areaHa: 430.0,  lonOffset: -0.01, latOffset: -0.03 }
  ];

  const rtrwFeatures: any[] = [];
  const hutanFeatures: any[] = [];

  allocations.forEach((alloc, index) => {
    rtrwFeatures.push(createBox(alloc.areaHa, alloc.lonOffset, alloc.latOffset,
      { NAMOBJ: alloc.polaRuang, OBJECTID: `RTRW_${index}`, WADMKK: 'Kabupaten Maros' }));
    hutanFeatures.push(createBox(alloc.areaHa, alloc.lonOffset, alloc.latOffset,
      { FUNGSIKWS: alloc.fungsiKws, NAMOBJ: alloc.hutanName, OBJECTID: `HUTAN_${index}` }));
  });

  return {
    rtrw: turf.featureCollection(rtrwFeatures) as FeatureCollection,
    hutan: turf.featureCollection(hutanFeatures) as FeatureCollection,
  };
}
