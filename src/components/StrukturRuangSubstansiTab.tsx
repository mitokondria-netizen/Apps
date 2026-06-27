import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import { extractDocxTextWithListNumbers } from '../docxReader';
import { 
  Upload, 
  FileSpreadsheet, 
  FileText, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  Info, 
  RefreshCw, 
  Search, 
  SlidersHorizontal, 
  ChevronRight, 
  ChevronDown, 
  Layers, 
  CheckCircle,
  AlertCircle
} from 'lucide-react';
import { 
  StrukturConsistencyResult, 
  StrukturSummaryStats, 
  StrukturPivotItem 
} from '../../utils/types';
import { 
  analyzeStrukturConsistency, 
  parseStrukturPivotExcel 
} from '../../utils/utils';
import { 
  RAW_STRUKTUR_DEMO_TEXT, 
  STRUKTUR_PIVOT_DEMO_DATA 
} from '../demoData';

export default function StrukturRuangSubstansiTab() {
  const [ranperdaText, setRanperdaText] = useState<string>("");
  const [ranperdaFileName, setRanperdaFileName] = useState<string>("");
  const [pivotData, setPivotData] = useState<Record<string, StrukturPivotItem>>({});
  const [pivotFileName, setPivotFileName] = useState<string>("");

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [isDemoMode, setIsDemoMode] = useState<boolean>(false);

  const [analysisResults, setAnalysisResults] = useState<StrukturConsistencyResult[] | null>(null);
  const [analysisStats, setAnalysisStats] = useState<StrukturSummaryStats | null>(null);
  const [countyName, setCountyName] = useState<string>("");
  const [selectedSubTab, setSelectedSubTab] = useState<'laporan' | 'catatan' | 'pivot'>('laporan');

  // Search/Filters states
  const [jenisFilter, setJenisFilter] = useState<string>('Semua');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [collapsedNodes, setCollapsedNodes] = useState<Record<string, boolean>>({});

  const toggleNode = (key: string) => {
    setCollapsedNodes(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const handleRanperdaUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.docx')) {
      setErrorMessage("Format file tidak didukung. Harap unggah draf Ranperda dalam format .docx");
      return;
    }
    setErrorMessage("");
    setIsLoading(true);
    setStatusMessage("Mengekstrak teks mentah dari dokumen Ranperda .docx...");

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const arrayBuffer = e.target?.result as ArrayBuffer;
        let text: string;
        try {
          text = await extractDocxTextWithListNumbers(arrayBuffer);
        } catch (numberingErr) {
          console.warn("Gagal memulihkan penomoran otomatis, fallback ke ekstraksi teks polos:", numberingErr);
          const result = await mammoth.extractRawText({ arrayBuffer });
          text = result.value;
        }
        setRanperdaText(text);
        setRanperdaFileName(file.name);
        setIsDemoMode(false);
        setIsLoading(false);
      } catch (err: any) {
        console.error(err);
        setErrorMessage("Gagal memproses draf Ranperda .docx. Silakan pastikan file tidak rusak.");
        setIsLoading(false);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handlePivotUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
      setErrorMessage("Format file tidak didukung. Harap unggah data Pivot dalam format .xlsx atau .xls");
      return;
    }
    setErrorMessage("");
    setIsLoading(true);
    setStatusMessage("Mengurai pivot tabel GIS Struktur Ruang...");

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const parsed = parseStrukturPivotExcel(workbook);
        if (Object.keys(parsed).length === 0) {
          setErrorMessage("Tidak ada data spasial (NAMOBJ) terdeteksi di sheet INFRASTRUKTUR atau JARINGAN. Pastikan format tabel sesuai.");
          setIsLoading(false);
          return;
        }
        setPivotData(parsed);
        setPivotFileName(file.name);
        setIsDemoMode(false);
        setIsLoading(false);
      } catch (err: any) {
        console.error(err);
        setErrorMessage("Gagal mengurai file Excel Pivot. Silakan pastikan sheet INFRASTRUKTUR dan JARINGAN tersedia.");
        setIsLoading(false);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const startStrukturConsistencyCheck = (rText: string, pData: Record<string, StrukturPivotItem>) => {
    if (!rText) {
      setErrorMessage("Harap lengkapi file Draft Ranperda Rencana Struktur Ruang (.docx) terlebih dahulu.");
      return;
    }
    if (Object.keys(pData).length === 0) {
      setErrorMessage("Harap lengkapi file Pivot Struktur Ruang (.xlsx) terlebih dahulu.");
      return;
    }
    
    setErrorMessage("");
    setIsLoading(true);
    setStatusMessage("Menganalisis sinkronisasi spasial & jaringan struktur ruang...");
    
    setTimeout(() => {
      try {
        const { results, stats, kabupaten } = analyzeStrukturConsistency(rText, pData);
        setAnalysisResults(results);
        setAnalysisStats(stats);
        setCountyName(kabupaten);
        setIsLoading(false);
      } catch (err: any) {
        console.error(err);
        setErrorMessage(`Analisis gagal: ${err.message || String(err)}`);
        setIsLoading(false);
      }
    }, 800);
  };

  const loadDemoData = () => {
    setRanperdaText(RAW_STRUKTUR_DEMO_TEXT);
    setRanperdaFileName("Draft_Ranperda_RTRW_TelukWondama_Demo.docx");
    setPivotData(STRUKTUR_PIVOT_DEMO_DATA);
    setPivotFileName("Pivot_Struktur_Ruang_TelukWondama_Demo.xlsx");
    setIsDemoMode(true);
    setErrorMessage("");

    setIsLoading(true);
    setStatusMessage("Memuat data simulasi konsistensi Struktur Ruang...");
    setTimeout(() => {
      const { results, stats, kabupaten } = analyzeStrukturConsistency(RAW_STRUKTUR_DEMO_TEXT, STRUKTUR_PIVOT_DEMO_DATA);
      setAnalysisResults(results);
      setAnalysisStats(stats);
      setCountyName(kabupaten);
      setIsLoading(false);
    }, 600);
  };

  const resetAll = () => {
    setRanperdaText("");
    setRanperdaFileName("");
    setPivotData({});
    setPivotFileName("");
    setAnalysisResults(null);
    setAnalysisStats(null);
    setCountyName("");
    setErrorMessage("");
    setIsDemoMode(false);
  };

  const exportStrukturToCSV = () => {
    if (!analysisResults || analysisResults.length === 0) return;
    let csvContent = "\uFEFF";
    const headers = [
      "No",
      "Jenis Rencana Struktur Ruang",
      "Orde 1",
      "Orde 2",
      "Orde 3",
      "Orde 4 / Nama Objek",
      "Nama Objek Ranperda",
      "Status Nama",
      "Distrik Pivot",
      "Distrik Ranperda",
      "Status Distrik",
      "Kesimpulan",
      "Catatan / Tindak Lanjut"
    ];
    csvContent += headers.map(h => `"${h}"`).join(",") + "\r\n";
    analysisResults.forEach((r, index) => {
      const row = [
        index + 1,
        r.jenisRencana || "-",
        r.orde1 || "-",
        r.orde2 || "-",
        r.namobj || "-",
        r.remark || "-",
        r.namobjRanperda || "-",
        r.statusNamobj,
        r.distrikPivot.join("; ") || "-",
        r.distrikRanperda.join("; ") || "-",
        r.statusDistrik,
        r.statusOverall,
        r.catatan || "-"
      ];
      csvContent += row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",") + "\r\n";
    });
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Laporan_Konsistensi_StrukturRuang_${countyName.replace(/\s+/g, '_')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getStrukturActionableList = () => {
    const list: { title: string; text: string; type: 'spasial' | 'distrik' | 'warning' }[] = [];
    analysisResults?.forEach(r => {
      if (r.statusNamobj === 'Tidak Ditemukan') {
        const isDrafOnly = r.distrikPivot.length === 0;
        list.push({
          title: isDrafOnly ? `OBJEK DRAFT TIDAK ADA DI PETA` : `OBJEK PETA BELUM TERTULIS DI DRAFT`,
          text: isDrafOnly 
            ? `Klausul draf mencantumkan objek "${r.namobj}" (${r.remark || '-'}), namun tidak ditemukan objek spasial murni di GIS.` 
            : `Peta GIS spasial mencantumkan objek "${r.namobj}" (${r.remark || '-'}), namun tidak disebutkan dalam draf bab naskah.`,
          type: 'spasial'
        });
      }
      if (r.statusDistrik === 'Tidak Sesuai') {
        list.push({
          title: `SELISIH SEBARAN DISTRIK (Pasal ${r.pasalAyat || '?-GIS'})`,
          text: `Objek "${r.namobj}" mencantumkan distrik [${r.distrikRanperda.join(', ')}] di draf, sedangkan pada peta GIS mencantumkan [${r.distrikPivot.join(', ')}].`,
          type: 'distrik'
        });
      }
      if (r.statusNamobj === 'Perlu Dicek') {
        list.push({
          title: `SINKRONISASI KATEGORI/NAMA (Pasal ${r.pasalAyat})`,
          text: `Draf menuliskan objek "${r.namobj}" sebagai part of "${r.remark || '-'}", namun pada geospasial menggunakan nama mirip. Harap seragamkan.`,
          type: 'warning'
        });
      }
    });
    return list;
  };

  const showUploader = !analysisResults;

  return (
    <div className="space-y-6">
      {/* LANDING PAGE / FILES UPLOADER FORM */}
      {showUploader && (
        <div className="space-y-6 no-print max-w-5xl mx-auto">
          {/* Banner Description */}
          <div className="bg-slate-900 text-white p-8 md:p-10 border border-slate-800 shadow-md space-y-4 relative overflow-hidden">
            <span className="inline-block px-3 py-1 bg-blue-500/20 text-blue-400 text-[10px] font-bold tracking-widest uppercase border border-blue-500/30">
              Penjaminan Mutu Hukum & Spasial • Struktur Ruang
            </span>
            <h2 className="text-2xl md:text-3xl font-display font-bold text-white tracking-tight max-w-3xl uppercase">
              Verifikasi Konsistensi draf hukum rtrw terhadap database spasial gis (Struktur Ruang)
            </h2>
            <p className="text-slate-300 text-xs md:text-sm max-w-3xl leading-relaxed font-sans font-medium">
              Modul khusus untuk menganalisis keselarasan pola jaringan prasarana dan pusat permukiman. Sistem akan mengekstrak data dari bab Struktur Ruang (.docx), membaginya secara dinamis ke kategori Infrastruktur dan Jaringan, lalu diuji silang terhadap Sheet INFRASTRUKTUR & JARINGAN dari Pivot Excel spasial untuk memverifikasi kecocokan objek spasial dan sebaran distrik administratif.
            </p>
            <div className="pt-4 flex flex-wrap gap-3">
              <button 
                onClick={loadDemoData}
                className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold uppercase tracking-wider transition-all shadow-md cursor-pointer"
              >
                Gunakan Data Simulasi (Teluk Wondama)
              </button>
            </div>
          </div>

          {/* Error Message Box */}
          {errorMessage && (
            <div className="bg-red-50 border border-red-200 text-red-900 p-4 flex items-start gap-3 shadow-sm">
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-red-650" />
              <div className="text-xs">
                <p className="font-bold uppercase tracking-wider">Gagal Melakukan Proses:</p>
                <p className="text-red-700 mt-0.5 leading-relaxed">{errorMessage}</p>
              </div>
            </div>
          )}

          {/* File Drag & Dropzones Grid */}
          <div className="grid md:grid-cols-2 gap-6">
            {/* File 1: Ranperda Docx */}
            <div className="bg-white p-6 border border-slate-200 shadow-sm flex flex-col justify-between hover:border-slate-300 transition duration-150">
              <div className="space-y-4">
                <div className="flex justify-between items-start">
                  <span className="p-3 bg-slate-100 text-slate-700 rounded inline-block">
                    <FileText className="w-5 h-5 text-slate-700" />
                  </span>
                  <span className="text-xs font-mono font-bold tracking-wider text-slate-400 uppercase">FILE 01 / DRAFT STRUKTUR</span>
                </div>
                <div>
                  <h3 className="font-display font-bold text-slate-800 text-sm uppercase tracking-wide">
                    Draf Rencana Struktur Ruang (.docx)
                  </h3>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    Dokumen naskah draf bab Struktur Ruang. Setiap pusat permukiman, gardu induk, jalan, atau pelabuhan dideklarasikan dalam pasal pendukung.
                  </p>
                </div>

                <div className="pt-2">
                  <label className="flex flex-col items-center justify-center border border-dashed border-slate-300 rounded p-6 cursor-pointer hover:bg-slate-50 hover:border-blue-500 transition group relative">
                    <input 
                      type="file" 
                      accept=".docx" 
                      onChange={handleRanperdaUpload} 
                      className="hidden" 
                    />
                    <Upload className="w-7 h-7 text-slate-400 group-hover:text-blue-500 mb-2 transition" />
                    
                    {ranperdaFileName ? (
                      <div className="text-center">
                        <p className="text-xs font-bold text-slate-800 break-all px-4">
                          {ranperdaFileName}
                        </p>
                        <p className="text-[10px] text-green-700 mt-1.5 font-bold uppercase tracking-wider flex items-center justify-center gap-1">
                          <CheckCircle className="w-3.5 h-3.5" /> File berhasil diekstrak
                        </p>
                      </div>
                    ) : (
                      <div className="text-center">
                        <p className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Klik untuk unggah draf</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">Ekstrak teks mentah dari Dokumen Word (.docx)</p>
                      </div>
                    )}
                  </label>
                </div>
              </div>

              {ranperdaText && (
                <div className="mt-4 bg-slate-50 p-3 border border-slate-150 max-h-32 overflow-y-auto">
                  <p className="text-[10px] font-mono leading-relaxed text-slate-500 line-clamp-3">
                    {ranperdaText}
                  </p>
                </div>
              )}
            </div>

            {/* File 2: Pivot Struktur Ruang Excel */}
            <div className="bg-white p-6 border border-slate-200 shadow-sm flex flex-col justify-between hover:border-slate-300 transition duration-150">
              <div className="space-y-4">
                <div className="flex justify-between items-start">
                  <span className="p-3 bg-slate-100 text-slate-700 rounded inline-block">
                    <FileSpreadsheet className="w-5 h-5 text-slate-700" />
                  </span>
                  <span className="text-xs font-mono font-bold tracking-wider text-slate-400 uppercase">FILE 02 / BASIS SPASIAL</span>
                </div>
                <div>
                  <h3 className="font-display font-bold text-slate-800 text-sm uppercase tracking-wide">
                    Pivot Tabel Struktur Ruang (.xlsx)
                  </h3>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    Laporan spasial keluaran SIG. Excel harus berisi minimal sheet INFRASTRUKTUR dan JARINGAN. Kolom wajib: NAMOBJ, REMARK, dan WADMKC/KECAMATAN.
                  </p>
                </div>

                <div className="pt-2">
                  <label className="flex flex-col items-center justify-center border border-dashed border-slate-300 rounded p-6 cursor-pointer hover:bg-slate-50 hover:border-blue-500 transition group relative">
                    <input 
                      type="file" 
                      accept=".xlsx, .xls" 
                      onChange={handlePivotUpload} 
                      className="hidden" 
                    />
                    <Upload className="w-7 h-7 text-slate-400 group-hover:text-blue-500 mb-2 transition" />
                    
                    {pivotFileName ? (
                      <div className="text-center">
                        <p className="text-xs font-bold text-slate-800 break-all px-4">
                          {pivotFileName}
                        </p>
                        <p className="text-[10px] text-green-700 mt-1.5 font-bold uppercase tracking-wider flex items-center justify-center gap-1">
                          <CheckCircle className="w-3.5 h-3.5" /> {Object.keys(pivotData).length} Objek terpetakan
                        </p>
                      </div>
                    ) : (
                      <div className="text-center">
                        <p className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Klik untuk unggah pivot</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">Membaca data terstruktur Spreadsheet Excel (.xlsx)</p>
                      </div>
                    )}
                  </label>
                </div>
              </div>

              {Object.keys(pivotData).length > 0 && (
                <div className="mt-4 bg-slate-50 p-3 border border-slate-150 max-h-32 overflow-y-auto">
                  <p className="text-[10px] font-mono leading-relaxed text-slate-500">
                    Kategori ditemukan: {Object.keys(pivotData).slice(0, 5).map(k => k.split('|||')[1] || k).join(', ')}...
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Action Trigger button */}
          <div className="flex justify-end pt-4">
            <button
              onClick={() => startStrukturConsistencyCheck(ranperdaText, pivotData)}
              className="px-8 py-3 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs uppercase tracking-widest transition shadow-md cursor-pointer"
            >
              Mulai Analisis Konsistensi
            </button>
          </div>
        </div>
      )}

      {/* LOADING COMPONENT */}
      {isLoading && (
        <div className="py-16 flex flex-col items-center justify-center gap-3 no-print">
          <RefreshCw className="w-10 h-10 text-blue-500 animate-spin" />
          <p className="font-display font-semibold tracking-wider text-xs uppercase text-slate-700">{statusMessage}</p>
          <p className="text-[11px] text-slate-400 font-medium">Harap tunggu, proses analisis memakan waktu beberapa detik...</p>
        </div>
      )}

      {/* STRUKTUR RUANG DETAILED REPORT WORKSPACE */}
      {analysisResults && analysisStats && !isLoading && (
        <div className="flex flex-col lg:flex-row gap-6 items-start">
          {/* LEFT WORKSPACE: Main Content */}
          <div className="flex-1 lg:flex-[3] w-full flex flex-col gap-6">
            
            {/* Header Laporan Info Panel */}
            <div className="bg-white p-6 border border-slate-200 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div>
                <span className="px-2.5 py-1 bg-blue-900 text-white text-[10px] font-bold tracking-widest uppercase font-mono">
                  LAPORAN HASIL SINKRONISASI STRUKTUR RUANG
                </span>
                <h2 className="text-xl font-display font-bold text-slate-900 mt-2 tracking-tight uppercase">
                  KONSISTENSI DATA STRUKTUR RUANG KABUPATEN {countyName.toUpperCase()}
                </h2>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500 mt-1 font-mono">
                  <span>Draft: <span className="text-slate-800 font-bold">{ranperdaFileName || 'struktur_draft.docx'}</span></span>
                  <span>•</span>
                  <span>Pivot GIS: <span className="text-slate-800 font-bold">{pivotFileName || 'struktur_pivot.xlsx'}</span></span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-wrap gap-2 w-full md:w-auto mt-2 md:mt-0 no-print">
                <button
                  onClick={exportStrukturToCSV}
                  className="px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 text-[10px] font-bold uppercase tracking-wider border border-slate-200 transition shadow-sm cursor-pointer"
                >
                  Ekspor CSV (.csv)
                </button>
                <button
                  onClick={() => window.print()}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-[10px] font-bold uppercase tracking-wider transition shadow-sm cursor-pointer"
                >
                  Cetak / Simpan PDF
                </button>
                <button
                  onClick={resetAll}
                  className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-[10px] font-bold uppercase tracking-wider transition shadow-sm cursor-pointer"
                >
                  Reset Ulang
                </button>
              </div>
            </div>

            {/* Hint Box */}
            <div className="bg-blue-50 border border-blue-200 text-blue-900 p-4 flex items-start gap-3 shadow-sm no-print">
              <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div className="text-xs">
                <p className="font-bold uppercase tracking-wider text-[10px] text-blue-800">Petunjuk Verifikasi:</p>
                <p className="text-blue-700 mt-0.5 leading-relaxed font-medium">
                  Pemeriksaan Struktur Ruang berfokus pada <b>Keselarasan Nama Objek/Prasarana</b> and <b>Sebaran Distrik</b>. Sistem tidak memperhitungkan besaran hektare (ha) melainkan hubungan spasial administratif (apakah berada di distrik pendukung draf Perda vs GIS).
                </p>
              </div>
            </div>

            {/* REPORT NAVIGATION SUB-TABS */}
            <div className="border-b border-slate-200 flex flex-wrap gap-2 no-print bg-white p-2 border border-slate-200 shadow-sm">
              <button
                onClick={() => setSelectedSubTab('laporan')}
                className={`py-2 px-4 text-[10px] font-display font-medium border-b-2 tracking-widest uppercase transition cursor-pointer ${
                  selectedSubTab === 'laporan'
                    ? 'border-blue-500 text-slate-900 font-bold'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                Tabel Hasil Analisis
              </button>
              <button
                onClick={() => setSelectedSubTab('catatan')}
                className={`py-2 px-4 text-[10px] font-display font-medium border-b-2 tracking-widest uppercase transition flex items-center gap-1.5 cursor-pointer ${
                  selectedSubTab === 'catatan'
                    ? 'border-red-500 text-slate-900 font-bold'
                    : 'border-transparent text-slate-500 hover:text-red-700'
                }`}
              >
                Daftar Temuan Krusial
                {(() => {
                  const errCount = (analysisResults?.filter(r => r.statusNamobj === 'Tidak Ditemukan' || r.statusDistrik === 'Tidak Sesuai').length || 0);
                  return errCount > 0 ? (
                    <span className="px-1.5 py-0.5 bg-red-105 bg-red-650 bg-red-600 text-white font-bold font-mono text-[9px]">{errCount}</span>
                  ) : null;
                })()}
              </button>
              <button
                onClick={() => setSelectedSubTab('pivot')}
                className={`py-2 px-4 text-[10px] font-display font-medium border-b-2 tracking-widest uppercase transition cursor-pointer ${
                  selectedSubTab === 'pivot'
                    ? 'border-blue-500 text-slate-900 font-bold'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                Rincian Pivot GIS Spasial
              </button>
            </div>

            {/* TAB CONTENT: DETAILED STRUKTUR REPORT TABLE */}
            {selectedSubTab === 'laporan' && (
              <div className="flex flex-col gap-6 w-full">
                {(() => {
                  const sesuaiCount = analysisStats.sesuai;
                  const tidakSesuaiCount = analysisStats.tidakSesuai + analysisStats.tidakDitemukan + (analysisStats.perluDicek || 0);
                  const tidakDapatDiverifikasiCount = analysisStats.tidakDapatDiverifikasi || 0;

                  const getStandardLabelForStruktur = (jenisName: string) => {
                    const mainCats = [
                      'Sistem Pusat Permukiman',
                      'Sistem Jaringan Transportasi',
                      'Sistem Jaringan Energi',
                      'Sistem Jaringan Telekomunikasi',
                      'Sistem Jaringan Sumber Daya Air'
                    ];
                    if (mainCats.includes(jenisName)) return jenisName;
                    return 'Sistem Jaringan Prasarana Lainnya';
                  };

                  const breakdownStats: Record<string, number> = {
                    'Sistem Pusat Permukiman': 0,
                    'Sistem Jaringan Transportasi': 0,
                    'Sistem Jaringan Energi': 0,
                    'Sistem Jaringan Telekomunikasi': 0,
                    'Sistem Jaringan Sumber Daya Air': 0,
                    'Sistem Jaringan Prasarana Lainnya': 0
                  };

                  analysisResults.forEach(r => {
                    const label = getStandardLabelForStruktur(r.jenisRencana || '');
                    breakdownStats[label] = (breakdownStats[label] || 0) + 1;
                  });

                  const filteredResults = analysisResults.filter(r => {
                    if (jenisFilter !== 'Semua') {
                      const stdLabel = getStandardLabelForStruktur(r.jenisRencana || '');
                      if (stdLabel !== jenisFilter) return false;
                    }
                    if (searchQuery) {
                      const q = searchQuery.toLowerCase();
                      const matchRemark = r.remark && r.remark.toLowerCase().includes(q);
                      const matchNamobj = r.namobj && r.namobj.toLowerCase().includes(q);
                      const matchRanperda = r.namobjRanperda && r.namobjRanperda.toLowerCase().includes(q);
                      const matchO1 = r.orde1 && r.orde1.toLowerCase().includes(q);
                      const matchO2 = r.orde2 && r.orde2.toLowerCase().includes(q);
                      
                      if (!matchRemark && !matchNamobj && !matchRanperda && !matchO1 && !matchO2) {
                        return false;
                      }
                    }
                    return true;
                  });

                  interface Orde3Group {
                    name: string;
                    leaves: typeof filteredResults;
                  }
                  interface Orde2Group {
                    name: string;
                    orde3Groups: Orde3Group[];
                  }
                  interface Orde1Group {
                    name: string;
                    orde2Groups: Orde2Group[];
                  }
                  interface JenisGroup {
                    name: string;
                    orde1Groups: Orde1Group[];
                  }

                  const treeGroups: JenisGroup[] = [];

                  filteredResults.forEach(r => {
                    const jName = r.jenisRencana || 'Sistem Jaringan Transportasi';
                    const o1Name = r.orde1 || 'Sistem Jaringan Transportasi';
                    const o2Name = r.orde2 || 'Jaringan Utama';
                    const o3Name = r.namobj || 'Prasarana Lainnya';

                    let gJenis = treeGroups.find(g => g.name === jName);
                    if (!gJenis) {
                      gJenis = { name: jName, orde1Groups: [] };
                      treeGroups.push(gJenis);
                    }

                    let gO1 = gJenis.orde1Groups.find(g => g.name === o1Name);
                    if (!gO1) {
                      gO1 = { name: o1Name, orde2Groups: [] };
                      gJenis.orde1Groups.push(gO1);
                    }

                    let gO2 = gO1.orde2Groups.find(g => g.name === o2Name);
                    if (!gO2) {
                      gO2 = { name: o2Name, orde3Groups: [] };
                      gO1.orde2Groups.push(gO2);
                    }

                    let gO3 = gO2.orde3Groups.find(g => g.name === o3Name);
                    if (!gO3) {
                      gO3 = { name: o3Name, leaves: [] };
                      gO2.orde3Groups.push(gO3);
                    }

                    gO3.leaves.push(r);
                  });

                  return (
                    <div className="flex flex-col gap-6 w-full">
                      {/* Summary Overview Blocks */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 no-print">
                        <div className="bg-slate-900 border border-slate-800 text-white p-5 flex items-center gap-4 hover:shadow transition">
                          <div className="w-12 h-12 bg-blue-950/60 border border-blue-500/20 text-blue-400 font-bold text-center flex items-center justify-center text-lg rounded-sm shrink-0">
                            📑
                          </div>
                          <div>
                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest leading-none">Total Objek</p>
                            <p className="text-xl font-display font-black text-white mt-1.5">{analysisResults.length} <span className="text-[11px] font-normal text-slate-400">Peta & Draf</span></p>
                          </div>
                        </div>

                        <div className="bg-emerald-950/10 border border-emerald-200/50 p-5 flex items-center gap-4 hover:shadow transition">
                          <div className="w-12 h-12 bg-emerald-100 text-emerald-800 font-bold text-center flex items-center justify-center text-lg rounded-sm shrink-0">
                            ✔
                          </div>
                          <div>
                            <p className="text-[10px] text-emerald-800 font-bold uppercase tracking-widest leading-none">Sesuai (Konsisten)</p>
                            <p className="text-xl font-display font-black text-emerald-700 mt-1.5">{sesuaiCount} <span className="text-[11px] font-normal text-emerald-600/70">Objek</span></p>
                          </div>
                        </div>

                        <div className="bg-rose-950/5 border border-rose-200/50 p-5 flex items-center gap-4 hover:shadow transition">
                          <div className="w-12 h-12 bg-rose-100 text-rose-800 font-bold text-center flex items-center justify-center text-lg rounded-sm shrink-0">
                            ✖
                          </div>
                          <div>
                            <p className="text-[10px] text-rose-800 font-bold uppercase tracking-widest leading-none">Tidak Sesuai / Selisih</p>
                            <p className="text-xl font-display font-black text-rose-700 mt-1.5">{tidakSesuaiCount} <span className="text-[11px] font-normal text-rose-600/70">Kasus</span></p>
                          </div>
                        </div>

                        <div className="bg-indigo-950/5 border border-indigo-200/50 p-5 flex items-center gap-4 hover:shadow transition">
                          <div className="w-12 h-12 bg-indigo-100 text-indigo-800 font-bold text-center flex items-center justify-center text-lg rounded-sm shrink-0">
                            ℹ
                          </div>
                          <div>
                            <p className="text-[10px] text-indigo-800 font-bold uppercase tracking-widest leading-none">Rujukan Lampiran</p>
                            <p className="text-xl font-display font-black text-indigo-700 mt-1.5">{tidakDapatDiverifikasiCount} <span className="text-[11px] font-normal text-indigo-650/70">Verifikasi</span></p>
                          </div>
                        </div>
                      </div>

                      {/* Breakdown block cards */}
                      <div className="bg-white border border-slate-200 p-5 shadow-sm space-y-3 no-print">
                        <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                          <h3 className="text-[10px] font-bold text-slate-700 uppercase tracking-wider">Metrik Sebaran Berdasarkan Jenis Rencana Struktur Ruang</h3>
                          <span className="text-[9px] font-mono text-slate-400 font-bold">STANDAR LAPORAN SPASIAL</span>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                          {Object.entries(breakdownStats).map(([jenis, count], idx) => {
                            let bgTheme = 'bg-blue-50/40 border-blue-150';
                            let titleColor = 'text-blue-900';
                            if (jenis.includes('Pusat')) { bgTheme = 'bg-slate-50 border-slate-200'; titleColor = 'text-slate-800'; }
                            if (jenis.includes('Transport')) { bgTheme = 'bg-amber-50/40 border-amber-200'; titleColor = 'text-amber-900'; }
                            if (jenis.includes('Energi')) { bgTheme = 'bg-yellow-50/40 border-yellow-200'; titleColor = 'text-yellow-805 text-yellow-800'; }
                            if (jenis.includes('Telekomu')) { bgTheme = 'bg-purple-50/40 border-purple-200'; titleColor = 'text-purple-900'; }
                            if (jenis.includes('Sumber Daya')) { bgTheme = 'bg-emerald-50/40 border-emerald-200'; titleColor = 'text-emerald-950'; }
                            
                            return (
                              <div key={idx} className={`p-3 border rounded-sm flex flex-col justify-between ${bgTheme}`}>
                                <div className={`text-[10px] font-bold leading-normal ${titleColor} line-clamp-2 mb-2`}>
                                  {jenis === 'Sistem Jaringan Prasarana Lainnya' ? 'Prasarana Lainnya' : jenis}
                                </div>
                                <div className="flex items-baseline justify-between mt-auto border-t border-slate-200/50 pt-2">
                                  <span className="text-[9px] font-mono text-slate-450 uppercase">Objek:</span>
                                  <span className="text-xs font-display font-extrabold text-slate-900">{count}</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Search and Navigation Bar Filter */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-slate-100 border border-slate-200 shadow-sm no-print">
                        <div className="relative flex-1">
                          <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                            <Search className="w-3.5 h-3.5 text-slate-400" />
                          </span>
                          <input
                            type="text"
                            placeholder="Cari kelayakan objek (Orde 4, NAMOBJ, Remark, contoh: 'Jl. Anumerta')..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-9 pr-8 py-2 bg-white text-xs text-slate-800 border border-slate-300 focus:outline-none focus:ring-1 focus:ring-slate-500 font-sans"
                          />
                          {searchQuery && (
                            <button
                              onClick={() => setSearchQuery('')}
                              className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600 text-xs font-mono font-bold"
                            >
                              ✕
                            </button>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          <SlidersHorizontal className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                          <select
                            value={jenisFilter}
                            onChange={(e) => setJenisFilter(e.target.value)}
                            className="bg-white border border-slate-300 text-slate-700 py-1.5 px-3 text-xs focus:outline-none focus:ring-1 focus:ring-slate-500 font-sans font-medium"
                          >
                            <option value="Semua">Semua Jenis Rencana</option>
                            <option value="Sistem Pusat Permukiman">Sistem Pusat Permukiman</option>
                            <option value="Sistem Jaringan Transportasi">Sistem Jaringan Transportasi</option>
                            <option value="Sistem Jaringan Energi">Sistem Jaringan Energi</option>
                            <option value="Sistem Jaringan Telekomunikasi">Sistem Jaringan Telekomunikasi</option>
                            <option value="Sistem Jaringan Sumber Daya Air">Sistem Jaringan Sumber Daya Air</option>
                            <option value="Sistem Jaringan Prasarana Lainnya">Sistem Jaringan Prasarana Lainnya</option>
                          </select>
                        </div>

                        <div className="flex gap-2">
                          <button
                            onClick={() => setCollapsedNodes({})}
                            className="px-2.5 py-1.5 bg-white border border-slate-200 text-slate-650 hover:text-slate-900 text-[10px] font-bold uppercase tracking-wider transition hover:bg-slate-50 cursor-pointer"
                          >
                            Buka Semua
                          </button>
                          <button
                            onClick={() => {
                              const collapses: Record<string, boolean> = {};
                              treeGroups.forEach(g => {
                                collapses[g.name] = true;
                                g.orde1Groups.forEach(o1 => {
                                  const k1 = `${g.name}||${o1.name}`;
                                  collapses[k1] = true;
                                  o1.orde2Groups.forEach(o2 => {
                                    const k2 = `${k1}||${o2.name}`;
                                    collapses[k2] = true;
                                    o2.orde3Groups.forEach(o3 => {
                                      const k3 = `${k2}||${o3.name}`;
                                      collapses[k3] = true;
                                    });
                                  });
                                });
                              });
                              setCollapsedNodes(collapses);
                            }}
                            className="px-2.5 py-1.5 bg-white border border-slate-200 text-slate-650 hover:text-slate-900 text-[10px] font-bold uppercase tracking-wider transition hover:bg-slate-50 cursor-pointer"
                          >
                            Tutup Semua
                          </button>
                        </div>
                      </div>

                      {/* Hierarchical Tree */}
                      {treeGroups.length === 0 ? (
                        <div className="p-8 border border-dashed border-slate-200 text-center text-slate-400 space-y-1">
                          <Info className="w-8 h-8 text-slate-300 mx-auto" />
                          <p className="font-semibold text-xs text-slate-600 uppercase tracking-wide">Pencarian Nihil</p>
                          <p className="text-[11px]">Tidak ada rincian prasarana yang cocok dengan filter atau kata kunci saat ini.</p>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {treeGroups.map((gJenis, gIdx) => {
                            const isJenisCollapsed = !!collapsedNodes[gJenis.name];
                            const countInJenis = gJenis.orde1Groups.reduce((acc, o1) => acc + o1.orde2Groups.reduce((a2, o2) => a2 + o2.orde3Groups.reduce((a3, o3) => a3 + o3.leaves.length, 0), 0), 0);

                            return (
                              <div key={gIdx} className="border border-slate-200 bg-white shadow-sm overflow-hidden rounded">
                                {/* LEVEL 0 */}
                                <div 
                                  onClick={() => toggleNode(gJenis.name)}
                                  className="flex items-center justify-between px-4 py-3 cursor-pointer select-none bg-slate-900 text-white border-b border-slate-800 transition hover:bg-slate-805 no-print"
                                >
                                  <div className="flex items-center gap-3">
                                    {isJenisCollapsed ? <ChevronRight className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-300" />}
                                    <Layers className="w-4 h-4 text-blue-400 shrink-0" />
                                    <span className="font-display font-bold text-[11px] tracking-wider uppercase font-semibold">
                                      {gJenis.name}
                                    </span>
                                  </div>
                                  <span className="px-2 py-0.5 bg-blue-800/80 text-blue-100 rounded text-[10px] font-mono font-bold shrink-0">
                                    {countInJenis} Objek
                                  </span>
                                </div>

                                <div className="hidden print:block bg-slate-150 p-2 font-display font-black text-xs uppercase border-b border-slate-300 tracking-wider">
                                  ⚙ CATEGORY: {gJenis.name} ({countInJenis} Objek)
                                </div>

                                {!isJenisCollapsed && (
                                  <div className="bg-slate-50/50 p-4 space-y-4">
                                    {gJenis.orde1Groups.map((gO1, o1Idx) => {
                                      const k1 = `${gJenis.name}||${gO1.name}`;
                                      const isO1Collapsed = !!collapsedNodes[k1];
                                      const countInO1 = gO1.orde2Groups.reduce((a2, o2) => a2 + o2.orde3Groups.reduce((a3, o3) => a3 + o3.leaves.length, 0), 0);
                                      
                                      return (
                                        <div key={o1Idx} className="bg-white border border-slate-200/85 pl-2 shadow-sm rounded-sm">
                                          {/* LEVEL 1 */}
                                          <div 
                                            onClick={() => toggleNode(k1)}
                                            className="flex items-center justify-between p-3 cursor-pointer select-none border-b border-slate-100 bg-slate-100/40 hover:bg-slate-100 transition rounded-tr-sm no-print"
                                          >
                                            <div className="flex items-center gap-2.5">
                                              {isO1Collapsed ? <ChevronRight className="w-3.5 h-3.5 text-slate-500" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-600" />}
                                              <span className="font-display font-extrabold text-slate-800 text-xs tracking-tight">
                                                Orde 1: {gO1.name}
                                              </span>
                                            </div>
                                            <span className="px-1.5 py-0.5 text-[9px] font-mono font-bold bg-slate-200 text-slate-600 rounded shrink-0">
                                              {countInO1} Objek
                                            </span>
                                          </div>

                                          <div className="hidden print:block font-bold text-slate-900 border-b border-slate-200 py-1 text-xs">
                                            📌 Orde 1: {gO1.name} ({countInO1} Objek)
                                          </div>

                                          {!isO1Collapsed && gO1.orde2Groups.map((gO2, o2Idx) => {
                                            const k2 = `${k1}||${gO2.name}`;
                                            const isO2Collapsed = !!collapsedNodes[k2];
                                            const countInO2 = gO2.orde3Groups.reduce((a3, o3) => a3 + o3.leaves.length, 0);

                                            return (
                                              <div key={o2Idx} className="mt-2 mr-2 mb-3 border-l-2 border-slate-200 pl-4 md:pl-5 print:pl-4">
                                                {/* LEVEL 2 */}
                                                <div 
                                                  onClick={() => toggleNode(k2)}
                                                  className="flex items-center justify-between py-2 cursor-pointer select-none group border-b border-slate-100 hover:border-slate-300 transition no-print"
                                                >
                                                  <div className="flex items-center gap-2">
                                                    {isO2Collapsed ? <ChevronRight className="w-3 h-3 text-slate-400" /> : <ChevronDown className="w-3 h-3 text-slate-500" />}
                                                    <span className="font-sans font-bold text-slate-700 text-[11px] hover:text-slate-900 transition">
                                                      Orde 2: {gO2.name}
                                                    </span>
                                                  </div>
                                                  <span className="text-[10px] text-slate-400 italic shrink-0">
                                                    {countInO2} objek
                                                  </span>
                                                </div>

                                                <div className="hidden print:block font-semibold text-slate-700 text-[11px] border-b border-slate-100 py-1">
                                                  ↳ Orde 2: {gO2.name} ({countInO2} objek)
                                                </div>

                                                {!isO2Collapsed && gO2.orde3Groups.map((gO3, o3Idx) => {
                                                  const k3 = `${k2}||${gO3.name}`;
                                                  const isO3Collapsed = !!collapsedNodes[k3];

                                                  return (
                                                    <div key={o3Idx} className="mt-2.5 mb-3.5 pl-3 border-l border-dashed border-slate-200">
                                                      {/* LEVEL 3 */}
                                                      <div 
                                                        onClick={() => toggleNode(k3)}
                                                        className="flex items-center justify-between py-1 px-2 cursor-pointer select-none bg-slate-55 bg-slate-50 hover:bg-slate-100 rounded-sm text-xs font-semibold text-slate-800 no-print"
                                                      >
                                                        <span className="flex items-center gap-1.5 text-slate-700">
                                                          {isO3Collapsed ? <ChevronRight className="w-3 h-3 text-slate-400" /> : <ChevronDown className="w-3 h-3 text-slate-500" />}
                                                          Orde 3: {gO3.name}
                                                        </span>
                                                        <span className="text-[9px] text-slate-400 bg-white border border-slate-150 px-1 py-0.5 rounded shrink-0">
                                                          {gO3.leaves.length} leaf
                                                        </span>
                                                      </div>

                                                      <div className="hidden print:block font-medium text-slate-600 text-[10px] bg-slate-50 py-0.5">
                                                        ▪ Orde 3: {gO3.name} ({gO3.leaves.length} verified objects)
                                                      </div>

                                                      {!isO3Collapsed && (
                                                        <div className="mt-2 ml-4 overflow-x-auto border border-slate-200 shadow-inner rounded bg-white print:ml-2">
                                                          <table className="w-full text-left border-collapse font-sans text-xs min-w-[760px] table-auto">
                                                            <thead>
                                                              <tr className="bg-slate-800 text-white font-medium text-[9px] uppercase tracking-wider border-b border-slate-700">
                                                                <th className="py-2.5 px-3 border-r border-slate-700 w-[180px]">Orde 4 / Remark (GIS)</th>
                                                                <th className="py-2.5 px-3 border-r border-slate-700 w-[180px]">Draf Ranperda (Pasal)</th>
                                                                <th className="py-2.5 px-3 border-r border-slate-700 min-w-[120px]">Distrik Peta GIS</th>
                                                                <th className="py-2.5 px-3 border-r border-slate-700 min-w-[120px]">Distrik Ranperda</th>
                                                                <th className="py-2.5 px-2 border-r border-slate-700 text-center w-[85px]">Status Nama</th>
                                                                <th className="py-2.5 px-2 border-r border-slate-700 text-center w-[80px]">Distrik</th>
                                                                <th className="py-2.5 px-2 text-center w-[90px]">Kesimpulan</th>
                                                              </tr>
                                                            </thead>
                                                            <tbody className="divide-y divide-slate-100">
                                                              {gO3.leaves.map((leaf, leafIdx) => {
                                                                const hasDistanceAlert = leaf.statusNamobj !== 'Sesuai' || leaf.statusDistrik !== 'Sesuai';
                                                                return (
                                                                  <tr key={leafIdx} className={`hover:bg-slate-50 transition-colors ${hasDistanceAlert ? 'bg-amber-50/10' : ''}`}>
                                                                    <td className="py-2 px-3 border-r border-slate-100 font-mono text-[11px] text-slate-800 leading-relaxed">
                                                                      {leaf.orde4 && leaf.orde4 !== 'Belum memiliki klasifikasi pada master referensi' && (
                                                                        <div className="text-[9px] font-sans text-slate-500 font-medium tracking-tight mb-1 bg-slate-100 px-1.5 py-0.5 rounded inline-block">
                                                                          {leaf.orde4}
                                                                        </div>
                                                                      )}
                                                                      {leaf.remark && leaf.remark !== 'Tidak Ada' && leaf.remark !== '-' ? (
                                                                        <div className="font-bold text-slate-800">{leaf.remark}</div>
                                                                      ) : (
                                                                        <div className="text-slate-400 italic">Sesuai Kategori</div>
                                                                      )}
                                                                    </td>

                                                                    <td className="py-2 px-3 border-r border-slate-100">
                                                                      {leaf.namobjRanperda && leaf.namobjRanperda !== '-' ? (
                                                                        <span className="font-semibold text-slate-700">{leaf.namobjRanperda}</span>
                                                                      ) : (
                                                                        <span className="text-slate-400 italic">Tidak Disebutkan</span>
                                                                      )}
                                                                      {leaf.pasalAyat && leaf.pasalAyat !== '-' && (
                                                                        <span className="block text-[9px] font-mono font-bold text-blue-700 mt-0.5 uppercase tracking-wider">
                                                                          📌 {leaf.pasalAyat}
                                                                        </span>
                                                                      )}
                                                                    </td>

                                                                    <td className="py-2 px-3 border-r border-slate-100 font-mono text-[9px] text-slate-605 leading-relaxed max-w-[150px]">
                                                                      {leaf.distrikPivot.length > 0 ? leaf.distrikPivot.join(', ') : <span className="text-slate-400 italic">tidak terpetakan</span>}
                                                                    </td>

                                                                    <td className="py-2 px-3 border-r border-slate-100 font-mono text-[9px] text-slate-605 leading-relaxed max-w-[150px]">
                                                                      {leaf.distrikRanperda.length > 0 ? leaf.distrikRanperda.join(', ') : <span className="text-slate-400 italic">tidak disebutkan</span>}
                                                                    </td>

                                                                    <td className="py-2 px-2 border-r border-slate-100 text-center">
                                                                      {leaf.statusNamobj === 'Sesuai' ? (
                                                                        <span className="bg-emerald-100 text-emerald-800 border border-emerald-200 px-1.5 py-0.5 rounded text-[9px] font-bold">SESUAI</span>
                                                                      ) : leaf.statusNamobj === 'Tidak Ditemukan' ? (
                                                                        <span className="bg-rose-100 text-rose-800 border border-rose-200 px-1.5 py-0.5 rounded text-[9px] font-bold">TIDAK ADA</span>
                                                                      ) : leaf.statusNamobj === 'Tidak Dicek' ? (
                                                                        <span className="bg-slate-100 border border-slate-200 text-slate-500 px-1.5 py-0.5 rounded text-[9px] font-bold">BYPASS</span>
                                                                      ) : leaf.statusNamobj === 'Tidak Dapat Diverifikasi' ? (
                                                                        <span className="bg-indigo-100 text-indigo-800 border border-indigo-200 px-1.5 py-0.5 rounded text-[9px] font-bold">LAMPIRAN</span>
                                                                      ) : (
                                                                        <span className="bg-amber-100 text-amber-800 border border-amber-200 px-1.5 py-0.5 rounded text-[9px] font-bold">CHECK</span>
                                                                      )}
                                                                    </td>

                                                                    <td className="py-2 px-2 border-r border-slate-100 text-center">
                                                                      {leaf.statusDistrik === 'Sesuai' ? (
                                                                        <span className="bg-emerald-50 text-emerald-800 border border-emerald-250 px-1 py-0.5 rounded text-[9px] font-semibold">SINKRON</span>
                                                                      ) : leaf.statusDistrik === 'Tidak Sesuai' ? (
                                                                        <span className="bg-rose-50 text-rose-800 border border-rose-200 px-1 py-0.5 rounded text-[9px] font-semibold">SELISIH</span>
                                                                      ) : leaf.statusDistrik === 'Diperiksa' ? (
                                                                        <span className="bg-blue-50 text-blue-800 border border-blue-200 px-1 py-0.5 rounded text-[9px] font-semibold">CHECK</span>
                                                                      ) : (
                                                                        <span className="bg-slate-50 text-slate-600 border border-slate-150 px-1 py-0.5 rounded text-[9px] font-semibold">INFO</span>
                                                                      )}
                                                                    </td>

                                                                    <td className="py-2 px-2 text-center">
                                                                      <div className="flex flex-col items-center gap-0.5">
                                                                        {leaf.statusOverall === 'Sesuai' ? (
                                                                          <span className="bg-emerald-600 text-white px-2 py-0.5 rounded text-[10px] font-bold block w-full text-center shadow-sm">SESUAI</span>
                                                                        ) : leaf.statusOverall === 'Tidak Sesuai' ? (
                                                                          <span className="bg-rose-600 text-white px-2 py-0.5 rounded text-[10px] font-bold block w-full text-center shadow-sm">SELISIH</span>
                                                                        ) : leaf.statusOverall === 'Tidak Dapat Diverifikasi' ? (
                                                                          <span className="bg-indigo-600 text-white px-1.5 py-0.5 rounded text-[9px] font-extrabold tracking-tight uppercase block w-full text-center shadow-sm">LAMPIRAN</span>
                                                                        ) : (
                                                                          <span className="bg-rose-600 text-white px-2 py-0.5 rounded text-[10px] font-bold block w-full text-center shadow-sm">SELISIH</span>
                                                                        )}
                                                                        {leaf.catatan && (
                                                                          <span className="block text-[8px] text-slate-550 font-sans italic max-w-[120px] line-clamp-2 mt-0.5 leading-tight">
                                                                            💡 {leaf.catatan}
                                                                          </span>
                                                                        )}
                                                                      </div>
                                                                    </td>
                                                                  </tr>
                                                                );
                                                              })}
                                                            </tbody>
                                                          </table>
                                                        </div>
                                                      )}
                                                    </div>
                                                  );
                                                })}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* TAB CONTENT: ACTIONABLE CRUCIAL TEMUAN */}
            {selectedSubTab === 'catatan' && (
              <div className="bg-white p-6 border border-slate-200 shadow-sm space-y-6">
                <div className="flex justify-between items-center pb-4 border-b border-slate-100">
                  <div>
                    <h3 className="text-sm font-display font-bold text-slate-900 tracking-tight uppercase">
                      Daftar Temuan Inkonsistensi Struktur Ruang
                    </h3>
                    {(() => {
                      const list = getStrukturActionableList();
                      return (
                        <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                          Sistem mendeteksi <b>{list.length} usulan tindakan koreksi</b> untuk mematangkan keselarasan spasial draf peraturan daerah.
                        </p>
                      );
                    })()}
                  </div>
                  <span className="px-2.5 py-1 bg-red-100 text-red-800 rounded text-xs font-semibold font-mono border border-red-200 tracking-widest">
                    MUTU RTRW
                  </span>
                </div>

                {(() => {
                  const list = getStrukturActionableList();
                  if (list.length === 0) {
                    return (
                      <div className="py-12 text-center text-slate-450 space-y-2">
                        <CheckCircle2 className="w-12 h-12 text-green-600 mx-auto" />
                        <p className="font-bold text-sm text-slate-700 uppercase tracking-wider">Sempurna! Semua Sinkron.</p>
                        <p className="text-xs leading-relaxed max-w-md mx-auto">Seluruh prasarana regional dan sebaran administratif distrik sinkron 100% antara draf hukum dan peta GIS.</p>
                      </div>
                    );
                  }
                  return (
                    <div className="space-y-4">
                      {list.map((item, index) => (
                        <div key={index} className={`p-4 border flex gap-3.5 items-start ${
                          item.type === 'spasial' 
                            ? 'bg-rose-50/40 border-rose-200 text-slate-800' 
                            : item.type === 'distrik'
                            ? 'bg-amber-50/30 border-amber-200 text-slate-800'
                            : 'bg-emerald-50/20 border-emerald-200 text-slate-800'
                        }`}>
                          <span className="mt-1 flex-shrink-0">
                            {item.type === 'spasial' ? (
                              <XCircle className="w-4 h-4 text-red-650" />
                            ) : item.type === 'distrik' ? (
                              <AlertTriangle className="w-4 h-4 text-yellow-600" />
                            ) : (
                              <Info className="w-4 h-4 text-blue-600" />
                            )}
                          </span>

                          <div className="space-y-1 text-xs">
                            <h4 className="font-bold text-slate-900 uppercase tracking-tight text-[11px]">
                              {item.title}
                            </h4>
                            <p className="text-slate-600 leading-relaxed italic">
                              {item.text}
                            </p>
                            <div className="flex gap-2 text-[10px] font-mono mt-1">
                              <span>Rekomendasi Mutu:</span>
                              <span className="text-slate-500 underline uppercase tracking-tight">
                                {item.type === 'spasial'
                                  ? 'Koreksi draf/peta agar nama & klasifikasi prasarana sinkron murni.'
                                  : item.type === 'distrik'
                                  ? 'Ubah wilayah administratif di draf pasal seketika agar merujuk peta SIG.'
                                  : 'Review penyamaan penamaan istilah di draf agar persis standard remark peta.'}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* TAB CONTENT: PIVOT DETAILS */}
            {selectedSubTab === 'pivot' && (
              <div className="bg-white p-6 border border-slate-200 shadow-sm space-y-6">
                <div className="pb-4 border-b border-slate-100">
                  <h3 className="text-sm font-display font-bold text-slate-900 tracking-tight uppercase">
                    Rincian Spasial Struktur Ruang GIS (Multi-Sheet Excel)
                  </h3>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    Menampilkan list lengkap objek dari sheet <b>INFRASTRUKTUR</b> dan <b>JARINGAN</b> beserta sebaran distrik administratifnya.
                  </p>
                </div>

                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {(Object.values(pivotData) as StrukturPivotItem[]).map((item, id) => (
                    <div key={id} className="p-4 border border-slate-200 bg-slate-50/30 flex flex-col justify-between">
                      <div>
                        <div className="flex justify-between items-start gap-2">
                          <span className="font-bold text-slate-800 text-xs line-clamp-1">{item.namobj}</span>
                          <span className={`text-[9px] font-mono font-semibold px-2 py-0.5 uppercase ${
                            item.type === 'Jaringan' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                          }`}>
                            {item.type === 'Jaringan' ? 'JARINGAN' : 'INFRA'}
                          </span>
                        </div>
                        <p className="text-xs font-semibold text-slate-650 mt-2">
                          Remark: <span className="text-slate-900 font-mono italic">{item.remark || '-'}</span>
                        </p>
                      </div>

                      <div className="border-t border-slate-200/60 mt-3 pt-2">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Distrik Koordinat Spasial:</span>
                        <p className="text-[10px] text-slate-500 mt-1 leading-relaxed font-mono line-clamp-2">
                          {item.districts.join(', ') || 'tidak merincikan distrik'}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* RIGHT WORKSPACE: Sidebar stats */}
          <div className="w-full lg:w-72 flex flex-col gap-6 shrink-0 no-print">
            <div className="bg-white border border-slate-200 p-5 shadow-sm">
              <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4">Ringkasan Temuan</h3>
              <div className="space-y-3">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-600 font-medium">✔ Spasial Sesuai</span>
                  <span className="font-bold text-green-600">{analysisStats.sesuai} Objek</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-600 font-medium">✖ Selisih Spasial</span>
                  <span className="font-bold text-red-600">{analysisStats.tidakDitemukan} Objek</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-600 font-medium">⚠ Selisih Distrik</span>
                  <span className="font-bold text-yellow-600">{analysisStats.tidakSesuai} Kasus</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-600 font-medium">ℹ Perlu Verifikasi</span>
                  <span className="font-bold text-blue-600">{analysisStats.perluDicek} Objek</span>
                </div>
                <div className="pt-3 mt-3 border-t border-slate-100 flex justify-between items-center text-xs">
                  <span className="font-bold uppercase tracking-wider text-slate-700 text-[10px]">TOTAL ANALISIS</span>
                  <span className="font-bold text-slate-900 text-sm font-display">{analysisResults.length}</span>
                </div>
              </div>
            </div>

            {/* Catatan Perbaikan Sidebar */}
            <div className="bg-white border border-slate-200 p-5 shadow-sm overflow-hidden flex flex-col">
              <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4">Catatan Perbaikan</h3>
              <div className="overflow-auto space-y-4 max-h-[280px] divide-y divide-slate-100">
                {(() => {
                  const list = getStrukturActionableList();
                  if (list.length === 0) {
                    return <p className="text-xs text-slate-450 italic font-medium pt-2">Seluruh penyebutan draf sejalan dengan basis spasial.</p>;
                  }
                  return list.slice(0, 4).map((f, i) => (
                    <div key={i} className="text-[11px] leading-relaxed pt-3 first:pt-0">
                      <p className={`font-bold mb-1 ${
                        f.type === 'spasial' ? 'text-red-600' : 'text-yellow-650 text-yellow-600'
                      }`}>
                        {f.title.length > 30 ? f.title.substring(0, 30) + '...' : f.title}
                      </p>
                      <p className="text-slate-500 italic line-clamp-3">
                        {f.text}
                      </p>
                    </div>
                  ));
                })()}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* STRUKTUR RUANG STATIC CONCLUSION CARD */}
      {analysisResults && analysisStats && !isLoading && (
        <div className="bg-slate-900 text-white p-6 md:p-8 shadow-sm space-y-4 mt-6">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 bg-blue-600 flex items-center justify-center font-bold text-[10px]">i</div>
            <h3 className="text-xs font-display font-bold text-white tracking-widest uppercase">
              KESIMPULAN & REKOMENDASI PENJAMINAN MUTU STRUKTUR RUANG
            </h3>
          </div>

          <div className="text-xs space-y-3 leading-relaxed text-slate-350">
            <p>
              Berdasarkan audit silang dokumen draf Struktur Ruang Kabupaten {countyName} terhadap basis spasial SIG (Sheet Infrastruktur & Jaringan Excel), berikut butir perbaikan legislatif:
            </p>
            
            <ul className="list-disc pl-5 space-y-2 text-[11px] text-slate-350">
              {analysisStats.tidakDitemukan > 0 ? (
                <li>
                  <b>Ketimpangan Dokumen vs Geospasial Spasial:</b> Ditemukan {analysisStats.tidakDitemukan} prasarana pembangunan yang terlampir di draf pasal hukum namun tidak tergambar murni di peta spasial GIS (atau sebaliknya). Hal ini berpotensi membongkar kesepakatan tata ruang strategis. Direkomendasikan menyamakan penyebutan istilah objek pembangunan regional.
                </li>
              ) : (
                <li>
                  <b>Keselarasan Geospasial Spasial (100% SINKRON):</b> Seluruh prasarana (infrastruktur titik & garis lintasan jaringan) berkoordinat tepat beriringan persis draf draf tekstual naskah hukum.
                </li>
              )}

              {analysisStats.tidakSesuai > 0 ? (
                <li>
                  <b>Penyimpangan Sebaran Kewilayahan Administratif:</b> Teridentifikasi {analysisStats.tidakSesuai} kasus selisih regional pemanfaatan kawasan. Beberapa distrik draf Perda terdeteksi tidak menampung garis/koordinat prasarana tersebut, atau sebaliknya peta SIG melangkahi distrik tanpa pelestarian klausul hukum draf Perda.
                </li>
              ) : (
                <li>
                  <b>Kepatuhan Sebaran Administratif (100% SINKRON):</b> Pembagian kecamatan/distrik atas sebaran perlintasan prasarana telah cocok sempurna tanpa sisa.
                </li>
              )}

              <li>
                <b>Uji Tipologi Prasarana:</b> Sistem memetakan secara andal klausul Jaringan (perlintasan linear, contoh: jalan kolektor, transmisi listrik) vs Infrastruktur (keberadaan titik lokal, contoh: pusat pemukiman perkotaan, gardu distribusi, pelabuhan penyeberangan) untuk menjamin simplifikasi drafting perundang-undangan nasional.
              </li>
            </ul>

            <p className="text-[10px] text-slate-500 italic pt-2 border-t border-slate-800">
              * Laporan ini dihasilkan secara otomatis oleh sistem penjaminan mutu struktur ruang RTRW berbasis deteksi teks dinamis.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
