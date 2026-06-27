export interface MapItem {
  namobj: string;
  kode: string;
  namaRanperda: string;
  pasalUtama: string;
  isTotal?: boolean;
  childKodes?: string[];
}

export interface RanperdaData {
  pasalAyatRaw: string;
  pasal: string;
  ayat: string | null;
  kode: string;
  namaKawasan: string;
  namaKawasanRaw: string;
  luasRaw: string;
  luasAngka: number;
  luasTerbilang: string;
  distrikRaw: string;
  distrikList: string[];
  isPasalTotal: boolean;
}

export interface PivotItem {
  namobj: string;
  totalLuas: number;
  districts: string[];
}

export interface ConsistencyResult {
  pasalAyat: string;
  kode: string;
  namaKawasan: string;
  ranperdaLuas: number | null; // From Ranperda text
  pivotLuasReal: number | null;  // Raw from excel
  pivotLuasRounded: number | null; // Math.round from excel
  luasStatus: 'SESUAI' | 'TIDAK_SESUAI' | 'PERLU_DICEK' | 'INFO';
  luasCatatan: string;
  ranperdaDistrik: string[];
  pivotDistrik: string[];
  distrikStatus: 'SESUAI' | 'TIDAK_SESUAI' | 'INFO';
  distrikCatatan: string[];
  keterangan: string; // Additional info (e.g. terbilang errors)
  isPasalTotal: boolean;
}

export interface SummaryStats {
  luasSesuai: number;
  luasTidakSesuai: number;
  luasPerluDicek: number;
  luasInfo: number;
  distrikSesuai: number;
  distrikTidakSesuai: number;
  distrikInfo: number;
}

export const EXCEL_MAPPING: MapItem[] = [
  { namobj: "Badan Air", kode: "BA", namaRanperda: "Badan Air", pasalUtama: "Pasal 22" },
  { namobj: "Kawasan Hutan Lindung", kode: "HL", namaRanperda: "Kawasan Hutan Lindung", pasalUtama: "Pasal 23" },
  { namobj: "Kawasan Perlindungan Setempat", kode: "PS", namaRanperda: "Kawasan Perlindungan Setempat", pasalUtama: "Pasal 24" },
  { namobj: "Cagar Alam", kode: "CA", namaRanperda: "Cagar Alam", pasalUtama: "Pasal 25 ayat (4)" },
  { namobj: "Kawasan Suaka Alam", kode: "KSA", namaRanperda: "Kawasan Suaka Alam", pasalUtama: "Pasal 25 ayat (5)" },
  { namobj: "Taman Nasional", kode: "TN", namaRanperda: "Taman Nasional", pasalUtama: "Pasal 25 ayat (6)" },
  { namobj: "Kawasan Ekosistem Mangrove", kode: "EM", namaRanperda: "Kawasan Ekosistem Mangrove", pasalUtama: "Pasal 26" },
  
  // Kawasan Hutan Produksi Total (Pasal Total)
  { namobj: "Kawasan Hutan Produksi Total", kode: "KHP", namaRanperda: "Kawasan Hutan Produksi", pasalUtama: "Pasal 28 ayat (1)", isTotal: true, childKodes: ["HPT", "HP", "HPK"] },
  { namobj: "Kawasan Hutan Produksi Terbatas", kode: "HPT", namaRanperda: "Hutan Produksi Terbatas", pasalUtama: "Pasal 28 ayat (2)" },
  { namobj: "Kawasan Hutan Produksi Tetap", kode: "HP", namaRanperda: "Hutan Produksi Tetap", pasalUtama: "Pasal 28 ayat (3)" },
  { namobj: "Kawasan Hutan Produksi yang dapat Dikonversi", kode: "HPK", namaRanperda: "Hutan Produksi Dapat Dikonversi", pasalUtama: "Pasal 28 ayat (4)" },
  
  // Kawasan Pertanian (Pasal Total)
  { namobj: "Kawasan Pertanian Total", kode: "P", namaRanperda: "Kawasan Pertanian", pasalUtama: "Pasal 29 ayat (1)", isTotal: true, childKodes: ["P-1", "P-3"] },
  { namobj: "Kawasan Tanaman Pangan", kode: "P-1", namaRanperda: "Kawasan Tanaman Pangan", pasalUtama: "Pasal 29 ayat (2)" },
  { namobj: "Kawasan Perkebunan", kode: "P-3", namaRanperda: "Kawasan Perkebunan", pasalUtama: "Pasal 29 ayat (3)" },
  
  { namobj: "Kawasan Pembangkitan Tenaga Listrik", kode: "PTL", namaRanperda: "Kawasan Pembangkit Listrik", pasalUtama: "Pasal 30" },
  
  // Kawasan Permukiman (Pasal Total)
  { namobj: "Kawasan Permukiman Total", kode: "PM", namaRanperda: "Kawasan Permukiman", pasalUtama: "Pasal 31 ayat (1)", isTotal: true, childKodes: ["PK", "PD"] },
  { namobj: "Kawasan Permukiman Perkotaan", kode: "PK", namaRanperda: "Kawasan Permukiman Perkotaan", pasalUtama: "Pasal 31 ayat (2)" },
  { namobj: "Kawasan Permukiman Perdesaan", kode: "PD", namaRanperda: "Kawasan Permukiman Perdesaan", pasalUtama: "Pasal 31 ayat (3)" },
  
  { namobj: "Kawasan Transportasi", kode: "TR", namaRanperda: "Kawasan Transportasi", pasalUtama: "Pasal 32" },
  { namobj: "Kawasan Pertahanan dan Keamanan", kode: "HK", namaRanperda: "Kawasan Pertahanan dan Keamanan", pasalUtama: "Pasal 33 ayat (1)" }
];

export interface StrukturPivotItem {
  orde1?: string;
  orde2?: string;
  namobj: string;
  remark: string;
  districts: string[];
  type: 'Infrastruktur' | 'Jaringan';
  jenisRencana?: string;
  jenisRencanaKd?: string;
  orde1Kd?: string;
  orde2Kd?: string;
  orde3Kd?: string;
  orde4Kd?: string;
  leafName?: string;
  leafCode?: string;
}

export interface StrukturConsistencyResult {
  pasalAyat: string;
  type: 'Infrastruktur' | 'Jaringan';
  jenisRencana: string;
  orde1?: string;
  orde2?: string;
  orde4?: string;
  namobj: string; // Orde 3
  remark: string; // Orde 4 / Remark (Pivot)
  namobjRanperda?: string; // Nama Objek Ranperda
  statusNamobj: 'Sesuai' | 'Tidak Sesuai' | 'Perlu Dicek' | 'Tidak Ditemukan' | 'Tidak Dicek' | 'Tidak Dapat Diverifikasi';
  statusRemark: 'Sesuai' | 'Tidak Sesuai' | 'Perlu Dicek' | 'Tidak Ditemukan' | 'N/A' | 'Tidak Dapat Diverifikasi';
  distrikPivot: string[];
  distrikRanperda: string[];
  statusDistrik: 'Sesuai' | 'Tidak Sesuai' | 'INFO' | 'Diperiksa';
  catatan: string;
  statusOverall: 'Sesuai' | 'Tidak Sesuai' | 'Perlu Dicek' | 'Tidak Ditemukan' | 'Tidak Dapat Diverifikasi';
}

export interface StrukturSummaryStats {
  totalItems: number;
  sesuai: number;
  tidakSesuai: number;
  perluDicek: number;
  tidakDitemukan: number;
  tidakDapatDiverifikasi?: number;
  infraCount: number;
  jarCount: number;
}
