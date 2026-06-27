import React, { useState, useEffect, useRef } from 'react';
import * as turf from '@turf/turf';
import L from 'leaflet';
import { Layers, Globe, Map as MapIcon, Maximize, ZoomIn, ZoomOut, Info } from 'lucide-react';

interface InteractiveMapProps {
  rtrwData: any | null;
  lbsData: any | null;
  overlayData: any[] | null;
  rtrwField: string;
  lbsSawahField: string;
  rtrwKp2bField: string;
}

// Leaflet Style Mapping for Zone Polygons
const getLeafletStyle = (name: string, layerType: 'rtrw' | 'lbs' | 'overlay') => {
  const trimmed = String(name || '').trim();
  let fillColor = '#64748b'; // default slate gray
  let color = '#475569';
  let fillOpacity = 0.45;
  let weight = 1.2;
  let dashArray = '';

  if (trimmed.includes('Tanaman Pangan') || trimmed === 'Kawasan Tanaman Pangan') {
    fillColor = '#10b981'; // emerald
    color = '#047857';
  } else if (trimmed.includes('Badan Air') || trimmed === 'Badan Air') {
    fillColor = '#3b82f6'; // blue
    color = '#1d4ed8';
  } else if (trimmed.includes('Mangrove') || trimmed === 'Kawasan Ekosistem Mangrove') {
    fillColor = '#14b8a6'; // teal
    color = '#0f766e';
  } else if (trimmed.includes('Hortikultura') || trimmed === 'Kawasan Hortikultura') {
    fillColor = '#84cc16'; // lime
    color = '#65a30d';
  } else if (trimmed.includes('Hutan Lindung') || trimmed === 'Kawasan Hutan Lindung') {
    fillColor = '#15803d'; // green-700
    color = '#14532d';
    fillOpacity = 0.55;
  } else if (trimmed.includes('Perkebunan') || trimmed === 'Kawasan Perkebunan') {
    fillColor = '#059669'; // emerald-600
    color = '#065f46';
  } else if (trimmed.includes('Perlindungan Setempat') || trimmed === 'Kawasan Perlindungan Setempat') {
    fillColor = '#06b6d4'; // cyan
    color = '#0891b2';
  } else if (trimmed.includes('Perdesaan') || trimmed === 'Kawasan Permukiman Perdesaan') {
    fillColor = '#fbbf24'; // amber-400
    color = '#b45309';
  } else if (trimmed.includes('Perkotaan') || trimmed === 'Kawasan Permukiman Perkotaan') {
    fillColor = '#f97316'; // orange
    color = '#c2410c';
  } else if (trimmed.toLowerCase().includes('sawah') && !trimmed.toLowerCase().includes('bukan')) {
    fillColor = '#10b981'; // emerald-500
    color = '#065f46';
    fillOpacity = 0.35;
    weight = 1.5;
    dashArray = '3, 3';
  } else if (trimmed.toLowerCase().includes('bukan sawah') || trimmed === 'Bukan Sawah') {
    fillColor = '#94a3b8'; // slate-400
    color = '#475569';
    fillOpacity = 0.15;
  }

  // Overlay layer has unique highlight properties
  if (layerType === 'overlay') {
    fillOpacity = 0.6;
    weight = 1.5;
    color = '#4f46e5'; // indigo outline is very visible on imagery
  }

  return {
    fillColor,
    color,
    fillOpacity,
    weight,
    dashArray,
  };
};

export default function InteractiveMap({
  rtrwData,
  lbsData,
  overlayData,
  rtrwField,
  lbsSawahField,
  rtrwKp2bField,
}: InteractiveMapProps) {
  const [activeTab, setActiveTab] = useState<'all' | 'rtrw' | 'lbs' | 'overlay'>('all');
  const [basemap, setBasemap] = useState<'streets' | 'satellite'>('satellite');
  
  // Custom Hover State
  const [hoveredFeature, setHoveredFeature] = useState<any | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  
  // Separate layer groups to easily refresh
  const layerGroupRtrw = useRef<L.LayerGroup | null>(null);
  const layerGroupLbs = useRef<L.LayerGroup | null>(null);
  const layerGroupOverlay = useRef<L.LayerGroup | null>(null);
  
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const labelLayerRef = useRef<L.TileLayer | null>(null);

  // 1. Initialize Map Instance
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    // Default focus: Kabupaten Maros coordinates approx
    const initialCenter: L.LatLngExpression = [-5.01, 119.62];
    const initialZoom = 11;

    const map = L.map(mapContainerRef.current, {
      center: initialCenter,
      zoom: initialZoom,
      zoomControl: false, // hand-rolled customized control buttons
      attributionControl: true,
    });

    mapInstanceRef.current = map;

    // Initialize individual layer groups and append them
    layerGroupRtrw.current = L.layerGroup().addTo(map);
    layerGroupLbs.current = L.layerGroup().addTo(map);
    layerGroupOverlay.current = L.layerGroup().addTo(map);

    // Initial tile layer loads (default: Satellite imagery + Roads/Labels overlay)
    tileLayerRef.current = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        attribution: '&copy; Esri, Earthstar Geographics'
      }
    ).addTo(map);

    labelLayerRef.current = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
      {
        attribution: 'Labels & Roads'
      }
    ).addTo(map);

    // Minor fix for resize handling
    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize();
    });
    if (mapContainerRef.current) {
      resizeObserver.observe(mapContainerRef.current);
    }

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // 2. Synchronize Basemap
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    // Remove existing tile layer bindings
    if (tileLayerRef.current) tileLayerRef.current.remove();
    if (labelLayerRef.current) labelLayerRef.current.remove();

    if (basemap === 'streets') {
      tileLayerRef.current = L.tileLayer(
        'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        {
          attribution: '&copy; OpenStreetMap contributors'
        }
      ).addTo(map);
    } else {
      // Satelit Imagery
      tileLayerRef.current = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        {
          attribution: '&copy; Esri World Imagery'
        }
      ).addTo(map);

      // Labels + Boundaries on top of satellite
      labelLayerRef.current = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        {
          attribution: 'Esri Landmarks'
        }
      ).addTo(map);
    }
  }, [basemap]);

  // 3. Populate Map Vector Layer Groups
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !layerGroupRtrw.current || !layerGroupLbs.current || !layerGroupOverlay.current) return;

    // Reset current graphics
    layerGroupRtrw.current.clearLayers();
    layerGroupLbs.current.clearLayers();
    layerGroupOverlay.current.clearLayers();

    // POLA RUANG Layer
    if (rtrwData && (activeTab === 'all' || activeTab === 'rtrw')) {
      L.geoJSON(rtrwData, {
        style: (feature) => {
          const val = feature?.properties?.[rtrwField] || 'Lainnya';
          const style = getLeafletStyle(val, 'rtrw');
          return {
            fillColor: style.fillColor,
            color: style.color,
            fillOpacity: style.fillOpacity,
            weight: style.weight,
            dashArray: style.dashArray,
          };
        },
        onEachFeature: (feature, layer) => {
          const value = feature.properties?.[rtrwField] || 'Lainnya';
          const kp2b = feature.properties?.[rtrwKp2bField] || '';
          layer.on({
            mouseover: (e) => {
              setHoveredFeature({
                layer: 'Rencana Pola Ruang (RTRW)',
                name: `${value} ${kp2b ? `(${kp2b})` : ''}`,
                properties: feature.properties,
              });
              setTooltipPos({ x: e.containerPoint.x, y: e.containerPoint.y });
            },
            mousemove: (e) => {
              setTooltipPos({ x: e.containerPoint.x, y: e.containerPoint.y });
            },
            mouseout: () => {
              setHoveredFeature(null);
            },
          });
        }
      }).addTo(layerGroupRtrw.current);
    }

    // LBS Sawah Layer
    if (lbsData && (activeTab === 'all' || activeTab === 'lbs')) {
      L.geoJSON(lbsData, {
        style: (feature) => {
          const val = feature?.properties?.[lbsSawahField] || 'Bukan Sawah';
          const style = getLeafletStyle(val, 'lbs');
          return {
            fillColor: style.fillColor,
            color: style.color,
            fillOpacity: style.fillOpacity,
            weight: style.weight,
            dashArray: style.dashArray,
          };
        },
        onEachFeature: (feature, layer) => {
          const value = feature.properties?.[lbsSawahField] || 'Bukan Sawah';
          layer.on({
            mouseover: (e) => {
              setHoveredFeature({
                layer: 'Lahan Baku Sawah (LBS)',
                name: value,
                properties: feature.properties,
              });
              setTooltipPos({ x: e.containerPoint.x, y: e.containerPoint.y });
            },
            mousemove: (e) => {
              setTooltipPos({ x: e.containerPoint.x, y: e.containerPoint.y });
            },
            mouseout: () => {
              setHoveredFeature(null);
            },
          });
        }
      }).addTo(layerGroupLbs.current);
    }

    // Intersection Overlay Results Layer
    if (overlayData && overlayData.length > 0 && activeTab === 'overlay') {
      const features = overlayData.map((item) => {
        return {
          type: 'Feature',
          geometry: item.geometry,
          properties: {
            polaRuang: item.polaRuang,
            sawahType: item.sawahType,
            kp2bType: item.kp2bType,
            areaM2: item.areaM2,
          }
        };
      });

      const overlayCollection: any = {
        type: 'FeatureCollection',
        features,
      };

      L.geoJSON(overlayCollection, {
        style: (feature) => {
          const val = feature?.properties?.polaRuang || 'Lainnya';
          const style = getLeafletStyle(val, 'overlay');
          return {
            fillColor: style.fillColor,
            color: style.color,
            fillOpacity: style.fillOpacity,
            weight: style.weight,
            dashArray: style.dashArray,
          };
        },
        onEachFeature: (feature, layer) => {
          const props = feature.properties || {};
          const areaHa = (props.areaM2 / 10000).toLocaleString('id-ID', { maximumFractionDigits: 2 });
          layer.on({
            mouseover: (e) => {
              setHoveredFeature({
                layer: 'Hasil Overlay Union',
                name: props.polaRuang,
                subText: `Sawah: ${props.sawahType} (${props.kp2bType})`,
                area: `${areaHa} Ha`,
              });
              setTooltipPos({ x: e.containerPoint.x, y: e.containerPoint.y });
            },
            mousemove: (e) => {
              setTooltipPos({ x: e.containerPoint.x, y: e.containerPoint.y });
            },
            mouseout: () => {
              setHoveredFeature(null);
            },
          });
        }
      }).addTo(layerGroupOverlay.current);
    }
  }, [rtrwData, lbsData, overlayData, activeTab, rtrwField, lbsSawahField, rtrwKp2bField]);

  // Fit boundaries helper
  const handleZoomToFit = () => {
    const map = mapInstanceRef.current;
    if (!map) return;

    let targetBbox: any = null;
    let features: any[] = [];
    if (rtrwData && rtrwData.features) features.push(...rtrwData.features);
    if (lbsData && lbsData.features) features.push(...lbsData.features);

    if (features.length > 0) {
      try {
        targetBbox = turf.bbox(turf.featureCollection(features));
      } catch (e) {
        console.warn(e);
      }
    }

    if (targetBbox) {
      const [west, south, east, north] = targetBbox;
      map.fitBounds([
        [south, west],
        [north, east]
      ], { padding: [25, 25] });
    } else {
      map.setView([-5.01, 119.62], 11);
    }
  };

  // Zoom standard bounds trigger on data loads
  useEffect(() => {
    if (rtrwData || lbsData) {
      const timer = setTimeout(() => {
        handleZoomToFit();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [rtrwData, lbsData]);

  const handleZoomIn = () => mapInstanceRef.current?.zoomIn();
  const handleZoomOut = () => mapInstanceRef.current?.zoomOut();

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-md" id="map-main-wrapper">
      {/* Map Header Controls */}
      <div className="p-4 bg-gradient-to-r from-gray-50 to-gray-100 border-b border-gray-200 flex flex-wrap items-center justify-between gap-3 text-gray-900">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-blue-50 text-blue-600 rounded-lg">
            <MapIcon className="w-5 h-5" id="map-icon" />
          </div>
          <div>
            <h3 className="text-sm font-extrabold text-gray-950">Visualisasi Peta Spasial Interaktif</h3>
            <p className="text-[10px] text-gray-500 font-medium font-sans">
              Zoom, geser, dan arahkan kursor untuk melihat kondisi spasial eksisting real-time
            </p>
          </div>
        </div>

        {/* Visualizer active layer select tab */}
        <div className="flex bg-gray-200/80 p-0.5 rounded-lg border border-gray-300 text-xs gap-0.5 font-sans">
          <button
            onClick={() => setActiveTab('all')}
            className={`px-3 py-1 rounded-md transition-all font-bold ${
              activeTab === 'all'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100/50'
            }`}
            id="btn-layer-all"
          >
            Semua
          </button>
          <button
            onClick={() => setActiveTab('rtrw')}
            className={`px-3 py-1 rounded-md transition-all font-bold ${
              activeTab === 'rtrw'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100/50'
            }`}
            disabled={!rtrwData}
            id="btn-layer-rtrw"
          >
            Rencana Pola Ruang
          </button>
          <button
            onClick={() => setActiveTab('lbs')}
            className={`px-3 py-1 rounded-md transition-all font-bold ${
              activeTab === 'lbs'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100/50'
            }`}
            disabled={!lbsData}
            id="btn-layer-lbs"
          >
            Sawah (LBS)
          </button>
          <button
            onClick={() => setActiveTab('overlay')}
            className={`px-3 py-1 rounded-md transition-all font-bold ${
              activeTab === 'overlay'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
            disabled={!overlayData || overlayData.length === 0}
            id="btn-layer-overlay"
          >
            Hasil Overlay
          </button>
        </div>

        {/* Zoom Fit Controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={handleZoomIn}
            className="p-1.5 bg-white border border-gray-200 rounded-md text-gray-600 hover:text-gray-900 hover:bg-gray-50 cursor-pointer shadow-sm"
            title="Perbesar"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            onClick={handleZoomOut}
            className="p-1.5 bg-white border border-gray-200 rounded-md text-gray-600 hover:text-gray-900 hover:bg-gray-50 cursor-pointer shadow-sm"
            title="Perkecil"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <button
            onClick={handleZoomToFit}
            className="p-1.5 bg-white border border-gray-200 rounded-md text-gray-600 hover:text-gray-900 hover:bg-gray-50 cursor-pointer shadow-sm"
            title="Suaikan Ukuran ke Peta"
          >
            <Maximize className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Map area parent */}
      <div className="relative w-full h-[520px] bg-slate-900 z-0 select-none overflow-hidden" id="leaflet-map-wrapper">
        
        {/* Real Leaflet Map Container Reference */}
        <div 
          ref={mapContainerRef} 
          className="w-full h-full"
          id="leaflet-map-element"
        />

        {/* Map Placeholder when nothing uploaded */}
        {!rtrwData && !lbsData && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center text-slate-400 bg-slate-950/80 backdrop-blur-md z-40 pointer-events-none">
            <Layers className="w-12 h-12 text-slate-700 mb-3 animate-pulse" />
            <p className="text-slate-200 text-sm font-semibold">Belum ada peta spasial yang diunggah</p>
            <p className="text-slate-500 text-xs mt-1.5 max-w-sm font-medium">
              Silakan unggah file GeoJSON / Shapefile RTRW dan LBS Anda di panel input kiri, atau klik tombol <b>Muat Data Sampel</b> untuk memulai simulasi.
            </p>
          </div>
        )}

        {/* Floating Custom Basemap Selection Overlay on Map */}
        {(rtrwData || lbsData) && (
          <div className="absolute bottom-5 left-5 bg-white/95 backdrop-blur-sm p-1.5 rounded-lg border border-gray-200 shadow-lg z-[30] flex items-center gap-1 text-[10px] pointer-events-auto font-sans">
            <span className="text-gray-500 font-bold px-1.5">Peta Dasar:</span>
            <button
              onClick={() => setBasemap('streets')}
              className={`px-2.5 py-1 rounded-md font-bold flex items-center gap-1 transition-all pointer-events-auto ${
                basemap === 'streets'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              Peta Jalan (OSM)
            </button>
            <button
              onClick={() => setBasemap('satellite')}
              className={`px-2.5 py-1 rounded-md font-bold flex items-center gap-1 transition-all pointer-events-auto ${
                basemap === 'satellite'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <Globe className="w-3.5 h-3.5 text-emerald-400" />
              Citra Satelit (Kondisi Eksisting)
            </button>
          </div>
        )}

        {/* Floating Custom Interactive Legend Panel */}
        {(rtrwData || lbsData) && (
          <div className="absolute top-5 left-5 bg-white/95 backdrop-blur-sm p-3.5 rounded-lg border border-gray-200 text-[10px] text-gray-700 max-h-[220px] overflow-y-auto max-w-[210px] shadow-lg z-[30] pointer-events-auto font-sans">
            <div className="flex items-center gap-1.5 font-extrabold text-gray-950 border-b border-gray-200 pb-1.5 mb-2">
              <span className="w-2.5 h-2.5 bg-blue-500 rounded-full animate-pulse"></span>
              <span>Legenda Klasifikasi Pola Ruang</span>
            </div>
            <div className="space-y-1.5 mt-2">
              <div className="flex items-center gap-2">
                <span className="w-3.5 h-3 bg-emerald-500/50 border border-emerald-600 rounded"></span>
                <span className="font-semibold text-gray-800">Tanaman Pangan</span>
              </div>
              <div className="flex items-center gap-2 flex-nowrap">
                <span className="w-3.5 h-3 bg-semibold rounded bg-indigo-500/50 border border-indigo-600 block"></span>
                <span className="text-gray-800 font-semibold text-nowrap">Hasil Overlay Union</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3.5 h-3 bg-blue-500/50 border border-blue-600 rounded"></span>
                <span className="text-gray-700">Badan Air</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3.5 h-3 bg-green-800/60 border border-green-950 rounded"></span>
                <span className="text-gray-700">Hutan Lindung</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3.5 h-3 bg-lime-500/50 border border-lime-600 rounded"></span>
                <span className="text-gray-700">Kawasan Hortikultura</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3.5 h-3 bg-emerald-600/60 border border-emerald-800 rounded"></span>
                <span className="text-gray-700">Kawasan Perkebunan</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3.5 h-3 bg-orange-500/50 border border-orange-600 rounded"></span>
                <span className="text-gray-700">Permukiman</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3.5 h-3 bg-slate-400/20 border border-slate-600 border-dashed rounded"></span>
                <span className="text-gray-700">Lahan Baku Sawah</span>
              </div>
            </div>
          </div>
        )}

        {/* Hover Information Tooltip Overlay */}
        {hoveredFeature && (
          <div
            className="absolute bg-slate-900/95 backdrop-blur-sm border border-slate-700 text-white p-3.5 rounded-lg shadow-2xl text-[11px] pointer-events-none z-[50] max-w-[240px] font-sans"
            style={{
              left: tooltipPos.x + 18,
              top: tooltipPos.y + 18,
            }}
            id="map-tooltip"
          >
            <div className="font-extrabold text-blue-400 uppercase tracking-widest text-[9px] mb-1">
              {hoveredFeature.layer}
            </div>
            <div className="font-extrabold text-white text-xs leading-snug">{hoveredFeature.name}</div>
            {hoveredFeature.subText && (
              <div className="text-gray-300 mt-1.5 font-medium border-t border-slate-750 pt-1">
                {hoveredFeature.subText}
              </div>
            )}
            {hoveredFeature.area && (
              <div className="mt-2 text-emerald-400 flex items-center gap-1 font-mono font-bold">
                <Info className="w-3.5 h-3.5 text-emerald-400" />
                <span>Luas: {hoveredFeature.area}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
