import { useEffect, useMemo, useState } from 'react';
import shp from 'shpjs';
import ChartsPanel from './components/ChartsPanel';
import MapPanel from './components/MapPanel';
import {
  aggregateSelection,
  buildQuantileScale,
  cellCoverageRatio,
  geoJsonToLatLngBounds,
  geometryToProjectedPolygons,
} from './utils';

function createEmptySelection() {
  return {
    ids: new Set(),
    adminId: null,
    geoJson: null,
    label: '',
    selectionMode: 'intersect',
    weights: null,
    manualDirty: false,
  };
}

function buildYearRange(years, fromYear, toYear) {
  const fromIndex = years.indexOf(fromYear);
  const toIndex = years.indexOf(toYear);
  if (fromIndex === -1 || toIndex === -1) {
    return [];
  }

  const start = Math.min(fromIndex, toIndex);
  const end = Math.max(fromIndex, toIndex);
  return years.slice(start, end + 1);
}

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

function decorateFeatureCollection(featureCollection, activeYear, selectedYears, yearDataMap, selectedIds, selectionWeights, cellIdToIndex) {
  const activeFields = yearDataMap[activeYear]?.fields || [];
  const activeAggregate = aggregateSelection(selectedIds, yearDataMap[activeYear], cellIdToIndex, selectionWeights);
  const timeline = Object.fromEntries(
    selectedYears.map((year) => [year, aggregateSelection(selectedIds, yearDataMap[year], cellIdToIndex, selectionWeights)]),
  );

  return {
    ...featureCollection,
    features: featureCollection.features.map((feature) => ({
      ...feature,
      properties: {
        ...feature.properties,
        analysis_year: activeYear,
        selected_cell_count: selectedIds.size,
        weighted_selection: Boolean(selectionWeights),
        ...Object.fromEntries(
          activeFields.map((field) => [
            `avg_${field}`,
            selectedIds.size > 0 && activeAggregate && Number.isFinite(activeAggregate[field])
              ? Number((activeAggregate[field] / selectedIds.size).toFixed(4))
              : null,
          ]),
        ),
        ...Object.fromEntries(Object.entries(activeAggregate || {}).map(([key, value]) => [key, value ?? null])),
        timeline,
      },
    })),
  };
}

export default function App() {
  const [manifest, setManifest] = useState(null);
  const [gridIndex, setGridIndex] = useState(null);
  const [adminData, setAdminData] = useState(null);
  const [yearDataMap, setYearDataMap] = useState({});
  const [activeYear, setActiveYear] = useState('');
  const [yearRange, setYearRange] = useState({ from: '', to: '' });
  const [status, setStatus] = useState('Nalagam podatke ...');
  const [error, setError] = useState(null);
  const [selectionState, setSelectionState] = useState({
    primary: createEmptySelection(),
    secondary: createEmptySelection(),
  });
  const [activeSelectionSlot, setActiveSelectionSlot] = useState('primary');
  const [isYearLoading, setIsYearLoading] = useState(false);
  const [selectedTrendMetric, setSelectedTrendMetric] = useState('pct_p65_');

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

        const latestYear = manifestData.years.at(-1);
        const earliestYear = manifestData.years.at(0);

        setManifest(manifestData);
        setGridIndex(gridData);
        setActiveYear(latestYear);
        setYearRange({ from: earliestYear, to: latestYear });

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

  const selectedYears = useMemo(() => {
    if (!manifest) {
      return [];
    }
    return buildYearRange(manifest.years, yearRange.from, yearRange.to);
  }, [manifest, yearRange]);

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

      setIsYearLoading(true);
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
      } finally {
        setIsYearLoading(false);
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

  const quantileScale = useMemo(
    () => buildQuantileScale(yearDataMap[activeYear]?.columns?.tot_p || []),
    [activeYear, yearDataMap],
  );

  const allCellIds = useMemo(() => new Set(gridIndex?.cell_ids || []), [gridIndex]);
  const effectivePrimaryIds = selectionState.primary.ids.size > 0 ? selectionState.primary.ids : allCellIds;
  const combinedSelection = useMemo(() => {
    const ids = new Set(effectivePrimaryIds);
    selectionState.secondary.ids.forEach((cellId) => ids.add(cellId));
    const weights = new Map(selectionState.primary.weights || []);
    if (selectionState.secondary.weights) {
      selectionState.secondary.weights.forEach((value, key) => {
        if (!weights.has(key)) {
          weights.set(key, value);
        }
      });
    }
    return { ids, weights: weights.size > 0 ? weights : null };
  }, [effectivePrimaryIds, selectionState.primary.weights, selectionState.secondary.ids, selectionState.secondary.weights]);

  const aggregatedByYear = useMemo(() => {
    if (!gridIndex || selectedYears.length === 0) {
      return {};
    }

    return Object.fromEntries(
      selectedYears.map((year) => [
        year,
        aggregateSelection(effectivePrimaryIds, yearDataMap[year], cellIdToIndex, selectionState.primary.weights),
      ]),
    );
  }, [gridIndex, selectedYears, yearDataMap, cellIdToIndex, effectivePrimaryIds, selectionState.primary.weights]);

  const comparisonAggregatedByYear = useMemo(() => {
    if (!gridIndex || selectedYears.length === 0) {
      return {};
    }

    return Object.fromEntries(
      selectedYears.map((year) => [
        year,
        aggregateSelection(selectionState.secondary.ids, yearDataMap[year], cellIdToIndex, selectionState.secondary.weights),
      ]),
    );
  }, [gridIndex, selectedYears, yearDataMap, cellIdToIndex, selectionState.secondary.ids, selectionState.secondary.weights]);

  const combinedAggregatedByYear = useMemo(() => {
    if (!gridIndex || selectedYears.length === 0) {
      return {};
    }

    return Object.fromEntries(
      selectedYears.map((year) => [
        year,
        aggregateSelection(combinedSelection.ids, yearDataMap[year], cellIdToIndex, combinedSelection.weights),
      ]),
    );
  }, [gridIndex, selectedYears, yearDataMap, cellIdToIndex, combinedSelection]);

  const activeAggregate = aggregatedByYear[activeYear] || null;
  const comparisonAggregate = comparisonAggregatedByYear[activeYear] || null;
  const combinedAggregate = combinedAggregatedByYear[activeYear] || null;
  const activeSlot = selectionState[activeSelectionSlot];
  const secondaryEnabled = Boolean(selectionState.primary.geoJson);

  const updateSlot = (slotKey, updater) => {
    setSelectionState((current) => ({
      ...current,
      [slotKey]: updater(current[slotKey]),
    }));
  };

  const clearSlot = (slotKey) => {
    if (slotKey === 'primary') {
      setSelectionState({
        primary: createEmptySelection(),
        secondary: createEmptySelection(),
      });
      setActiveSelectionSlot('primary');
      return;
    }

    updateSlot(slotKey, () => createEmptySelection());
  };

  const clearAllSelections = () => {
    setSelectionState({
      primary: createEmptySelection(),
      secondary: createEmptySelection(),
    });
    setActiveSelectionSlot('primary');
  };

  const handleToggleCell = (cellId, slotKey = activeSelectionSlot) => {
    updateSlot(slotKey, (slot) => {
      const nextIds = new Set(slot.ids);
      if (nextIds.has(cellId)) {
        nextIds.delete(cellId);
      } else {
        nextIds.add(cellId);
      }

      return {
        ...slot,
        ids: nextIds,
        adminId: null,
        weights: null,
        manualDirty: slot.manualDirty || Boolean(slot.geoJson),
      };
    });
  };

  const handleReplaceSelection = (slotKey, cellIds, options = {}) => {
    const { adminId = null, geoJson, label, weights = null, manualDirty } = options;

    updateSlot(slotKey, (slot) => ({
      ...slot,
      ids: new Set(cellIds),
      adminId,
      weights,
      geoJson: geoJson ?? slot.geoJson,
      label: label ?? slot.label,
      manualDirty: manualDirty ?? (geoJson ? false : slot.manualDirty),
    }));
  };

  const handleSelectAdmin = (adminId, slotKey = activeSelectionSlot) => {
    if (!adminId || !adminData?.mapping?.[adminId]) {
      updateSlot(slotKey, (slot) => ({
        ...slot,
        adminId: null,
        ids: new Set(),
        weights: null,
      }));
      return;
    }

    handleReplaceSelection(slotKey, adminData.mapping[adminId], {
      adminId,
      weights: null,
      manualDirty: Boolean(selectionState[slotKey].geoJson),
    });
  };

  const applyPolygonToSlot = (slotKey, featureCollection, label) => {
    if (!gridIndex || !featureCollection) {
      return;
    }

    const mode = selectionState[slotKey].selectionMode;
    const selectedFromPolygon = collectCellsForFeatureCollection(featureCollection, gridIndex, mode);
    handleReplaceSelection(slotKey, selectedFromPolygon.selected, {
      geoJson: featureCollection,
      label,
      weights: selectedFromPolygon.weights.size > 0 ? selectedFromPolygon.weights : null,
      manualDirty: false,
    });
  };

  const handleDrawPolygon = (featureCollection, slotKey = activeSelectionSlot) => {
    applyPolygonToSlot(slotKey, featureCollection, slotKey === 'primary' ? 'P1' : 'P2');
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

      applyPolygonToSlot(activeSelectionSlot, parsed, file.name);
    } catch (uploadError) {
      setError(uploadError.message);
    } finally {
      event.target.value = '';
    }
  };

  const handleSelectionModeChange = (slotKey, mode) => {
    updateSlot(slotKey, (slot) => ({ ...slot, selectionMode: mode }));
    const geoJson = selectionState[slotKey].geoJson;
    if (geoJson && gridIndex) {
      const recalculated = collectCellsForFeatureCollection(geoJson, gridIndex, mode);
      handleReplaceSelection(slotKey, recalculated.selected, {
        weights: recalculated.weights.size > 0 ? recalculated.weights : null,
        manualDirty: false,
      });
    }
  };

  const handleExportActivePolygon = () => {
    if (!activeSlot.geoJson || !activeYear) {
      return;
    }

    const exportIds = activeSlot.ids.size > 0 ? activeSlot.ids : (activeSelectionSlot === 'primary' ? effectivePrimaryIds : activeSlot.ids);
    const decorated = decorateFeatureCollection(
      activeSlot.geoJson,
      activeYear,
      selectedYears,
      yearDataMap,
      exportIds,
      activeSlot.weights,
      cellIdToIndex,
    );
    const blob = new Blob([JSON.stringify(decorated, null, 2)], { type: 'application/geo+json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `poligon-${activeSelectionSlot}-${activeYear}.geojson`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (error) {
    return <main className="app-shell"><section className="notice notice--error">{error}</section></main>;
  }

  if (status) {
    return <main className="app-shell"><section className="notice">{status}</section></main>;
  }

  return (
    <main className="app-shell">
      <section className="workspace">
        <aside className={`sidebar-panel ${activeSelectionSlot === 'primary' ? 'sidebar-panel--primary' : 'sidebar-panel--secondary'}`}>
          <div className="sidebar-header sidebar-header--compact">
            <div>
              <p className="eyebrow">100-stat: demografska statistika po SURS celicah 100 x 100 m</p>
            </div>
            <div
              className="slot-switch"
              title="Preklopi, za kateri poligon trenutno veljajo upload, kliki na karto in vse spodnje nastavitve."
            >
              <button
                type="button"
                className={`button button--chip ${activeSelectionSlot === 'primary' ? 'button--slot-primary' : 'button--ghost'}`}
                onClick={() => setActiveSelectionSlot('primary')}
                title="Urejaš prvi poligon. Vsi kliki na karto in upload veljajo zanj."
              >
                P1
              </button>
              <button
                type="button"
                className={`button button--chip ${activeSelectionSlot === 'secondary' ? 'button--slot-secondary' : 'button--ghost'}`}
                onClick={() => setActiveSelectionSlot('secondary')}
                disabled={!secondaryEnabled}
                title={secondaryEnabled ? 'Urejaš drugi poligon. Vsi kliki na karto in upload veljajo zanj.' : 'Drugi poligon se odklene, ko najprej zaključiš ali uvoziš prvi poligon.'}
              >
                P2
              </button>
            </div>
          </div>

          <div className="control-grid control-grid--compact">
            <label className="control">
              <span>Leto</span>
              <select value={activeYear} onChange={(event) => setActiveYear(event.target.value)} title="Izberi leto, za katero se obarva karta in osvežijo glavni kazalniki.">
                {manifest.years.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </label>

            <div className="control">
              <span>Trend od-do</span>
              <div className="year-range">
                <select
                  value={yearRange.from}
                  onChange={(event) => setYearRange((current) => ({ ...current, from: event.target.value }))}
                  title="Začetno leto za časovne grafe."
                >
                  {manifest.years.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
                <select
                  value={yearRange.to}
                  onChange={(event) => setYearRange((current) => ({ ...current, to: event.target.value }))}
                  title="Končno leto za časovne grafe."
                >
                  {manifest.years.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <label className="control">
              <span>
                Način preseka
                <span
                  className="inline-help"
                  tabIndex={0}
                  title="Meja seka vrne vse dosežene celice. V celoti znotraj je strožji filter. Utežen izračun je najbolj smiseln za populacijske števce; deleži in kazalniki so pri takem rezu približek."
                >
                  (i)
                </span>
              </span>
              <select
                value={activeSlot.selectionMode}
                onChange={(event) => handleSelectionModeChange(activeSelectionSlot, event.target.value)}
                title={
                  activeSlot.selectionMode === 'intersect'
                    ? 'Meja seka vrne vse dosežene celice.'
                    : activeSlot.selectionMode === 'within'
                      ? 'V celoti znotraj je strožji filter.'
                      : 'Utežen izračun je najbolj smiseln za populacijske števce; deleži in kazalniki so pri takem rezu približek.'
                }
              >
                <option value="intersect">Celice, ki jih meja seka</option>
                <option value="within">Celice v celoti znotraj</option>
                <option value="weighted_population">Utežen izračun po deležu preseka</option>
              </select>
            </label>

            <label className="control control--wide">
              <span>Naloži poligon</span>
              <input
                type="file"
                accept=".geojson,.json,.zip,.shp"
                onChange={handleUploadPolygon}
                title="Naloži GeoJSON ali shapefile za trenutno aktivni poligon."
              />
            </label>

            {adminData?.options?.length > 0 && (
              <label className="control">
                <span>Občina</span>
                <select
                  value={activeSlot.adminId || ''}
                  onChange={(event) => handleSelectAdmin(event.target.value || null, activeSelectionSlot)}
                  title="Administrativni izbor nadomesti trenutni izbor aktivnega poligona."
                >
                  <option value="">Brez administrativnega izbora</option>
                  {adminData.options.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <div className="selection-summary">
              <div>
                <strong>{activeSelectionSlot === 'primary' ? 'P1' : 'P2'}</strong>
                <p>{activeSlot.ids.size} celic, način: {activeSlot.selectionMode}</p>
              </div>
              {isYearLoading ? <span className="loading-pill">Nalagam leta ...</span> : null}
            </div>

            <div className="button-row button-row--compact control--wide">
              <button
                type="button"
                className="button button--ghost"
                onClick={() => clearSlot(activeSelectionSlot)}
                title="Počisti izbor in geometrijo trenutno aktivnega poligona."
              >
                Počisti aktivni
              </button>
              <button
                type="button"
                className="button button--ghost"
                onClick={clearAllSelections}
                title="Ponastavi oba poligona in odstrani vse izbore."
              >
                Ponastavi vse
              </button>
              <button
                type="button"
                className="button button--secondary"
                onClick={handleExportActivePolygon}
                disabled={!activeSlot.geoJson}
                title={!activeSlot.geoJson
                  ? 'Najprej nariši ali naloži geometrijo aktivnega poligona.'
                  : 'Izvozi obogaten GeoJSON za trenutno aktivni poligon, kot je trenutno prikazan na karti.'}
              >
                Izvozi
              </button>
            </div>
          </div>

          <MapPanel
            gridIndex={gridIndex}
            yearData={yearDataMap[activeYear]}
            quantileScale={quantileScale}
            selectionState={selectionState}
            activeSelectionSlot={activeSelectionSlot}
            onSetActiveSelectionSlot={setActiveSelectionSlot}
            onToggleCell={handleToggleCell}
            onDrawPolygon={handleDrawPolygon}
            primaryBounds={geoJsonToLatLngBounds(selectionState.primary.geoJson)}
            secondaryBounds={geoJsonToLatLngBounds(selectionState.secondary.geoJson)}
          />
        </aside>

        <section className="charts-wrap">
          <ChartsPanel
            selectedYears={selectedYears}
            aggregatedByYear={aggregatedByYear}
            comparisonAggregatedByYear={comparisonAggregatedByYear}
            latestAggregate={activeAggregate}
            comparisonLatestAggregate={comparisonAggregate}
            combinedLatestAggregate={combinedAggregate}
            selectedCount={selectionState.primary.ids.size}
            comparisonCount={selectionState.secondary.ids.size}
            usesNationalFallback={selectionState.primary.ids.size === 0}
            selectedTrendMetric={selectedTrendMetric}
            onSelectedTrendMetricChange={setSelectedTrendMetric}
            isYearLoading={isYearLoading}
          />
        </section>
      </section>
    </main>
  );
}
