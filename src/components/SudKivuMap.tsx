import { useMemo, useRef, useState } from 'react';
import { ZoomIn, ZoomOut, RotateCcw, CheckCircle2, AlertTriangle, Move } from 'lucide-react';
import { sudKivuGeoData } from '../data/sudKivuGeoData.ts';
import { GpsAcquisitionStatus } from '../types/agri.ts';
import { formatAccuracyMeters } from '../utils/gpsValidation.ts';
import {
  OUTSIDE_SUD_KIVU_MESSAGE,
  SUD_KIVU_LOCALITIES,
  findSudKivuTerritory,
  isInsideSudKivu,
} from '../utils/sudKivuGeo.ts';

interface SudKivuMapProps {
  lat: number | null;
  lon: number | null;
  accuracyMeters: number | null;
  gpsStatus: GpsAcquisitionStatus;
}

// Projection bounding box strictly centered on Sud-Kivu with cos(lat) aspect ratio preservation
const VIEW_MIN_LON = 26.55;
const VIEW_MAX_LON = 29.55;
const VIEW_MIN_LAT = -5.20;
const VIEW_MAX_LAT = -1.35;

const SVG_W = 600;
const SVG_H = 770;

export function lonToX(lon: number): number {
  return ((lon - VIEW_MIN_LON) / (VIEW_MAX_LON - VIEW_MIN_LON)) * SVG_W;
}

export function latToY(lat: number): number {
  return ((VIEW_MAX_LAT - lat) / (VIEW_MAX_LAT - VIEW_MIN_LAT)) * SVG_H;
}

function geometryToSvgPath(geometry: { type: string; coordinates: unknown }): string {
  const polys =
    geometry.type === 'Polygon'
      ? [geometry.coordinates as readonly (readonly (readonly [number, number])[])[]]
      : (geometry.coordinates as readonly (readonly (readonly (readonly [number, number])[])[])[]);

  const segments: string[] = [];
  for (const poly of polys) {
    for (const ring of poly) {
      if (ring.length === 0) continue;
      const cmds = ring.map(([lon, lat], idx) => {
        const x = lonToX(lon).toFixed(1);
        const y = latToY(lat).toFixed(1);
        return `${idx === 0 ? 'M' : 'L'}${x},${y}`;
      });
      cmds.push('Z');
      segments.push(cmds.join(''));
    }
  }
  return segments.join(' ');
}

function clampPan(
  panX: number,
  panY: number,
  zoom: number
): { x: number; y: number } {
  const vbW = SVG_W / zoom;
  const vbH = SVG_H / zoom;
  const maxPanX = Math.max(0, (SVG_W - vbW) / 2 + 40);
  const maxPanY = Math.max(0, (SVG_H - vbH) / 2 + 40);
  return {
    x: Math.max(-maxPanX, Math.min(maxPanX, panX)),
    y: Math.max(-maxPanY, Math.min(maxPanY, panY)),
  };
}

export function SudKivuMap({ lat, lon, accuracyMeters, gpsStatus }: SudKivuMapProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [hoveredTerritory, setHoveredTerritory] = useState<string | null>(null);

  const dragRef = useRef<{
    active: boolean;
    pointerId: number | null;
    startClientX: number;
    startClientY: number;
    startPanX: number;
    startPanY: number;
    movedPx: number;
  }>({
    active: false,
    pointerId: null,
    startClientX: 0,
    startClientY: 0,
    startPanX: 0,
    startPanY: 0,
    movedPx: 0,
  });

  const provincePath = useMemo(
    () => geometryToSvgPath(sudKivuGeoData.province.geometry),
    []
  );

  const territoryPaths = useMemo(
    () =>
      sudKivuGeoData.territories.map((t) => ({
        name: t.properties.shapeName,
        d: geometryToSvgPath(t.geometry),
      })),
    []
  );

  const hasCoords = lat !== null && lon !== null && Number.isFinite(lat) && Number.isFinite(lon);
  const inside = hasCoords ? isInsideSudKivu(lat, lon) : false;
  const activeTerritory = hasCoords && inside ? findSudKivuTerritory(lat, lon) : null;
  const isValidated = gpsStatus === 'validated';

  const markerX = hasCoords ? lonToX(lon) : null;
  const markerY = hasCoords ? latToY(lat) : null;

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      active: true,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startPanX: pan.x,
      startPanY: pan.y,
      movedPx: 0,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag.active || drag.pointerId !== e.pointerId) return;

    const dxScreen = e.clientX - drag.startClientX;
    const dyScreen = e.clientY - drag.startClientY;
    drag.movedPx = Math.max(drag.movedPx, Math.hypot(dxScreen, dyScreen));

    if (drag.movedPx > 4 && svgRef.current) {
      const ctm = svgRef.current.getScreenCTM();
      const scaleX = ctm ? ctm.a : 1;
      const scaleY = ctm ? ctm.d : 1;
      const nextPan = clampPan(
        drag.startPanX - dxScreen / (scaleX || 1),
        drag.startPanY - dyScreen / (scaleY || 1),
        zoom
      );
      setPan(nextPan);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag.active || drag.pointerId !== e.pointerId) return;
    drag.active = false;
    drag.pointerId = null;
  };

  const handlePointerCancel = () => {
    dragRef.current.active = false;
    dragRef.current.pointerId = null;
  };

  const handleZoomAtCenter = (nextZoomRaw: number) => {
    const nextZoom = Math.max(1, Math.min(6, Number(nextZoomRaw.toFixed(1))));
    setZoom(nextZoom);
    if (nextZoom === 1) {
      setPan({ x: 0, y: 0 });
    } else {
      setPan((prev) => clampPan(prev.x, prev.y, nextZoom));
    }
  };

  const handleFocusLocalityView = (targetLat: number, targetLon: number) => {
    const targetZoom = Math.max(zoom, 2.2);
    setZoom(targetZoom);
    const desiredPanX = lonToX(targetLon) - SVG_W / 2;
    const desiredPanY = latToY(targetLat) - SVG_H / 2;
    setPan(clampPan(desiredPanX, desiredPanY, targetZoom));
  };

  const handleResetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const vbW = SVG_W / zoom;
  const vbH = SVG_H / zoom;
  const vbX = (SVG_W - vbW) / 2 + pan.x;
  const vbY = (SVG_H - vbH) / 2 + pan.y;

  const markerFill = !inside
    ? '#C05621'
    : isValidated
    ? '#1B4D3E'
    : '#B45309';

  const markerHalo = !inside
    ? 'rgba(192, 86, 33, 0.25)'
    : isValidated
    ? 'rgba(27, 77, 62, 0.22)'
    : 'rgba(180, 83, 9, 0.25)';

  return (
    <div className="space-y-3">
      {/* Header & Zoom Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs text-stone-600">
          <Move className="w-3.5 h-3.5 text-[#1B4D3E] shrink-0" aria-hidden="true" />
          <span>Glissez pour explorer la carte · Position issue du GPS uniquement</span>
        </div>

        <div className="flex items-center gap-1.5" role="group" aria-label="Contrôles de la carte">
          <button
            type="button"
            onClick={() => handleZoomAtCenter(zoom - 0.6)}
            disabled={zoom <= 1}
            aria-label="Dézoomer la carte"
            className="min-w-[40px] min-h-[40px] rounded-lg border border-stone-200 bg-[#F7F8F5] hover:bg-stone-200 flex items-center justify-center text-stone-700 disabled:opacity-40 cursor-pointer"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-xs font-mono tabular-nums text-stone-600 min-w-[36px] text-center">
            {zoom.toFixed(1)}×
          </span>
          <button
            type="button"
            onClick={() => handleZoomAtCenter(zoom + 0.6)}
            disabled={zoom >= 6}
            aria-label="Zoomer la carte"
            className="min-w-[40px] min-h-[40px] rounded-lg border border-stone-200 bg-[#F7F8F5] hover:bg-stone-200 flex items-center justify-center text-stone-700 disabled:opacity-40 cursor-pointer"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleResetView}
            aria-label="Recentrer sur le Sud-Kivu"
            className="min-h-[40px] px-2.5 rounded-lg border border-stone-200 bg-[#F7F8F5] hover:bg-stone-200 flex items-center gap-1 text-xs font-medium text-stone-700 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Recentrer</span>
          </button>
        </div>
      </div>

      {/* Interactive GeoJSON Map */}
      <div className="relative rounded-xl border border-stone-200 bg-[#EAECE6] overflow-hidden touch-none">
        <svg
          ref={svgRef}
          viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
          preserveAspectRatio="xMidYMid meet"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          role="img"
          aria-label="Carte officielle de la province du Sud-Kivu affichant la position GPS"
          className="w-full h-[300px] sm:h-[360px] cursor-grab active:cursor-grabbing select-none block touch-none"
        >
          {/* Outside-province context labels */}
          <text
            x={lonToX(28.55)}
            y={latToY(-1.46)}
            textAnchor="middle"
            style={{ fontSize: `${13 / Math.sqrt(zoom)}px` }}
            className="fill-stone-500 font-medium pointer-events-none"
          >
            Nord-Kivu (hors zone)
          </text>
          <text
            x={lonToX(26.92)}
            y={latToY(-3.1)}
            textAnchor="middle"
            style={{ fontSize: `${13 / Math.sqrt(zoom)}px` }}
            className="fill-stone-500 font-medium pointer-events-none"
          >
            Maniema
          </text>
          <text
            x={lonToX(28.15)}
            y={latToY(-5.11)}
            textAnchor="middle"
            style={{ fontSize: `${13 / Math.sqrt(zoom)}px` }}
            className="fill-stone-500 font-medium pointer-events-none"
          >
            Tanganyika (hors zone)
          </text>
          <text
            x={lonToX(29.36)}
            y={latToY(-3.3)}
            textAnchor="middle"
            style={{ fontSize: `${12 / Math.sqrt(zoom)}px` }}
            className="fill-stone-500 font-medium pointer-events-none"
          >
            Burundi
          </text>

          {/* Lake Kivu & Lake Tanganyika context */}
          <text
            x={lonToX(29.18)}
            y={latToY(-2.05)}
            textAnchor="middle"
            style={{ fontSize: `${11 / Math.sqrt(zoom)}px` }}
            className="fill-sky-700/70 font-semibold italic pointer-events-none"
          >
            Lac Kivu
          </text>
          <text
            x={lonToX(29.26)}
            y={latToY(-4.15)}
            textAnchor="middle"
            style={{ fontSize: `${11 / Math.sqrt(zoom)}px` }}
            className="fill-sky-700/70 font-semibold italic pointer-events-none"
          >
            Lac Tanganyika
          </text>

          {/* Official Sud-Kivu ADM1 base fill */}
          <path
            d={provincePath}
            fill="#F6F9F3"
            stroke="#1B4D3E"
            strokeWidth={2.5 / zoom}
            strokeLinejoin="round"
          />

          {/* 11 Official Sud-Kivu ADM2 Territories / Cities */}
          {territoryPaths.map((terr) => {
            const isActive = activeTerritory === terr.name;
            const isHovered = hoveredTerritory === terr.name;
            return (
              <path
                key={terr.name}
                d={terr.d}
                fill={
                  isActive
                    ? 'rgba(27, 77, 62, 0.18)'
                    : isHovered
                    ? 'rgba(27, 77, 62, 0.1)'
                    : 'rgba(255, 255, 255, 0.65)'
                }
                stroke="#1B4D3E"
                strokeOpacity={0.55}
                strokeWidth={(isActive ? 1.8 : 1.0) / zoom}
                strokeLinejoin="round"
                onMouseEnter={() => setHoveredTerritory(terr.name)}
                onMouseLeave={() => setHoveredTerritory(null)}
              />
            );
          })}

          {/* Province Name Label */}
          <text
            x={lonToX(28.05)}
            y={latToY(-2.35)}
            textAnchor="middle"
            style={{ fontSize: `${19 / Math.sqrt(zoom)}px` }}
            className="fill-[#1B4D3E]/35 font-display font-bold tracking-wide pointer-events-none"
          >
            SUD-KIVU
          </text>

          {/* Reference city/territory labels bound strictly to their real geographic coordinates */}
          {SUD_KIVU_LOCALITIES.map((loc) => {
            const cx = lonToX(loc.lon);
            const cy = latToY(loc.lat);
            return (
              <g key={loc.id} className="pointer-events-none">
                <circle
                  cx={cx}
                  cy={cy}
                  r={2.8 / zoom}
                  fill="#1B4D3E"
                  fillOpacity={0.65}
                  stroke="#FFFFFF"
                  strokeWidth={0.9 / zoom}
                />
                <text
                  x={cx}
                  y={cy - 6 / zoom}
                  textAnchor="middle"
                  style={{ fontSize: `${Math.max(5.5, 10 / Math.pow(zoom, 0.65))}px` }}
                  className="fill-[#1A241E]/85 font-semibold"
                >
                  {loc.name}
                </text>
              </g>
            );
          })}

          {/* Live GPS Marker — strictly bound to actual device (lat, lon) */}
          {markerX !== null && markerY !== null && (
            <g className="pointer-events-none">
              <circle cx={markerX} cy={markerY} r={13 / zoom} fill={markerHalo} />
              <circle
                cx={markerX}
                cy={markerY}
                r={6.5 / zoom}
                fill={markerFill}
                stroke="#FFFFFF"
                strokeWidth={2 / zoom}
              />
            </g>
          )}
        </svg>

        {hoveredTerritory && (
          <div className="absolute top-2.5 left-2.5 bg-white/95 border border-stone-200 px-2.5 py-1 rounded-lg text-xs font-semibold text-[#1A241E] pointer-events-none">
            {hoveredTerritory}
          </div>
        )}
      </div>

      {/* Structured Parcel Location Box when GPS coordinates are available */}
      {hasCoords && (
        inside ? (
          <div
            className={`rounded-xl border p-3.5 text-xs sm:text-sm ${
              isValidated
                ? 'bg-[#1B4D3E]/[0.07] border-[#1B4D3E]/25 text-[#1B4D3E]'
                : 'bg-amber-50/80 border-amber-300 text-amber-900'
            }`}
          >
            <div className="flex items-center gap-2 font-bold">
              {isValidated ? (
                <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
              ) : (
                <AlertTriangle className="w-4 h-4 shrink-0 text-amber-700" aria-hidden="true" />
              )}
              <span>
                {isValidated
                  ? 'POSITION GPS VALIDÉE AU SUD-KIVU'
                  : 'POSITION GPS EN ATTENTE DE PRÉCISION (< 10 M)'}
              </span>
            </div>
            <dl className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5 text-xs">
              <div>
                <dt className="opacity-75">Territoire / Ville</dt>
                <dd className="font-semibold text-[#1A241E]">
                  {activeTerritory ?? 'À déterminer'}
                </dd>
              </div>
              <div>
                <dt className="opacity-75">Latitude / Longitude</dt>
                <dd className="font-mono font-bold tabular-nums text-[#1A241E]">
                  {lat.toFixed(5)}, {lon.toFixed(5)}
                </dd>
              </div>
              <div>
                <dt className="opacity-75">Précision GPS</dt>
                <dd className="font-mono font-bold tabular-nums text-[#1A241E]">
                  {accuracyMeters !== null ? `${formatAccuracyMeters(accuracyMeters)} m` : '—'}
                </dd>
              </div>
            </dl>
          </div>
        ) : (
          <div
            role="alert"
            className="rounded-xl bg-[#C05621]/10 border border-[#C05621]/35 px-3.5 py-3 flex items-start gap-2.5 text-xs sm:text-sm text-[#8F3A11]"
          >
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-[#C05621]" aria-hidden="true" />
            <div className="space-y-1">
              <div className="font-bold">
                Position GPS hors limites du Sud-Kivu ({lat.toFixed(5)}, {lon.toFixed(5)})
              </div>
              <p className="leading-relaxed">{OUTSIDE_SUD_KIVU_MESSAGE}</p>
            </div>
          </div>
        )
      )}

      {/* Map viewport exploration shortcuts (view-only, never overrides real GPS coordinates) */}
      <div>
        <div className="text-xs font-semibold text-stone-600 mb-2">
          Centrer la vue de la carte sur un territoire (aperçu géographique uniquement) :
        </div>
        <div className="flex flex-wrap gap-1.5">
          {SUD_KIVU_LOCALITIES.map((loc) => {
            const isSelected = activeTerritory === loc.name;
            return (
              <button
                key={loc.id}
                type="button"
                onClick={() => handleFocusLocalityView(loc.lat, loc.lon)}
                className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1B4D3E] ${
                  isSelected
                    ? 'bg-[#1B4D3E] text-white'
                    : 'bg-[#F7F8F5] text-[#1A241E] border border-stone-200 hover:bg-stone-200/70'
                }`}
              >
                {loc.name}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
