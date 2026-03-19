import proj4 from 'proj4';
import { ABSOLUTE_FIELDS, PROJECTED_CRS, WEIGHTED_MEAN_FIELDS } from './config';

proj4.defs(
  PROJECTED_CRS,
  '+proj=tmerc +lat_0=0 +lon_0=15 +k=0.9999 +x_0=500000 +y_0=-5000000 +ellps=GRS80 +units=m +no_defs',
);

export function parseCellId(cellId) {
  const parts = `${cellId}`.split('_');
  if (parts.length < 3) {
    return null;
  }

  const x = Number(parts[1]) * 100;
  const y = Number(parts[2]) * 100;
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return { x, y };
}

export function projectedToLatLng(x, y) {
  const [lng, lat] = proj4(PROJECTED_CRS, 'EPSG:4326', [x, y]);
  return [lat, lng];
}

export function latLngToProjected(lat, lng) {
  const [x, y] = proj4('EPSG:4326', PROJECTED_CRS, [lng, lat]);
  return { x, y };
}

export function cellPolygonLatLngs(cellId) {
  const parsed = parseCellId(cellId);
  if (!parsed) {
    return null;
  }

  const { x, y } = parsed;
  return [
    projectedToLatLng(x, y),
    projectedToLatLng(x + 100, y),
    projectedToLatLng(x + 100, y + 100),
    projectedToLatLng(x, y + 100),
  ];
}

export function normalizeNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= -1000000) {
    return null;
  }

  return numeric;
}

export function safeDivide(numerator, denominator, multiplier = 1) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return null;
  }

  return (numerator / denominator) * multiplier;
}

const POPULATION_WEIGHTED_FIELDS = new Set(ABSOLUTE_FIELDS.filter((field) => !field.startsWith('edct_')));

export function aggregateSelection(selectedIds, yearData, cellIdToIndex, selectionWeights = null) {
  if (!yearData || selectedIds.size === 0) {
    return null;
  }

  const sourceIds = Array.from(selectedIds);
  const totals = Object.fromEntries(ABSOLUTE_FIELDS.map((field) => [field, 0]));
  const weightedSums = Object.fromEntries(WEIGHTED_MEAN_FIELDS.map(({ field }) => [field, 0]));
  const weights = Object.fromEntries(WEIGHTED_MEAN_FIELDS.map(({ field }) => [field, 0]));

  sourceIds.forEach((cellId) => {
    const index = cellIdToIndex.get(cellId);
    if (index === undefined) {
      return;
    }

    ABSOLUTE_FIELDS.forEach((field) => {
      const column = yearData.columns[field];
      if (!column) {
        return;
      }
      const value = normalizeNumber(column[index]);
      if (value !== null) {
        const factor = selectionWeights?.get(cellId) ?? 1;
        totals[field] += value * (POPULATION_WEIGHTED_FIELDS.has(field) ? factor : 1);
      }
    });

    WEIGHTED_MEAN_FIELDS.forEach(({ field, weightField }) => {
      const value = normalizeNumber(yearData.columns[field]?.[index]);
      const weight = normalizeNumber(yearData.columns[weightField]?.[index]);
      if (value !== null && weight !== null && weight > 0) {
        const factor = selectionWeights?.get(cellId) ?? 1;
        weightedSums[field] += value * weight * factor;
        weights[field] += weight * factor;
      }
    });
  });

  const result = { ...totals };

  WEIGHTED_MEAN_FIELDS.forEach(({ field }) => {
    result[field] = safeDivide(weightedSums[field], weights[field]);
  });

  result.pct_p00_14 = safeDivide(result.p_00_14, result.tot_p, 100);
  result.pct_m00_14 = safeDivide(result.m_00_14, result.tot_m, 100);
  result.pct_f00_14 = safeDivide(result.f_00_14, result.tot_f, 100);
  result.pct_p15_64 = safeDivide(result.p_15_64, result.tot_p, 100);
  result.pct_m15_64 = safeDivide(result.m_15_64, result.tot_m, 100);
  result.pct_f15_64 = safeDivide(result.f_15_64, result.tot_f, 100);
  result.pct_p65_ = safeDivide(result.p_65_, result.tot_p, 100);
  result.pct_m65_ = safeDivide(result.m_65_, result.tot_m, 100);
  result.pct_f65_ = safeDivide(result.f_65_, result.tot_f, 100);
  result.ind_age_p = safeDivide(result.p_65_, result.p_00_14, 100);
  result.ind_age_m = safeDivide(result.m_65_, result.m_00_14, 100);
  result.ind_age_f = safeDivide(result.f_65_, result.f_00_14, 100);
  result.ind_fem = safeDivide(result.tot_f, result.tot_m, 100);

  return result;
}

export function pointInPolygon(point, polygon) {
  const [px, py] = point;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersects =
      yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / ((yj - yi) || Number.EPSILON) + xi;
    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

export function pointInRect(point, x, y, size = 100) {
  const [px, py] = point;
  return px >= x && px <= x + size && py >= y && py <= y + size;
}

function orientation(a, b, c) {
  return (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1]);
}

function onSegment(a, b, c) {
  return (
    Math.min(a[0], c[0]) <= b[0] &&
    b[0] <= Math.max(a[0], c[0]) &&
    Math.min(a[1], c[1]) <= b[1] &&
    b[1] <= Math.max(a[1], c[1])
  );
}

export function segmentsIntersect(a1, a2, b1, b2) {
  const o1 = orientation(a1, a2, b1);
  const o2 = orientation(a1, a2, b2);
  const o3 = orientation(b1, b2, a1);
  const o4 = orientation(b1, b2, a2);

  if (o1 === 0 && onSegment(a1, b1, a2)) return true;
  if (o2 === 0 && onSegment(a1, b2, a2)) return true;
  if (o3 === 0 && onSegment(b1, a1, b2)) return true;
  if (o4 === 0 && onSegment(b1, a2, b2)) return true;

  return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
}

export function polygonIntersectsCell(polygon, x, y, size = 100) {
  const cellCorners = [
    [x, y],
    [x + size, y],
    [x + size, y + size],
    [x, y + size],
  ];
  const cellEdges = [
    [cellCorners[0], cellCorners[1]],
    [cellCorners[1], cellCorners[2]],
    [cellCorners[2], cellCorners[3]],
    [cellCorners[3], cellCorners[0]],
  ];

  if (pointInPolygon([x + size / 2, y + size / 2], polygon)) {
    return true;
  }

  if (cellCorners.some((corner) => pointInPolygon(corner, polygon))) {
    return true;
  }

  if (polygon.some((vertex) => pointInRect(vertex, x, y, size))) {
    return true;
  }

  for (let i = 0; i < polygon.length; i += 1) {
    const start = polygon[i];
    const end = polygon[(i + 1) % polygon.length];
    for (const [cellStart, cellEnd] of cellEdges) {
      if (segmentsIntersect(start, end, cellStart, cellEnd)) {
        return true;
      }
    }
  }

  return false;
}

export function formatMetric(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return 'Ni podatka';
  }

  return new Intl.NumberFormat('sl-SI', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

export function getColorForValue(value, maxValue) {
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(maxValue) || maxValue <= 0) {
    return 'rgba(255, 245, 157, 0.08)';
  }

  const ratio = Math.min(value / maxValue, 1);
  if (ratio <= 0.05) return 'rgba(255, 245, 157, 0.18)';
  if (ratio <= 0.15) return 'rgba(255, 213, 79, 0.28)';
  if (ratio <= 0.35) return 'rgba(255, 167, 38, 0.38)';
  if (ratio <= 0.6) return 'rgba(239, 108, 0, 0.5)';
  return 'rgba(183, 28, 28, 0.64)';
}

export function geoJsonToLatLngBounds(geojson) {
  const coordinates = [];

  function coordinateToLatLng(pair) {
    const [a, b] = pair;
    if (Math.abs(a) > 180 || Math.abs(b) > 90) {
      return projectedToLatLng(a, b);
    }
    return [b, a];
  }

  function walk(value) {
    if (!Array.isArray(value)) {
      return;
    }
    if (typeof value[0] === 'number' && typeof value[1] === 'number') {
      coordinates.push(coordinateToLatLng(value));
      return;
    }
    value.forEach(walk);
  }

  if (geojson?.type === 'FeatureCollection') {
    geojson.features.forEach((feature) => walk(feature.geometry?.coordinates));
  } else if (geojson?.type === 'Feature') {
    walk(geojson.geometry?.coordinates);
  } else {
    walk(geojson?.coordinates);
  }

  return coordinates;
}

export function polygonCoordinatesToProjectedRings(geometry) {
  if (!geometry) {
    return [];
  }

  function coordinateToProjected(pair) {
    const [a, b] = pair;
    if (Math.abs(a) > 180 || Math.abs(b) > 90) {
      return [a, b];
    }
    const point = latLngToProjected(b, a);
    return [point.x, point.y];
  }

  if (geometry.type === 'Polygon') {
    return geometry.coordinates.map((ring) =>
      ring.map((pair) => coordinateToProjected(pair)),
    );
  }

  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.flatMap((polygon) =>
      polygon.map((ring) =>
        ring.map((pair) => coordinateToProjected(pair)),
      ),
    );
  }

  return [];
}

export function geometryToProjectedPolygons(geometry) {
  if (!geometry) {
    return [];
  }

  if (geometry.type === 'Polygon') {
    return [polygonCoordinatesToProjectedRings(geometry)];
  }

  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.map((polygon) =>
      polygon.map((ring) =>
        ring.map((pair) => {
          const [a, b] = pair;
          if (Math.abs(a) > 180 || Math.abs(b) > 90) {
            return [a, b];
          }
          const point = latLngToProjected(b, a);
          return [point.x, point.y];
        }),
      ),
    );
  }

  return [];
}

export function pointInPolygonWithHoles(point, polygonRings) {
  if (!polygonRings?.length) {
    return false;
  }

  if (!pointInPolygon(point, polygonRings[0])) {
    return false;
  }

  for (let i = 1; i < polygonRings.length; i += 1) {
    if (pointInPolygon(point, polygonRings[i])) {
      return false;
    }
  }

  return true;
}

export function pointInProjectedPolygons(point, polygons) {
  return polygons.some((polygon) => pointInPolygonWithHoles(point, polygon));
}

export function cellCoverageRatio(polygons, x, y, size = 100, samples = 6) {
  if (!polygons?.length) {
    return 0;
  }

  let inside = 0;
  const total = samples * samples;
  const step = size / samples;

  for (let row = 0; row < samples; row += 1) {
    for (let col = 0; col < samples; col += 1) {
      const px = x + col * step + step / 2;
      const py = y + row * step + step / 2;
      if (pointInProjectedPolygons([px, py], polygons)) {
        inside += 1;
      }
    }
  }

  return inside / total;
}
