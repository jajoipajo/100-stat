import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  cellPolygonLatLngs,
  getColorForValue,
  latLngToProjected,
  polygonIntersectsCell,
  projectedToLatLng,
} from '../utils';

function findCellIdFromLatLng(latlng, cellIdSet) {
  const { x, y } = latLngToProjected(latlng.lat, latlng.lng);
  const cellId = `SIHM100_${Math.floor(x / 100)}_${Math.floor(y / 100)}`;
  return cellIdSet.has(cellId) ? cellId : null;
}

function collectCellsFromLatLngs(latLngs, gridIndex) {
  const projectedPolygon = latLngs.map((latlng) => {
    const point = latLngToProjected(latlng.lat, latlng.lng);
    return [point.x, point.y];
  });

  const xs = projectedPolygon.map(([x]) => x);
  const ys = projectedPolygon.map(([, y]) => y);
  const minX = Math.min(...xs) - 100;
  const maxX = Math.max(...xs) + 100;
  const minY = Math.min(...ys) - 100;
  const maxY = Math.max(...ys) + 100;
  const selected = [];

  gridIndex.cell_ids.forEach((cellId, index) => {
    const x = gridIndex.x_coords[index];
    const y = gridIndex.y_coords[index];
    if (x < minX || x > maxX || y < minY || y > maxY) {
      return;
    }

    if (polygonIntersectsCell(projectedPolygon, x, y, gridIndex.cell_size_m || 100)) {
      selected.push(cellId);
    }
  });

  return selected;
}

export default function MapPanel({
  gridIndex,
  selectedIds,
  onToggleCell,
  onReplaceSelection,
  yearData,
  adminData,
  selectedAdminId,
  onSelectAdmin,
  uploadedGeoJson,
  uploadedBounds,
  geometryClearToken,
  selectionClearToken,
  onClearSelection,
  onClearPolygons,
}) {
  const mapRef = useRef(null);
  const canvasLayerRef = useRef(null);
  const drawnItemsRef = useRef(null);
  const uploadLayerRef = useRef(null);
  const selectionLayerRef = useRef(null);
  const adminLayerRef = useRef(null);
  const containerRef = useRef(null);
  const sketchLayerRef = useRef(null);
  const polygonVertexMarkersRef = useRef([]);
  const polygonVerticesRef = useRef([]);
  const polygonDrawingEnabledRef = useRef(false);
  const cellSet = useMemo(() => new Set(gridIndex?.cell_ids || []), [gridIndex]);

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

    drawnItemsRef.current = new L.FeatureGroup().addTo(map);
    uploadLayerRef.current = new L.FeatureGroup().addTo(map);
    selectionLayerRef.current = L.layerGroup().addTo(map);
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
      drawnItemsRef.current.clearLayers();
      const polygonLayer = L.polygon(latLngs, {
        color: '#5b7282',
        weight: 2,
        fillOpacity: 0.05,
      }).addTo(drawnItemsRef.current);
      polygonLayer.on('click', () => onClearPolygons(true));
      const cells = collectCellsFromLatLngs(latLngs, gridIndex);
      onReplaceSelection(cells, 'replace');
      clearSketch();
    }

    const drawToggleControl = L.Control.extend({
      options: { position: 'topleft' },
      onAdd() {
        const div = L.DomUtil.create('div', 'leaflet-bar leaflet-control polygon-draw-control');
        const button = L.DomUtil.create('a', '', div);
        button.href = '#';
        button.title = 'Nariši poligon';
        button.innerHTML = '⬠';
        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.on(button, 'click', (event) => {
          L.DomEvent.preventDefault(event);
          if (polygonDrawingEnabledRef.current) {
            clearSketch();
          } else {
            drawnItemsRef.current.clearLayers();
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
        onToggleCell(cellId);
      }
    });

    mapRef.current = map;

    return () => {
      containerRef.current?.removeEventListener('wheel', stopWheelScroll);
      polygonVertexMarkersRef.current.forEach((marker) => marker.remove());
    };
  }, [gridIndex, cellSet, onReplaceSelection, onToggleCell]);

  useEffect(() => {
    if (!mapRef.current || !gridIndex) {
      return;
    }

    const map = mapRef.current;
    if (canvasLayerRef.current && map.hasLayer(canvasLayerRef.current)) {
      map.removeLayer(canvasLayerRef.current);
    }

    const totColumn = yearData?.columns?.tot_p || [];
    const maxTot = totColumn.reduce((max, value) => {
      const current = Number(value);
      return Number.isFinite(current) && current > max ? current : max;
    }, 0);

    const CanvasLayer = L.Layer.extend({
      onAdd() {
        this._canvas = L.DomUtil.create('canvas', 'grid-canvas-layer');
        this._canvas.style.position = 'absolute';
        map.getPanes().overlayPane.appendChild(this._canvas);
        map.on('moveend zoomend resize', this._reset, this);
        this._reset();
      },
      onRemove() {
        if (this._canvas?.parentNode) {
          this._canvas.parentNode.removeChild(this._canvas);
        }
        map.off('moveend zoomend resize', this._reset, this);
      },
      _reset() {
        const size = map.getSize();
        const topLeft = map.containerPointToLayerPoint([0, 0]);
        L.DomUtil.setPosition(this._canvas, topLeft);
        this._canvas.width = size.x;
        this._canvas.height = size.y;

        const ctx = this._canvas.getContext('2d');
        ctx.clearRect(0, 0, size.x, size.y);

        const bounds = map.getBounds();
        const sw = latLngToProjected(bounds.getSouthWest().lat, bounds.getSouthWest().lng);
        const ne = latLngToProjected(bounds.getNorthEast().lat, bounds.getNorthEast().lng);
        const minX = Math.min(sw.x, ne.x) - 200;
        const maxX = Math.max(sw.x, ne.x) + 200;
        const minY = Math.min(sw.y, ne.y) - 200;
        const maxY = Math.max(sw.y, ne.y) + 200;

        gridIndex.cell_ids.forEach((cellId, index) => {
          const x = gridIndex.x_coords[index];
          const y = gridIndex.y_coords[index];
          if (x < minX || x > maxX || y < minY || y > maxY) {
            return;
          }

          const bottomLeft = map.latLngToContainerPoint(projectedToLatLng(x, y));
          const topRight = map.latLngToContainerPoint(projectedToLatLng(x + 100, y + 100));
          const width = Math.max(topRight.x - bottomLeft.x, 1);
          const height = Math.max(bottomLeft.y - topRight.y, 1);
          const value = Number(totColumn[index]);

          ctx.fillStyle = selectedIds.has(cellId)
            ? 'rgba(34, 67, 90, 0.82)'
            : getColorForValue(value, maxTot);
          ctx.fillRect(bottomLeft.x, topRight.y, width, height);

          if (map.getZoom() >= 11) {
            ctx.strokeStyle = selectedIds.has(cellId)
              ? 'rgba(247, 249, 250, 0.92)'
              : 'rgba(78, 97, 111, 0.10)';
            ctx.lineWidth = selectedIds.has(cellId) ? 1.1 : 0.4;
            ctx.strokeRect(bottomLeft.x, topRight.y, width, height);
          }
        });
      },
    });

    canvasLayerRef.current = new CanvasLayer();
    canvasLayerRef.current.addTo(map);

    return () => {
      if (canvasLayerRef.current && map.hasLayer(canvasLayerRef.current)) {
        map.removeLayer(canvasLayerRef.current);
      }
    };
  }, [gridIndex, yearData, selectedIds]);

  useEffect(() => {
    if (!selectionLayerRef.current) {
      return;
    }

    selectionLayerRef.current.clearLayers();
    selectedIds.forEach((cellId) => {
      const latLngs = cellPolygonLatLngs(cellId);
      if (!latLngs) {
        return;
      }

      L.polygon(latLngs, {
        color: '#163d57',
        weight: 1,
        fillOpacity: 0,
      }).addTo(selectionLayerRef.current);
    });
  }, [selectedIds]);

  useEffect(() => {
    if (!uploadLayerRef.current || !mapRef.current) {
      return;
    }

    uploadLayerRef.current.clearLayers();
    if (!uploadedGeoJson) {
      return;
    }

      L.geoJSON(uploadedGeoJson, {
        style: {
          color: '#1f4e79',
          weight: 3,
          dashArray: '8 4',
          fillColor: '#ffffff',
          fillOpacity: 0.01,
        },
      onEachFeature: (_, layer) => {
        layer.on('click', () => onClearPolygons(true));
        layer.bindTooltip('Naložen poligon');
      },
    }).addTo(uploadLayerRef.current);

    if (uploadedBounds?.length > 0) {
      mapRef.current.fitBounds(uploadedBounds, { padding: [18, 18] });
    }
  }, [uploadedGeoJson, uploadedBounds, onClearPolygons]);

  useEffect(() => {
    if (!drawnItemsRef.current || !uploadLayerRef.current || !mapRef.current) {
      return;
    }

    drawnItemsRef.current.clearLayers();
    uploadLayerRef.current.clearLayers();
    sketchLayerRef.current?.clearLayers();
    polygonVerticesRef.current = [];
    polygonVertexMarkersRef.current.forEach((marker) => marker.remove());
    polygonVertexMarkersRef.current = [];
    polygonDrawingEnabledRef.current = false;
    mapRef.current.fitBounds(
      [
        [gridIndex.bbox_wgs84[1], gridIndex.bbox_wgs84[0]],
        [gridIndex.bbox_wgs84[3], gridIndex.bbox_wgs84[2]],
      ],
      { padding: [6, 6] },
    );
  }, [geometryClearToken, gridIndex]);

  useEffect(() => {
    if (selectionClearToken === 0 || !selectionLayerRef.current) {
      return;
    }
    selectionLayerRef.current.clearLayers();
  }, [selectionClearToken]);

  useEffect(() => {
    if (!mapRef.current) {
      return;
    }

    if (adminLayerRef.current) {
      mapRef.current.removeLayer(adminLayerRef.current);
      adminLayerRef.current = null;
    }

    if (!adminData?.geojson) {
      return;
    }

    adminLayerRef.current = L.geoJSON(adminData.geojson, {
      style: (feature) => ({
        color: feature.properties.admin_id === selectedAdminId ? '#4b5b66' : '#98a6b0',
        weight: feature.properties.admin_id === selectedAdminId ? 2 : 1,
        fillOpacity: 0.02,
      }),
      onEachFeature: (feature, layer) => {
        layer.on('click', () => onSelectAdmin(feature.properties.admin_id));
        layer.bindTooltip(feature.properties.admin_name || feature.properties.name || feature.properties.admin_id);
      },
    }).addTo(mapRef.current);
  }, [adminData, onSelectAdmin, selectedAdminId]);

  return (
    <section className="map-panel">
      <div className="map-panel__toolbar">
        <div>
          <strong>Karta</strong>
          <p>`⬠` začne nov poligon. Klik na prvo točko zaključi lik. Klik na poligon ga izbriše.</p>
        </div>
        <div className="map-panel__actions">
          <button type="button" className="button button--muted" onClick={onClearPolygons}>
            Izbriši poligon
          </button>
          <button type="button" className="button button--secondary" onClick={onClearSelection}>
            Odizberi vse celice
          </button>
        </div>
        {adminData?.options?.length > 0 && (
          <label className="control">
            <span>Občina</span>
            <select value={selectedAdminId || ''} onChange={(event) => onSelectAdmin(event.target.value || null)}>
              <option value="">Brez administrativnega izbora</option>
              {adminData.options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div ref={containerRef} className="map-container" />
    </section>
  );
}
