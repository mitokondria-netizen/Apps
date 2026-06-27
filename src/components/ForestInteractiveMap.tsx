import React, { useState, useEffect, useRef } from 'react';
import * as turf from '@turf/turf';
import L from 'leaflet';
import { Layers, Globe, Map as MapIcon, Maximize, ZoomIn, ZoomOut, Info } from 'lucide-react';

interface ForestInteractiveMapProps {
  rtrwData: any | null;
  hutanData: any | null;
  overlayData: any[] | null;
  rtrwField: string;
  fungsikwsField: string;
}

// Leaflet Style Mapping for Forest Zone Polygons
const getForestLeafletStyle = (name: string, layerType: 'rtrw' | 'hutan' | 'overlay', status?: string) => {
  let fillColor = '#64748b'; // default slate gray
  let color = '#475569';
  let fillOpacity = 0.45;
  let weight = 1.2;
  let dashArray = '';

  if (layerType === 'overlay') {
    if (status === 'SESUAI') {
      fillColor = '#10b981'; // emerald
      color = '#047857';
    } else if (status === 'TIDAK SESUAI') {
      fillColor = '#f43f5e'; // rose
      color = '#be123c';
    } else {
      fillColor = '#f59e0b'; // amber / perbedaan geometri
      color = '#b45309';
    }
    fillOpacity = 0.65;
    weight = 1.5;
    return { fillColor, color, fillOpacity, weight, dashArray };
  }

  const trimmed = String(name || '').trim();

  if (layerType === 'hutan') {
    // Style based on FUNGSIKWS codes
    if (trimmed === '100100') {
      // HL (Hutan Lindung)
      fillColor = '#064e3b';
      color = '#022c22';
      fillOpacity = 0.5;
    } else if (['100300', '100400', '100500'].includes(trimmed)) {
      // HP, HPT, HPK (Hutan Produksi)
      fillColor = '#15803d';
      color = '#14532d';
      fillOpacity = 0.45;
    } else if (trimmed === '100210' || trimmed === '100240' || trimmed === '100200') {
      // CA, TN (Cagar Alam / Pelestarian)
      fillColor = '#4c1d95';
      color = '#2e1065';
      fillOpacity = 0.55;
    } else if (trimmed === '100700') {
      // APL (Areal Penggunaan Lain)
      fillColor = '#ca8a04';
      color = '#854d0e';
      fillOpacity = 0.25;
      dashArray = '2, 4';
    } else {
      fillColor = '#0284c7'; // other / water bodies
      color = '#0369a1';
      fillOpacity = 0.4;
    }
    return { fillColor, color, fillOpacity, weight, dashArray };
  }

  // Pola Ruang styles
  if (trimmed.includes('Tanaman Pangan') || trimmed === 'Kawasan Tanaman Pangan') {
    fillColor = '#22c55e'; // green-500
    color = '#15803d';
  } else if (trimmed.includes('Badan Air') || trimmed === 'Badan Air' || trimmed.includes('Air')) {
    fillColor = '#0ea5e9'; // sky
    color = '#0369a1';
  } else if (trimmed.includes('Hutan Lindung') || trimmed === 'Kawasan Hutan Lindung') {
    fillColor = '#166534'; // green-800
    color = '#14532d';
  } else if (trimmed.includes('Hutan Produksi') || trimmed.includes('HPT') || trimmed.includes('HPK')) {
    fillColor = '#15803d'; // green-700
    color = '#166534';
  } else if (trimmed.includes('Perkebunan') || trimmed === 'Kawasan Perkebunan') {
    fillColor = '#10b981'; // emerald-500
    color = '#047857';
  } else if (trimmed.includes('Perdesaan') || trimmed === 'Kawasan Permukiman Perdesaan') {
    fillColor = '#fbbf24'; // amber-400
    color = '#b45309';
  } else if (trimmed.includes('Perkotaan') || trimmed === 'Kawasan Permukiman Perkotaan') {
    fillColor = '#f97316'; // orange
    color = '#c2410c';
  }

  return {
    fillColor,
    color,
    fillOpacity,
    weight,
    dashArray,
  };
};

export default function ForestInteractiveMap({
  rtrwData,
  hutanData,
  overlayData,
  rtrwField,
  fungsikwsField,
}: ForestInteractiveMapProps) {
  const [activeTab, setActiveTab] = useState<'all' | 'rtrw' | 'hutan' | 'overlay'>('all');
  const [basemap, setBasemap] = useState<'streets' | 'satellite'>('satellite');
  
  // Custom Hover State
  const [hoveredFeature, setHoveredFeature] = useState<any | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  
  // Separate layer groups to easily refresh
  const layerGroupRtrw = useRef<L.LayerGroup | null>(null);
  const layerGroupHutan = useRef<L.LayerGroup | null>(null);
  const layerGroupOverlay = useRef<L.LayerGroup | null>(null);
  
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const labelLayerRef = useRef<L.TileLayer | null>(null);

  // 1. Initialize Map Instance
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    // Default focus: Kabupaten Maros coordinates approx
    const initialCenter: L.LatLngExpression = [-4.95, 119.65];
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
    layerGroupHutan.current = L.layerGroup().addTo(map);
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
    if (!map || !layerGroupRtrw.current || !layerGroupHutan.current || !layerGroupOverlay.current) return;

    // Reset current graphics
    layerGroupRtrw.current.clearLayers();
    layerGroupHutan.current.clearLayers();
    layerGroupOverlay.current.clearLayers();

    // POLA RUANG Layer
    if (rtrwData && (activeTab === 'all' || activeTab === 'rtrw')) {
      L.geoJSON(rtrwData, {
        style: (feature) => {
          const val = feature?.properties?.[rtrwField] || 'Lainnya';
          const style = getForestLeafletStyle(val, 'rtrw');
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
          layer.on({
            mouseover: (e) => {
              setHoveredFeature({
                title: 'Rencana Pola Ruang (RTRW)',
                primary: `${rtrwField}: ${value}`,
                secondary: `Tipe Geometri: ${feature.geometry.type}`,
              });
              setTooltipPos({ x: e.originalEvent.pageX + 12, y: e.originalEvent.pageY + 12 });
            },
            mousemove: (e) => {
              setTooltipPos({ x: e.originalEvent.pageX + 12, y: e.originalEvent.pageY + 12 });
            },
            mouseout: () => {
              setHoveredFeature(null);
            },
          });
        },
      }).addTo(layerGroupRtrw.current);
    }

    // KAWASAN HUTAN Layer
    if (hutanData && (activeTab === 'all' || activeTab === 'hutan')) {
      L.geoJSON(hutanData, {
        style: (feature) => {
          const val = feature?.properties?.[fungsikwsField] || '';
          const style = getForestLeafletStyle(String(val), 'hutan');
          return {
            fillColor: style.fillColor,
            color: style.color,
            fillOpacity: style.fillOpacity,
            weight: style.weight,
            dashArray: style.dashArray,
          };
        },
        onEachFeature: (feature, layer) => {
          const val = feature.properties?.[fungsikwsField] || 'Tidak Ada';
          const name = feature.properties?.NAMOBJ || feature.properties?.namobj || 'Kawasan Hutan';
          layer.on({
            mouseover: (e) => {
              setHoveredFeature({
                title: 'Batas Kawasan Hutan (KemenLHK)',
                primary: `Nama: ${name}`,
                secondary: `Fungsi (Kode ${fungsikwsField}): ${val}`,
              });
              setTooltipPos({ x: e.originalEvent.pageX + 12, y: e.originalEvent.pageY + 12 });
            },
            mousemove: (e) => {
              setTooltipPos({ x: e.originalEvent.pageX + 12, y: e.originalEvent.pageY + 12 });
            },
            mouseout: () => {
              setHoveredFeature(null);
            },
          });
        },
      }).addTo(layerGroupHutan.current);
    }

    // OVERLAY UNION INTERSECTION Slices
    if (overlayData && overlayData.length > 0 && (activeTab === 'all' || activeTab === 'overlay')) {
      overlayData.forEach((item) => {
        if (!item.polygon) return;
        L.geoJSON(item.polygon, {
          style: () => {
            const style = getForestLeafletStyle('', 'overlay', item.status);
            return {
              fillColor: style.fillColor,
              color: style.color,
              fillOpacity: style.fillOpacity,
              weight: style.weight,
              dashArray: style.dashArray,
            };
          },
          onEachFeature: (feature, layer) => {
            layer.on({
              mouseover: (e) => {
                setHoveredFeature({
                  title: 'Hasil Tumpang Susun (Forest Union)',
                  primary: `Pola Ruang: ${item.namobjPolaRuang}`,
                  secondary: `Fungsi Hutan: ${item.deskripsiHutan} (${item.kodeFungsikws})`,
                  extra: `Luas: ${item.luasOverlay?.toFixed(2)} Ha | Status: ${item.status}`,
                  desc: item.keterangan,
                });
                setTooltipPos({ x: e.originalEvent.pageX + 12, y: e.originalEvent.pageY + 12 });
              },
              mousemove: (e) => {
                setTooltipPos({ x: e.originalEvent.pageX + 12, y: e.originalEvent.pageY + 12 });
              },
              mouseout: () => {
                setHoveredFeature(null);
              },
            });
          },
        }).addTo(layerGroupOverlay.current!);
      });
    }

    // Zoom to fit any bounds available (prefer overlay bounds first, then input data)
    let fitBoundsCollection: any[] = [];
    if (overlayData && overlayData.length > 0 && activeTab === 'overlay') {
      fitBoundsCollection = overlayData.map((item) => item.polygon).filter(Boolean);
    } else if (hutanData && activeTab === 'hutan') {
      fitBoundsCollection = [hutanData];
    } else if (rtrwData && activeTab === 'rtrw') {
      fitBoundsCollection = [rtrwData];
    } else if (rtrwData) {
      fitBoundsCollection = [rtrwData];
    }

    if (fitBoundsCollection.length > 0) {
      try {
        const fc = turf.featureCollection(
          fitBoundsCollection.flatMap((d) => (d.type === 'FeatureCollection' ? d.features : d))
        );
        const [minX, minY, maxX, maxY] = turf.bbox(fc);
        if (minX !== Infinity && minY !== Infinity) {
          map.fitBounds([
            [minY, minX],
            [maxY, maxX],
          ], { padding: [24, 24] });
        }
      } catch (err) {
        console.error('Error zoom bounds:', err);
      }
    }
  }, [rtrwData, hutanData, overlayData, activeTab, rtrwField, fungsikwsField]);

  // Handlers for manual Zoom Control buttons
  const handleZoomIn = () => mapInstanceRef.current?.zoomIn();
  const handleZoomOut = () => mapInstanceRef.current?.zoomOut();
  const handleZoomToFit = () => {
    const map = mapInstanceRef.current;
    if (!map) return;
    try {
      const activeData = overlayData && overlayData.length > 0 ? overlayData.map((item) => item.polygon) : rtrwData;
      if (!activeData) return;
      const fc = turf.featureCollection(
        Array.isArray(activeData) 
          ? activeData.flatMap((d) => (d.type === 'FeatureCollection' ? d.features : d))
          : (activeData.type === 'FeatureCollection' ? activeData.features : [activeData])
      );
      const [minX, minY, maxX, maxY] = turf.bbox(fc);
      if (minX !== Infinity) {
        map.fitBounds([
          [minY, minX],
          [maxY, maxX],
        ], { padding: [16, 16] });
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="relative w-full h-[520px] rounded-xl overflow-hidden border border-gray-200 shadow-inner bg-slate-50" id="forest-map-stage">
      {/* Target element mount for Leaflet */}
      <div ref={mapContainerRef} className="w-full h-full z-10" id="forest-leaflet-map" />

      {/* Floater: Layer controls and basemap switcher */}
      <div className="absolute top-4 left-4 z-20 flex flex-col gap-2 shrink-0">
        <div className="bg-white/95 backdrop-blur-md px-3 py-2.5 rounded-lg border border-gray-200/80 shadow-md space-y-2 max-w-[190px]">
          <span className="text-[10px] font-black tracking-wider uppercase text-gray-400 block font-sans">
            Filter Tampilan Peta
          </span>
          <div className="flex flex-col gap-1">
            <button
              onClick={() => setActiveTab('all')}
              className={`w-full text-left text-xs px-2.5 py-1.5 font-bold rounded-md flex items-center gap-1.5 transition-all ${
                activeTab === 'all'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <Globe className="w-3.5 h-3.5 shrink-0" />
              <span>Semua Layer</span>
            </button>
            <button
              onClick={() => setActiveTab('rtrw')}
              className={`w-full text-left text-xs px-2.5 py-1.5 font-bold rounded-md flex items-center gap-1.5 transition-all ${
                activeTab === 'rtrw'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <div className="w-3 h-3 bg-[#f97316]/80 rounded-sm border border-[#c2410c] shrink-0" />
              <span className="truncate">Rencana Pola Ruang</span>
            </button>
            <button
              onClick={() => setActiveTab('hutan')}
              className={`w-full text-left text-xs px-2.5 py-1.5 font-bold rounded-md flex items-center gap-1.5 transition-all ${
                activeTab === 'hutan'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <div className="w-3 h-3 bg-[#15803d]/80 rounded-sm border border-[#14532d] shrink-0" />
              <span className="truncate">Kawasan Hutan</span>
            </button>
            <button
              disabled={!overlayData}
              onClick={() => setActiveTab('overlay')}
              className={`w-full text-left text-xs px-2.5 py-1.5 font-bold rounded-md flex items-center gap-1.5 transition-all ${
                !overlayData ? 'opacity-40 cursor-not-allowed' : ''
              } ${
                activeTab === 'overlay'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <Layers className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
              <span className="truncate">Irisan Overlap</span>
            </button>
          </div>
        </div>

        {/* Base Map Switcher */}
        <div className="bg-white/95 backdrop-blur-md px-2.5 py-2 rounded-lg border border-gray-200/80 shadow-md flex items-center gap-1.5 w-max">
          <button
            onClick={() => setBasemap('satellite')}
            className={`p-1.5 rounded-md transition-all ${
              basemap === 'satellite' ? 'bg-blue-50 text-blue-600' : 'text-gray-500 hover:text-gray-900'
            }`}
            title="Satelit"
          >
            <Globe className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setBasemap('streets')}
            className={`p-1.5 rounded-md transition-all ${
              basemap === 'streets' ? 'bg-blue-50 text-blue-600' : 'text-gray-500 hover:text-gray-900'
            }`}
            title="Peta Jalan"
          >
            <MapIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Floater: Spatial operations & Map utilities (Right side) */}
      <div className="absolute top-4 right-4 z-20 flex flex-col gap-2 shrink-0">
        <div className="flex flex-col bg-white/95 backdrop-blur-md border border-gray-200/80 rounded-lg shadow-md overflow-hidden">
          <button
            onClick={handleZoomIn}
            className="p-2 hover:bg-gray-100 border-b border-gray-150 text-gray-700 transition-colors cursor-pointer"
            title="Zoom In"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            onClick={handleZoomOut}
            className="p-2 hover:bg-gray-100 border-b border-gray-150 text-gray-700 transition-colors cursor-pointer"
            title="Zoom Out"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <button
            onClick={handleZoomToFit}
            className="p-2 hover:bg-gray-100 text-gray-700 transition-colors cursor-pointer"
            title="Zoom ke Luas Wilayah"
          >
            <Maximize className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Legend Box bottom-left */}
      <div className="absolute bottom-4 left-4 z-20 bg-white/90 backdrop-blur-md p-3 rounded-lg border border-gray-250/80 shadow-md max-w-[220px]">
        <div className="text-[10px] font-black tracking-wider text-gray-400 uppercase mb-2">
          Legenda Status Kesesuaian
        </div>
        <div className="space-y-1.5 text-[11px] font-sans">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-sm bg-[#10b981] border border-[#047857]" />
            <span className="text-gray-700 font-semibold">Zonasi Sesuai</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-sm bg-[#f43f5e] border border-[#be123c]" />
            <span className="text-gray-700 font-semibold">Tidk Sesuai (Pelanggaran)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-sm bg-[#f59e0b] border border-[#b45309]" />
            <span className="text-gray-700 font-semibold">Perbedaan Geometri</span>
          </div>
        </div>
      </div>

      {/* Hover Floating Tooltip */}
      {hoveredFeature && (
        <div
          className="fixed pointer-events-none z-50 bg-slate-900/95 text-white text-[11px] p-3 rounded-lg shadow-xl border border-slate-700/60 max-w-sm animate-fadein space-y-1.5 font-sans"
          style={{ left: `${tooltipPos.x}px`, top: `${tooltipPos.y}px` }}
        >
          <span className="text-[10px] font-black text-indigo-400 uppercase tracking-wide block">
            {hoveredFeature.title}
          </span>
          <p className="font-extrabold text-sm tracking-tight">{hoveredFeature.primary}</p>
          <p className="text-gray-300 font-medium">{hoveredFeature.secondary}</p>
          {hoveredFeature.extra && (
            <p className="text-amber-400 font-mono font-bold border-t border-slate-700 pt-1 mt-1">
              {hoveredFeature.extra}
            </p>
          )}
          {hoveredFeature.desc && (
            <p className="text-emerald-400 text-[10px] font-medium italic mt-1 leading-relaxed">
              * Keterangan: {hoveredFeature.desc}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
