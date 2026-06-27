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
  BookOpen, 
  ClipboardList, 
  CheckCircle,
  AlertCircle
} from 'lucide-react';
import { 
  ConsistencyResult, 
  SummaryStats, 
  EXCEL_MAPPING, 
  PivotItem 
} from '../../utils/types';
import { 
  analyzeConsistency, 
  parsePivotExcel 
} from '../../utils/utils';
import { 
  RAW_RANPERDA_DEMO_TEXT, 
  PIVOT_DEMO_DATA 
} from '../demoData';

export default function PolaRuangSubstansiTab() {
  const [ranperdaText, setRanperdaText] = useState<string>("");
  const [ranperdaFileName, setRanperdaFileName] = useState<string>("");
  const [pivotData, setPivotData] = useState<Record<string, PivotItem>>({});
  const [pivotFileName, setPivotFileName] = useState<string>("");

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [isDemoMode, setIsDemoMode] = useState<boolean>(false);

  const [analysisResults, setAnalysisResults] = useState<ConsistencyResult[] | null>(null);
  const [analysisStats, setAnalysisStats] = useState<SummaryStats | null>(null);
  const [countyName, setCountyName] = useState<string>("");
  const [selectedSubTab, setSelectedSubTab] = useState<'laporan' | 'catatan' | 'pivot'>('laporan');

  const startConsistencyCheck = (rText: string, pData: Record<string, PivotItem>) => {
    if (!rText) {
      setErrorMessage("Harap lengkapi file Draft Ranperda (.docx) terlebih dahulu.");
      return;
    }
    if (Object.keys(pData).length === 0) {
      setErrorMessage("Harap lengkapi file Pivot Pola Ruang (.xlsx) terlebih dahulu.");
      return;
    }

    setErrorMessage("");
    setIsLoading(true);
    setStatusMessage("Menganalisis sinkronisasi spasial pola ruang...");

    setTimeout(() => {
      try {
        const { results, stats, kabupaten } = analyzeConsistency(rText, pData);
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
    setRanperdaText(RAW_RANPERDA_DEMO_TEXT);
    setRanperdaFileName("Draft_Ranperda_RTRW_TelukWondama_Demo.docx");
    setPivotData(PIVOT_DEMO_DATA);
    setPivotFileName("Pivot_Pola_Ruang_TelukWondama_Demo.xlsx");
    setIsDemoMode(true);
    setErrorMessage("");

    setIsLoading(true);
    setStatusMessage("Memuat data simulasi Pola Ruang Kabupaten Teluk Wondama...");
    setTimeout(() => {
      const { results, stats, kabupaten } = analyzeConsistency(RAW_RANPERDA_DEMO_TEXT, PIVOT_DEMO_DATA);
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
    setStatusMessage("Mengurai pivot tabel GIS dari Excel sheet...");

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        
        const targetSheetName = "Pola Ruang";
        if (!workbook.SheetNames.includes(targetSheetName)) {
          setErrorMessage("Sheet 'Pola Ruang' tidak ditemukan pada file pivot.");
          setIsLoading(false);
          return;
        }
        
        const worksheet = workbook.Sheets[targetSheetName];
        const parsed = parsePivotExcel(worksheet);
        if (Object.keys(parsed).length === 0) {
          setErrorMessage("Tidak ada data spasial pola ruang (NAMOBJ) yang terdeteksi di sheet 'Pola Ruang'. Pastikan format tabel sesuai template.");
          setIsLoading(false);
          return;
        }
        setPivotData(parsed);
        setPivotFileName(file.name);
        setIsDemoMode(false);
        setIsLoading(false);
      } catch (err: any) {
        console.error(err);
        setErrorMessage("Gagal mengurai file Excel Pivot. Silakan pastikan data baris & kolom sesuai panduan.");
        setIsLoading(false);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const exportToCSV = () => {
    if (!analysisResults || analysisResults.length === 0) return;
    let csvContent = "\uFEFF";
    const headers = [
      "Pasal/Ayat",
      "Kode",
      "Nama Kawasan",
      "Ranperda (ha)",
      "Pivot (ha)",
      "Status Luas",
      "Catatan Luas",
      "Distrik (Ranperda)",
      "Distrik (Pivot)",
      "Status Distrik",
      "Keterangan/Saran"
    ];
    csvContent += headers.map(h => `"${h}"`).join(",") + "\r\n";
    analysisResults.forEach(r => {
      const row = [
        r.pasalAyat,
        r.kode,
        r.namaKawasan,
        r.ranperdaLuas !== null ? r.ranperdaLuas : "-",
        r.pivotLuasRounded !== null ? r.pivotLuasRounded : "-",
        r.luasStatus,
        r.luasCatatan,
        r.ranperdaDistrik.join(', '),
        r.pivotDistrik.join(', '),
        r.distrikStatus,
        r.keterangan || "-"
      ];
      csvContent += row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(",") + "\r\n";
    });
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `Laporan_Konsistensi_PolaRuang_${countyName.replace(/\s+/g, '_')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getActionableChecklist = () => {
    if (!analysisResults) return [];
    const checklist: { type: 'rounding' | 'spelling' | 'ambient' | 'distrik' | 'total', title: string, text: string, item: ConsistencyResult }[] = [];
    
    analysisResults.forEach(r => {
      if (r.luasStatus === 'PERLU_DICEK') {
        checklist.push({
          type: 'ambient',
          title: `PERLU VERIFIKASI: ${r.pasalAyat}`,
          text: r.luasCatatan,
          item: r
        });
      }
      if (r.luasStatus === 'TIDAK_SESUAI' && r.ranperdaLuas !== null && r.pivotLuasRounded !== null) {
        const diff = Math.abs(r.ranperdaLuas - r.pivotLuasRounded);
        const isSmall = diff <= 2;
        if (!r.isPasalTotal) {
          checklist.push({
            type: isSmall ? 'rounding' : 'total',
            title: `SELISIH LUAS: ${r.pasalAyat} (${r.namaKawasan})`,
            text: isSmall 
              ? `Selisih minor ${diff} ha. Hal ini wajar akibat toleransi pembulatan desimal GIS. Di Ranperda tertulis ${r.ranperdaLuas} ha vs Pivot ${r.pivotLuasRounded} ha.`
              : `Perbedaan luas krusial sebesar ${diff} ha. (Di Ranperda tertulis ${r.ranperdaLuas} ha vs Pivot ${r.pivotLuasRounded} ha). Dokumen hukum wajib dikoreksi sesuai SIG.`,
            item: r
          });
        } else {
          checklist.push({
            type: 'total',
            title: `SELISIH PASAL AGREGASI: ${r.pasalAyat} (${r.namaKawasan})`,
            text: `Jumlah luas draf (${r.ranperdaLuas} ha) tidak sama dengan penjumlahan manual sub-kawasan yang telah dibulatkan (${r.pivotLuasRounded} ha). Selisih ${diff} ha.`,
            item: r
          });
        }
      }
      if (r.keterangan && r.keterangan.includes('Terbilang salah')) {
        checklist.push({
          type: 'spelling',
          title: `KESALAHAN TERBILANG: ${r.pasalAyat} (${r.namaKawasan})`,
          text: `${r.keterangan}. Angka luas kuantitatif (${r.ranperdaLuas} ha) sudah sinkron, namun draf narasi terbilang tidak konsisten.`,
          item: r
        });
      }
    });
    return checklist;
  };

  const actionableList = getActionableChecklist();

  const getLuasBadgeClass = (status: string, hasKeterangan: boolean) => {
    if (status === 'SESUAI') {
      return hasKeterangan 
        ? "border-2 border-dashed border-green-600 bg-green-50 text-green-700 px-2 py-0.5 rounded text-[10px] font-bold"
        : "bg-green-100 text-green-700 px-2 py-1 rounded text-[10px] font-bold";
    }
    if (status === 'TIDAK_SESUAI') return "bg-red-100 text-red-700 px-2 py-1 rounded text-[10px] font-bold";
    if (status === 'PERLU_DICEK') return "bg-yellow-100 text-yellow-700 px-2 py-1 rounded text-[10px] font-bold uppercase";
    return "bg-blue-100 text-blue-700 px-2 py-1 rounded text-[10px] font-bold"; // INFO
  };

  const getDistrikBadgeClass = (status: string) => {
    if (status === 'SESUAI') return "bg-green-100 text-green-700 px-2 py-1 rounded text-[10px] font-bold";
    if (status === 'TIDAK_SESUAI') return "bg-red-100 text-red-700 px-2 py-1 rounded text-[10px] font-bold";
    return "bg-blue-100 text-blue-700 px-2 py-1 rounded text-[10px] font-bold"; // INFO
  };

  const getUnmappedPivotItems = () => {
    return Object.keys(pivotData).filter(namobj => {
      return !EXCEL_MAPPING.some(m => m.namobj === namobj);
    });
  };
  const unmappedKeys = getUnmappedPivotItems();
  const showUploader = !analysisResults;

  return (
    <div className="space-y-6">
      {/* LANDING PAGE / FILES UPLOADER FORM */}
      {showUploader && (
        <div className="space-y-6 no-print max-w-5xl mx-auto">
          {/* Banner Description */}
          <div className="bg-slate-900 text-white p-8 md:p-10 border border-slate-800 shadow-md space-y-4 relative overflow-hidden">
            <span className="inline-block px-3 py-1 bg-blue-500/20 text-blue-400 text-[10px] font-bold tracking-widest uppercase border border-blue-500/30">
              Penjaminan Mutu Hukum & Spasial • Pola Ruang
            </span>
            <h2 className="text-2xl md:text-3xl font-display font-bold text-white tracking-tight max-w-3xl uppercase">
              Verifikasi Konsistensi draf hukum rtrw terhadap database spasial gis (Pola Ruang)
            </h2>
            <p className="text-slate-300 text-xs md:text-sm max-w-3xl leading-relaxed font-sans font-medium">
              Platform penjaminan mutu tata ruang digital untuk menganalisis akurasi data. Sistem ini mengekstrak kandungan draf peraturan daerah (.docx) lalu mengauditnya silang terhadap tabel pivot spasial GIS (.xlsx) untuk memverifikasi keselarasan kuantitatif luas lahan (ha), kebenaran penulisan "terbilang" bahasa Indonesia, serta keabsahan administratif sebaran distrik demi meminimalkan gugatan sengketa hukum spasial.
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
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-red-650 text-red-650 text-red-605" />
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
                  <span className="text-xs font-mono font-bold tracking-wider text-slate-400 uppercase">FILE 01 / DRAFT RANPERDA</span>
                </div>
                <div>
                  <h3 className="font-display font-bold text-slate-800 text-sm uppercase tracking-wide">
                    Draf Ranperda RTRW (.docx)
                  </h3>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    Dokumen naskah draf undang-undang daerah. Setiap kategori pemanfaatan dideklarasikan dalam format pasal, jumlah luas ha, serta sebaran administratif kecamatan/distrik.
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

            {/* File 2: Pivot Pola Ruang */}
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
                    Pivot Tabel Pola Ruang (.xlsx)
                  </h3>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    Laporan spasial keluaran Sistem Informasi Geodetik (SIG). Skema kolom wajib memuat: NAMOBJ, WADMKC, serta Sum of LUASHA.
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
                    Kategori ditemukan: {Object.keys(pivotData).slice(0, 5).join(', ')}...
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Action Trigger button */}
          <div className="flex justify-end pt-4">
            <button
              onClick={() => startConsistencyCheck(ranperdaText, pivotData)}
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

      {/* DETAILED ANALYSIS REPORT WORKSPACE */}
      {analysisResults && analysisStats && !isLoading && (
        <div className="flex flex-col lg:flex-row gap-6 items-start">
          {/* LEFT WORKSPACE: Main Content */}
          <div className="flex-1 lg:flex-[3] w-full flex flex-col gap-6">
            
            {/* Header Laporan Info panel */}
            <div className="bg-white p-6 border border-slate-200 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div>
                <span className="px-2.5 py-1 bg-slate-950 text-white text-[10px] font-bold tracking-widest uppercase font-mono">
                  LAPORAN HASIL SINKRONISASI
                </span>
                <h2 className="text-xl font-display font-bold text-slate-900 mt-2 tracking-tight uppercase">
                  KONSISTENSI DATA POLA RUANG KABUPATEN {countyName.toUpperCase()}
                </h2>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500 mt-1 font-mono">
                  <span>Draft: <span className="text-slate-800 font-bold">{ranperdaFileName}</span></span>
                  <span>•</span>
                  <span>Pivot GIS: <span className="text-slate-800 font-bold">{pivotFileName}</span></span>
                </div>
              </div>

              {/* Action Buttons: Export / Print */}
              <div className="flex flex-wrap gap-2 w-full md:w-auto mt-2 md:mt-0 no-print">
                <button
                  onClick={exportToCSV}
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

            {/* Hint for Printer */}
            <div className="bg-blue-50 border border-blue-200 text-blue-900 p-4 flex items-start gap-3 shadow-sm no-print">
              <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div className="text-xs">
                <p className="font-bold uppercase tracking-wider text-[10px] text-blue-800">Tips Cetak PDF:</p>
                <p className="text-blue-700 mt-0.5 leading-relaxed font-medium">
                  Saat dialog cetak muncul, gunakan orientasi <b>Landscape</b> (Mendatar) dan centang opsi <b>"Background Graphics"</b> agar warna status badge tampil dengan presisi pada laporan fisik Anda.
                </p>
              </div>
            </div>

            {/* REPORT NAVIGATION TABS */}
            <div className="border-b border-slate-200 flex flex-wrap gap-2 no-print bg-white p-2 border border-slate-200 shadow-sm">
              <button
                onClick={() => setSelectedSubTab('laporan')}
                className={`py-2 px-4 text-[10px] font-display font-medium border-b-2 tracking-widest uppercase transition cursor-pointer ${
                  selectedSubTab === 'laporan'
                    ? 'border-blue-500 text-slate-900 font-bold'
                    : 'border-transparent text-slate-500 hover:text-slate-900'
                }`}
              >
                <div className="flex items-center gap-2">
                  <BookOpen className="w-3.5 h-3.5" />
                  Tabel Utama Laporan
                </div>
              </button>
              <button
                onClick={() => setSelectedSubTab('catatan')}
                className={`py-2 px-4 text-[10px] font-display font-medium border-b-2 tracking-widest uppercase transition relative cursor-pointer ${
                  selectedSubTab === 'catatan'
                    ? 'border-blue-500 text-slate-900 font-bold'
                    : 'border-transparent text-slate-500 hover:text-slate-900'
                }`}
              >
                <div className="flex items-center gap-2">
                  <ClipboardList className="w-3.5 h-3.5" />
                  Daftar Temuan Krusial
                  {actionableList.length > 0 && (
                    <span className="px-1.5 py-0.5 text-[9px] bg-red-650 bg-red-650 bg-red-600 text-white font-bold font-mono">
                      {actionableList.length}
                    </span>
                  )}
                </div>
              </button>
              <button
                onClick={() => setSelectedSubTab('pivot')}
                className={`py-2 px-4 text-[10px] font-display font-medium border-b-2 tracking-widest uppercase transition cursor-pointer ${
                  selectedSubTab === 'pivot'
                    ? 'border-blue-500 text-slate-900 font-bold'
                    : 'border-transparent text-slate-500 hover:text-slate-900'
                }`}
              >
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  Data Spasial Pivot ({Object.keys(pivotData).length})
                </div>
              </button>
            </div>

            {/* TAB CONTENT: MAIN TABLE */}
            {selectedSubTab === 'laporan' && (
              <div className="space-y-6">
                
                {/* Legend wrapper */}
                <div className="bg-white p-4 border border-slate-200 shadow-sm flex flex-wrap gap-3 md:gap-4 justify-between items-center text-[10px] text-slate-500 no-print">
                  <div className="font-bold text-slate-600 uppercase tracking-widest">LEGENDA STATUS BADGE:</div>
                  <div className="flex flex-wrap gap-4 items-center">
                    <span className="flex items-center gap-1.5 font-bold"><span className="w-2.5 h-2.5 bg-green-500 inline-block"></span> SESUAI (Sinkron)</span>
                    <span className="flex items-center gap-1.5 font-bold"><span className="w-2.5 h-2.5 border-2 border-dashed border-green-600 bg-green-50 inline-block"></span> SESUAI* (Teks terbilang salah)</span>
                    <span className="flex items-center gap-1.5 font-bold"><span className="w-2.5 h-2.5 bg-red-500 inline-block"></span> TIDAK SESUAI</span>
                    <span className="flex items-center gap-1.5 font-bold"><span className="w-2.5 h-2.5 bg-yellow-500 inline-block"></span> PERLU CEK</span>
                    <span className="flex items-center gap-1.5 font-bold"><span className="w-2.5 h-2.5 bg-blue-500 inline-block"></span> INFO AGREGASI</span>
                  </div>
                </div>

                {/* SCROLLABLE TABLE FRAME */}
                <div className="flex flex-col bg-white border border-slate-200 shadow-sm overflow-hidden">
                  <div className="overflow-x-auto overflow-y-auto">
                    <table className="w-full text-[11px] text-left border-collapse table-auto min-w-[1240px]">
                      <thead className="bg-slate-800 text-white font-display text-[11px] uppercase tracking-wider sticky top-0 z-10">
                        <tr>
                          <th className="p-3 border-r border-slate-700 font-semibold uppercase tracking-wider sticky left-0 bg-slate-800 z-10 w-[140px] shadow-[2px_0_5px_rgba(0,0,0,0.1)]">Pasal/Ayat</th>
                          <th className="p-3 border-r border-slate-700 font-semibold uppercase tracking-wider text-center w-[60px]">Kode</th>
                          <th className="p-3 border-r border-slate-700 font-semibold uppercase tracking-wider sticky left-[140px] bg-slate-800 z-10 w-[240px] shadow-[2px_0_5px_rgba(0,0,0,0.1)]">Nama Kawasan Pola Ruang</th>
                          <th className="p-3 border-r border-slate-700 font-semibold text-right w-[110px]">Ranperda (ha)</th>
                          <th className="p-3 border-r border-slate-700 font-semibold text-right w-[110px]">Pivot (ha)</th>
                          <th className="p-3 border-r border-slate-700 font-semibold text-center w-[120px]">Status Luas</th>
                          <th className="p-3 border-r border-slate-700 font-semibold max-w-[250px]">Catatan Luas</th>
                          <th className="p-3 border-r border-slate-700 font-semibold min-w-[180px]">Distrik (Ranperda)</th>
                          <th className="p-3 border-r border-slate-700 font-semibold min-w-[180px]">Distrik (Pivot)</th>
                          <th className="p-3 border-r border-slate-700 font-semibold text-center w-[120px]">Status Distrik</th>
                          <th className="p-3 font-semibold min-w-[160px]">Keterangan</th>
                        </tr>
                      </thead>

                      <tbody className="divide-y divide-slate-150">
                        {analysisResults.map((row, index) => {
                          const parts: React.ReactNode[] = [];
                          
                          if (index === 0) {
                            parts.push(
                              <tr key="sub-hdr-1" className="bg-slate-100 font-semibold text-slate-800 border-b border-slate-200">
                                <td colSpan={11} className="p-2 px-3 font-display font-bold text-slate-500 border-y border-slate-200 uppercase tracking-tighter text-[11px]">
                                  BAB V — KAWASAN LINDUNG (Rencana Keberlanjutan Alamiah)
                                </td>
                              </tr>
                            );
                          } else if (index === 7) { 
                            parts.push(
                              <tr key="sub-hdr-2" className="bg-slate-100 font-semibold text-slate-800 border-y border-slate-200">
                                <td colSpan={11} className="p-2 px-3 font-display font-bold text-slate-500 border-y border-slate-200 uppercase tracking-tighter text-[11px]">
                                  BAB V — KAWASAN BUDI DAYA (Kawasan Pemanfaatan Sosio-Ekonomi)
                                </td>
                              </tr>
                            );
                          }
                          
                          parts.push(
                            <tr key={row.pasalAyat + index} className={`hover:bg-slate-50/70 transition border-b border-slate-100 ${
                              index % 2 === 1 ? 'bg-slate-50/50' : 'bg-white'
                            } ${
                              row.luasStatus === 'TIDAK_SESUAI' || row.distrikStatus === 'TIDAK_SESUAI' ? 'bg-rose-50/20' : ''
                            }`}>
                              <td className="p-3 font-medium text-slate-500 sticky left-0 bg-inherit z-10 font-mono text-[11px] shadow-[2px_0_5px_rgba(0,0,0,0.02)] border-r border-slate-200 whitespace-nowrap">
                                {row.pasalAyat}
                              </td>
                              <td className="p-3 text-center border-r border-slate-200">
                                <span className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 font-mono text-[10px]">{row.kode}</span>
                              </td>
                              <td className="p-3 font-semibold text-slate-700 sticky left-[140px] bg-inherit z-10 shadow-[2px_0_5px_rgba(0,0,0,0.02)] border-r border-slate-200 leading-tight">
                                {row.namaKawasan}
                              </td>
                              <td className="p-3 text-right font-mono font-bold text-slate-800 border-r border-slate-200">
                                {row.ranperdaLuas !== null ? row.ranperdaLuas.toLocaleString('id-ID') : '-'}
                              </td>
                              <td className="p-3 text-right font-mono text-slate-650 border-r border-slate-200 text-slate-600">
                                {row.pivotLuasRounded !== null ? row.pivotLuasRounded.toLocaleString('id-ID') : '-'}
                              </td>
                              <td className="p-3 text-center border-r border-slate-200 whitespace-nowrap">
                                <span className={getLuasBadgeClass(row.luasStatus, !!row.keterangan)}>
                                  {row.luasStatus === 'SESUAI' ? (row.keterangan ? '✔* SESUAI*' : '✔ SESUAI') : ''}
                                  {row.luasStatus === 'TIDAK_SESUAI' && '✖ TIDAK SESUAI'}
                                  {row.luasStatus === 'PERLU_DICEK' && '⚠ PERLU CEK'}
                                  {row.luasStatus === 'INFO' && 'ℹ INFO'}
                                </span>
                              </td>
                              <td className="p-3 text-slate-500 leading-tight italic border-r border-slate-200 max-w-[250px]">
                                {row.luasCatatan}
                              </td>
                              <td className="p-3 text-slate-605 leading-tight min-w-[180px] border-r border-slate-200">
                                {row.ranperdaDistrik.length > 0 ? (
                                  <div className="flex flex-wrap gap-1">
                                    {row.ranperdaDistrik.map(d => (
                                      <span key={d} className="px-1.5 py-0.5 bg-slate-50 border border-slate-200 text-[10px]">{d}</span>
                                    ))}
                                  </div>
                                ) : (
                                  <span className="text-slate-400 italic">bukan sebaran rincian</span>
                                )}
                              </td>
                              <td className="p-3 text-slate-605 leading-tight min-w-[180px] border-r border-slate-200">
                                {row.isPasalTotal ? (
                                  <span className="text-slate-400 italic font-medium">pasal total agregasi</span>
                                ) : row.pivotDistrik.length > 0 ? (
                                  <div className="flex flex-wrap gap-1">
                                    {row.pivotDistrik.map(d => (
                                      <span key={d} className="px-1.5 py-0.5 bg-slate-50 border border-slate-200 text-[10px]">{d}</span>
                                    ))}
                                  </div>
                                ) : (
                                  <span className="text-slate-400 italic">tidak ditemukan</span>
                                )}
                              </td>
                              <td className="p-3 text-center border-r border-slate-200 whitespace-nowrap">
                                <span className={getDistrikBadgeClass(row.distrikStatus)}>
                                  {row.distrikStatus === 'SESUAI' && '✔ SESUAI'}
                                  {row.distrikStatus === 'TIDAK_SESUAI' && '✖ TIDAK SESUAI'}
                                  {row.distrikStatus === 'INFO' && 'ℹ INFO'}
                                </span>
                              </td>
                              <td className="p-3 text-slate-550 italic">
                                {row.keterangan || <span className="text-slate-300">-</span>}
                              </td>
                            </tr>
                          );
                          return parts;
                        })}
                      </tbody>
                    </table>
                  </div>
                  
                  {/* Table Footer */}
                  <div className="h-10 bg-slate-50 border-t border-slate-200 px-4 flex items-center text-[10px] text-slate-450 gap-4 no-print">
                    <div className="flex items-center gap-1.5 font-semibold text-slate-500"><div className="w-2 h-2 rounded-full bg-green-500"></div> Sesuai</div>
                    <div className="flex items-center gap-1.5 font-semibold text-slate-500"><div className="w-2 h-2 rounded-full bg-red-500"></div> Tidak Sesuai</div>
                    <div className="flex items-center gap-1.5 font-semibold text-slate-500"><div className="w-2 h-2 rounded-full bg-yellow-500"></div> Perlu Konfirmasi Manual</div>
                    <div className="flex items-center gap-1.5 font-semibold text-slate-500"><div className="w-2 h-2 rounded-full bg-blue-500"></div> Agregasi Total</div>
                  </div>
                </div>

                {/* Summary Matrix Table */}
                <div className="bg-white p-6 border border-slate-200 shadow-sm space-y-4">
                  <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    RINGKASAN MATRIX SINKRONISASI (GROUND TRUTH: PIVOT SIG)
                  </h3>
                  <div className="max-w-md overflow-hidden border border-slate-200 shadow-sm">
                    <table className="w-full text-left text-[11px] border-collapse">
                      <thead className="bg-slate-800 text-white font-mono text-[10px] uppercase tracking-wider">
                        <tr>
                          <th className="py-2.5 px-4 font-semibold border-r border-slate-700">Kategori Laporan Findings</th>
                          <th className="py-2.5 px-4 text-center font-semibold border-r border-slate-700">Cek Luas</th>
                          <th className="py-2.5 px-4 text-center font-semibold">Cek Distrik</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-150">
                        <tr className="hover:bg-slate-50/50">
                          <td className="py-2.5 px-4 font-bold text-green-700 bg-green-50/20 border-r border-slate-200">✔ SESUAI / SINKRON</td>
                          <td className="py-2.5 px-4 text-center font-mono font-bold text-slate-800 border-r border-slate-200">{analysisStats.luasSesuai}</td>
                          <td className="py-2.5 px-4 text-center font-mono font-bold text-slate-800">{analysisStats.distrikSesuai}</td>
                        </tr>
                        <tr className="hover:bg-slate-50/50">
                          <td className="py-2.5 px-4 font-bold text-red-700 bg-red-50/20 border-r border-slate-200">✖ TIDAK SINKRON</td>
                          <td className="py-2.5 px-4 text-center font-mono font-bold text-slate-800 border-r border-slate-200">{analysisStats.luasTidakSesuai}</td>
                          <td className="py-2.5 px-4 text-center font-mono font-bold text-slate-800">{analysisStats.distrikTidakSesuai}</td>
                        </tr>
                        <tr className="hover:bg-slate-50/50">
                          <td className="py-2.5 px-4 font-bold text-yellow-700 bg-yellow-50/20 border-r border-slate-200">⚠ PERLU VERIFIKASI</td>
                          <td className="py-2.5 px-4 text-center font-mono font-bold text-slate-800 border-r border-slate-200">{analysisStats.luasPerluDicek}</td>
                          <td className="py-2.5 px-4 text-center font-mono font-bold text-slate-800">-</td>
                        </tr>
                        <tr className="hover:bg-slate-50/50">
                          <td className="py-2.5 px-4 font-bold text-blue-700 bg-blue-50/20 border-r border-slate-200">ℹ INFO AGREGASI (Pasal Total)</td>
                          <td className="py-2.5 px-4 text-center font-mono font-bold text-slate-800 border-r border-slate-200">{analysisStats.luasInfo}</td>
                          <td className="py-2.5 px-4 text-center font-mono font-bold text-slate-800">{analysisStats.distrikInfo}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

              </div>
            )}

            {/* TAB CONTENT: ACTIONABLE CRUCIAL TEMUAN */}
            {selectedSubTab === 'catatan' && (
              <div className="bg-white p-6 border border-slate-200 shadow-sm space-y-6">
                <div className="flex justify-between items-center pb-4 border-b border-slate-100">
                  <div>
                    <h3 className="text-sm font-display font-bold text-slate-900 tracking-tight uppercase">
                      Daftar Temuan Inkonsistensi Pola Ruang
                    </h3>
                    <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                      Sistem mendeteksi <b>{actionableList.length} ketidaksesuaian</b> antara draf teks hukum dan database spasial SIG.
                    </p>
                  </div>
                  <span className="px-2.5 py-1 bg-red-100 text-red-800 rounded text-xs font-semibold font-mono border border-red-200 tracking-widest">
                    KOREKSI MUTLAK
                  </span>
                </div>

                {actionableList.length === 0 ? (
                  <div className="py-12 text-center text-slate-450 space-y-2">
                    <CheckCircle2 className="w-12 h-12 text-green-600 mx-auto" />
                    <p className="font-bold text-sm text-slate-700 uppercase tracking-wider">Luar Biasa! Tidak ada inkonsistensi yang dideteksi.</p>
                    <p className="text-xs leading-relaxed max-w-md mx-auto">Seluruh luas hektare, terbilang bahasa Indonesia, dan sebaran distrik telah sepenuhnya konsisten.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {actionableList.map((item, index) => (
                      <div key={index} className={`p-4 border flex gap-3.5 items-start ${
                        item.type === 'total' || item.type === 'distrik'
                          ? 'bg-rose-50/40 border-rose-200 text-slate-800' 
                          : item.type === 'spelling'
                          ? 'bg-emerald-50/20 border-emerald-200 text-slate-800'
                          : 'bg-amber-50/30 border-amber-200 text-slate-800'
                      }`}>
                        <span className="mt-1 flex-shrink-0">
                          {item.type === 'total' || item.type === 'distrik' ? (
                            <XCircle className="w-4 h-4 text-red-600" />
                          ) : item.type === 'spelling' ? (
                            <CheckCircle2 className="w-4 h-4 text-green-700" />
                          ) : (
                            <AlertTriangle className="w-4 h-4 text-yellow-600" />
                          )}
                        </span>

                        <div className="space-y-1 text-xs">
                          <h4 className="font-bold text-slate-900 uppercase tracking-tight text-[11px]">
                            {item.title}
                          </h4>
                          <p className="text-slate-650 leading-relaxed italic">
                            {item.text}
                          </p>
                          <div className="flex gap-2 text-[10px] font-mono text-slate-405 pt-1">
                            <span>Saran Legal:</span>
                            <span className="text-slate-500 underline uppercase tracking-tight">
                              {item.type === 'spelling' 
                                ? 'Revisi salinan redaksional draf terbilang di Ranperda.' 
                                : item.type === 'rounding' 
                                ? 'Dapat ditoleransi atau disesuaikan dengan nilai pembulatan.' 
                                : 'Sesuaikan salinan draf Perda agar menyalin data Spasial SIG secara mutlak.'}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* TAB CONTENT: PIVOT DETAILS */}
            {selectedSubTab === 'pivot' && (
              <div className="bg-white p-6 border border-slate-200 shadow-sm space-y-6">
                <div className="pb-4 border-b border-slate-100">
                  <h3 className="text-sm font-display font-bold text-slate-900 tracking-tight uppercase">
                    Rincian Database Spasial GIS (Excel)
                  </h3>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    Menampilkan seluruh kategori pemanfaatan pola ruang spasial kabupaten yang dibaca dari basis data pivot sheet.
                  </p>
                </div>

                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {Object.values(pivotData).map((prov: PivotItem) => (
                    <div key={prov.namobj} className="p-4 border border-slate-200 bg-slate-50/30 flex flex-col justify-between">
                      <div>
                        <div className="flex justify-between items-start gap-2">
                          <span className="font-bold text-slate-800 text-xs line-clamp-1">{prov.namobj}</span>
                          <span className="text-[9px] font-mono font-semibold text-slate-400 bg-slate-100 px-1.5 py-0.5 uppercase">TOTAL SIG</span>
                        </div>
                        <p className="text-lg font-display font-bold text-slate-900 mt-2">
                          {prov.totalLuas.toLocaleString('id-ID', { maximumFractionDigits: 3 })} <span className="text-xs font-normal text-slate-500 font-mono">ha</span>
                        </p>
                      </div>

                      <div className="border-t border-slate-200/60 mt-3 pt-2">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Sebaran Spasial:</span>
                        <p className="text-[10px] text-slate-500 mt-1 line-clamp-2 leading-relaxed font-mono">
                          {prov.districts.join(', ') || 'tidak merinci distrik'}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                {/* UNMAPPED PIVOT ITEMS */}
                {unmappedKeys.length > 0 && (
                  <div className="pt-6 border-t border-slate-100 space-y-3">
                    <h4 className="font-display font-semibold text-slate-800 text-xs uppercase tracking-wide flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-yellow-600" />
                      Kategori Pola Ruang Pivot Tidak Terpetakan ({unmappedKeys.length})
                    </h4>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      Kategori berikut terdeteksi di dalam pivot GIS spasial Anda, namun tidak diidentifikasikan di dalam standard mapping tabel hukum Ranperda RTRW.
                    </p>
                    <div className="flex flex-wrap gap-2 pt-1 font-mono">
                      {unmappedKeys.map(k => (
                        <span key={k} className="px-2.5 py-1 text-[10px] font-bold bg-red-50 text-red-805 border border-red-200">
                          {k} (Pivot: {pivotData[k]?.totalLuas.toLocaleString('id-ID')} ha)
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* RIGHT WORKSPACE: Sidebar stats */}
          <div className="w-full lg:w-72 flex flex-col gap-6 shrink-0 no-print">
            <div className="bg-white border border-slate-200 p-5 shadow-sm">
              <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4">Ringkasan Temuan</h3>
              <div className="space-y-3">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-600 font-medium">✔ Luas Sesuai</span>
                  <span className="font-bold text-green-600">{analysisStats.luasSesuai} Kawasan</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-600 font-medium">✖ Ketidaksesuaian Luas</span>
                  <span className="font-bold text-red-600">{analysisStats.luasTidakSesuai} Kawasan</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-600 font-medium">⚠ Perlu Verifikasi</span>
                  <span className="font-bold text-yellow-600">{analysisStats.luasPerluDicek} Kawasan</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-600 font-medium">ℹ Info Agregasi</span>
                  <span className="font-bold text-blue-600">{analysisStats.luasInfo} Kawasan</span>
                </div>
                <div className="pt-3 mt-3 border-t border-slate-100 flex justify-between items-center text-xs">
                  <span className="font-bold uppercase tracking-wider text-slate-700 text-[10px]">Total Kawasan</span>
                  <span className="font-bold text-slate-900 text-sm font-display">{analysisResults.length}</span>
                </div>
              </div>
            </div>

            {/* Catatan Perbaikan Sidebar */}
            <div className="bg-white border border-slate-200 p-5 shadow-sm">
              <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4">Catatan Perbaikan</h3>
              <div className="overflow-auto space-y-4 max-h-[280px] divide-y divide-slate-100">
                {actionableList.length === 0 ? (
                  <p className="text-xs text-slate-400 italic font-medium pt-2">Seluruh pemanfaatan ruang draf sinkron.</p>
                ) : (
                  actionableList.slice(0, 4).map((item, idx) => (
                    <div key={idx} className="text-[11px] leading-relaxed pt-3 first:pt-0">
                      <p className={`font-bold mb-1 ${
                        item.type === 'total' || item.type === 'distrik' ? 'text-red-600' : 'text-yellow-600'
                      }`}>
                        {item.title}
                      </p>
                      <p className="text-slate-500 italic line-clamp-3">
                        {item.text}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
