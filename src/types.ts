export interface SpatialFieldSelection {
  polaRuangField: string;
  lbsSawahField: string;
  rtrwKp2bField: string;
}

export interface OverlayResultRow {
  sawahType: string; // 'Sawah' | 'Bukan Sawah'
  kp2bType: string;  // 'KP2B (K02A)' | 'Non KP2B (Tidak Ada)' | etc.
  polaRuang: string;  // e.g. 'Kawasan Tanaman Pangan'
  areaHa: number;
  percentage: number; // calculated relative to total Sawah
}

export interface RawDataset {
  name: string;
  geojson: any; // FeatureCollection
  fields: string[];
  file?: File;
}

export interface MoratoriumConfig {
  threshold: number; // 87
  accommodatedCategories: string[]; // Rencana Pola Ruang categories considered as accommodating
}
