import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Upload,
  Play,
  CheckCircle2,
  AlertTriangle,
  Layers,
  Table,
  Settings,
  FileJson,
  Activity,
  FileSpreadsheet,
  Download,
  Info,
  RefreshCw,
  HelpCircle,
  TrendingUp,
  Camera,
  ShieldAlert,
  FileCheck,
  Trees,
  Globe,
} from 'lucide-react';
import proj4 from 'proj4';
import { generateMockDatasets, getGeometryAreaCEA } from './utils/spatial';
import InteractiveMap from './components/InteractiveMap';
import EvidenceTab from './components/EvidenceTab';
import RightsTab from './components/RightsTab';
import DownloadDocTab from './components/DownloadDocTab';
import ForestTab from './components/ForestTab';
import PolaRuangSubstansiTab from './components/PolaRuangSubstansiTab';
import StrukturRuangSubstansiTab from './components/StrukturRuangSubstansiTab';
import { BookOpen, ClipboardList, ChevronDown } from 'lucide-react';
import { SpatialFieldSelection, OverlayResultRow, RawDataset, MoratoriumConfig } from './types';

// Setup and register custom Cylindrical Equal Area projections globally
const KEY_PRJ_1 = 'PROJCS["World_Cylindrical_Equal_Area",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Cylindrical_Equal_Area"],PARAMETER["False_Easting",0.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",0.0],PARAMETER["Standard_Parallel_1",0.0],UNIT["Meter",1.0]]';
const DEF_CEA = "+proj=cea +lon_0=0 +lat_ts=0 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs";

proj4.defs(KEY_PRJ_1, DEF_CEA);
proj4.defs(KEY_PRJ_1.trim(), DEF_CEA);
proj4.defs("World_Cylindrical_Equal_Area", DEF_CEA);
proj4.defs("Cylindrical_Equal_Area", DEF_CEA);
proj4.defs("world_cylindrical_equal_area", DEF_CEA);
proj4.defs("cylindrical_equal_area", DEF_CEA);
proj4.defs("ESRI:54034", DEF_CEA);
proj4.defs("54034", DEF_CEA);

// Also map cylindrical_equal_area name mapping to cea inside proj4 projections store
const ceaProj = (proj4 as any).Proj?.projections?.get('cea');
if (ceaProj) {
  const customCea = {
    ...ceaProj,
    names: [...(ceaProj.names || []), 'cylindrical_equal_area', 'world_cylindrical_equal_area']
  };
  (proj4 as any).Proj?.projections?.add(customCea);
}


export default function App() {

  // Active Module State: 'lbs' (Lahan Baku Sawah) or 'forest' (Kawasan Hutan) or 'pola_ruang' or 'struktur_ruang'
  const [activeModule, setActiveModule] = useState<'lbs' | 'forest' | 'pola_ruang' | 'struktur_ruang'>('lbs');

  // Active Tab State (Dashboard, Evidence, Rights, Download)
  const [activeTab, setActiveTab] = useState<'dashboard' | 'evidence' | 'rights' | 'download'>('dashboard');

  // State for Land Rights (Hak Atas Tanah) & Perizinan KKPR statistics
  const [rightsStats, setRightsStats] = useState({
    overlapHguHa: 0,
    overlapHgbHa: 0,
    overlapHmHa: 0,
    overlapKkprHa: 0,
    excludeTotalHa: 0,
    netLbsHa: 0
  });

  // Datasets State
  const [rtrwRaw, setRtrwRaw] = useState<RawDataset | null>(null);
  const [lbsRaw, setLbsRaw] = useState<RawDataset | null>(null);

  // Field Mapping State
  const [fields, setFields] = useState<SpatialFieldSelection>({
    polaRuangField: '',
    lbsSawahField: '',
    rtrwKp2bField: '',
  });

  // Calculation Progress / Outputs
  const [isCalculating, setIsCalculating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [overlayResults, setOverlayResults] = useState<any[] | null>(null);
  const [tableData, setTableData] = useState<OverlayResultRow[]>([]);

  // Moratorium Configurations
  const [moratoriumThreshold, setMoratoriumThreshold] = useState<number>(87);
  const [accommodatedCategories, setAccommodatedCategories] = useState<string[]>(['Kawasan Tanaman Pangan']);

  // Error/Status messages
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'info' | 'error' | 'warn' | null }>({
    text: '',
    type: null,
  });



  const [sessionId] = useState(() => {
    let id = sessionStorage.getItem('spatial_session_id');
    if (!id) {
      id = 'sess_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
      sessionStorage.setItem('spatial_session_id', id);
    }
    return id;
  });

  const [sessionKey, setSessionKey] = useState('sess_key_initial');

  // Trigger resize to fix Leaflet gray tiles when switching tabs (since maps were hidden in DOM)
  useEffect(() => {
    const timer = setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 150);
    return () => clearTimeout(timer);
  }, [activeModule]);

  // Cleanup staged data on tab close/refresh
  useEffect(() => {
    const handleUnload = () => {
      const url = '/api/spatial/cleanup';
      const payload = JSON.stringify({ sessionId });
      if (navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }));
      } else {
        fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(() => {});
      }
    };
    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, [sessionId]);

  // Compute 20 representative samples from LBS dataset with balanced spatial distribution
  const lbsSamples = useMemo(() => {
    if (!lbsRaw || !lbsRaw.geojson || !lbsRaw.geojson.features) return [];
    
    // Filter features that are Polygons or MultiPolygons
    const polygonFeatures = lbsRaw.geojson.features.filter((f: any) => 
      f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
    );

    if (polygonFeatures.length === 0) return [];

    const totalFeatures = polygonFeatures.length;
    const countNeeded = Math.min(20, totalFeatures);
    
    // Spread the sampling across the array to avoid gathering contiguous blocks
    const step = Math.max(1, Math.floor(totalFeatures / countNeeded));
    const samples: any[] = [];
    
    for (let i = 0; i < countNeeded; i++) {
      const idx = Math.min(i * step, totalFeatures - 1);
      const feat = polygonFeatures[idx];
      
      // Calculate center coordinate (Lat/Lon)
      let latSum = 0;
      let lonSum = 0;
      let coordCount = 0;
      
      // Extract coordinates to find a center point
      if (feat.geometry.type === 'Polygon') {
        const ring = feat.geometry.coordinates[0];
        if (ring) {
          ring.forEach((c: any) => {
            lonSum += c[0];
            latSum += c[1];
            coordCount++;
          });
        }
      } else if (feat.geometry.type === 'MultiPolygon') {
        const poly = feat.geometry.coordinates[0];
        if (poly && poly[0]) {
          poly[0]?.forEach((c: any) => {
            lonSum += c[0];
            latSum += c[1];
            coordCount++;
          });
        }
      }
      
      const lat = coordCount > 0 ? latSum / coordCount : -5.01;
      const lon = coordCount > 0 ? lonSum / coordCount : 119.66;
      
      // Calculate area (either from properties or simple CEA estimate)
      let areaHa = 0;
      if (feat.properties && (feat.properties.LUASHA || feat.properties.luas || feat.properties.AREA_HA)) {
        areaHa = Number(feat.properties.LUASHA || feat.properties.luas || feat.properties.AREA_HA);
      } else {
        try {
          const areaM2 = getGeometryAreaCEA(feat.geometry);
          areaHa = areaM2 / 10000;
        } catch {
          areaHa = 1.25;
        }
      }

      // Read attributes
      const sawahType = String(feat.properties?.[fields.lbsSawahField] || 'Lahan Sawah').trim();

      samples.push({
        id: `plot-${idx}`,
        index: i + 1,
        feature: feat,
        lat,
        lon,
        areaHa,
        sawahType,
        originalIndex: idx
      });
    }

    return samples;
  }, [lbsRaw, fields.lbsSawahField]);

  // Extract unique fields once spatial data is uploaded
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>, type: 'rtrw' | 'lbs') => {
    const file = event.target.files?.[0];
    if (!file) return;

    setStatusMessage({ text: `Membaca file ${file.name}...`, type: 'info' });

    try {
      if (file.name.endsWith('.zip')) {
        // We will notify the user they can load the shapefile
        // Dynamic importing of shpjs
        const shp = (await import('shpjs')).default;
        const reader = new FileReader();
        reader.onload = async (e) => {
          try {
            const buffer = e.target?.result as ArrayBuffer;
            const geojson: any = await shp(buffer);
            let finalGeojson = geojson;
            if (Array.isArray(geojson)) {
              finalGeojson = geojson[0];
            }
            processIncomingDataset(finalGeojson, file.name, type, file);
          } catch (err) {
            console.error(err);
            setStatusMessage({
              text: 'Gagal mengekstrak Shapefile ZIP. Pastikan di dalamnya terdapat file .shp dan .dbf yang valid.',
              type: 'error',
            });
          }
        };
        reader.readAsArrayBuffer(file);
      } else if (file.name.endsWith('.geojson') || file.name.endsWith('.json')) {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const text = e.target?.result as string;
            const geojson = JSON.parse(text);
            processIncomingDataset(geojson, file.name, type, file);
          } catch (err) {
            console.error(err);
            setStatusMessage({
              text: 'Gagal mengurai GeoJSON. Pastikan file JSON berformat spasial GeoJSON standar.',
              type: 'error',
            });
          }
        };
        reader.readAsText(file);
      } else {
        setStatusMessage({
          text: 'Format file tidak didukung. Harap gunakan .geojson, .json, atau .zip (Shapefile).',
          type: 'error',
        });
      }
    } catch (err) {
      console.error(err);
      setStatusMessage({ text: 'Terjadi kegagalan membaca modul file upload.', type: 'error' });
    }
  };

  const processIncomingDataset = (geojson: any, filename: string, type: 'rtrw' | 'lbs', file?: File) => {
    if (!geojson || !geojson.features) {
      setStatusMessage({ text: 'Data spasial tidak memiliki FeatureCollection yang valid.', type: 'error' });
      return;
    }

    // Extract all unique property keys / fields from features
    const allKeys = new Set<string>();
    geojson.features.forEach((feature: any) => {
      if (feature.properties) {
        Object.keys(feature.properties).forEach((k) => allKeys.add(k));
      }
    });

    const fieldList = Array.from(allKeys);

    if (type === 'rtrw') {
      setRtrwRaw({ name: filename, geojson, fields: fieldList, file });
      // Pre-select popular field names if available (case-insensitive)
      const rtrwSel = fieldList.find((f) => {
        const lf = f.toLowerCase();
        return ['namobj', 'pola_ruang', 'pola ruang', 'fungsi', 'pola_ruang_id'].includes(lf);
      }) || fieldList[0] || '';
      const kp2bSel = fieldList.find((f) => {
        const lf = f.toLowerCase();
        return ['kp2b', 'kp2b_2', 'kp2b_status', 'kp2b_code', 'kp2b_status_2'].includes(lf);
      }) || fieldList[1] || fieldList[0] || '';
      setFields((prev) => ({ ...prev, polaRuangField: rtrwSel, rtrwKp2bField: kp2bSel }));
      setStatusMessage({ text: `Berhasil memuat file RTRW: ${filename}`, type: 'success' });
    } else {
      setLbsRaw({ name: filename, geojson, fields: fieldList, file });
      // Pre-select popular field names (case-insensitive)
      const sawahSel = fieldList.find((f) => {
        const lf = f.toLowerCase();
        return ['qname23', 'sawah', 'status', 'landuse', 'kategori', 'lkg_sawah'].includes(lf);
      }) || fieldList[0] || '';
      setFields((prev) => ({ ...prev, lbsSawahField: sawahSel }));
      setStatusMessage({ text: `Berhasil memuat file Lahan Baku Sawah (LBS): ${filename}`, type: 'success' });
    }
  };

  // Populate data with exact image.png specs
  const handleLoadSampleData = () => {
    setStatusMessage({ text: 'Memuat data simulasi Kabupaten Maros...', type: 'info' });
    const { rtrw, lbs } = generateMockDatasets();

    processIncomingDataset(rtrw, 'RTRW_Kab_Maros_CEA.geojson', 'rtrw');
    processIncomingDataset(lbs, 'LBS_Lahan_Baku_Sawah_CEA.geojson', 'lbs');

    // Overwrite fields mapping to perfectly fit image.png
    setFields({
      polaRuangField: 'NAMOBJ',
      lbsSawahField: 'QNAME23',
      rtrwKp2bField: 'KP2B_2',
    });

    setStatusMessage({ text: 'Data sampel Kabupaten Maros berhasil dimuat!', type: 'success' });
  };

  // ─── Helper: aggregate raw intersection results → OverlayResultRow[] ────────
  const aggregateResults = (intersectionResults: any[]): OverlayResultRow[] => {
    const groups: Record<string, { areaHa: number; count: number }> = {};
    let totalSawahAreaHa = 0;

    intersectionResults.forEach((item) => {
      const key = `${item.sawahType}|||${item.kp2bType}|||${item.polaRuang}`;
      const itemAreaHa = item.areaM2 / 10000;
      if (!groups[key]) groups[key] = { areaHa: 0, count: 0 };
      groups[key].areaHa += itemAreaHa;
      groups[key].count += 1;

      if (item.sawahType.toLowerCase().includes('sawah') && !item.sawahType.toLowerCase().includes('bukan')) {
        totalSawahAreaHa += itemAreaHa;
      }
    });

    const resultsFlat: OverlayResultRow[] = Object.keys(groups).map((key) => {
      const [sawahType, kp2bType, polaRuang] = key.split('|||');
      const areaHa  = groups[key].areaHa;
      const isSawah = sawahType.toLowerCase().includes('sawah') && !sawahType.toLowerCase().includes('bukan');
      const percentage = isSawah && totalSawahAreaHa > 0 ? (areaHa / totalSawahAreaHa) * 100 : 0;
      return { sawahType, kp2bType, polaRuang, areaHa, percentage };
    });

    // Keep all Sawah rows, but for Bukan Sawah, only keep those containing "K02A" or "K20A"
    const filteredResults = resultsFlat.filter((row) => {
      const isSawah = row.sawahType.toLowerCase().includes('sawah') && !row.sawahType.toLowerCase().includes('bukan');
      if (isSawah) return true;
      return row.kp2bType.toUpperCase().includes('K02A') || row.kp2bType.toUpperCase().includes('K20A');
    });

    filteredResults.sort((a, b) => {
      const isASawah = a.sawahType.toLowerCase().includes('sawah') && !a.sawahType.toLowerCase().includes('bukan');
      const isBSawah = b.sawahType.toLowerCase().includes('sawah') && !b.sawahType.toLowerCase().includes('bukan');
      if (isASawah && !isBSawah) return -1;
      if (!isASawah && isBSawah) return 1;
      const kp2bCompare = a.kp2bType.localeCompare(b.kp2bType);
      if (kp2bCompare !== 0) return kp2bCompare;
      return a.polaRuang.localeCompare(b.polaRuang);
    });

    return filteredResults;
  };

  const handleResetSession = async () => {
    if (window.confirm('Apakah Anda yakin ingin menghapus semua data yang terunggah dan memulai sesi baru?')) {
      setIsCalculating(true);
      setStatusMessage({ text: 'Membersihkan sesi dan data staging di database...', type: 'info' });
      try {
        await fetch('/api/spatial/cleanup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId })
        });
      } catch (err) {
        console.error('Failed to clean up database:', err);
      }

      // Reset LBS states in App.tsx
      setRtrwRaw(null);
      setLbsRaw(null);
      setOverlayResults(null);
      setTableData([]);
      setStatusMessage({ text: 'Sesi berhasil di-reset. Semua data dibersihkan.', type: 'info' });
      setIsCalculating(false);

      // Reset ForestTab states by updating key
      setSessionKey('sess_key_' + Date.now());
    }
  };

  // ─── Perform spatial overlay via PostGIS Database Engine ──────────────────
  const runOverlayAnalysis = async () => {
    if (!rtrwRaw || !lbsRaw) {
      setStatusMessage({ text: 'Harap unggah kedua file RTRW dan LBS sebelum memulai analisis.', type: 'warn' });
      return;
    }
    if (!fields.polaRuangField || !fields.lbsSawahField || !fields.rtrwKp2bField) {
      setStatusMessage({ text: 'Harap tentukan pemetaan atribut (field) untuk kedua file terlebih dahulu.', type: 'warn' });
      return;
    }

    setIsCalculating(true);
    setProgress(10);
    setStatusMessage({ text: 'Mengunggah data RTRW ke database PostGIS...', type: 'info' });

    try {
      // Step A: Upload RTRW Staging
      let uploadRes;
      if (rtrwRaw.file) {
        uploadRes = await fetch(`/api/spatial/upload-file?sessionId=${sessionId}&type=rtrw&namobjField=${fields.polaRuangField}&kp2bField=${fields.rtrwKp2bField}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: rtrwRaw.file
        });
      } else {
        const rtrwFormatted = {
          type: 'FeatureCollection',
          features: rtrwRaw.geojson.features.map((f: any) => ({
            ...f,
            properties: {
              NAMOBJ_INTERNAL: f.properties?.[fields.polaRuangField],
              KP2B_INTERNAL: f.properties?.[fields.rtrwKp2bField]
            }
          }))
        };

        uploadRes = await fetch('/api/spatial/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, type: 'rtrw', geojson: rtrwFormatted })
        });
      }
      if (!uploadRes.ok) throw new Error(`Upload RTRW gagal dengan status ${uploadRes.status}`);

      setProgress(40);
      setStatusMessage({ text: 'Mengunggah data LBS ke database PostGIS...', type: 'info' });

      // Step B: Upload LBS Staging
      if (lbsRaw.file) {
        uploadRes = await fetch(`/api/spatial/upload-file?sessionId=${sessionId}&type=lbs&sawahField=${fields.lbsSawahField}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: lbsRaw.file
        });
      } else {
        const lbsFormatted = {
          type: 'FeatureCollection',
          features: lbsRaw.geojson.features.map((f: any) => ({
            ...f,
            properties: {
              SAWAH_INTERNAL: f.properties?.[fields.lbsSawahField]
            }
          }))
        };

        uploadRes = await fetch('/api/spatial/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, type: 'lbs', geojson: lbsFormatted })
        });
      }
      if (!uploadRes.ok) throw new Error(`Upload LBS gagal dengan status ${uploadRes.status}`);

      setProgress(70);
      setStatusMessage({ text: 'Menjalankan geoprocessing overlay di PostGIS server...', type: 'info' });

      // Step C: Execute PostGIS Overlay LBS
      const overlayRes = await fetch('/api/spatial/overlay-lbs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId })
      });
      if (!overlayRes.ok) throw new Error(`Overlay LBS gagal dengan status ${overlayRes.status}`);

      const overlayData = await overlayRes.json();
      if (overlayData.status === 'error') throw new Error(overlayData.message);

      setProgress(90);
      const results = overlayData.results;
      setOverlayResults(results);

      const resultsFlat = aggregateResults(results);
      setTableData(resultsFlat);

      const uniquePolaRuangs = Array.from(new Set(resultsFlat.map((r) => r.polaRuang)));
      const initialSelected = uniquePolaRuangs.filter(
        (cat) => cat.toLowerCase().includes('pangan') || cat.toLowerCase().includes('pertanian')
      );
      setAccommodatedCategories(initialSelected.length > 0 ? initialSelected : uniquePolaRuangs.slice(0, 1));

      setProgress(100);
      setStatusMessage({ text: 'Analisis overlay spasial PostGIS selesai dihitung dengan sukses!', type: 'success' });
    } catch (err: any) {
      console.error('PostGIS Staging Overlay Error:', err);
      setStatusMessage({ text: `Kalkulasi PostGIS gagal: ${err.message || String(err)}`, type: 'error' });
    } finally {
      setIsCalculating(false);
      // Clean up staged database tables immediately to keep database empty
      fetch('/api/spatial/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId })
      }).catch(() => {});
    }
  };

  // Dynamically extract Kabupaten / Kota name from WADMKK field in RTRW dataset.
  // Menggunakan nilai yang paling sering muncul (mode) agar robust untuk file multi-fitur,
  // dan selalu menormalisasi prefix admin (termasuk typo seperti "Kabupatan") sebelum
  // menambahkan "Kabupaten" atau "Kota" yang benar dan konsisten.
  const countyName = useMemo(() => {
    if (!rtrwRaw?.geojson?.features) return 'Kabupaten';

    // Hitung frekuensi tiap nilai WADMKK
    const freq: Record<string, number> = {};
    for (const f of rtrwRaw.geojson.features) {
      if (!f.properties) continue;
      const key = Object.keys(f.properties).find((k) => k.toLowerCase() === 'wadmkk');
      if (!key || !f.properties[key]) continue;
      const val = String(f.properties[key]).trim();
      if (val) freq[val] = (freq[val] ?? 0) + 1;
    }

    // Ambil nilai yang paling sering muncul
    const topVal = Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!topVal) return 'Kabupaten';

    // Strip semua variasi prefix admin (termasuk typo "Kabupatan", "Kab.", "Kab ")
    // lalu tambahkan prefix baku yang benar
    const adminPrefixPattern = /^(kota|kabupaten|kabupatan|kab\.|kab )\s*/i;
    const bare = topVal.replace(adminPrefixPattern, '').trim();

    if (topVal.toLowerCase().startsWith('kota')) {
      return `Kota ${bare}`;
    }
    return `Kabupaten ${bare}`;
  }, [rtrwRaw]);

  // Extract unique categories of Rencana Pola Ruang from current result dataset
  const uniquePolaRuangs = useMemo(() => {
    return Array.from(new Set(tableData.map((row) => row.polaRuang)));
  }, [tableData]);

  // Aggregate stats: Total Sawah, Total Bukan Sawah, Accommodated Sawah, Accommodated Percentage
  const stats = useMemo(() => {
    let totalSawah = 0;
    let totalBukanSawah = 0;
    let accommodatedSawah = 0;
    let totalKp2bK02A = 0;

    tableData.forEach((row) => {
      const isSawah = row.sawahType.toLowerCase().includes('sawah') && !row.sawahType.toLowerCase().includes('bukan');
      if (isSawah) {
        totalSawah += row.areaHa;
        if (accommodatedCategories.includes(row.polaRuang)) {
          accommodatedSawah += row.areaHa;
        }
      } else {
        totalBukanSawah += row.areaHa;
      }

      const isK02A = row.kp2bType.toUpperCase().includes('K02A') || row.kp2bType.toUpperCase().includes('K20A');
      if (isK02A) {
        totalKp2bK02A += row.areaHa;
      }
    });

    const accommodatedPercent = totalSawah > 0 ? (accommodatedSawah / totalSawah) * 100 : 0;
    const passes = accommodatedPercent >= moratoriumThreshold;

    return {
      totalSawah,
      totalBukanSawah,
      accommodatedSawah,
      accommodatedPercent,
      passes,
      totalKp2bK02A,
    };
  }, [tableData, accommodatedCategories, moratoriumThreshold]);

  // Toggle Pola Ruang category inside the "Accommodated" list
  const toggleAccommodatedCategory = (cat: string) => {
    setAccommodatedCategories((prev) => {
      if (prev.includes(cat)) {
        return prev.filter((item) => item !== cat);
      } else {
        return [...prev, cat];
      }
    });
  };

  // Row Merging spans calculations
  const rowSpans = useMemo(() => {
    const spans = {
      sawah: [] as number[],
      kp2b: [] as number[],
    };

    for (let i = 0; i < tableData.length; i++) {
      const current = tableData[i];

      // Sawah merger span
      if (i === 0 || tableData[i - 1].sawahType !== current.sawahType) {
        let count = 1;
        while (i + count < tableData.length && tableData[i + count].sawahType === current.sawahType) {
          count++;
        }
        spans.sawah.push(count);
      } else {
        spans.sawah.push(0);
      }

      // KP2B status merger (must be bound under the same Sawah Group structure)
      if (
        i === 0 ||
        tableData[i - 1].kp2bType !== current.kp2bType ||
        tableData[i - 1].sawahType !== current.sawahType
      ) {
        let count = 1;
        while (
          i + count < tableData.length &&
          tableData[i + count].kp2bType === current.kp2bType &&
          tableData[i + count].sawahType === current.sawahType
        ) {
          count++;
        }
        spans.kp2b.push(count);
      } else {
        spans.kp2b.push(0);
      }
    }

    return spans;
  }, [tableData]);

  // Export results table to CSV/Excel matching
  const exportToCSV = () => {
    let csvContent = 'data:text/csv;charset=utf-8,';
    csvContent += 'Kelompok Sawah,KP2B Status,Rencana Pola Ruang,Luas (Ha),Persentase (%)\r\n';

    tableData.forEach((row) => {
      const isSawah = row.sawahType.toLowerCase().includes('sawah') && !row.sawahType.toLowerCase().includes('bukan');
      const percentStr = isSawah ? `${row.percentage.toFixed(2)}%` : '-';
      csvContent += `"${row.sawahType}","${row.kp2bType}","${row.polaRuang}",${row.areaHa.toFixed(2)},${percentStr}\r\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', 'Overlay_Spatial_CEA_LBS_Report.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="min-h-screen bg-[#F3F4F6] text-[#1F2937] flex flex-col font-sans" id="app">
      {/* Dynamic Header */}
      <header className="border-b border-gray-200 bg-white sticky top-0 z-20 shadow-xs" id="header">
        <div className="max-w-7xl mx-auto px-4 py-3.5 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg border transition-all ${
              activeModule === 'lbs' ? 'bg-blue-50 border-blue-200 text-blue-600' :
              activeModule === 'forest' ? 'bg-indigo-50 border-indigo-200 text-indigo-600' :
              activeModule === 'pola_ruang' ? 'bg-emerald-50 border-emerald-200 text-emerald-600' :
              'bg-purple-50 border-purple-200 text-purple-600'
            }`}>
              {activeModule === 'lbs' && <Layers className="w-5 h-5" />}
              {activeModule === 'forest' && <Trees className="w-5 h-5" />}
              {activeModule === 'pola_ruang' && <BookOpen className="w-5 h-5" />}
              {activeModule === 'struktur_ruang' && <ClipboardList className="w-5 h-5" />}
            </div>
            <div>
              <h1 className="text-base sm:text-lg font-black tracking-tight text-gray-900 font-display flex items-center gap-2 animate-feedin uppercase" id="app-title">
                Sistem Penjaminan Mutu & Pemeriksaan Mandiri RTRW
              </h1>
            </div>
          </div>

          {/* Dropdown Menu Selection for Modules */}
          <div className="relative shrink-0 w-72">
            <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
              {activeModule === 'lbs' && <Layers className="w-4 h-4 text-blue-500" />}
              {activeModule === 'forest' && <Trees className="w-4 h-4 text-indigo-500" />}
              {activeModule === 'pola_ruang' && <BookOpen className="w-4 h-4 text-emerald-500" />}
              {activeModule === 'struktur_ruang' && <ClipboardList className="w-4 h-4 text-purple-500" />}
            </div>
            <select
              value={activeModule}
              onChange={(e) => setActiveModule(e.target.value as any)}
              className="w-full pl-9 pr-10 py-2 bg-gray-50 border border-gray-300 text-gray-800 text-xs font-bold rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 cursor-pointer appearance-none shadow-xs"
              id="module-selector-dropdown"
            >
              <option value="lbs">Pemeriksaan Lahan Baku Sawah</option>
              <option value="forest">Pemeriksaan Kawasan Hutan</option>
              <option value="pola_ruang">Pemeriksaan Pola Ruang (Substansi)</option>
              <option value="struktur_ruang">Pemeriksaan Struktur Ruang (Substansi)</option>
            </select>
            <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-gray-400">
              <ChevronDown className="w-3.5 h-3.5" />
            </div>
          </div>

          <div className="flex items-center gap-2.5">


            {/* Reset Session Button */}
            <button
              onClick={handleResetSession}
              disabled={isCalculating}
              className={`flex items-center gap-1.5 px-3 py-1.5 border text-xs font-bold rounded-lg transition-all cursor-pointer ${
                isCalculating
                  ? 'bg-gray-50 border-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100 hover:border-rose-300'
              }`}
              title="Bersihkan semua data yang terunggah dan mulai sesi baru"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isCalculating ? 'animate-spin' : ''}`} />
              <span>Reset Sesi</span>
            </button>

            {activeModule === 'lbs' && !rtrwRaw && !lbsRaw && (
              <button
                onClick={handleLoadSampleData}
                className="flex items-center gap-1.5 px-3.5 py-1.5 bg-gray-50 hover:bg-gray-100 border border-gray-300 text-gray-750 text-xs font-bold rounded-lg transition-all cursor-pointer"
                id="btn-sample-data"
              >
                <RefreshCw className="w-3.5 h-3.5 text-blue-600" />
                Muat Data Sampel
              </button>
            )}
            <span className="text-[10px] py-1 px-2.5 bg-gray-200 rounded-full text-gray-600 font-mono font-medium">
              v1.1.0
            </span>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-5 space-y-5" id="main-content">
        {/* Status Messages */}
        {statusMessage.text && (
          <div
            className={`p-3 rounded-lg border flex items-center gap-3 text-xs transition-all ${
              statusMessage.type === 'error'
                ? 'bg-rose-50 border-rose-200 text-rose-800 shadow-xs'
                : statusMessage.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800 shadow-xs'
                : statusMessage.type === 'warn'
                ? 'bg-amber-50 border-amber-200 text-amber-800 shadow-xs'
                : 'bg-blue-50 border-blue-200 text-blue-800 shadow-xs'
            }`}
            id="status-bar"
          >
            <Info className="w-4 h-4 shrink-0 text-blue-650" />
            <div className="font-semibold flex-1">{statusMessage.text}</div>
            <button
              onClick={() => setStatusMessage({ text: '', type: null })}
              className="text-gray-400 hover:text-gray-700 transition-colors"
            >
              ✕
            </button>
          </div>
        )}

        <div className={activeModule === 'forest' ? 'block' : 'hidden'}>
          <ForestTab key={sessionKey} countyName={countyName} sessionId={sessionId} />
        </div>

        <div className={activeModule === 'pola_ruang' ? 'block' : 'hidden'}>
          <PolaRuangSubstansiTab />
        </div>

        <div className={activeModule === 'struktur_ruang' ? 'block' : 'hidden'}>
          <StrukturRuangSubstansiTab />
        </div>

        <div className={activeModule === 'lbs' ? 'block space-y-8 animate-feedin' : 'hidden'} id="lbs-page-container">
            {/* LBS Header Hero Card */}
            <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-6" id="lbs-hero">
              <div className="space-y-1.5 max-w-4xl">
                <div className="flex items-center gap-2 text-blue-700">
                  <Layers className="w-5 h-5 text-blue-600" />
                  <h2 className="text-lg font-extrabold tracking-tight font-display text-gray-900">
                    Pemeriksaan Lahan Baku Sawah (LBS)
                  </h2>
                </div>
                <p className="text-xs text-gray-500 leading-relaxed">
                  Sistem audit spasial dan administrasi alih fungsi lahan sawah. Evaluasi dilakukan secara komprehensif mulai dari tumpang susun spasial, verifikasi fisik visual tutupan lahan lewat citra satelit, penyaringan hak atas tanah (HGU/HAT/KKPR), hingga kompilasi rekomendasi formal pemerintah.
                </p>
              </div>
            </div>

            {/* Quick Sticky Anchor Navigation */}
            <div className="bg-white/95 backdrop-blur-md p-1.5 border border-gray-250 rounded-xl flex items-center justify-around text-[11px] font-black uppercase text-gray-500 sticky top-16 z-10 shadow-md overflow-x-auto gap-2 shrink-0 animate-feedin" id="lbs-sticky-anchors">
              <a href="#lbs-section-spatial" className="px-3 py-2 text-blue-600 hover:bg-blue-50/75 rounded-md transition-all flex items-center gap-1">
                <Table className="w-3.5 h-3.5" />
                <span>Bagian I: Analisis Spasial</span>
              </a>
              <a href="#lbs-section-evidence" className="px-3 py-2 hover:text-gray-900 hover:bg-gray-100/75 rounded-md transition-all flex items-center gap-1">
                <Camera className="w-3.5 h-3.5" />
                <span>Bagian II: Citra Satelit</span>
              </a>
              <a href="#lbs-section-rights" className="px-3 py-2 hover:text-gray-900 hover:bg-gray-100/75 rounded-md transition-all flex items-center gap-1">
                <ShieldAlert className="w-3.5 h-3.5" />
                <span>Bagian III: Hak Atas Tanah</span>
              </a>
              <a href="#lbs-section-download" className="px-3 py-2 hover:text-gray-900 hover:bg-gray-100/75 rounded-md transition-all flex items-center gap-1">
                <FileCheck className="w-3.5 h-3.5" />
                <span>Bagian IV: Unduh Laporan</span>
              </a>
            </div>

            {/* SECTION I: Analisis Spasial */}
            <section id="lbs-section-spatial" className="scroll-mt-32 space-y-5">
              <div className="border-b border-gray-200 pb-2">
                <h3 className="text-xs font-black tracking-wider text-gray-400 uppercase flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center font-mono text-[10px] font-bold">I</span>
                  Penyandingan Spasial & Overlay Union LBS
                </h3>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* LEFT PANEL: UPLOADS & PARAMETERS CONFIGS (4 Cols on Large) */}
          <section className="lg:col-span-5 space-y-5" id="left-panel">
            {/* Data Loader & File Manager */}
            <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-xs space-y-4">
              <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5 pb-2 border-b border-gray-100">
                <Settings className="w-3.5 h-3.5 text-blue-600" />
                Unggah Berkas Spasial
              </h2>



              {/* Data 1 Input: RTRW Pola Ruang */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-700 flex items-center justify-between">
                  <span>Data 1: Rencana Pola Ruang (RTRW)</span>
                  {rtrwRaw && <span className="text-[10px] text-blue-600 font-mono font-bold">TERRAIN LOADED</span>}
                </label>
                <div className="relative group border border-gray-300 hover:border-blue-500 rounded-lg p-3 text-center cursor-pointer bg-gray-50 transition-all">
                  <input
                    type="file"
                    accept=".json,.geojson,.zip"
                    onChange={(e) => handleFileUpload(e, 'rtrw')}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                    id="input-file-rtrw"
                  />
                  <div className="flex flex-col items-center justify-center space-y-1">
                    <Upload className="w-5 h-5 text-gray-400 group-hover:text-blue-600 transition-colors" />
                    <span className="text-xs font-bold text-gray-800">
                      {rtrwRaw ? rtrwRaw.name : 'Pilih GeoJSON / SHP .zip'}
                    </span>
                    <span className="text-[10px] text-gray-500 font-medium">Maks. 50 MB (GeoJSON atau Shapefile terkompresi)</span>
                  </div>
                </div>
                {rtrwRaw && (
                  <div className="grid grid-cols-2 gap-2 mt-2 bg-gray-50 p-2 rounded-lg border border-gray-200">
                    <div className="flex flex-col gap-1">
                      <span className="text-[9px] text-gray-600 font-bold uppercase tracking-wider">Field Pola Ruang:</span>
                      <select
                        value={fields.polaRuangField}
                        onChange={(e) => setFields((prev) => ({ ...prev, polaRuangField: e.target.value }))}
                        className="text-[11px] bg-white border border-gray-300 rounded px-1.5 py-1 text-gray-800 outline-none w-full font-medium"
                        id="select-rtrw-field"
                      >
                        {rtrwRaw.fields.map((f) => (
                          <option key={f} value={f}>
                            {f}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-[9px] text-gray-600 font-bold uppercase tracking-wider">Field KP2B:</span>
                      <select
                        value={fields.rtrwKp2bField}
                        onChange={(e) => setFields((prev) => ({ ...prev, rtrwKp2bField: e.target.value }))}
                        className="text-[11px] bg-white border border-gray-300 rounded px-1.5 py-1 text-gray-800 outline-none w-full font-medium"
                        id="select-rtrw-kp2b-field"
                      >
                        {rtrwRaw.fields.map((f) => (
                          <option key={f} value={f}>
                            {f}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </div>

              {/* Data 2 Input: Lahan Baku Sawah */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-700 flex items-center justify-between">
                  <span>Data 2: Lahan Baku Sawah (LBS)</span>
                  {lbsRaw && <span className="text-[10px] text-blue-600 font-mono font-bold">SAWAH LOADED</span>}
                </label>
                <div className="relative group border border-gray-300 hover:border-blue-500 rounded-lg p-3 text-center cursor-pointer bg-gray-50 transition-all">
                  <input
                    type="file"
                    accept=".json,.geojson,.zip"
                    onChange={(e) => handleFileUpload(e, 'lbs')}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                    id="input-file-lbs"
                  />
                  <div className="flex flex-col items-center justify-center space-y-1">
                    <Upload className="w-5 h-5 text-gray-400 group-hover:text-blue-600 transition-colors" />
                    <span className="text-xs font-bold text-gray-800">
                      {lbsRaw ? lbsRaw.name : 'Pilih GeoJSON / SHP .zip'}
                    </span>
                    <span className="text-[10px] text-gray-500 font-medium">Maks. 50 MB (GeoJSON atau Shapefile terkompresi)</span>
                  </div>
                </div>
                {lbsRaw && (
                  <div className="flex items-center justify-between gap-2 mt-2 bg-gray-50 p-2 rounded-lg border border-gray-200">
                    <span className="text-[10px] text-gray-600 font-bold uppercase tracking-wider">Field Sawah LBS:</span>
                    <select
                      value={fields.lbsSawahField}
                      onChange={(e) => setFields((prev) => ({ ...prev, lbsSawahField: e.target.value }))}
                      className="text-xs bg-white border border-gray-300 rounded px-2 py-1 text-gray-800 outline-none max-w-[180px] font-medium"
                      id="select-lbs-sawah-field"
                    >
                      {lbsRaw.fields.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Run Overlay Button */}
              <button
                onClick={runOverlayAnalysis}
                disabled={isCalculating || !rtrwRaw || !lbsRaw}
                className={`w-full py-2.5 px-4 rounded-xl font-bold text-xs uppercase tracking-widest flex items-center justify-center gap-2 shadow-md transition-all cursor-pointer ${
                  isCalculating || !rtrwRaw || !lbsRaw
                    ? 'bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed shadow-none'
                    : 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-100'
                }`}
                id="btn-run-overlay"
              >
                {isCalculating ? (
                  <>
                    <Activity className="w-4 h-4 animate-spin" />
                    Menghitung {progress}% ...
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-current" />
                    Proses Overlay Poligon
                  </>
                )
                }
              </button>
            </div>

            {/* Moratorium Evaluator parameter controls */}
            {tableData.length > 0 && (
              <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-xs space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-gray-100">
                  <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                    <TrendingUp className="w-3.5 h-3.5 text-blue-600" />
                    Penetapan Prasyarat Moratorium
                  </h2>
                  <span className="text-xs font-bold bg-blue-50 text-blue-600 border border-blue-200 px-2 py-0.5 rounded">
                    Batas: {moratoriumThreshold}%
                  </span>
                </div>

                <div className="space-y-3">
                  {/* Slider Control for standard threshold limit (default 87%) */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-gray-500 font-semibold">
                      <span>Target Pola Ruang Min.</span>
                      <span className="font-mono text-gray-900 font-bold">{moratoriumThreshold}%</span>
                    </div>
                    <input
                      type="range"
                      min="50"
                      max="100"
                      step="1"
                      value={moratoriumThreshold}
                      onChange={(e) => setMoratoriumThreshold(Number(e.target.value))}
                      className="w-full accent-blue-600 h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                      id="input-moratorium-threshold"
                    />
                    <span className="text-[10px] text-gray-500 block leading-relaxed">
                      *Berdasarkan regulasi nasional, moratorium konversi lahan baku sawah dibebaskan jika diakomodasi pola ruang pertanian pangan &gt; 87%.
                    </span>
                  </div>

                  {/* Pola Ruang Categories checkboxes to custom decide which zones represent agriculture/food crop */}
                  {uniquePolaRuangs.length > 0 && (
                    <div className="space-y-2 pt-2 border-t border-gray-100">
                      <label className="text-xs font-bold text-gray-700 flex items-center gap-1">
                        <span>Pilih Pola Ruang Diakomodasi:</span>
                        <span title="Pola Ruang yang dianggap dapat mengamankan/mengakomodasi keberadaan sawah" className="cursor-help">
                          <HelpCircle className="w-3.5 h-3.5 text-gray-400 hover:text-gray-600" />
                        </span>
                      </label>
                      <div className="space-y-1 max-h-[160px] overflow-y-auto pr-1 select-none">
                        {uniquePolaRuangs.map((cat) => (
                          <label
                            key={cat}
                            className="flex items-center gap-2 px-2.5 py-1.5 rounded bg-gray-50 border border-gray-200 text-[11px] text-gray-700 hover:bg-gray-100 hover:text-gray-900 cursor-pointer transition-all"
                          >
                            <input
                              type="checkbox"
                              checked={accommodatedCategories.includes(cat)}
                              onChange={() => toggleAccommodatedCategory(cat)}
                              className="accent-blue-600 rounded border-gray-300"
                            />
                            <span className="truncate font-medium">{cat}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>

          {/* RIGHT PANEL: MAP & EVALUATION STATS (7 Cols on Large) */}
          <section className="lg:col-span-7 space-y-5" id="right-panel">
            {/* Top Overview: Moratorium verdict screen */}
            {tableData.length > 0 && (
              <div
                className={`border rounded-xl p-4 shadow-xs flex flex-col md:flex-row items-center gap-5 transition-all duration-300 ${
                  stats.passes
                    ? 'bg-emerald-50/70 border-emerald-500/40 text-emerald-950'
                    : 'bg-rose-50/70 border-rose-500/40 text-rose-950'
                }`}
                id="moratorium-evaluation-card"
              >
                {/* Dial percentage gauge */}
                <div className="relative w-28 h-28 flex items-center justify-center shrink-0 bg-white rounded-full p-2 border border-gray-100 shadow-xs">
                  <svg className="w-full h-full transform -rotate-90">
                    {/* Background Circle */}
                    <circle
                      cx="48"
                      cy="48"
                      r="40"
                      className="stroke-gray-100 fill-none"
                      strokeWidth="8"
                    />
                    {/* Accent Progress Circle */}
                    <circle
                      cx="48"
                      cy="48"
                      r="40"
                      className={`fill-none transition-all duration-500 ${
                        stats.passes ? 'stroke-emerald-600' : 'stroke-rose-600'
                      }`}
                      strokeWidth="8"
                      strokeDasharray={251.32}
                      strokeDashoffset={251.32 - (251.32 * Math.min(stats.accommodatedPercent, 100)) / 100}
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="absolute text-center">
                    <span className="text-xl font-black text-gray-900 block" id="dial-value">
                      {stats.accommodatedPercent.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%
                    </span>
                    <span className="text-[9px] text-gray-500 font-bold uppercase tracking-wider">Akomodatif</span>
                  </div>
                </div>

                {/* Verdict labels */}
                <div className="space-y-1 text-center md:text-left flex-1">
                  <div className="flex items-center justify-center md:justify-start gap-2 flex-wrap">
                    <span
                      className={`px-2.5 py-0.5 text-[10px] font-bold rounded-md tracking-wider flex items-center gap-1 shadow-xs ${
                        stats.passes
                          ? 'bg-emerald-600 text-white'
                          : 'bg-rose-600 text-white'
                      }`}
                      id="badge-verdict"
                    >
                      {stats.passes ? (
                        <>
                          <CheckCircle2 className="w-3 h-3" />
                          MEMENUHI
                        </>
                      ) : (
                        <>
                          <AlertTriangle className="w-3 h-3" />
                          BELUM MEMENUHI
                        </>
                      )}
                    </span>
                    <span className="text-[11px] text-gray-600 font-bold font-mono">
                      {stats.accommodatedSawah.toLocaleString('id-ID', { maximumFractionDigits: 2 })} Ha dari{' '}
                      {stats.totalSawah.toLocaleString('id-ID', { maximumFractionDigits: 2 })} Ha
                    </span>
                  </div>

                  <h3 className="text-sm font-bold text-gray-900">
                    {stats.passes
                      ? `${countyName} Memenuhi Syarat Spasial Bebas Moratorium`
                      : `${countyName} Belum Memenuhi Prasyarat Spasial`}
                  </h3>
                  <p className="text-[11px] text-gray-600 leading-relaxed max-w-xl">
                    {stats.passes
                      ? `Rencana pola ruang ${countyName} telah berhasil mengakomodasi porsi lahan baku sawah di atas target prasyarat nasional (> 87%). Daerah ini memenuhi prasyarat spasial untuk bebas dari moratorium konversi lahan.`
                      : `Porsi sawah ${countyName} yang diakomodasi rencana tata ruang masih berada di bawah target prasyarat nasional 87% (saat ini ${stats.accommodatedPercent.toFixed(
                          1
                        )}%). Penangguhan/moratorium pembebasan konversi lahan tetap dipertahankan sampai revisi RTRW dilakukan.`}
                  </p>
                </div>
              </div>
            )}

            {/* Interactive spatial visualizer card */}
            <InteractiveMap
              rtrwData={rtrwRaw?.geojson}
              lbsData={lbsRaw?.geojson}
              overlayData={overlayResults}
              rtrwField={fields.polaRuangField}
              lbsSawahField={fields.lbsSawahField}
              rtrwKp2bField={fields.rtrwKp2bField}
            />
          </section>
        </div>

        {/* RESULTS INTERSECTION DATA TABLE */}
        {tableData.length > 0 && (
          <div className="space-y-4" id="table-card">
            {/* Quick Metrics Dashboard atop the table */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Card 1: Total Sawah */}
              <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm flex items-center justify-between">
                <div className="space-y-1">
                  <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Total Lahan Sawah (LBS)</span>
                  <h4 className="text-xl font-black font-display text-gray-950">
                    {stats.totalSawah.toLocaleString('id-ID', { maximumFractionDigits: 2 })} <span className="text-xs font-semibold text-gray-500">Ha</span>
                  </h4>
                  <p className="text-[10px] text-gray-400 font-medium font-sans">Lahan Baku Sawah terhitung</p>
                </div>
                <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl border border-emerald-100 shadow-xs">
                  <Table className="w-6 h-6" />
                </div>
              </div>

              {/* Card 2: LBS Diakomodasi */}
              <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm flex items-center justify-between">
                <div className="space-y-1">
                  <span className="text-[10px] text-emerald-600 font-bold uppercase tracking-wider">LBS Diakomodasi RTRW</span>
                  <h4 className="text-xl font-black font-display text-emerald-600">
                    {stats.accommodatedSawah.toLocaleString('id-ID', { maximumFractionDigits: 2 })} <span className="text-xs font-semibold text-emerald-650">Ha</span>
                  </h4>
                  <div className="flex items-center gap-1 text-[10px] text-emerald-600 font-extrabold bg-emerald-50 px-1.5 py-0.5 rounded-md w-fit">
                    <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                    <span>{stats.accommodatedPercent.toFixed(1)}% Terakomodasi</span>
                  </div>
                </div>
                <div className="p-3 bg-emerald-100 text-emerald-700 rounded-xl border border-emerald-250/50 shadow-xs">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
              </div>

              {/* Card 3: LBS Rawan Moratorium */}
              <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm flex items-center justify-between">
                <div className="space-y-1">
                  <span className="text-[10px] text-rose-600 font-bold uppercase tracking-wider">LBS Rawan Moratorium</span>
                  <h4 className="text-xl font-black font-display text-rose-600">
                    {(stats.totalSawah - stats.accommodatedSawah).toLocaleString('id-ID', { maximumFractionDigits: 2 })} <span className="text-xs font-semibold text-gray-500">Ha</span>
                  </h4>
                  <div className="flex items-center gap-1 text-[10px] text-rose-650 font-extrabold bg-rose-50 px-1.5 py-0.5 rounded-md w-fit">
                    <AlertTriangle className="w-3 h-3 text-rose-500 animate-pulse" />
                    <span>{(100 - stats.accommodatedPercent).toFixed(1)}% Risiko Alih Fungsi</span>
                  </div>
                </div>
                <div className="p-3 bg-rose-50 text-rose-650 rounded-xl border border-rose-100 shadow-xs">
                  <AlertTriangle className="w-6 h-6" />
                </div>
              </div>

              {/* Card 4: Luas Total KP2B */}
              <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm flex items-center justify-between">
                <div className="space-y-1">
                  <span className="text-[10px] text-indigo-650 font-bold uppercase tracking-wider">Luas Total KP2B RTRW</span>
                  <h4 className="text-xl font-black font-display text-indigo-700">
                    {stats.totalKp2bK02A.toLocaleString('id-ID', { maximumFractionDigits: 2 })} <span className="text-xs font-semibold text-indigo-400">Ha</span>
                  </h4>
                  <p className="text-[10px] text-gray-400 font-medium font-sans">KP2B terhitung</p>
                </div>
                <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl border border-indigo-100 shadow-xs">
                  <Layers className="w-6 h-6" />
                </div>
              </div>
            </div>

            {/* Main Table Container */}
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
              <div className="p-4 bg-gradient-to-r from-gray-50 to-gray-100 border-b border-gray-200 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <div className="p-1 px-2 bg-blue-50 text-blue-600 text-[10px] rounded font-extrabold font-mono border border-blue-150">
                    ANALISIS SPASIAL
                  </div>
                  <div>
                    <h3 className="text-sm font-extrabold text-gray-950">Laporan Hasil Overlay Spasial</h3>
                    <p className="text-[11px] text-gray-550 font-medium">
                      Gabungan (union) poligon Lahan Sawah dan Rencana Tata Ruang
                    </p>
                  </div>
                </div>

                <button
                  onClick={exportToCSV}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition-all cursor-pointer shadow-sm hover:translate-y-[-1px]"
                  id="btn-export"
                >
                  <Download className="w-3.5 h-3.5" />
                  Ekspor Laporan (CSV)
                </button>
              </div>

              {/* High-fidelity responsive HTML table */}
              <div className="overflow-x-auto" id="table-container">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-900 border-b-2 border-slate-700 text-white font-extrabold uppercase text-[10px] tracking-wider font-sans">
                      <th className="p-3 border-r border-slate-800">Lahan Baku Sawah (LBS)</th>
                      <th className="p-3 border-r border-slate-800">KP2B (RTRW)</th>
                      <th className="p-3 border-r border-slate-800">Rencana Pola Ruang</th>
                      <th className="p-3 border-r border-slate-800 w-32">Status</th>
                      <th className="p-3 border-r border-slate-800 text-right w-40">Luas (Ha)</th>
                      <th className="p-3 text-right w-44">Porsi Sawah (%)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 text-gray-800">
                    {tableData.map((row, idx) => {
                      const isSawah = row.sawahType.toLowerCase().includes('sawah') && !row.sawahType.toLowerCase().includes('bukan');
                      const hasSawahSpan = rowSpans.sawah[idx] > 0;
                      const isSawahSpanHidden = rowSpans.sawah[idx] === 0;

                      const hasKp2bSpan = rowSpans.kp2b[idx] > 0;
                      const isKp2bSpanHidden = rowSpans.kp2b[idx] === 0;

                      const isAccommodated = accommodatedCategories.includes(row.polaRuang);

                      // Style rows based on compliance
                      let rowStyle = 'hover:bg-gray-50/80 transition-colors';
                      if (isSawah) {
                        if (isAccommodated) {
                          rowStyle = 'bg-emerald-50/25 hover:bg-emerald-50/45 border-l-[4px] border-l-emerald-500 transition-colors';
                        } else {
                          rowStyle = 'bg-rose-50/30 hover:bg-rose-50/45 border-l-[4px] border-l-rose-500 transition-colors';
                        }
                      }

                      return (
                        <tr key={idx} className={rowStyle}>
                          {/* 1. Lahan Baku Sawah rowSpan columns with badge styling */}
                          {!isSawahSpanHidden && (
                            <td
                              className="p-3 align-middle font-bold text-gray-900 border-r border-gray-250 bg-gray-50/70"
                              rowSpan={rowSpans.sawah[idx]}
                            >
                              <span className="flex items-center gap-1.5 capitalize text-xs">
                                <span
                                  className={`w-2 h-2 rounded-full shadow-xs ${
                                    isSawah ? 'bg-emerald-500' : 'bg-gray-400'
                                  }`}
                                ></span>
                                <span className={isSawah ? 'text-emerald-950 font-extrabold' : 'text-gray-700'}>
                                  {row.sawahType}
                                </span>
                              </span>
                            </td>
                          )}

                          {/* 2. KP2B Status rowSpan columns */}
                          {!isKp2bSpanHidden && (
                            <td
                              className="p-3 align-middle text-gray-750 font-semibold border-r border-gray-200 bg-gray-50/30 text-center"
                              rowSpan={rowSpans.kp2b[idx]}
                            >
                              <span className={`inline-block px-2.5 py-1 text-[10px] rounded-full font-bold border ${
                                row.kp2bType?.toLowerCase().includes('bukan') || row.kp2bType?.toLowerCase().includes('tidak') || row.kp2bType === 'Lainnya' || row.kp2bType === 'Tidak Ada'
                                  ? 'bg-gray-100 text-gray-600 border-gray-300'
                                  : 'bg-indigo-50 text-indigo-700 border-indigo-200'
                              }`}>
                                {row.kp2bType}
                              </span>
                            </td>
                          )}

                          {/* 3. NAMOBJ Pola Ruang */}
                          <td className="p-3 border-r border-gray-150 font-sans font-medium">
                            <div className="flex items-center gap-2">
                              {isSawah && (
                                <span
                                  className={`w-2 h-2 rounded-full ${
                                    isAccommodated ? 'bg-emerald-500' : 'bg-rose-500'
                                  }`}
                                  title={
                                    isAccommodated
                                      ? 'Diakomodasi Pola Ruang'
                                      : 'Tidak Diakomodasi Pola Ruang'
                                  }
                                ></span>
                              )}
                              <span className="font-extrabold text-gray-950 text-xs">{row.polaRuang}</span>
                            </div>
                          </td>

                          {/* 4. Status badge column */}
                          <td className="p-3 border-r border-gray-150 align-middle">
                            {isSawah ? (
                              isAccommodated ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-extrabold bg-emerald-100 text-emerald-800 border border-emerald-250">
                                  <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                  DIAKOMODASI
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-extrabold bg-rose-50 text-rose-800 border border-rose-200 animate-pulse">
                                  <AlertTriangle className="w-3 h-3 text-rose-600" />
                                  RISIKO TINGGI
                                </span>
                              )
                            ) : (
                              <span className="text-gray-400 font-mono text-[10px]">KP2B/LP2B/LCP2B</span>
                            )}
                          </td>

                          {/* 5. LUASHA Luas Ha */}
                          <td className="p-3 text-right font-mono border-r border-gray-150 text-gray-950 font-extrabold text-xs">
                            {row.areaHa.toLocaleString('id-ID', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })} <span className="text-[10px] font-normal text-gray-400">Ha</span>
                          </td>

                          {/* 6. Percentage relative to total Sawah with mini progress bar */}
                          <td className="p-3 text-right align-middle">
                            {isSawah ? (
                              <div className="flex flex-col items-end gap-1">
                                <span className={`font-mono text-xs font-black ${
                                  isAccommodated ? 'text-emerald-700' : 'text-rose-600'
                                }`}>
                                  {row.percentage.toLocaleString('id-ID', {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  })}%
                                </span>
                                {/* Visual sparkline micro bar */}
                                <div className="w-24 bg-gray-200 h-1.5 rounded-full overflow-hidden">
                                  <div 
                                    className={`h-full rounded-full ${
                                      isAccommodated ? 'bg-emerald-500' : 'bg-rose-500'
                                    }`} 
                                    style={{ width: `${Math.min(row.percentage, 100)}%` }} 
                                  />
                                </div>
                              </div>
                            ) : (
                              <span className="text-gray-400 text-right pr-6 block font-medium">-</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}

                    {/* Totals Breakdown rows */}
                    <tr className="bg-slate-100 font-bold text-slate-900 border-t border-gray-300">
                      <td colSpan={4} className="p-3.5 text-left border-r border-gray-250 text-emerald-800 font-extrabold">
                        TOTAL LAHAN BAKU SAWAH (LBS) KABUPATEN
                      </td>
                      <td className="p-3.5 text-right font-mono border-r border-gray-250 text-emerald-900 text-xs font-black">
                        {stats.totalSawah.toLocaleString('id-ID', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })} <span className="text-[10px] font-normal text-gray-500">Ha</span>
                      </td>
                      <td className="p-3.5 text-right font-mono text-emerald-800 text-xs font-black pr-3">100,00%</td>
                    </tr>

                    {stats.totalBukanSawah > 0 && (
                      <tr className="bg-gray-50 font-semibold text-gray-600">
                        <td colSpan={4} className="p-3 text-left border-r border-gray-200">
                          Total Non Lahan Baku Sawah (Bukan Sawah)
                        </td>
                        <td className="p-3 text-right font-mono border-r border-gray-200 text-gray-900">
                          {stats.totalBukanSawah.toLocaleString('id-ID', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })} <span className="text-[10px] font-normal text-gray-400">Ha</span>
                        </td>
                        <td className="p-3 text-right text-gray-450 pr-3">-</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Bottom table info bar */}
              <div className="bg-gray-50 p-4 border-t border-gray-200 flex items-center gap-2 text-[11px] text-gray-500 font-sans font-medium">
                <Info className="w-4 h-4 text-blue-600" />
                <span>
                  *Perhitungan luas poligon gabungan (union) dilakukan secara real-time pada bola bumi WGS84
                  menggunakan proyeksi <b>Cylindrical Equal Area (CEA)</b> yang akurat secara luas ruang geografis.
                </span>
              </div>
            </div>
          </div>
        )}
      </section>

            {/* SECTION II: Evidence Citra Satelit */}
            <section id="lbs-section-evidence" className="scroll-mt-32 space-y-5">
              <div className="border-b border-gray-200 pb-2 pt-4">
                <h3 className="text-xs font-black tracking-wider text-gray-400 uppercase flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center font-mono text-[10px] font-bold">II</span>
                  Verifikasi Fisik (Evidence Citra Satelit)
                </h3>
              </div>
              <EvidenceTab
            lbsRaw={lbsRaw}
            lbsSamples={lbsSamples}
            fields={fields}
            onLoadSampleData={handleLoadSampleData}
              />
            </section>

            {/* SECTION III: Data Perizinan & Hak Tanah */}
            <section id="lbs-section-rights" className="scroll-mt-32 space-y-5">
              <div className="border-b border-gray-200 pb-2 pt-4">
                <h3 className="text-xs font-black tracking-wider text-gray-400 uppercase flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center font-mono text-[10px] font-bold">III</span>
                  Audit Hak Atas Tanah & Perizinan KKPR
                </h3>
              </div>
              <RightsTab
            lbsRaw={lbsRaw}
            onUpdateExcludeStats={(newStats) => {
              setRightsStats(newStats);
            }}
              />
            </section>

            {/* SECTION IV: Unduh Dokumen */}
            <section id="lbs-section-download" className="scroll-mt-32 space-y-5">
              <div className="border-b border-gray-200 pb-2 pt-4">
                <h3 className="text-xs font-black tracking-wider text-gray-400 uppercase flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center font-mono text-[10px] font-bold">IV</span>
                  Penyusunan Berkas & Unduh Laporan Resmi LP2B
                </h3>
              </div>
              <DownloadDocTab
            countyName={countyName}
            lbsRaw={lbsRaw}
            rtrwRaw={rtrwRaw}
            evidenceCount={lbsSamples.length}
            polaRuangStats={{
              passesHa: stats.accommodatedSawah,
              passesPct: stats.accommodatedPercent,
              failsHa: stats.totalSawah - stats.accommodatedSawah,
              failsPct: 100 - stats.accommodatedPercent
            }}
            rightsStats={rightsStats}
          />
        </section>
      </div>
  </main>

      <footer className="mt-auto border-t border-gray-200 p-6 bg-white text-center text-gray-500 text-[11px]" id="footer">
        <div className="max-w-7xl mx-auto space-y-1">
          <p className="font-medium text-gray-700">
            Pemeriksaan Mandiri Rencana Tata Ruang (RTRW) dan Sinkronisasi Lahan Baku Sawah Kabupaten/Kota.
          </p>
          <p className="text-[10px] text-gray-400">
             Dioptimalkan untuk analisis Moratorium Bebas Alih Fungsi Lahan Pertanian Pangan Berkelanjutan (KP2B).
          </p>
        </div>
      </footer>
    </div>
  );
}