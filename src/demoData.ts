import { PivotItem, StrukturPivotItem } from '../utils/types';

export const RAW_RANPERDA_DEMO_TEXT = `
RANCANGAN PERATURAN DAERAH KABUPATEN TELUK WONDAMA
TENTANG RENCANA TATA RUANG WILAYAH KABUPATEN TELUK WONDAMA TAHUN 2026-2046

BAB V

RENCANA POLA RUANG WILAYAH

Bagian Kesatu

Umum

Paragraf 1

Kawasan Lindung

Pasal 22

Kawasan Badan Air dengan kode BA sebagaimana dimaksud dalam Pasal 20 ayat (1) huruf a seluas kurang lebih 269 (dua ratus enam puluh sembilan) hektare berada di: Distrik Kuri Wamesa, Distrik Naikere, Distrik Rasiei, Distrik Rumberpon, Distrik Teluk Duairi, Distrik Wasior, dan Distrik Wondiboy.

Pasal 23

Kawasan Hutan Lindung dengan kode HL sebagaimana dimaksud dalam Pasal 20 ayat (1) huruf b seluas kurang lebih 69.176 (enam puluh sembilan ribu seratus tujuh puluh enam) hektare berada di: Distrik Naikere, Distrik Rasiei, dan Distrik Wasior.

Pasal 24

Kawasan Perlindungan Setempat dengan kode PS sebagaimana dimaksud dalam Pasal 20 ayat (1) huruf c seluas kurang lebih 2.081 (dua ribu delapan puluh satu) hektare berada di: Distrik Naikere, Distrik Rasiei, Distrik Wasior, dan Distrik Windesi.

Pasal 25

(1) Kawasan Suaka Alam dan Pelestarian Alam sebagaimana dimaksud dalam Pasal 20 ayat (1) huruf d terdiri dari Cagar Alam, Kawasan Suaka Alam, dan Taman Nasional.

(2) Cagar Alam sebagaimana dimaksud pada ayat (1) dirinci pada ayat (4).

(3) Kawasan Suaka Alam dirinci pada ayat (5).

(4) Cagar Alam dengan kode CA seluas kurang lebih 45.100 (empat puluh lima ribu seratus) hektare berada di: Distrik Rumberpon dan Distrik Wasior.

(5) Kawasan Suaka Alam dengan kode KSA seluas kurang lebih 15.230 (lima belas ribu dua ratus tiga puluh) hektare berada di: Distrik Naikere.

(6) Taman Nasional dengan kode TN seluas kurang lebih 110.500 (seratus sepuluh ribu lima ratus) hektare berada di: Distrik Wasior dan Distrik Wondiboy.

Pasal 26

Kawasan Ekosistem Mangrove dengan kode EM sebagaimana dimaksud dalam Pasal 20 ayat (1) huruf e seluas kurang lebih 3.420 (tiga ribu empat ratus dua puluh) hektare berada di: Distrik Rumberpon dan Distrik Wasior.

Bagian Kedua

Kawasan Budi Daya

Pasal 28

(1) Kawasan Hutan Produksi dengan kode KHP sebagaimana dimaksud dalam Pasal 27 ayat (1) huruf a terdiri dari Hutan Produksi Terbatas dengan kode HPT, Hutan Produksi Tetap dengan kode HP, dan Hutan Produksi Dapat Dikonversi dengan kode HPK dengan luas total kurang lebih 269.450 (dua ratus enam puluh sembilan ribu empat ratus lima puluh) hektare.

(2) Hutan Produksi Terbatas dengan kode HPT sebagaimana dimaksud pada ayat (1) seluas kurang lebih 129.259 (seratus lima puluh sembilan ribu) hektare berada di: Distrik Kuri Wamesa, Distrik Naikere, Distrik Rasiei, Distrik Rumberpon, Distrik Teluk Duairi, Distrik Wasior, dan Distrik Wondiboy.

(3) Hutan Produksi Tetap dengan kode HP sebagaimana dimaksud pada ayat (1) seluas kurang lebih 80.000 (delapan puluh ribu) hektare berada di: Distrik Naikere, Distrik Rumberpon, dan Distrik Wasior.

(4) Hutan Produksi Dapat Dikonversi dengan kode HPK sebagaimana dimaksud pada ayat (1) seluas kurang lebih 60.191 (enam puluh ribu seratus sembilan puluh satu) hektare berada di: Distrik Naikere dan Distrik Wasior.

Pasal 29

(1) Kawasan Pertanian dengan kode P sebagaimana dimaksud dalam Pasal 27 ayat (1) huruf b terdiri dari Kawasan Tanaman Pangan dengan kode P-1 dan Kawasan Perkebunan dengan kode P-3 dengan luas total kurang lebih 15.000 (lima belas ribu) hektare.

(2) Kawasan Tanaman Pangan dengan kode P-1 sebagaimana dimaksud pada ayat (1) seluas kurang lebih 10.000 (sepuluh ribu) hektare berada di: Distrik Kuri Wamesa, Distrik Wasior, dan Distrik Wondiboy.

(3) Kawasan Perkebunan dengan kode P-3 sebagaimana dimaksud pada ayat (1) seluas kurang lebih 5.000 (lima ribu) hektare berada di: Distrik Wasior.

Pasal 30

Kawasan Pembangkit Tenaga Listrik dengan kode PTL sebagaimana dimaksud dalam Pasal 27 ayat (1) huruf c seluas kurang lebih 15 (lima belas) hektare berada di: Distrik Wasior.

Pasal 31

(1) Kawasan Permukiman dengan kode PM sebagaimana dimaksud dalam Pasal 27 ayat (1) huruf d terdiri dari Kawasan Permukiman Perkotaan dengan kode PK dan Kawasan Permukiman Perdesaan dengan kode PD dengan luas total kurang lebih 12.000 (dua belas ribu) hektare.

(2) Kawasan Permukiman Perkotaan dengan kode PK sebagaimana dimaksud pada ayat (1) seluas kurang lebih 8.000 (delapan ribu) hektare berada di: Distrik Wasior.

(3) Kawasan Permukiman Perdesaan dengan kode PD sebagaimana dimaksud pada ayat (1) seluas kurang lebih 4.000 (empat ribu) hektare berada di: Distrik Rasiei, Distrik Rumberpon, dan Distrik Wondiboy.

Pasal 32

Kawasan Transportasi dengan kode TR sebagaimana dimaksud dalam Pasal 27 ayat (1) huruf e seluas kurang lebih 120 (seratus dua puluh) hektare berada di: Distrik Teluk Duairi dan Distrik Wasior.

Pasal 33

(1) Kawasan Pertahanan dan Keamanan dengan kode HK sebagaimana dimaksud dalam Pasal 27 ayat (1) huruf f seluas kurang lebih 45 (empat puluh lima) hektare berada di: Distrik Wasior dan Distrik Wondiboy.
`;

export const PIVOT_DEMO_DATA: Record<string, PivotItem> = {
  "Badan Air": {
    namobj: "Badan Air",
    totalLuas: 269.626,
    districts: ["Kuri Wamesa", "Naikere", "Rasiei", "Rumberpon", "Teluk Duairi", "Wasior", "Wondiboy"]
  },
  "Kawasan Hutan Lindung": {
    namobj: "Kawasan Hutan Lindung",
    totalLuas: 69176.648,
    districts: ["Naikere", "Rasiei", "Wasior", "Kuri Wamesa"] // Kuri Wamesa is only in Pivot
  },
  "Kawasan Perlindungan Setempat": {
    namobj: "Kawasan Perlindungan Setempat",
    totalLuas: 2081.284,
    districts: ["Naikere", "Rasiei", "Wasior"] // Windesi is in Ranperda, but not in Pivot
  },
  "Cagar Alam": {
    namobj: "Cagar Alam",
    totalLuas: 45100.12,
    districts: ["Rumberpon", "Wasior"]
  },
  "Kawasan Suaka Alam": {
    namobj: "Kawasan Suaka Alam",
    totalLuas: 15230.45,
    districts: ["Naikere"]
  },
  "Taman Nasional": {
    namobj: "Taman Nasional",
    totalLuas: 110500.5,
    districts: ["Wasior", "Wondiboy"]
  },
  "Kawasan Ekosistem Mangrove": {
    namobj: "Kawasan Ekosistem Mangrove",
    totalLuas: 3420.2,
    districts: ["Rumberpon", "Wasior"]
  },
  "Kawasan Hutan Produksi Terbatas": {
    namobj: "Kawasan Hutan Produksi Terbatas",
    totalLuas: 129259.073,
    districts: ["Kuri Wamesa", "Naikere", "Rasiei", "Rumberpon", "Teluk Duairi", "Wasior", "Wondiboy"]
  },
  "Kawasan Hutan Produksi Tetap": {
    namobj: "Kawasan Hutan Produksi Tetap",
    totalLuas: 79999.8,
    districts: ["Naikere", "Rumberpon", "Wasior"]
  },
  "Kawasan Hutan Produksi yang dapat Dikonversi": {
    namobj: "Kawasan Hutan Produksi yang dapat Dikonversi",
    totalLuas: 60191.2,
    districts: ["Naikere", "Wasior"]
  },
  "Kawasan Tanaman Pangan": {
    namobj: "Kawasan Tanaman Pangan",
    totalLuas: 10000.1,
    districts: ["Kuri Wamesa", "Wasior", "Wondiboy"]
  },
  "Kawasan Perkebunan": {
    namobj: "Kawasan Perkebunan",
    totalLuas: 4999.9,
    districts: ["Wasior"]
  },
  "Kawasan Pembangkitan Tenaga Listrik": {
    namobj: "Kawasan Pembangkitan Tenaga Listrik",
    totalLuas: 15.0,
    districts: ["Wasior"]
  },
  "Kawasan Permukiman Perkotaan": {
    namobj: "Kawasan Permukiman Perkotaan",
    totalLuas: 8100.2, // Discrepancy! 8100 instead of 8000
    districts: ["Wasior"]
  },
  "Kawasan Permukiman Perdesaan": {
    namobj: "Kawasan Permukiman Perdesaan",
    totalLuas: 4000.1,
    districts: ["Rasiei", "Rumberpon", "Wondiboy"]
  },
  "Kawasan Transportasi": {
    namobj: "Kawasan Transportasi",
    totalLuas: 120.4,
    districts: ["Teluk Duairi", "Wasior"]
  },
  "Kawasan Pertahanan dan Keamanan": {
    namobj: "Kawasan Pertahanan dan Keamanan",
    totalLuas: 45.1,
    districts: ["Wasior", "Wondiboy"]
  }
};

export const RAW_STRUKTUR_DEMO_TEXT = `
RANCANGAN PERATURAN DAERAH KABUPATEN TELUK WONDAMA
TENTANG RENCANA TATA RUANG WILAYAH KABUPATEN TELUK WONDAMA TAHUN 2026-2046

BAB IV

RENCANA STRUKTUR RUANG WILAYAH

Bagian Kesatu
Sistem Pusat Permukiman

Pasal 11
Sistem Pusat Permukiman sebagaimana dimaksud meliputi Pusat Kegiatan Lokal (PKL) Kota Wasior.

Bagian Kedua
Sistem Jaringan Prasarana

Paragraf 1
Sistem Jaringan Transportasi

Pasal 12
(1) Jaringan jalan kolektor primer sebagaimana dimaksud dalam Pasal 10 melintas di: Distrik Wasior, Distrik Rasiei, dan Distrik Naikere.
(2) Jaringan jalan lokal primer melintas di: Distrik Rumberpon dan Distrik Anggajaya.
(3) Pelabuhan Pengumpul Wasior berada di: Distrik Wasior.
(4) Terminal Penumpang Tipe B Wasior berada di: Distrik Wasior dan Distrik Wondiboy.

Paragraf 2
Sistem Jaringan Energi / Ketenagalistrikan

Pasal 13
(1) Gardu Induk Wasior berada di: Distrik Wasior.
(2) Jaringan transmisi tenaga listrik melintas di: Distrik Wasior dan Distrik Rasiei.
`;

export const STRUKTUR_PIVOT_DEMO_DATA: Record<string, StrukturPivotItem> = {
  "infrastruktur|||pelabuhan pengumpul|||pelabuhan pengumpul wasior": {
    namobj: "Pelabuhan Pengumpul",
    remark: "Pelabuhan Pengumpul Wasior",
    districts: ["Wasior"],
    type: "Infrastruktur"
  },
  "infrastruktur|||terminal penumpang tipe b|||terminal penumpang tipe b wasior": {
    namobj: "Terminal Penumpang Tipe B",
    remark: "Terminal Penumpang Tipe B Wasior",
    districts: ["Wasior", "Naikere"],
    type: "Infrastruktur"
  },
  "jaringan|||jalan kolektor primer|||jalan kolektor primer": {
    namobj: "Jalan Kolektor Primer",
    remark: "Jalan Kolektor Primer",
    districts: ["Wasior", "Rasiei", "Naikere"],
    type: "Jaringan"
  },
  "jaringan|||jalan lokal primer|||jalan lokal primer": {
    namobj: "Jalan Lokal Primer",
    remark: "Jalan Lokal Primer",
    districts: ["Rumberpon"],
    type: "Jaringan"
  },
  "infrastruktur|||gardu induk|||gardu induk wasior": {
    namobj: "Gardu Induk",
    remark: "Gardu Induk Wasior",
    districts: ["Wasior"],
    type: "Infrastruktur"
  },
  "jaringan|||saluran udara tegangan tinggi|||sutt 150kv": {
    namobj: "Saluran Udara Tegangan Tinggi",
    remark: "SUTT 150kV",
    districts: ["Wasior"],
    type: "Jaringan"
  }
};

