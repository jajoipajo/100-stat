import { useEffect, useMemo, useState } from 'react';
import shp from 'shpjs';
import ChartsPanel from './components/ChartsPanel';
import MapPanel from './components/MapPanel';
import { aggregateSelection, cellCoverageRatio, geoJsonToLatLngBounds, geometryToProjectedPolygons } from './utils';

async function fetchJson(path, options = {}) {
  const { optional = false } = options;
  const response = await fetch(path);
  if (!response.ok) {
    if (optional && response.status === 404) {
      return null;
    }
    throw new Error(`Napaka pri nalaganju ${path}: ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();

  if (optional && text.trim().startsWith('<!doctype html')) {
    return null;
  }

  if (!contentType.includes('json') && !text.trim().startsWith('{') && !text.trim().startsWith('[')) {
    if (optional) {
      return null;
    }
    throw new Error(`Datoteka ${path} ni JSON.`);
  }

  try {
    return JSON.parse(text);
  } catch (parseError) {
    if (optional) {
      return null;
    }
    throw parseError;
  }
}

function normalizeFeatureCollection(data) {
  if (!data) {
    return null;
  }

  if (data.type === 'FeatureCollection') {
    return data;
  }

  if (Array.isArray(data)) {
    if (data.length > 0 && data[0]?.type === 'FeatureCollection') {
      return {
        type: 'FeatureCollection',
        features: data.flatMap((collection) => collection.features || []),
      };
    }
    if (data.length > 0 && data[0]?.type === 'Feature') {
      return { type: 'FeatureCollection', features: data };
    }
  }

  if (data.type === 'Feature') {
    return { type: 'FeatureCollection', features: [data] };
  }

  return null;
}

function collectCellsForFeatureCollection(featureCollection, gridIndex, mode = 'intersect') {
  if (!featureCollection || !gridIndex) {
    return { selected: new Set(), weights: new Map() };
  }

  const selected = new Set();
  const weights = new Map();
  featureCollection.features.forEach((feature) => {
    const polygons = geometryToProjectedPolygons(feature.geometry);
    if (polygons.length === 0) {
      return;
    }

    const xs = polygons.flat(2).map(([x]) => x);
    const ys = polygons.flat(2).map(([, y]) => y);
    const minX = Math.min(...xs) - 100;
    const maxX = Math.max(...xs) + 100;
    const minY = Math.min(...ys) - 100;
    const maxY = Math.max(...ys) + 100;

    gridIndex.cell_ids.forEach((cellId, index) => {
      const x = gridIndex.x_coords[index];
      const y = gridIndex.y_coords[index];

      if (x < minX || x > maxX || y < minY || y > maxY) {
        return;
      }

      const ratio = cellCoverageRatio(polygons, x, y, gridIndex.cell_size_m || 100);
      if (mode === 'intersect' && ratio > 0) {
        selected.add(cellId);
      }
      if (mode === 'within' && ratio >= 0.999) {
        selected.add(cellId);
      }
      if (mode === 'weighted_population' && ratio > 0) {
        selected.add(cellId);
        weights.set(cellId, ratio);
      }
    });
  });

  return { selected, weights };
}

function decorateFeatureCollection(featureCollection, activeYear, selectedYears, yearDataMap, cellIdToIndex, gridIndex) {
  const activeFields = yearDataMap[activeYear]?.fields || [];
  return {
    ...featureCollection,
    features: featureCollection.features.map((feature) => {
      const featureCollectionSingle = { type: 'FeatureCollection', features: [feature] };
      const cellIds = collectCellsForFeatureCollection(featureCollectionSingle, gridIndex, 'intersect').selected;
      const activeAggregate = aggregateSelection(cellIds, yearDataMap[activeYear], cellIdToIndex);
      const timeline = Object.fromEntries(
        selectedYears.map((year) => [year, aggregateSelection(cellIds, yearDataMap[year], cellIdToIndex)]),
      );
      const averages = Object.fromEntries(
        activeFields.map((field) => [
          `avg_${field}`,
          cellIds.size > 0 && activeAggregate && Number.isFinite(activeAggregate[field])
            ? Number((activeAggregate[field] / cellIds.size).toFixed(4))
            : null,
        ]),
      );

      return {
        ...feature,
        properties: {
          ...feature.properties,
          analysis_year: activeYear,
          selected_cell_count: cellIds.size,
          ...averages,
          ...Object.fromEntries(
            Object.entries(activeAggregate || {}).map(([key, value]) => [key, value ?? null]),
          ),
          timeline,
        },
      };
    }),
  };
}

export default function App() {
  const [manifest, setManifest] = useState(null);
  const [gridIndex, setGridIndex] = useState(null);
  const [adminData, setAdminData] = useState(null);
  const [yearDataMap, setYearDataMap] = useState({});
  const [activeYear, setActiveYear] = useState('');
  const [selectedYears, setSelectedYears] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [selectedAdminId, setSelectedAdminId] = useState(null);
  const [status, setStatus] = useState('Nalagam podatke ...');
  const [error, setError] = useState(null);
  const [geometryClearToken, setGeometryClearToken] = useState(0);
  const [selectionClearToken, setSelectionClearToken] = useState(0);
  const [uploadedGeoJson, setUploadedGeoJson] = useState(null);
  const [uploadedLabel, setUploadedLabel] = useState('');
  const [uploadedSelectionMode, setUploadedSelectionMode] = useState('intersect');
  const [selectionWeights, setSelectionWeights] = useState(null);

  useEffect(() => {
    async function loadBootstrap() {
      try {
        const [manifestData, gridData, adminGeojson, adminCells] = await Promise.all([
          fetchJson('./data/manifest.json'),
          fetchJson('./data/grid-index.json'),
          fetchJson('./admin/municipalities.geojson', { optional: true }),
          fetchJson('./admin/municipality-cells.json', { optional: true }),
        ]);

        if (!manifestData || !gridData) {
          setStatus('V public/data še ni pripravljenih frontend podatkov. Zaženi pripravljalno skripto iz README.');
          return;
        }

        setManifest(manifestData);
        setGridIndex(gridData);
        setActiveYear(manifestData.years.at(-1));
        setSelectedYears(manifestData.years);

        if (adminGeojson && adminCells) {
          setAdminData({
            geojson: adminGeojson,
            mapping: adminCells,
            options: adminGeojson.features.map((feature) => ({
              id: feature.properties.admin_id,
              name: feature.properties.admin_name || feature.properties.name || feature.properties.admin_id,
            })),
          });
        }

        setStatus(null);
      } catch (loadError) {
        setError(loadError.message);
      }
    }

    loadBootstrap();
  }, []);

  useEffect(() => {
    async function ensureYearsLoaded() {
      if (!manifest) {
        return;
      }

      const yearsToLoad = Array.from(new Set([activeYear, ...selectedYears])).filter(Boolean);
      const missingYears = yearsToLoad.filter((year) => !yearDataMap[year]);
      if (missingYears.length === 0) {
        return;
      }

      try {
        const loaded = await Promise.all(
          missingYears.map(async (year) => [year, await fetchJson(`./data/attributes/${year}.json`)]),
        );
        setYearDataMap((current) => {
          const next = { ...current };
          loaded.forEach(([year, payload]) => {
            if (payload) {
              next[year] = payload;
            }
          });
          return next;
        });
      } catch (loadError) {
        setError(loadError.message);
      }
    }

    ensureYearsLoaded();
  }, [manifest, activeYear, selectedYears, yearDataMap]);

  const cellIdToIndex = useMemo(() => {
    if (!gridIndex) {
      return new Map();
    }
    return new Map(gridIndex.cell_ids.map((cellId, index) => [cellId, index]));
  }, [gridIndex]);

  const aggregatedByYear = useMemo(() => {
    if (!gridIndex || selectedYears.length === 0) {
      return {};
    }

      return Object.fromEntries(
      selectedYears.map((year) => [
        year,
        aggregateSelection(selectedIds, yearDataMap[year], cellIdToIndex, selectionWeights),
      ]),
      );
  }, [gridIndex, selectedIds, selectedYears, yearDataMap, cellIdToIndex, selectionWeights]);

  const activeAggregate = aggregatedByYear[activeYear] || null;

  const clearSelection = () => {
    setSelectedIds(new Set());
    setSelectedAdminId(null);
    setSelectionWeights(null);
    setSelectionClearToken((value) => value + 1);
  };

  const clearPolygons = (clearSelectionToo = false) => {
    setUploadedGeoJson(null);
    setUploadedLabel('');
    setSelectionWeights(null);
    setGeometryClearToken((value) => value + 1);
    if (clearSelectionToo) {
      clearSelection();
    }
  };

  const handleToggleCell = (cellId) => {
    setSelectedAdminId(null);
    setSelectionWeights(null);
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(cellId)) {
        next.delete(cellId);
      } else {
        next.add(cellId);
      }
      return next;
    });
  };

  const handleReplaceSelection = (cellIds, mode = 'replace') => {
    setSelectedAdminId(null);
    setSelectedIds((current) => {
      if (mode === 'replace') {
        return new Set(cellIds);
      }
      const next = new Set(current);
      cellIds.forEach((cellId) => next.add(cellId));
      return next;
    });
  };

  const handleSelectAdmin = (adminId) => {
    setSelectedAdminId(adminId);
    if (!adminId || !adminData?.mapping?.[adminId]) {
      setSelectedIds(new Set());
      setSelectionWeights(null);
      return;
    }
    setSelectedIds(new Set(adminData.mapping[adminId]));
    setSelectionWeights(null);
  };

  const handleUploadPolygon = async (event) => {
    const file = event.target.files?.[0];
    if (!file || !gridIndex) {
      return;
    }

    try {
      let parsed = null;

      if (file.name.toLowerCase().endsWith('.geojson') || file.name.toLowerCase().endsWith('.json')) {
        parsed = normalizeFeatureCollection(JSON.parse(await file.text()));
      } else if (file.name.toLowerCase().endsWith('.zip') || file.name.toLowerCase().endsWith('.shp')) {
        parsed = normalizeFeatureCollection(await shp(await file.arrayBuffer()));
      } else {
        throw new Error('Podprt je GeoJSON ali zip/shp shapefile.');
      }

      if (!parsed || parsed.features.length === 0) {
        throw new Error('V vhodni datoteki ni podprte poligonske geometrije.');
      }

      const selectedFromUpload = collectCellsForFeatureCollection(parsed, gridIndex, uploadedSelectionMode);
      setUploadedGeoJson(parsed);
      setUploadedLabel(file.name);
      setSelectedAdminId(null);
      setSelectedIds(selectedFromUpload.selected);
      setSelectionWeights(selectedFromUpload.weights.size > 0 ? selectedFromUpload.weights : null);
    } catch (uploadError) {
      setError(uploadError.message);
    } finally {
      event.target.value = '';
    }
  };

  const handleExportUploadedPolygon = () => {
    if (!uploadedGeoJson || !activeYear) {
      return;
    }

    const decorated = decorateFeatureCollection(
      uploadedGeoJson,
      activeYear,
      selectedYears,
      yearDataMap,
      cellIdToIndex,
      gridIndex,
    );
    const blob = new Blob([JSON.stringify(decorated, null, 2)], { type: 'application/geo+json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `poligon-analiza-${activeYear}.geojson`;
    link.click();
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    if (!uploadedGeoJson || !gridIndex) {
      return;
    }

    const recalculated = collectCellsForFeatureCollection(uploadedGeoJson, gridIndex, uploadedSelectionMode);
    setSelectedIds(recalculated.selected);
    setSelectionWeights(recalculated.weights.size > 0 ? recalculated.weights : null);
  }, [uploadedGeoJson, gridIndex, uploadedSelectionMode]);

  if (error) {
    return <main className="app-shell"><section className="notice notice--error">{error}</section></main>;
  }

  if (status) {
    return <main className="app-shell"><section className="notice">{status}</section></main>;
  }

  return (
    <main className="app-shell">
      <section className="workspace">
        <aside className="sidebar-panel">
          <div className="sidebar-header">
            <p className="eyebrow">Statična GitHub Pages aplikacija</p>
            <h1>Demografija 100 x 100 m</h1>
            <p>Levo je izbor podatkov in karta, desno pa analitični grafi za izbrano območje.</p>
          </div>

          <div className="control-grid">
            <label className="control">
              <span>Aktivno leto</span>
              <select value={activeYear} onChange={(event) => setActiveYear(event.target.value)}>
                {manifest.years.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </label>

            <label className="control">
              <span>Leta za časovno vrsto</span>
              <select
                multiple
                value={selectedYears}
                onChange={(event) =>
                  setSelectedYears(
                    (() => {
                      const values = Array.from(event.target.selectedOptions).map((option) => option.value).sort();
                      return values.length > 0 ? values : [activeYear];
                    })(),
                  )
                }
              >
                {manifest.years.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </label>

            <label className="control control--wide">
              <span>Naloži svoj poligon</span>
              <input type="file" accept=".geojson,.json,.zip,.shp" onChange={handleUploadPolygon} />
            </label>

            {uploadedGeoJson && (
              <div className="control compact-control control--wide">
                <span>Način obračuna za uvožen poligon</span>
                <label className="check-option">
                  <input
                    type="radio"
                    name="upload-mode"
                    checked={uploadedSelectionMode === 'intersect'}
                    onChange={() => setUploadedSelectionMode('intersect')}
                  />
                  <span>Izberi celice, ki jih meja seka</span>
                </label>
                <label className="check-option">
                  <input
                    type="radio"
                    name="upload-mode"
                    checked={uploadedSelectionMode === 'within'}
                    onChange={() => setUploadedSelectionMode('within')}
                  />
                  <span>Izberi celice, ki so v celoti znotraj poligona</span>
                </label>
                <label className="check-option">
                  <input
                    type="radio"
                    name="upload-mode"
                    checked={uploadedSelectionMode === 'weighted_population'}
                    onChange={() => setUploadedSelectionMode('weighted_population')}
                  />
                  <span>Uteži prebivalstvo glede na delež celice v poligonu</span>
                </label>
              </div>
            )}

            <div className="button-row control--wide">
              <button type="button" className="button" onClick={clearSelection}>
                Počisti izbor
              </button>
            </div>

            {uploadedGeoJson && (
              <div className="upload-summary control--wide">
                <span>{uploadedLabel}</span>
                <button type="button" className="button button--secondary" onClick={handleExportUploadedPolygon}>
                  Izvozi obogaten poligon
                </button>
              </div>
            )}
          </div>

          <MapPanel
            gridIndex={gridIndex}
            selectedIds={selectedIds}
            onToggleCell={handleToggleCell}
            onReplaceSelection={handleReplaceSelection}
            yearData={yearDataMap[activeYear]}
            adminData={adminData}
            selectedAdminId={selectedAdminId}
            onSelectAdmin={handleSelectAdmin}
            uploadedGeoJson={uploadedGeoJson}
            uploadedBounds={geoJsonToLatLngBounds(uploadedGeoJson)}
            geometryClearToken={geometryClearToken}
            selectionClearToken={selectionClearToken}
            onClearSelection={clearSelection}
            onClearPolygons={clearPolygons}
          />
        </aside>

        <section className="charts-wrap">
          <ChartsPanel
            selectedYears={selectedYears}
            aggregatedByYear={aggregatedByYear}
            latestAggregate={activeAggregate}
            selectedCount={selectedIds.size}
          />
        </section>
      </section>
    </main>
  );
}
