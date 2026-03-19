import ReactECharts from 'echarts-for-react';
import {
  BIG_GROUP_FIELDS,
  EDUCATION_FIELDS,
  FIVE_YEAR_FIELDS,
  METRIC_DESCRIPTIONS,
  METRIC_LABELS,
  SELECTABLE_TREND_FIELDS,
} from '../config';
import { formatMetric } from '../utils';

const COLORS = {
  primary: '#1f4e79',
  primarySoft: '#5f89b0',
  secondary: '#c0504d',
  secondarySoft: '#d88a87',
};

const WOMEN_DECAL = {
  symbol: 'circle',
  dashArrayX: [1, 0],
  dashArrayY: [2, 3],
  rotation: 0,
  color: 'rgba(255,255,255,0.82)',
  symbolSize: 1.6,
};

function metricDigits(metric) {
  if (
    metric?.startsWith('pct_') ||
    metric?.startsWith('share_') ||
    metric?.includes('ratio') ||
    metric?.includes('index') ||
    metric === 'age_p' ||
    metric === 'education_index'
  ) {
    return 1;
  }
  return 0;
}

function emptyOption(title, text = 'Ni izbranih celic') {
  return {
    title: { text: title, textStyle: { fontSize: 15, fontWeight: 700, color: '#163d57' } },
    graphic: {
      type: 'text',
      left: 'center',
      top: 'middle',
      style: {
        text,
        fill: '#7a8b96',
        fontSize: 16,
      },
    },
  };
}

function normalizePercent(value, base) {
  if (!Number.isFinite(value) || !Number.isFinite(base) || base <= 0) {
    return null;
  }
  return (value / base) * 100;
}

function isAbsoluteMetric(metric) {
  return ['tot_p', 'tot_m', 'tot_f', 'p_15_24', 'p_75_plus', 'p_80_plus', 'edct_total'].includes(metric);
}

function trendDisplayValue(metric, aggregate, hasComparison) {
  if (!aggregate) {
    return null;
  }
  const raw = aggregate[metric];
  if (!hasComparison || !isAbsoluteMetric(metric)) {
    return raw ?? null;
  }
  return normalizePercent(raw, aggregate.tot_p);
}

function buildLegend() {
  return {
    bottom: 0,
    textStyle: { color: '#425a68', fontSize: 11 },
    itemWidth: 14,
    itemHeight: 8,
  };
}

function buildBarOption({
  title,
  labels,
  primaryRawValues,
  comparisonRawValues,
  primaryBase,
  comparisonBase,
  showComparison,
}) {
  const primaryValues = showComparison
    ? primaryRawValues.map((value) => normalizePercent(value, primaryBase))
    : primaryRawValues;
  const secondaryValues = showComparison
    ? comparisonRawValues.map((value) => normalizePercent(value, comparisonBase))
    : comparisonRawValues;

  return {
    animationDuration: 300,
    grid: { left: 40, right: 10, top: 40, bottom: 46, containLabel: true },
    title: { text: title, textStyle: { fontSize: 15, fontWeight: 700, color: '#163d57' } },
    tooltip: {
      trigger: 'axis',
      formatter: (params) =>
        params
          .map((item) => {
            const source = item.seriesName === 'P1' ? primaryRawValues[item.dataIndex] : comparisonRawValues[item.dataIndex];
            if (showComparison) {
              return `${item.marker}${item.seriesName}: ${formatMetric(Number(item.value), 1)} %<br/>Absolutno: ${formatMetric(source, 0)}`;
            }
            return `${item.marker}${item.seriesName}: ${formatMetric(Number(item.value), 0)}`;
          })
          .join('<br/>'),
    },
    legend: buildLegend(),
    xAxis: {
      type: 'category',
      data: labels,
      axisLabel: { color: '#425a68', rotate: labels.length > 10 ? 26 : 0 },
      axisLine: { lineStyle: { color: '#b8c5cd' } },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#425a68', formatter: showComparison ? '{value} %' : '{value}' },
      splitLine: { lineStyle: { color: '#e3eaee' } },
    },
    series: [
      {
        name: 'P1',
        type: 'bar',
        data: primaryValues,
        itemStyle: { color: COLORS.primary, borderRadius: [4, 4, 0, 0] },
      },
      ...(showComparison
        ? [
            {
              name: 'P2',
              type: 'bar',
              data: secondaryValues,
              itemStyle: { color: COLORS.secondary, borderRadius: [4, 4, 0, 0] },
            },
          ]
        : []),
    ],
  };
}

function buildLineOption(years, aggregatedByYear, comparisonAggregatedByYear, hasComparison) {
  const primaryTotal = years.map((year) => aggregatedByYear[year]?.tot_p ?? null);
  const primaryMen = years.map((year) => aggregatedByYear[year]?.tot_m ?? null);
  const primaryWomen = years.map((year) => aggregatedByYear[year]?.tot_f ?? null);
  const comparisonMen = years.map((year) => comparisonAggregatedByYear[year]?.tot_m ?? null);
  const comparisonWomen = years.map((year) => comparisonAggregatedByYear[year]?.tot_f ?? null);

  const primaryDisplay = hasComparison
    ? {
        men: years.map((year) => normalizePercent(aggregatedByYear[year]?.tot_m, aggregatedByYear[year]?.tot_p)),
        women: years.map((year) => normalizePercent(aggregatedByYear[year]?.tot_f, aggregatedByYear[year]?.tot_p)),
      }
    : {
        total: primaryTotal,
        men: primaryMen,
        women: primaryWomen,
      };

  const comparisonDisplay = {
    men: years.map((year) => normalizePercent(comparisonAggregatedByYear[year]?.tot_m, comparisonAggregatedByYear[year]?.tot_p)),
    women: years.map((year) => normalizePercent(comparisonAggregatedByYear[year]?.tot_f, comparisonAggregatedByYear[year]?.tot_p)),
  };

  return {
    animationDuration: 300,
    grid: { left: 40, right: 10, top: 40, bottom: 46, containLabel: true },
    title: { text: hasComparison ? 'Spolna sestava skozi čas' : 'Časovna vrsta', textStyle: { fontSize: 15, fontWeight: 700, color: '#163d57' } },
    tooltip: {
      trigger: 'axis',
      formatter: (params) =>
        params
          .map((item) => {
            const yearIndex = item.dataIndex;
            if (hasComparison) {
              const rawSource =
                item.seriesName === 'P1 moski'
                  ? primaryMen[yearIndex]
                  : item.seriesName === 'P1 zenske'
                    ? primaryWomen[yearIndex]
                    : item.seriesName === 'P2 moski'
                      ? comparisonMen[yearIndex]
                      : comparisonWomen[yearIndex];
              return `${item.marker}${item.seriesName}: ${formatMetric(Number(item.value), 1)} %<br/>Absolutno: ${formatMetric(rawSource, 0)}`;
            }
            return `${item.marker}${item.seriesName}: ${formatMetric(Number(item.value), 0)}`;
          })
          .join('<br/>'),
    },
    legend: buildLegend(),
    xAxis: {
      type: 'category',
      data: years,
      axisLabel: { color: '#425a68' },
      axisLine: { lineStyle: { color: '#b8c5cd' } },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#425a68', formatter: hasComparison ? '{value} %' : '{value}' },
      splitLine: { lineStyle: { color: '#e3eaee' } },
    },
    series: hasComparison
      ? [
          { name: 'P1 moski', type: 'line', smooth: true, symbolSize: 6, data: primaryDisplay.men, lineStyle: { color: COLORS.primary, width: 3 }, itemStyle: { color: COLORS.primary } },
          { name: 'P1 zenske', type: 'line', smooth: true, symbolSize: 6, data: primaryDisplay.women, lineStyle: { color: COLORS.primarySoft, width: 3, type: 'dashed' }, itemStyle: { color: COLORS.primarySoft } },
          { name: 'P2 moski', type: 'line', smooth: true, symbolSize: 5, data: comparisonDisplay.men, lineStyle: { color: COLORS.secondary, width: 3 }, itemStyle: { color: COLORS.secondary } },
          { name: 'P2 zenske', type: 'line', smooth: true, symbolSize: 5, data: comparisonDisplay.women, lineStyle: { color: COLORS.secondarySoft, width: 3, type: 'dashed' }, itemStyle: { color: COLORS.secondarySoft } },
        ]
      : [
          { name: 'Skupaj', type: 'line', smooth: true, symbolSize: 7, data: primaryDisplay.total, lineStyle: { color: COLORS.primary, width: 3 }, itemStyle: { color: COLORS.primary } },
          { name: 'Moski', type: 'line', smooth: true, symbolSize: 6, data: primaryDisplay.men, lineStyle: { color: COLORS.primary, width: 2.5 }, itemStyle: { color: COLORS.primary } },
          { name: 'Zenske', type: 'line', smooth: true, symbolSize: 6, data: primaryDisplay.women, lineStyle: { color: COLORS.primarySoft, width: 2.5, type: 'dashed' }, itemStyle: { color: COLORS.primarySoft } },
        ],
  };
}

function buildPyramidOption(latest, comparisonLatest) {
  const comparisonVisible = Boolean(comparisonLatest?.tot_p);
  return {
    animationDuration: 300,
    title: { text: 'Starostna piramida', textStyle: { fontSize: 15, fontWeight: 700, color: '#163d57' } },
    grid: { left: 40, right: 34, top: 40, bottom: 46, containLabel: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params) =>
        params
          .map((item) => `${item.marker}${item.seriesName}: ${Math.abs(Number(item.value) || 0).toFixed(1)} %`)
          .join('<br/>'),
    },
    legend: buildLegend(),
    xAxis: {
      type: 'value',
      axisLabel: { color: '#425a68', formatter: (value) => `${Math.abs(value)} %` },
      splitLine: { lineStyle: { color: '#e3eaee' } },
    },
    yAxis: {
      type: 'category',
      data: ['0-14', '15-64', '65+'],
      axisLabel: { color: '#425a68' },
      axisLine: { lineStyle: { color: '#b8c5cd' } },
    },
    series: [
      {
        name: 'P1 moski',
        type: 'bar',
        stack: 'p1',
        itemStyle: { color: COLORS.primary },
        data: [-(latest?.pct_m00_14 ?? 0), -(latest?.pct_m15_64 ?? 0), -(latest?.pct_m65_ ?? 0)],
      },
      {
        name: 'P1 zenske',
        type: 'bar',
        stack: 'p1',
        itemStyle: { color: COLORS.primarySoft, decal: WOMEN_DECAL },
        data: [latest?.pct_f00_14 ?? 0, latest?.pct_f15_64 ?? 0, latest?.pct_f65_ ?? 0],
      },
      ...(comparisonVisible
        ? [
            {
              name: 'P2 moski',
              type: 'bar',
              stack: 'p2',
              barGap: '-65%',
              itemStyle: { color: COLORS.secondary, opacity: 0.65 },
              data: [-(comparisonLatest?.pct_m00_14 ?? 0), -(comparisonLatest?.pct_m15_64 ?? 0), -(comparisonLatest?.pct_m65_ ?? 0)],
            },
            {
              name: 'P2 zenske',
              type: 'bar',
              stack: 'p2',
              barGap: '-65%',
              itemStyle: { color: COLORS.secondarySoft, opacity: 0.7, decal: WOMEN_DECAL },
              data: [comparisonLatest?.pct_f00_14 ?? 0, comparisonLatest?.pct_f15_64 ?? 0, comparisonLatest?.pct_f65_ ?? 0],
            },
          ]
        : []),
    ],
  };
}

function buildMetricTrendOption(years, aggregatedByYear, comparisonAggregatedByYear, metric, hasComparison) {
  const digits = metricDigits(metric);
  return {
    animationDuration: 300,
    grid: { left: 40, right: 10, top: 40, bottom: 46, containLabel: true },
    title: { text: `Trend: ${METRIC_LABELS[metric] || metric}`, textStyle: { fontSize: 15, fontWeight: 700, color: '#163d57' } },
    tooltip: {
      trigger: 'axis',
      formatter: (params) =>
        params
          .map((item) => {
            const aggregate = item.seriesName === 'P1'
              ? aggregatedByYear[years[item.dataIndex]]
              : comparisonAggregatedByYear[years[item.dataIndex]];
            const raw = aggregate?.[metric];
            if (hasComparison && isAbsoluteMetric(metric)) {
              return `${item.marker}${item.seriesName}: ${formatMetric(Number(item.value), 1)} %<br/>Absolutno: ${formatMetric(raw, 0)}`;
            }
            return `${item.marker}${item.seriesName}: ${formatMetric(Number(item.value), digits)}`;
          })
          .join('<br/>'),
    },
    legend: buildLegend(),
    xAxis: {
      type: 'category',
      data: years,
      axisLabel: { color: '#425a68' },
      axisLine: { lineStyle: { color: '#b8c5cd' } },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#425a68', formatter: hasComparison && isAbsoluteMetric(metric) ? '{value} %' : '{value}' },
      splitLine: { lineStyle: { color: '#e3eaee' } },
    },
    series: [
      {
        name: 'P1',
        type: 'line',
        smooth: true,
        data: years.map((year) => trendDisplayValue(metric, aggregatedByYear[year], hasComparison)),
        lineStyle: { color: COLORS.primary, width: 3 },
        itemStyle: { color: COLORS.primary },
      },
      ...(hasComparison
        ? [
            {
              name: 'P2',
              type: 'line',
              smooth: true,
              data: years.map((year) => trendDisplayValue(metric, comparisonAggregatedByYear[year], true)),
              lineStyle: { color: COLORS.secondary, width: 3 },
              itemStyle: { color: COLORS.secondary },
            },
          ]
        : []),
    ],
  };
}

function InfoBadge({ text }) {
  return (
    <span className="info-badge" tabIndex={0}>
      (i)
      <span className="info-badge__tooltip">{text}</span>
    </span>
  );
}

export default function ChartsPanel({
  selectedYears,
  aggregatedByYear,
  comparisonAggregatedByYear,
  latestAggregate,
  comparisonLatestAggregate,
  combinedLatestAggregate,
  selectedCount,
  comparisonCount,
  usesNationalFallback,
  selectedTrendMetric,
  onSelectedTrendMetricChange,
  isYearLoading,
}) {
  const latest = latestAggregate;
  const comparisonLatest = comparisonLatestAggregate;
  const combinedLatest = combinedLatestAggregate;
  const years = selectedYears;
  const hasSelection = selectedCount > 0 || usesNationalFallback;
  const hasComparison = comparisonCount > 0;

  const statCards = [
    { key: 'tot_p', label: 'Skupaj preb.', totalValue: formatMetric(combinedLatest?.tot_p ?? null, 0), value: formatMetric(latest?.tot_p ?? null, 0), compareValue: formatMetric(comparisonLatest?.tot_p ?? null, 0) },
    { key: 'age_p', label: 'Povprečna starost', totalValue: formatMetric(combinedLatest?.age_p ?? null, 1), value: formatMetric(latest?.age_p ?? null, 1), compareValue: formatMetric(comparisonLatest?.age_p ?? null, 1) },
    { key: 'ind_age_p', label: 'Indeks staranja', totalValue: formatMetric(combinedLatest?.ind_age_p ?? null, 1), value: formatMetric(latest?.ind_age_p ?? null, 1), compareValue: formatMetric(comparisonLatest?.ind_age_p ?? null, 1), info: METRIC_DESCRIPTIONS.ind_age_p },
    { key: 'ind_fem', label: 'Indeks feminitete', totalValue: formatMetric(combinedLatest?.ind_fem ?? null, 1), value: formatMetric(latest?.ind_fem ?? null, 1), compareValue: formatMetric(comparisonLatest?.ind_fem ?? null, 1), info: METRIC_DESCRIPTIONS.ind_fem },
  ];

  return (
    <section className="charts-panel">
      <div className="stats-header">
        <div>
          <strong>Analiza izbora</strong>
        </div>
        {isYearLoading ? <span className="loading-pill">Nalagam atribute let ...</span> : null}
      </div>

      <div className="stats-grid">
        {statCards.map((card) => (
          <article key={card.key} className="stat-card stat-card--plain">
            <span className="stat-card__label stat-card__label--heading">
              {card.label}
              {card.info ? <InfoBadge text={card.info} /> : null}
            </span>
            <strong className="stat-card__total">{card.totalValue}</strong>
            <small>P1: {card.value}</small>
            <small>P2: {hasComparison ? card.compareValue : 'Ni podatka'}</small>
          </article>
        ))}
      </div>

      <div className="chart-grid">
        <div className="chart-card">
          <ReactECharts option={hasSelection ? buildLineOption(years, aggregatedByYear, comparisonAggregatedByYear, hasComparison) : emptyOption('Časovna vrsta')} style={{ height: 286 }} />
        </div>

        <div className="chart-card">
          <ReactECharts
            option={
              hasSelection
                ? buildBarOption({
                    title: hasComparison ? 'Starostna struktura v deležih' : 'Starostna struktura',
                    labels: FIVE_YEAR_FIELDS.map((field) => METRIC_LABELS[field]),
                    primaryRawValues: FIVE_YEAR_FIELDS.map((field) => latest?.[field] ?? 0),
                    comparisonRawValues: FIVE_YEAR_FIELDS.map((field) => comparisonLatest?.[field] ?? 0),
                    primaryBase: FIVE_YEAR_FIELDS.reduce((sum, field) => sum + (latest?.[field] ?? 0), 0),
                    comparisonBase: FIVE_YEAR_FIELDS.reduce((sum, field) => sum + (comparisonLatest?.[field] ?? 0), 0),
                    showComparison: hasComparison,
                  })
                : emptyOption('Starostna struktura')
            }
            style={{ height: 286 }}
          />
        </div>

        <div className="chart-card">
          <ReactECharts
            option={
              hasSelection
                ? buildBarOption({
                    title: hasComparison ? 'Velike starostne skupine v deležih' : 'Velike starostne skupine',
                    labels: BIG_GROUP_FIELDS.map((field) => METRIC_LABELS[field]),
                    primaryRawValues: BIG_GROUP_FIELDS.map((field) => latest?.[field] ?? 0),
                    comparisonRawValues: BIG_GROUP_FIELDS.map((field) => comparisonLatest?.[field] ?? 0),
                    primaryBase: latest?.tot_p ?? 0,
                    comparisonBase: comparisonLatest?.tot_p ?? 0,
                    showComparison: hasComparison,
                  })
                : emptyOption('Velike starostne skupine')
            }
            style={{ height: 270 }}
          />
        </div>

        <div className="chart-card">
          <ReactECharts option={hasSelection ? buildPyramidOption(latest, comparisonLatest) : emptyOption('Starostna piramida')} style={{ height: 270 }} />
        </div>

        <div className="chart-card">
          <ReactECharts
            option={
              hasSelection
                ? buildBarOption({
                    title: hasComparison ? 'Izobrazbena struktura v deležih' : 'Izobrazbena struktura',
                    labels: EDUCATION_FIELDS.map((field) => METRIC_LABELS[field]),
                    primaryRawValues: EDUCATION_FIELDS.map((field) => latest?.[field] ?? 0),
                    comparisonRawValues: EDUCATION_FIELDS.map((field) => comparisonLatest?.[field] ?? 0),
                    primaryBase: (latest?.edct_1 ?? 0) + (latest?.edct_2 ?? 0) + (latest?.edct_3 ?? 0),
                    comparisonBase: (comparisonLatest?.edct_1 ?? 0) + (comparisonLatest?.edct_2 ?? 0) + (comparisonLatest?.edct_3 ?? 0),
                    showComparison: hasComparison,
                  })
                : emptyOption('Izobrazbena struktura')
            }
            style={{ height: 270 }}
          />
        </div>

        <div className="chart-card">
          <label className="control chart-card__control">
            <span>Trendni kazalnik</span>
            <select
              value={selectedTrendMetric}
              onChange={(event) => onSelectedTrendMetricChange(event.target.value)}
              title="Izberi kazalnik za spodnji trendni graf in pojasnilo."
            >
              {SELECTABLE_TREND_FIELDS.map((field) => (
                <option key={field} value={field}>
                  {METRIC_LABELS[field] || field}
                </option>
              ))}
            </select>
          </label>
          <ReactECharts
            option={
              hasSelection
                ? buildMetricTrendOption(years, aggregatedByYear, comparisonAggregatedByYear, selectedTrendMetric, hasComparison)
                : emptyOption('Trend kazalnika')
            }
            style={{ height: 228 }}
          />
          <div className="metric-explainer">
            <strong>{METRIC_LABELS[selectedTrendMetric] || selectedTrendMetric}</strong>
            <p>{METRIC_DESCRIPTIONS[selectedTrendMetric] || 'Za ta kazalnik še ni pripravljenega dodatnega pojasnila.'}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
