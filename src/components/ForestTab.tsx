import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Upload,
  Play,
  CheckCircle2,
  AlertTriangle,
  Layers,
  Table,
  FileSpreadsheet,
  Download,
  Info,
  RefreshCw,
  Search,
  Check,
  AlertCircle,
  FileCheck,
  Compass,
  Globe,
} from 'lucide-react';
import { RawDataset } from '../types';
import { generateForestMockDatasets } from '../utils/spatial';
import ForestInteractiveMap from './ForestInteractiveMap';

interface ForestTabProps {
  countyName: string;
  sessionId?: string;
}

export default function ForestTab({ countyName: initialCountyName, sessionId }: ForestTabProps) {

  // Datasets State
  const [rtrwRaw, setRtrwRaw] = useState<RawDataset | null>(null);
  const [hutanRaw, setHutanRaw] = useState<RawDataset | null>(null);

  // Field Mapping State
  const [fields, setFields] = useState({
    polaRuangField: '',
    fungsikwsField: '',
  });

  // Calculation Progress / Outputs
  const [isCalculating, setIsCalculating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressPhase, setProgressPhase] = useState('');
  const [overlayResults, setOverlayResults] = useState<any[] | null>(null);

  // UI state for search & filtering
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'ALL' | 'SESUAI' | 'TIDAK SESUAI' | 'Perbedaan Geometri'>('ALL');

  // Column specific filters
  const [colFilterFungsikws, setColFilterFungsikws] = useState<string>('ALL');
  const [colFilterNamaHutan, setColFilterNamaHutan] = useState<string>('');
  const [colFilterPolaRuang, setColFilterPolaRuang] = useState<string>('');
  const [colFilterMinLuas, setColFilterMinLuas] = useState<string>('');
  const [colFilterStatus, setColFilterStatus] = useState<string>('ALL');
  const [colFilterKeterangan, setColFilterKeterangan] = useState<string>('');

  // Error/Status messages
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'info' | 'error' | 'warn' | null }>({
    text: '',
    type: null,
  });


  // Extract county name dynamically from loaded RTRW properties (just like LBS)
  const countyName = useMemo(() => {
    if (!rtrwRaw?.geojson?.features) return initialCountyName || 'Kabupaten';
    const freq: Record<string, number> = {};
    for (const f of rtrwRaw.geojson.features) {
      if (!f.properties) continue;
      const key = Object.keys(f.properties).find((k) => k.toLowerCase() === 'wadmkk');
      if (!key || !f.properties[key]) continue;
      const val = String(f.properties[key]).trim();
      if (val) freq[val] = (freq[val] ?? 0) + 1;
    }
    const topVal = Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!topVal) return initialCountyName || 'Kabupaten';

    // Normalize formatting
    let clean = topVal.replace(/^(kabupaten|kab|kota)\s+/gi, '').trim();
    if (topVal.toLowerCase().includes('kota')) {
      return `Kota ${clean}`;
    }
    return `Kabupaten ${clean}`;
  }, [rtrwRaw, initialCountyName]);

  // Handle file uploads
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>, type: 'rtrw' | 'hutan') => {
    const file = event.target.files?.[0];
    if (!file) return;

    setStatusMessage({ text: `Membaca file ${file.name}...`, type: 'info' });

    try {
      if (file.name.endsWith('.zip')) {
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

  const processIncomingDataset = (geojson: any, filename: string, type: 'rtrw' | 'hutan', file?: File) => {
    if (!geojson || !geojson.features) {
      setStatusMessage({ text: 'Data spasial tidak memiliki FeatureCollection yang valid.', type: 'error' });
      return;
    }

    const allKeys = new Set<string>();
    geojson.features.forEach((feature: any) => {
      if (feature.properties) {
        Object.keys(feature.properties).forEach((k) => allKeys.add(k));
      }
    });

    const fieldList = Array.from(allKeys);

    if (type === 'rtrw') {
      setRtrwRaw({ name: filename, geojson, fields: fieldList, file });
      const rtrwSel = fieldList.find((f) => {
        const lf = f.toLowerCase();
        return ['namobj', 'pola_ruang', 'pola ruang', 'fungsi', 'pola_ruang_id'].includes(lf);
      }) || fieldList[0] || '';
      setFields((prev) => ({ ...prev, polaRuangField: rtrwSel }));
      setStatusMessage({ text: `Berhasil memuat file RTRW: ${filename}`, type: 'success' });
    } else {
      setHutanRaw({ name: filename, geojson, fields: fieldList, file });
      const fungsikwsSel = fieldList.find((f) => {
        const lf = f.toLowerCase();
        return ['fungsikws', 'fungsi_kws', 'fungsi_kawasan', 'fungsikawasan', 'fungsikws_internal'].includes(lf);
      }) || fieldList[0] || '';
      setFields((prev) => ({ ...prev, fungsikwsField: fungsikwsSel }));
      setStatusMessage({ text: `Berhasil memuat file Kawasan Hutan: ${filename}`, type: 'success' });
    }
  };

  // Load forest simulation mock dataset
  const handleLoadMockData = () => {
    setStatusMessage({ text: 'Memuat data simulasi Kawasan Hutan Kabupaten Maros...', type: 'info' });
    const { rtrw, hutan } = generateForestMockDatasets();

    processIncomingDataset(rtrw, 'RTRW_Kab_Maros_Kawasan.geojson', 'rtrw');
    processIncomingDataset(hutan, 'Kawasan_Hutan_KemenLHK_Maros.geojson', 'hutan');

    setFields({
      polaRuangField: 'NAMOBJ',
      fungsikwsField: 'FUNGSIKWS',
    });

    setStatusMessage({ text: 'Data simulasi Kawasan Hutan berhasil dimuat!', type: 'success' });
  };

  // ─── Perform spatial overlay via PostGIS Database Engine ──────────────────
  const runForestAnalysis = async () => {
    if (!rtrwRaw || !hutanRaw) {
      setStatusMessage({ text: 'Harap unggah kedua file RTRW dan Hutan sebelum memulai analisis.', type: 'warn' });
      return;
    }
    if (!fields.polaRuangField || !fields.fungsikwsField) {
      setStatusMessage({ text: 'Harap tentukan pemetaan atribut (field) untuk kedua file terlebih dahulu.', type: 'warn' });
      return;
    }

    setIsCalculating(true);
    setProgress(10);
    setProgressPhase('Mengunggah data RTRW...');
    setStatusMessage({ text: 'Mengunggah data RTRW ke database PostGIS...', type: 'info' });

    try {
      // Step A: Upload RTRW Staging
      let uploadRes;
      if (rtrwRaw.file) {
        uploadRes = await fetch(`/api/spatial/upload-file?sessionId=${sessionId}&type=rtrw&namobjField=${fields.polaRuangField}`, {
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
              KP2B_INTERNAL: ''
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
      setProgressPhase('Mengunggah data Hutan...');
      setStatusMessage({ text: 'Mengunggah data Kawasan Hutan ke database PostGIS...', type: 'info' });

      // Step B: Upload Hutan Staging
      if (hutanRaw.file) {
        uploadRes = await fetch(`/api/spatial/upload-file?sessionId=${sessionId}&type=hutan&fungsikwsField=${fields.fungsikwsField}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: hutanRaw.file
        });
      } else {
        const hutanFormatted = {
          type: 'FeatureCollection',
          features: hutanRaw.geojson.features.map((f: any) => ({
            ...f,
            properties: {
              NAMOBJ_INTERNAL: f.properties?.['NAMOBJ'] || f.properties?.['namobj'] || '',
              FUNGS_INTERNAL: f.properties?.[fields.fungsikwsField]
            }
          }))
        };

        uploadRes = await fetch('/api/spatial/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, type: 'hutan', geojson: hutanFormatted })
        });
      }
      if (!uploadRes.ok) throw new Error(`Upload Hutan gagal dengan status ${uploadRes.status}`);

      setProgress(70);
      setProgressPhase('Menjalankan overlay PostGIS...');
      setStatusMessage({ text: 'Menjalankan geoprocessing overlay di PostGIS server...', type: 'info' });

      // Step C: Execute PostGIS Overlay Forest
      const overlayRes = await fetch('/api/spatial/overlay-forest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId })
      });
      if (!overlayRes.ok) throw new Error(`Overlay Hutan gagal dengan status ${overlayRes.status}`);

      const overlayData = await overlayRes.json();
      if (overlayData.status === 'error') throw new Error(overlayData.message);

      setProgress(90);
      setProgressPhase('Mengolah hasil...');
      setOverlayResults(overlayData.results);

      setProgress(100);
      setProgressPhase('Selesai!');
      setStatusMessage({ text: 'Analisis penyandingan Kawasan Hutan PostGIS selesai dihitung dengan sukses!', type: 'success' });
    } catch (err: any) {
      console.error('PostGIS Forest Overlay Error:', err);
      setStatusMessage({ text: `Analisis PostGIS gagal: ${err.message || String(err)}`, type: 'error' });
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

  // Compute Statistics based on overlay results
  const stats = useMemo(() => {
    if (!overlayResults) return { totalOverlap: 0, sesuai: 0, tidakSesuai: 0, perbedaanGeometri: 0, compliancePct: 100 };

    let totalOverlap = 0;
    let sesuai = 0;
    let tidakSesuai = 0;
    let perbedaanGeometri = 0;

    overlayResults.forEach((r) => {
      totalOverlap += r.luasOverlay;
      if (r.status === 'SESUAI') sesuai += r.luasOverlay;
      else if (r.status === 'TIDAK SESUAI') tidakSesuai += r.luasOverlay;
      else perbedaanGeometri += r.luasOverlay;
    });

    const compliancePct = totalOverlap > 0 ? (sesuai / (totalOverlap - perbedaanGeometri)) * 100 : 100;

    return {
      totalOverlap,
      sesuai,
      tidakSesuai,
      perbedaanGeometri,
      compliancePct: isNaN(compliancePct) ? 100 : compliancePct,
    };
  }, [overlayResults]);

  // Filter & Search table results with column-specific filters
  const filteredTableData = useMemo(() => {
    if (!overlayResults) return [];

    return overlayResults.filter((r) => {
      // Global filters
      const matchSearch =
        !searchQuery ||
        r.namobjPolaRuang.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (r.deskripsiHutan || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.namaObjekHutan.toLowerCase().includes(searchQuery.toLowerCase());

      const matchFilter = filterStatus === 'ALL' || r.status === filterStatus;

      // Column-specific filters
      const matchColFungsikws =
        colFilterFungsikws === 'ALL' ||
        r.kodeFungsikws === colFilterFungsikws;

      const matchColNamaHutan =
        !colFilterNamaHutan ||
        r.namaObjekHutan.toLowerCase().includes(colFilterNamaHutan.toLowerCase());

      const matchColPolaRuang =
        !colFilterPolaRuang ||
        r.namobjPolaRuang.toLowerCase().includes(colFilterPolaRuang.toLowerCase());

      const matchColMinLuas = (() => {
        if (!colFilterMinLuas) return true;
        const val = parseFloat(colFilterMinLuas);
        if (isNaN(val)) return true;
        return r.luasOverlay >= val;
      })();

      const matchColStatus =
        colFilterStatus === 'ALL' ||
        r.status === colFilterStatus;

      const matchColKeterangan =
        !colFilterKeterangan ||
        (r.keterangan || '').toLowerCase().includes(colFilterKeterangan.toLowerCase());

      return (
        matchSearch &&
        matchFilter &&
        matchColFungsikws &&
        matchColNamaHutan &&
        matchColPolaRuang &&
        matchColMinLuas &&
        matchColStatus &&
        matchColKeterangan
      );
    });
  }, [
    overlayResults,
    searchQuery,
    filterStatus,
    colFilterFungsikws,
    colFilterNamaHutan,
    colFilterPolaRuang,
    colFilterMinLuas,
    colFilterStatus,
    colFilterKeterangan,
  ]);

  // Dynamic list of unique Fungsi Kawasan Hutan in the dataset for the select filter
  const uniqueFungsikwsOptions = useMemo(() => {
    if (!overlayResults) return [];
    const map = new Map<string, { desc: string; alias: string }>();
    overlayResults.forEach((r) => {
      if (r.kodeFungsikws) {
        map.set(r.kodeFungsikws, {
          desc: r.deskripsiHutan || 'Belum terdefinisi',
          alias: r.aliasHutan || '',
        });
      }
    });
    return Array.from(map.entries())
      .map(([code, data]) => ({
        code,
        label: `${code} - ${data.alias ? data.alias + ' (' + data.desc + ')' : data.desc}`,
      }))
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [overlayResults]);

  // Indicator if any column filter or global filter is active
  const hasActiveColFilters = useMemo(() => {
    return (
      colFilterFungsikws !== 'ALL' ||
      colFilterNamaHutan !== '' ||
      colFilterPolaRuang !== '' ||
      colFilterMinLuas !== '' ||
      colFilterStatus !== 'ALL' ||
      colFilterKeterangan !== '' ||
      searchQuery !== '' ||
      filterStatus !== 'ALL'
    );
  }, [
    colFilterFungsikws,
    colFilterNamaHutan,
    colFilterPolaRuang,
    colFilterMinLuas,
    colFilterStatus,
    colFilterKeterangan,
    searchQuery,
    filterStatus,
  ]);

  // Pivot and group filtered data for simple aggregated display matching the example image
  const pivotedTableData = useMemo(() => {
    if (!filteredTableData) return [];

    const map = new Map<string, any>();
    filteredTableData.forEach((row) => {
      const fungsikws = row.kodeFungsikws || '000000';
      const deskripsi = row.deskripsiHutan || 'Belum terdefinisi';
      const alias = row.aliasHutan || '';
      const namaHutan = row.namaObjekHutan || '-';
      const polaRuang = row.namobjPolaRuang || '-';
      const status = row.status || 'Perbedaan Geometri';
      const keterangan = row.keterangan || '';

      const key = `${fungsikws}|||${namaHutan}|||${polaRuang}|||${status}`;
      if (map.has(key)) {
        const existing = map.get(key)!;
        existing.luasOverlay += row.luasOverlay;
      } else {
        map.set(key, {
          kodeFungsikws: fungsikws,
          deskripsiHutan: deskripsi,
          aliasHutan: alias,
          namaObjekHutan: namaHutan,
          namobjPolaRuang: polaRuang,
          luasOverlay: row.luasOverlay,
          status: status,
          keterangan: keterangan,
        });
      }
    });

    const aggregatedRows = Array.from(map.values());

    // Sort matching the example image
    aggregatedRows.sort((a, b) => {
      if (a.kodeFungsikws !== b.kodeFungsikws) {
        return a.kodeFungsikws.localeCompare(b.kodeFungsikws);
      }
      if (a.namaObjekHutan !== b.namaObjekHutan) {
        if (a.namaObjekHutan === '-') return -1;
        if (b.namaObjekHutan === '-') return 1;
        return a.namaObjekHutan.localeCompare(b.namaObjekHutan);
      }
      return a.namobjPolaRuang.localeCompare(b.namobjPolaRuang);
    });

    // Compute rowspans
    let i = 0;
    while (i < aggregatedRows.length) {
      let fungsikwsCount = 1;
      let j = i + 1;
      while (j < aggregatedRows.length && aggregatedRows[j].kodeFungsikws === aggregatedRows[i].kodeFungsikws) {
        fungsikwsCount++;
        j++;
      }

      aggregatedRows[i].fungsikwsSpan = fungsikwsCount;
      for (let k = i + 1; k < j; k++) {
        aggregatedRows[k].fungsikwsSpan = 0;
      }

      // Calculate namaHutanSpan within the fungsikws group
      let subI = i;
      while (subI < j) {
        let namaHutanCount = 1;
        let subJ = subI + 1;
        while (subJ < j && aggregatedRows[subJ].namaObjekHutan === aggregatedRows[subI].namaObjekHutan) {
          namaHutanCount++;
          subJ++;
        }
        aggregatedRows[subI].namaHutanSpan = namaHutanCount;
        for (let k = subI + 1; k < subJ; k++) {
          aggregatedRows[k].namaHutanSpan = 0;
        }
        subI = subJ;
      }

      i = j;
    }

    return aggregatedRows;
  }, [filteredTableData]);

  const totalLuasSum = useMemo(() => {
    return pivotedTableData.reduce((sum, r) => sum + r.luasOverlay, 0);
  }, [pivotedTableData]);

  // Export Results to CSV (pivoted matching the table display)
  const exportToCSV = () => {
    if (!pivotedTableData) return;
    let csvContent = 'data:text/csv;charset=utf-8,';
    csvContent += 'Fungsi Kawasan Hutan,Nama Hutan,Rencana Pola Ruang,Luas (Ha),Status Audit,Keterangan\r\n';

    pivotedTableData.forEach((row) => {
      const cleanName = row.namaObjekHutan === '-' ? '-' : row.namaObjekHutan;
      const aliasStr = row.aliasHutan ? ` (${row.aliasHutan})` : '';
      csvContent += `"${row.kodeFungsikws}${aliasStr} - ${row.deskripsiHutan}","${cleanName}","${row.namobjPolaRuang}",${row.luasOverlay},"${row.status === 'SESUAI' ? 'Sesuai' : 'Tidak sesuai'}","${row.keterangan}"\r\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Laporan_Pivoted_Sinkronisasi_Kawasan_Hutan_${countyName.replace(/\s+/g, '_')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6 animate-feedin" id="forest-tab-module">
      {/* Description Panel */}
      <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-6" id="forest-intro-panel">
        <div className="space-y-1.5 max-w-3xl">
          <div className="flex items-center gap-2 text-indigo-700">
            <Compass className="w-5 h-5 text-indigo-600" />
            <h2 className="text-lg font-extrabold tracking-tight font-display text-gray-900">
              Sinkronisasi Rencana Pola Ruang dengan Fungsi Kawasan Hutan
            </h2>
          </div>
          <p className="text-xs text-gray-500 leading-relaxed">
            Menjalankan analisis tumpang susun (*Union Geoprocessing*) real-time antara draft Rencana Pola Ruang (RTRW/RDTR) dengan Peta Batas Kawasan Hutan resmi Kementerian Lingkungan Hidup dan Kehutanan (KemenLHK). Atribut fungsi kawasan hutan dievaluasi berdasarkan field <b className="font-mono text-indigo-600 bg-indigo-50 px-1 py-0.5 rounded text-[10px]">FUNGSIKWS</b> untuk mendeteksi kesesuaian spasial secara hukum dan tata ruang.
          </p>
        </div>
        <button
          onClick={handleLoadMockData}
          className="px-4 py-2 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 text-indigo-700 rounded-lg text-xs font-bold transition-all flex items-center gap-2 cursor-pointer shrink-0"
          id="btn-load-forest-mock"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Muat Data Simulasi Maros</span>
        </button>
      </div>

      {/* Dataset Inputs & Parameters */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6" id="forest-inputs-row">
        {/* Dataset 1: Pola Ruang */}
        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-xs flex flex-col justify-between space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between border-b border-gray-100 pb-2">
              <span className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span>
                Pola Ruang (RTRW / RDTR)
              </span>
              {rtrwRaw && (
                <span className="text-[10px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded font-extrabold flex items-center gap-1">
                  <Check className="w-3 h-3 text-emerald-600" />
                  Loaded
                </span>
              )}
            </div>
            <p className="text-[10px] text-gray-400">Peta rencana tata ruang wilayah kabupaten/kota.</p>
            {rtrwRaw ? (
              <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200 text-[11px] space-y-1.5">
                <p className="font-semibold text-gray-700 truncate">{rtrwRaw.name}</p>
                <p className="text-gray-400 text-[10px]">{rtrwRaw.geojson.features.length} poligon terdeteksi</p>
                <div className="pt-2">
                  <label className="text-[10px] font-bold text-gray-500 block mb-1">Pilih Atribut Pola Ruang:</label>
                  <select
                    value={fields.polaRuangField}
                    onChange={(e) => setFields((prev) => ({ ...prev, polaRuangField: e.target.value }))}
                    className="w-full bg-white border border-gray-300 rounded p-1 text-[11px] font-medium"
                  >
                    {rtrwRaw.fields.map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </div>
              </div>
            ) : (
              <div className="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center hover:bg-slate-50/50 transition-all relative">
                <input
                  type="file"
                  onChange={(e) => handleFileUpload(e, 'rtrw')}
                  accept=".geojson,.json,.zip"
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <Upload className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                <p className="text-xs font-bold text-gray-600">Pilih berkas Pola Ruang</p>
                <p className="text-[9px] text-gray-400 mt-1">Mendukung GeoJSON atau Shapefile ZIP</p>
              </div>
            )}
          </div>
        </div>

        {/* Dataset 2: Batas Kawasan Hutan */}
        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-xs flex flex-col justify-between space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between border-b border-gray-100 pb-2">
              <span className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-green-600"></span>
                Kawasan Hutan (KemenLHK)
              </span>
              {hutanRaw && (
                <span className="text-[10px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded font-extrabold flex items-center gap-1">
                  <Check className="w-3 h-3 text-emerald-600" />
                  Loaded
                </span>
              )}
            </div>
            <p className="text-[10px] text-gray-400">Peta batas resmi kawasan hutan negara KLHK.</p>
            {hutanRaw ? (
              <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200 text-[11px] space-y-1.5">
                <p className="font-semibold text-gray-700 truncate">{hutanRaw.name}</p>
                <p className="text-gray-400 text-[10px]">{hutanRaw.geojson.features.length} poligon terdeteksi</p>
                <div className="pt-2">
                  <label className="text-[10px] font-bold text-gray-500 block mb-1">Pilih Atribut FUNGSIKWS:</label>
                  <select
                    value={fields.fungsikwsField}
                    onChange={(e) => setFields((prev) => ({ ...prev, fungsikwsField: e.target.value }))}
                    className="w-full bg-white border border-gray-300 rounded p-1 text-[11px] font-mono font-bold"
                  >
                    {hutanRaw.fields.map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </div>
              </div>
            ) : (
              <div className="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center hover:bg-slate-50/50 transition-all relative">
                <input
                  type="file"
                  onChange={(e) => handleFileUpload(e, 'hutan')}
                  accept=".geojson,.json,.zip"
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <Upload className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                <p className="text-xs font-bold text-gray-600">Pilih berkas Batas Hutan</p>
                <p className="text-[9px] text-gray-400 mt-1">Mendukung GeoJSON atau Shapefile ZIP</p>
              </div>
            )}
          </div>
        </div>

        {/* Action Panel & Progress */}
        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-xs flex flex-col justify-center space-y-4">
          <div className="text-center space-y-3">
            <span className="text-xs font-extrabold text-gray-800 block">Status Operasi Geoprocessing</span>
            
            {isCalculating ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[11px] font-bold text-indigo-700">
                  <span className="flex items-center gap-1.5 animate-pulse">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Processing Union...</span>
                  </span>
                  <span>{progress}%</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden border border-gray-200">
                  <div
                    className="bg-indigo-600 h-full rounded-full transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="text-[10px] text-gray-400 italic text-left truncate">
                  Fase: {progressPhase}
                </p>
              </div>
            ) : (
              <button
                onClick={runForestAnalysis}
                disabled={isCalculating || !rtrwRaw || !hutanRaw}
                className={`w-full py-3 px-4 rounded-xl font-bold text-xs flex items-center justify-center gap-2 cursor-pointer shadow-md transition-all ${
                  isCalculating || !rtrwRaw || !hutanRaw
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed border border-gray-200 shadow-none'
                    : 'bg-indigo-600 text-white hover:bg-indigo-700 hover:shadow-lg'
                }`}
                id="btn-run-forest-analysis"
              >
                <Play className="w-4 h-4" />
                <span>JALANKAN SINKRONISASI KAWASAN HUTAN</span>
              </button>
            )}

            {/* Quick status bar */}
            {statusMessage.text && (
              <div className={`p-2.5 rounded-lg border text-[10px] font-medium flex items-start gap-2 text-left ${
                statusMessage.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' :
                statusMessage.type === 'error' ? 'bg-rose-50 border-rose-200 text-rose-800' :
                statusMessage.type === 'warn' ? 'bg-amber-50 border-amber-200 text-amber-800' :
                'bg-blue-50 border-blue-200 text-blue-800'
              }`}>
                {statusMessage.type === 'success' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />}
                {statusMessage.type === 'error' && <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />}
                {statusMessage.type === 'warn' && <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />}
                {statusMessage.type === 'info' && <Info className="w-3.5 h-3.5 text-blue-600 shrink-0" />}
                <span className="leading-normal">{statusMessage.text}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {overlayResults && (
        <>
          {/* Key Metrics Row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4" id="forest-kpis-grid">
            <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-xs space-y-1">
              <span className="text-[10px] font-black tracking-wider uppercase text-gray-400 font-sans block">
                Total Overlap Teranalisis
              </span>
              <p className="text-xl font-black text-gray-900 font-mono">
                {stats.totalOverlap.toLocaleString('id-ID', { maximumFractionDigits: 2 })}
                <span className="text-xs font-medium text-gray-400 ml-1">Ha</span>
              </p>
              <span className="text-[9px] text-gray-400 font-medium block">
                Seluruh tumpang susun wilayah
              </span>
            </div>

            <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-xs space-y-1 border-l-4 border-l-emerald-500">
              <span className="text-[10px] font-black tracking-wider uppercase text-emerald-600 font-sans block">
                Luas Sesuai (Zonasi)
              </span>
              <p className="text-xl font-black text-emerald-700 font-mono">
                {stats.sesuai.toLocaleString('id-ID', { maximumFractionDigits: 2 })}
                <span className="text-xs font-medium text-emerald-500 ml-1">Ha</span>
              </p>
              <span className="text-[9px] text-emerald-600 font-bold block">
                {stats.totalOverlap > 0 ? ((stats.sesuai / stats.totalOverlap) * 100).toFixed(1) : '100'}% dari total tumpang susun
              </span>
            </div>

            <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-xs space-y-1 border-l-4 border-l-rose-500">
              <span className="text-[10px] font-black tracking-wider uppercase text-rose-600 font-sans block">
                Luas Tidak Sesuai
              </span>
              <p className="text-xl font-black text-rose-700 font-mono">
                {stats.tidakSesuai.toLocaleString('id-ID', { maximumFractionDigits: 2 })}
                <span className="text-xs font-medium text-rose-500 ml-1">Ha</span>
              </p>
              <span className="text-[9px] text-rose-600 font-bold block">
                {stats.totalOverlap > 0 ? ((stats.tidakSesuai / stats.totalOverlap) * 100).toFixed(1) : '0'}% butuh koreksi zonasi
              </span>
            </div>

            <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-xs space-y-1 border-l-4 border-l-indigo-500">
              <span className="text-[10px] font-black tracking-wider uppercase text-indigo-600 font-sans block">
                Indeks Keselarasan Spasial
              </span>
              <p className="text-xl font-black text-indigo-700 font-mono">
                {stats.compliancePct.toFixed(2)}
                <span className="text-xs font-medium text-indigo-500 ml-1">%</span>
              </p>
              <div className="w-full bg-gray-100 h-1.5 rounded-full overflow-hidden mt-1">
                <div className="h-full bg-indigo-600" style={{ width: `${stats.compliancePct}%` }} />
              </div>
            </div>
          </div>

          {/* Interactive Map */}
          <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-xs space-y-3" id="forest-map-wrapper">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-extrabold text-gray-800 flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-indigo-500" />
                Delineasi Spasial Kesesuaian Rencana Tata Ruang vs Kawasan Hutan
              </span>
              <span className="text-[10px] text-gray-400 font-medium">
                Pilih filter di kiri peta untuk melihat detail per layer
              </span>
            </div>
            <ForestInteractiveMap
              rtrwData={rtrwRaw?.geojson || null}
              hutanData={hutanRaw?.geojson || null}
              overlayData={overlayResults}
              rtrwField={fields.polaRuangField}
              fungsikwsField={fields.fungsikwsField}
            />
          </div>

          {/* Results Table & Filters */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden" id="forest-results-table-panel">
            <div className="p-5 border-b border-gray-200 bg-slate-50/50 flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="space-y-1 w-full md:w-auto">
                <h3 className="text-sm font-extrabold text-gray-900 flex items-center gap-1.5">
                  <Table className="w-4 h-4 text-gray-700" />
                  Rincian Hasil Overlay Union & Audit Keselarasan Hukum
                </h3>
                <p className="text-[10px] text-gray-400">Menampilkan detail plot overlap poligon beserta analisis kecocokan hukum kehutanan.</p>
              </div>

              {/* Filters */}
              <div className="flex flex-wrap items-center gap-3 w-full md:w-auto shrink-0">
                {/* Search */}
                <div className="relative max-w-xs w-full">
                  <Search className="w-4 h-4 text-gray-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    placeholder="Cari Pola Ruang / Hutan..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9 pr-4 py-2 bg-white border border-gray-300 rounded-lg text-xs font-medium w-full"
                  />
                </div>

                {/* Status Filter */}
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value as any)}
                  className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-xs font-semibold"
                >
                  <option value="ALL">Semua Status</option>
                  <option value="SESUAI">Zonasi Sesuai</option>
                  <option value="TIDAK SESUAI">Tidak Sesuai</option>
                  <option value="Perbedaan Geometri">Perbedaan Geometri</option>
                </select>

                {/* Reset Filters */}
                {hasActiveColFilters && (
                  <button
                    onClick={() => {
                      setColFilterFungsikws('ALL');
                      setColFilterNamaHutan('');
                      setColFilterPolaRuang('');
                      setColFilterMinLuas('');
                      setColFilterStatus('ALL');
                      setColFilterKeterangan('');
                      setSearchQuery('');
                      setFilterStatus('ALL');
                    }}
                    className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-lg flex items-center gap-1.5 cursor-pointer border border-slate-300 transition-colors"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Reset Filter</span>
                  </button>
                )}

                {/* Export CSV */}
                <button
                  onClick={exportToCSV}
                  className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>Ekspor CSV</span>
                </button>
              </div>
            </div>

            {/* Table stage */}
            <div className="overflow-x-auto border border-gray-200 rounded-lg">
              <table className="w-full text-left text-xs font-sans border-collapse">
                <thead>
                  <tr className="bg-slate-100 text-gray-700 border-b border-gray-300 font-bold uppercase tracking-wider text-[10px]">
                    <th className="p-3 border-r border-gray-200">Fungsi Kawasan Hutan</th>
                    <th className="p-3 border-r border-gray-200">Nama Hutan</th>
                    <th className="p-3 border-r border-gray-200">Rencana Pola Ruang</th>
                    <th className="p-3 text-right border-r border-gray-200">Luas</th>
                    <th className="p-3 text-center border-r border-gray-200">Status Audit</th>
                    <th className="p-3">Keterangan</th>
                  </tr>
                  {/* Interactive Column Filters */}
                  <tr className="bg-slate-50 border-b border-gray-300">
                    {/* Fungsi Kawasan Hutan filter */}
                    <th className="p-2 border-r border-gray-200">
                      <select
                        value={colFilterFungsikws}
                        onChange={(e) => setColFilterFungsikws(e.target.value)}
                        className="w-full p-1 bg-white border border-gray-300 rounded text-[11px] font-medium text-gray-700 focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
                      >
                        <option value="ALL">Semua</option>
                        {uniqueFungsikwsOptions.map((opt) => (
                          <option key={opt.code} value={opt.code}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </th>

                    {/* Nama Hutan filter */}
                    <th className="p-2 border-r border-gray-200">
                      <input
                        type="text"
                        value={colFilterNamaHutan}
                        onChange={(e) => setColFilterNamaHutan(e.target.value)}
                        placeholder="Filter nama..."
                        className="w-full p-1 bg-white border border-gray-300 rounded text-[11px] font-medium text-gray-700 placeholder-gray-400 focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
                      />
                    </th>

                    {/* Rencana Pola Ruang filter */}
                    <th className="p-2 border-r border-gray-200">
                      <input
                        type="text"
                        value={colFilterPolaRuang}
                        onChange={(e) => setColFilterPolaRuang(e.target.value)}
                        placeholder="Filter pola..."
                        className="w-full p-1 bg-white border border-gray-300 rounded text-[11px] font-medium text-gray-700 placeholder-gray-400 focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
                      />
                    </th>

                    {/* Luas filter */}
                    <th className="p-2 border-r border-gray-200">
                      <input
                        type="number"
                        step="any"
                        value={colFilterMinLuas}
                        onChange={(e) => setColFilterMinLuas(e.target.value)}
                        placeholder=">= Luas (Ha)"
                        className="w-full p-1 bg-white border border-gray-300 rounded text-[11px] font-medium text-gray-700 placeholder-gray-400 text-right focus:outline-hidden focus:ring-1 focus:ring-indigo-500 font-mono"
                      />
                    </th>

                    {/* Status Audit filter */}
                    <th className="p-2 border-r border-gray-200">
                      <select
                        value={colFilterStatus}
                        onChange={(e) => setColFilterStatus(e.target.value)}
                        className="w-full p-1 bg-white border border-gray-300 rounded text-[11px] font-medium text-gray-700 focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
                      >
                        <option value="ALL">Semua</option>
                        <option value="SESUAI">Sesuai</option>
                        <option value="TIDAK SESUAI">Tidak sesuai</option>
                        <option value="Perbedaan Geometri">Perbedaan Geometri</option>
                      </select>
                    </th>

                    {/* Keterangan filter */}
                    <th className="p-2">
                      <input
                        type="text"
                        value={colFilterKeterangan}
                        onChange={(e) => setColFilterKeterangan(e.target.value)}
                        placeholder="Filter ket..."
                        className="w-full p-1 bg-white border border-gray-300 rounded text-[11px] font-medium text-gray-700 placeholder-gray-400 focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
                      />
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {pivotedTableData.length > 0 ? (
                    pivotedTableData.map((row, idx) => (
                      <tr
                        key={idx}
                        className={`hover:bg-slate-50/50 transition-colors ${
                          row.status === 'SESUAI' ? 'bg-emerald-50/5' :
                          row.status === 'TIDAK SESUAI' ? 'bg-rose-50/5' :
                          'bg-amber-50/5'
                        }`}
                      >
                        {/* Fungsi Kawasan Hutan column with rowspan */}
                        {row.fungsikwsSpan !== 0 && (
                          <td
                            className="p-3 bg-slate-50/40 border-r border-gray-200 align-middle text-center"
                            rowSpan={row.fungsikwsSpan}
                          >
                            <div className="flex flex-col items-center justify-center gap-1.5">
                              <span className="font-mono text-xs font-bold text-gray-800 bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200">
                                {row.kodeFungsikws}
                              </span>
                              {row.aliasHutan && (
                                <span className="font-sans text-[10px] font-extrabold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100">
                                  {row.aliasHutan}
                                </span>
                              )}
                              <div className="text-[10px] text-gray-600 font-bold leading-normal max-w-[125px] mx-auto whitespace-normal">
                                {row.deskripsiHutan}
                              </div>
                            </div>
                          </td>
                        )}

                        {/* Nama Hutan column with rowspan */}
                        {row.namaHutanSpan !== 0 && (
                          <td
                            className="p-3 font-bold text-gray-700 bg-slate-50/10 border-r border-gray-200 align-middle"
                            rowSpan={row.namaHutanSpan}
                          >
                            {row.namaObjekHutan}
                          </td>
                        )}

                        {/* Rencana Pola Ruang */}
                        <td className="p-3 text-gray-900 font-medium border-r border-gray-200">
                          {row.namobjPolaRuang}
                        </td>

                        {/* Luas Overlap */}
                        <td className="p-3 text-right font-mono font-bold text-gray-900 border-r border-gray-200">
                          {row.luasOverlay.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>

                        {/* Status Audit */}
                        <td className="p-3 text-center border-r border-gray-200">
                          <span className={`inline-flex px-2 py-0.5 rounded text-[9px] font-black ${
                            row.status === 'SESUAI' ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' :
                            row.status === 'TIDAK SESUAI' ? 'bg-rose-100 text-rose-800 border border-rose-200' :
                            'bg-amber-100 text-amber-800 border border-amber-200'
                          }`}>
                            {row.status === 'SESUAI' ? 'Sesuai' : 'Tidak sesuai'}
                          </span>
                        </td>

                        {/* Keterangan */}
                        <td className="p-3 text-gray-500 font-medium text-[11px] leading-relaxed max-w-sm">
                          {row.keterangan || '-'}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-gray-400 font-medium font-sans">
                        Tidak ada data yang memenuhi kriteria pencarian / filter.
                      </td>
                    </tr>
                  )}
                </tbody>
                {pivotedTableData.length > 0 && (
                  <tfoot>
                    <tr className="bg-slate-100 text-gray-950 font-black border-t-2 border-gray-300">
                      <td colSpan={3} className="p-3 text-left font-black uppercase tracking-wider text-[10px]">
                        Grand Total
                      </td>
                      <td className="p-3 text-right font-mono font-black border-r border-gray-200">
                        {totalLuasSum.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td colSpan={2} className="p-3 bg-slate-50/30"></td>
                    </tr>
                    <tr className="bg-slate-100 text-gray-950 font-black border-t border-gray-300">
                      <td colSpan={3} className="p-3 text-left font-black uppercase tracking-wider text-[10px]">
                        Grand Total (Format Desimal)
                      </td>
                      <td className="p-3 text-right font-mono font-black border-r border-gray-200">
                        {totalLuasSum.toFixed(4).replace('.', ',')}
                      </td>
                      <td colSpan={2} className="p-3 bg-slate-50/30"></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            {/* Bottom info banner */}
            <div className="bg-slate-50 p-4 border-t border-gray-200 flex items-center gap-2 text-[10px] text-gray-500 leading-normal font-medium">
              <Info className="w-4 h-4 text-indigo-600 shrink-0" />
              <span>
                *Aturan kesesuaian mengacu pada integrasi Peraturan Menteri Kehutanan, Undang-Undang No. 41 Tahun 1999 tentang Kehutanan, serta pedoman KP2B/LP2B pusat. Seluruh perhitungan luas poligon menggunakan model proyeksi <b>Cylindrical Equal Area (CEA)</b>.
              </span>
            </div>
          </div>


        </>
      )}
    </div>
  );
}
