import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { cellPolygonLatLngs, getColorForValue, latLngToProjected, projectedToLatLng } from '../utils';

const PRIMARY_FILL = '#1f4e79';
const SECONDARY_FILL = '#c0504d';
const OVERLAP_FILL = '#7a4d8c';

function buildFeatureCollectionFromLatLngs(latLngs) {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Polygon',
          coordinates: [[...latLngs, latLngs[0]].map((latlng) => [latlng.lng, latlng.lat])],
        },
      },
    ],
  };
}

function createBucketIndex(gridIndex, bucketSize = 1200) {
  const buckets = new Map();
  gridIndex.cell_ids.forEach((_, index) => {
    const x = gridIndex.x_coords[index];
    const y = gridIndex.y_coords[index];
    const key = `${Math.floor(x / bucketSize)}:${Math.floor(y / bucketSize)}`;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(index);
    } else {
      buckets.set(key, [index]);
    }
  });
  return { bucketSize, buckets };
}

function findVisibleIndexes(map, gridIndex, bucketIndex) {
  const bounds = map.getBounds();
  const sw = latLngToProjected(bounds.getSouthWest().lat, bounds.getSouthWest().lng);
  const ne = latLngToProjected(bounds.getNorthEast().lat, bounds.getNorthEast().lng);
  const minX = Math.min(sw.x, ne.x) - 200;
  const maxX = Math.max(sw.x, ne.x) + 200;
  const minY = Math.min(sw.y, ne.y) - 200;
  const maxY = Math.max(sw.y, ne.y) + 200;
  const minBucketX = Math.floor(minX / bucketIndex.bucketSize);
  const maxBucketX = Math.floor(maxX / bucketIndex.bucketSize);
  const minBucketY = Math.floor(minY / bucketIndex.bucketSize);
  const maxBucketY = Math.floor(maxY / bucketIndex.bucketSize);
  const indexes = [];

  for (let bx = minBucketX; bx <= maxBucketX; bx += 1) {
    for (let by = minBucketY; by <= maxBucketY; by += 1) {
      const bucket = bucketIndex.buckets.get(`${bx}:${by}`);
      if (!bucket) {
        continue;
      }
      bucket.forEach((index) => {
        const x = gridIndex.x_coords[index];
        const y = gridIndex.y_coords[index];
        if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
          indexes.push(index);
        }
      });
    }
  }

  return indexes;
}

function findCellIdFromLatLng(latlng, cellIdSet) {
  const { x, y } = latLngToProjected(latlng.lat, latlng.lng);
  const cellId = `SIHM100_${Math.floor(x / 100)}_${Math.floor(y / 100)}`;
  return cellIdSet.has(cellId) ? cellId : null;
}

function getBoundsFromCellIds(cellIds) {
  if (!cellIds.length) {
    return null;
  }
  const latLngs = cellIds.flatMap((cellId) => cellPolygonLatLngs(cellId) || []);
  return latLngs.length ? L.latLngBounds(latLngs) : null;
}

export default function MapPanel({
  gridIndex,
  yearData,
  quantileScale,
  selectionState,
  activeSelectionSlot,
  onSetActiveSelectionSlot,
  onToggleCell,
  onDrawPolygon,
  primaryBounds,
  secondaryBounds,
}) {
  const mapRef = useRef(null);
  const canvasLayerRef = useRef(null);
  const geometryLayerRef = useRef(null);
  const selectionOutlineLayerRef = useRef(null);
  const polygonLabelLayerRef = useRef(null);
  const sketchLayerRef = useRef(null);
  const containerRef = useRef(null);
  const polygonVertexMarkersRef = useRef([]);
  const polygonVerticesRef = useRef([]);
  const polygonDrawingEnabledRef = useRef(false);
  const activeSelectionSlotRef = useRef(activeSelectionSlot);
  const cellSet = useMemo(() => new Set(gridIndex?.cell_ids || []), [gridIndex]);
  const bucketIndex = useMemo(() => (gridIndex ? createBucketIndex(gridIndex) : null), [gridIndex]);
  const overlapIds = useMemo(() => {
    const overlap = [];
    selectionState.primary.ids.forEach((cellId) => {
      if (selectionState.secondary.ids.has(cellId)) {
        overlap.push(cellId);
      }
    });
    return overlap;
  }, [selectionState]);

  const drawStateRef = useRef({
    yearData,
    quantileScale,
    primaryIds: selectionState.primary.ids,
    secondaryIds: selectionState.secondary.ids,
  });

  drawStateRef.current = {
    yearData,
    quantileScale,
    primaryIds: selectionState.primary.ids,
    secondaryIds: selectionState.secondary.ids,
  };
  activeSelectionSlotRef.current = activeSelectionSlot;

  useEffect(() => {
    if (!gridIndex || mapRef.current) {
      return;
    }

    const map = L.map(containerRef.current, {
      preferCanvas: true,
      zoomControl: true,
      scrollWheelZoom: true,
      doubleClickZoom: false,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    const sloveniaBounds = L.latLngBounds(
      [gridIndex.bbox_wgs84[1], gridIndex.bbox_wgs84[0]],
      [gridIndex.bbox_wgs84[3], gridIndex.bbox_wgs84[2]],
    );

    map.fitBounds(sloveniaBounds, { padding: [4, 4] });
    map.setMinZoom(map.getZoom());
    map.setMaxBounds(sloveniaBounds.pad(0.04));
    map.options.maxBoundsViscosity = 1.0;

    const stopWheelScroll = (event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    containerRef.current.addEventListener('wheel', stopWheelScroll, { passive: false });

    geometryLayerRef.current = L.layerGroup().addTo(map);
    selectionOutlineLayerRef.current = L.layerGroup().addTo(map);
    polygonLabelLayerRef.current = L.layerGroup().addTo(map);
    sketchLayerRef.current = L.layerGroup().addTo(map);

    function clearSketch() {
      polygonVerticesRef.current = [];
      polygonVertexMarkersRef.current.forEach((marker) => marker.remove());
      polygonVertexMarkersRef.current = [];
      sketchLayerRef.current?.clearLayers();
      polygonDrawingEnabledRef.current = false;
    }

    function redrawSketch() {
      sketchLayerRef.current?.clearLayers();
      if (polygonVerticesRef.current.length < 2) {
        return;
      }

      L.polyline(polygonVerticesRef.current, {
        color: '#5b7282',
        weight: 2,
        dashArray: '5 5',
      }).addTo(sketchLayerRef.current);
    }

    function finishPolygon() {
      if (polygonVerticesRef.current.length < 3) {
        clearSketch();
        return;
      }

      const latLngs = [...polygonVerticesRef.current];
      onDrawPolygon(buildFeatureCollectionFromLatLngs(latLngs), activeSelectionSlotRef.current);
      clearSketch();
    }

    const drawToggleControl = L.Control.extend({
      options: { position: 'topleft' },
      onAdd() {
        const div = L.DomUtil.create('div', 'leaflet-bar leaflet-control polygon-draw-control');
        const button = L.DomUtil.create('a', '', div);
        button.href = '#';
        button.title = 'Začni risati nov poligon za trenutno aktivni izbor.';
        button.innerHTML = '&#11040;';
        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.on(button, 'click', (event) => {
          L.DomEvent.preventDefault(event);
          if (polygonDrawingEnabledRef.current) {
            clearSketch();
          } else {
            clearSketch();
            polygonDrawingEnabledRef.current = true;
          }
        });
        return div;
      },
    });

    map.addControl(new drawToggleControl());

    map.on('click', (event) => {
      if (polygonDrawingEnabledRef.current) {
        const latlng = event.latlng;
        const vertexIndex = polygonVerticesRef.current.length;
        polygonVerticesRef.current.push(latlng);

        const marker = L.circleMarker(latlng, {
          radius: vertexIndex === 0 ? 7 : 5,
          color: vertexIndex === 0 ? '#7a1f1f' : '#5b7282',
          fillColor: '#ffffff',
          fillOpacity: 1,
          weight: 2,
        });

        marker.on('click', (markerEvent) => {
          L.DomEvent.stop(markerEvent);
          if (vertexIndex === 0 && polygonVerticesRef.current.length >= 3) {
            finishPolygon();
          }
        });

        marker.addTo(map);
        polygonVertexMarkersRef.current.push(marker);
        redrawSketch();
        return;
      }

      const cellId = findCellIdFromLatLng(event.latlng, cellSet);
      if (cellId) {
        onToggleCell(cellId, activeSelectionSlotRef.current);
      }
    });

    const CanvasLayer = L.Layer.extend({
      onAdd() {
        this._canvas = L.DomUtil.create('canvas', 'grid-canvas-layer');
        this._canvas.style.position = 'absolute';
        map.getPanes().overlayPane.appendChild(this._canvas);
        this._animationFrame = null;
        this._scheduleReset = () => {
          if (this._animationFrame) {
            cancelAnimationFrame(this._animationFrame);
          }
          this._animationFrame = requestAnimationFrame(() => this._reset());
        };
        map.on('moveend zoomend resize', this._scheduleReset, this);
        this._scheduleReset();
      },
      onRemove() {
        if (this._animationFrame) {
          cancelAnimationFrame(this._animationFrame);
        }
        if (this._canvas?.parentNode) {
          this._canvas.parentNode.removeChild(this._canvas);
        }
        map.off('moveend zoomend resize', this._scheduleReset, this);
      },
      redraw() {
        this._scheduleReset();
      },
      _reset() {
        const size = map.getSize();
        const topLeft = map.containerPointToLayerPoint([0, 0]);
        L.DomUtil.setPosition(this._canvas, topLeft);
        this._canvas.width = size.x;
        this._canvas.height = size.y;

        const ctx = this._canvas.getContext('2d');
        ctx.clearRect(0, 0, size.x, size.y);
        ctx.imageSmoothingEnabled = false;

        const visibleIndexes = findVisibleIndexes(map, gridIndex, bucketIndex);
        const zoom = map.getZoom();
        const drawStroke = zoom >= 11 && visibleIndexes.length < 4500;
        const { yearData: currentYearData, primaryIds, secondaryIds, quantileScale: currentScale } = drawStateRef.current;
        const totColumn = currentYearData?.columns?.tot_p || [];

        visibleIndexes.forEach((index) => {
          const cellId = gridIndex.cell_ids[index];
          const x = gridIndex.x_coords[index];
          const y = gridIndex.y_coords[index];
          const bottomLeft = map.latLngToContainerPoint(projectedToLatLng(x, y));
          const topRight = map.latLngToContainerPoint(projectedToLatLng(x + 100, y + 100));
          const width = Math.max(topRight.x - bottomLeft.x, 1);
          const height = Math.max(bottomLeft.y - topRight.y, 1);
          const value = Number(totColumn[index]);
          const isPrimary = primaryIds.has(cellId);
          const isSecondary = secondaryIds.has(cellId);

          if (isPrimary && isSecondary) {
            ctx.fillStyle = 'rgba(122, 77, 140, 0.50)';
          } else if (isPrimary) {
            ctx.fillStyle = 'rgba(31, 78, 121, 0.50)';
          } else if (isSecondary) {
            ctx.fillStyle = 'rgba(192, 80, 77, 0.50)';
          } else {
            ctx.fillStyle = getColorForValue(value, currentScale);
          }

          ctx.fillRect(bottomLeft.x, topRight.y, width, height);

          if (drawStroke) {
            ctx.strokeStyle = isPrimary || isSecondary ? 'rgba(247, 249, 250, 0.65)' : 'rgba(78, 97, 111, 0.06)';
            ctx.lineWidth = isPrimary || isSecondary ? 1 : 0.35;
            ctx.strokeRect(bottomLeft.x, topRight.y, width, height);
          }
        });
      },
    });

    canvasLayerRef.current = new CanvasLayer();
    canvasLayerRef.current.addTo(map);
    mapRef.current = map;

    return () => {
      containerRef.current?.removeEventListener('wheel', stopWheelScroll);
      polygonVertexMarkersRef.current.forEach((marker) => marker.remove());
    };
  }, [bucketIndex, cellSet, gridIndex, onDrawPolygon, onToggleCell]);

  useEffect(() => {
    canvasLayerRef.current?.redraw();
  }, [yearData, quantileScale, selectionState]);

  useEffect(() => {
    if (!geometryLayerRef.current || !polygonLabelLayerRef.current) {
      return;
    }

    geometryLayerRef.current.clearLayers();
    polygonLabelLayerRef.current.clearLayers();

    [
      { geoJson: selectionState.primary.geoJson, color: PRIMARY_FILL, label: 'P1', number: '1' },
      { geoJson: selectionState.secondary.geoJson, color: SECONDARY_FILL, label: 'P2', number: '2' },
    ].forEach(({ geoJson, color, label, number }) => {
      if (!geoJson) {
        return;
      }

      const layer = L.geoJSON(geoJson, {
        style: {
          color,
          weight: 3,
          dashArray: '8 4',
          fillColor: '#ffffff',
          fillOpacity: 0.02,
        },
      }).bindTooltip(label).addTo(geometryLayerRef.current);

      const center = layer.getBounds().getCenter();
      L.marker(center, {
        interactive: false,
        icon: L.divIcon({
          className: 'polygon-number-marker',
          html: `<span>${number}</span>`,
        }),
      }).addTo(polygonLabelLayerRef.current);
    });
  }, [selectionState]);

  useEffect(() => {
    if (!selectionOutlineLayerRef.current) {
      return;
    }

    selectionOutlineLayerRef.current.clearLayers();
    [
      { ids: selectionState.primary.ids, color: PRIMARY_FILL },
      { ids: selectionState.secondary.ids, color: SECONDARY_FILL },
    ].forEach(({ ids, color }) => {
      if (ids.size > 1400) {
        return;
      }

      ids.forEach((cellId) => {
        const latLngs = cellPolygonLatLngs(cellId);
        if (!latLngs) {
          return;
        }

        L.polygon(latLngs, {
          color,
          weight: 1,
          fillOpacity: 0,
        }).addTo(selectionOutlineLayerRef.current);
      });
    });
  }, [selectionState]);

  useEffect(() => {
    const bounds = activeSelectionSlot === 'primary' ? primaryBounds : secondaryBounds;
    if (!mapRef.current || !bounds?.length) {
      return;
    }
    mapRef.current.fitBounds(bounds, { padding: [18, 18] });
  }, [activeSelectionSlot, primaryBounds, secondaryBounds]);

  const focusMap = (target) => {
    if (!mapRef.current) {
      return;
    }

    let bounds = null;
    if (target === 'primary' && primaryBounds?.length) {
      bounds = L.latLngBounds(primaryBounds);
    } else if (target === 'secondary' && secondaryBounds?.length) {
      bounds = L.latLngBounds(secondaryBounds);
    } else if (target === 'overlap') {
      bounds = getBoundsFromCellIds(overlapIds);
    }

    if (bounds) {
      mapRef.current.fitBounds(bounds, { padding: [20, 20] });
    }
  };

  return (
    <section className="map-panel">
      <div className="map-panel__toolbar map-panel__toolbar--compact">
        <div>
          <p>Klik na celico jo doda ali odstrani iz aktivnega poligona. Ikona `⬠` začne risanje nove geometrije.</p>
        </div>
      </div>

      <div className="map-meta">
        <div className="selection-chips">
          <button
            type="button"
            className={`selection-chip ${activeSelectionSlot === 'primary' ? 'selection-chip--active' : ''}`}
            onClick={() => {
              onSetActiveSelectionSlot('primary');
              focusMap('primary');
            }}
            title="Preklopi na P1 in premakni pogled karte na njegovo območje."
          >
            <span className="selection-chip__swatch" style={{ background: PRIMARY_FILL }} />
            P1: {selectionState.primary.ids.size}
          </button>
          <button
            type="button"
            className={`selection-chip ${activeSelectionSlot === 'secondary' ? 'selection-chip--active' : ''}`}
            onClick={() => {
              onSetActiveSelectionSlot('secondary');
              focusMap('secondary');
            }}
            disabled={!selectionState.primary.geoJson}
            title="Preklopi na P2 in premakni pogled karte na njegovo območje."
          >
            <span className="selection-chip__swatch" style={{ background: SECONDARY_FILL }} />
            P2: {selectionState.secondary.ids.size}
          </button>
          <button
            type="button"
            className="selection-chip"
            onClick={() => focusMap('overlap')}
            disabled={overlapIds.length === 0}
            title="Premakni pogled karte na območje, kjer se P1 in P2 prekrivata."
          >
            <span className="selection-chip__swatch" style={{ background: OVERLAP_FILL }} />
            Prekrivanje: {overlapIds.length}
          </button>
        </div>
      </div>

      <div ref={containerRef} className="map-container" />
    </section>
  );
}
