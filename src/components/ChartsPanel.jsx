import ReactECharts from 'echarts-for-react';
import { BIG_GROUP_FIELDS, EDUCATION_FIELDS, FIVE_YEAR_FIELDS, METRIC_LABELS } from '../config';
import { formatMetric } from '../utils';

const COLORS = {
  navy: '#1f4e79',
  blue: '#4f81bd',
  red: '#c0504d',
  green: '#76923c',
  gold: '#c9a227',
  slate: '#6d7c86',
};

function shareText(value, base) {
  if (!Number.isFinite(value) || !Number.isFinite(base) || base <= 0) {
    return 'Ni podatka';
  }
  return `${((value / base) * 100).toFixed(1)} %`;
}

function emptyOption(title) {
  return {
    title: { text: title, textStyle: { fontSize: 15, fontWeight: 700, color: '#163d57' } },
    graphic: {
      type: 'text',
      left: 'center',
      top: 'middle',
      style: {
        text: 'Ni izbranih celic',
        fill: '#7a8b96',
        fontSize: 16,
      },
    },
  };
}

function buildBarOption({ title, labels, values, color, shareBase, xAxisRotate = 0 }) {
  return {
    animationDuration: 300,
    grid: { left: 48, right: 18, top: 52, bottom: 42, containLabel: true },
    title: { text: title, textStyle: { fontSize: 15, fontWeight: 700, color: '#163d57' } },
    tooltip: {
      trigger: 'axis',
      formatter: (params) => {
        const item = params[0];
        const value = Number(item.value) || 0;
        return `${item.axisValue}<br/>Vrednost: ${formatMetric(value, 0)}<br/>Delež: ${shareText(value, shareBase)}`;
      },
    },
    xAxis: {
      type: 'category',
      data: labels,
      axisLabel: { color: '#425a68', rotate: xAxisRotate },
      axisLine: { lineStyle: { color: '#b8c5cd' } },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#425a68' },
      splitLine: { lineStyle: { color: '#e3eaee' } },
    },
    series: [
      {
        type: 'bar',
        data: values,
        itemStyle: {
          color,
          borderRadius: [4, 4, 0, 0],
        },
      },
    ],
  };
}

function buildLineOption(seriesByMetric, years) {
  return {
    animationDuration: 300,
    grid: { left: 48, right: 18, top: 52, bottom: 42, containLabel: true },
    title: { text: 'Časovna vrsta', textStyle: { fontSize: 15, fontWeight: 700, color: '#163d57' } },
    tooltip: { trigger: 'axis' },
    legend: { top: 18, textStyle: { color: '#425a68' } },
    xAxis: {
      type: 'category',
      data: years,
      axisLabel: { color: '#425a68' },
      axisLine: { lineStyle: { color: '#b8c5cd' } },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#425a68' },
      splitLine: { lineStyle: { color: '#e3eaee' } },
    },
    series: [
      { name: 'Skupaj', type: 'line', smooth: true, symbolSize: 8, data: seriesByMetric.tot_p, lineStyle: { color: COLORS.navy, width: 3 }, itemStyle: { color: COLORS.navy } },
      { name: 'Moški', type: 'line', smooth: true, symbolSize: 6, data: seriesByMetric.tot_m, lineStyle: { color: COLORS.blue, width: 2 }, itemStyle: { color: COLORS.blue } },
      { name: 'Ženske', type: 'line', smooth: true, symbolSize: 6, data: seriesByMetric.tot_f, lineStyle: { color: COLORS.red, width: 2 }, itemStyle: { color: COLORS.red } },
    ],
  };
}

function buildPyramidOption(latest) {
  return {
    animationDuration: 300,
    title: { text: 'Starostna piramida', textStyle: { fontSize: 15, fontWeight: 700, color: '#163d57' } },
    grid: { left: 48, right: 48, top: 52, bottom: 36, containLabel: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params) => {
        const men = Math.abs(params.find((item) => item.seriesName === 'Moški')?.value || 0);
        const women = Math.abs(params.find((item) => item.seriesName === 'Ženske')?.value || 0);
        return `${params[0].axisValue}<br/>Moški: ${men.toFixed(1)} %<br/>Ženske: ${women.toFixed(1)} %`;
      },
    },
    legend: { top: 18, textStyle: { color: '#425a68' } },
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
      { name: 'Moški', type: 'bar', stack: 'total', itemStyle: { color: COLORS.blue }, data: [-(latest?.pct_m00_14 ?? 0), -(latest?.pct_m15_64 ?? 0), -(latest?.pct_m65_ ?? 0)] },
      { name: 'Ženske', type: 'bar', stack: 'total', itemStyle: { color: COLORS.red }, data: [latest?.pct_f00_14 ?? 0, latest?.pct_f15_64 ?? 0, latest?.pct_f65_ ?? 0] },
    ],
  };
}

function buildShareTrendOption(years, aggregatedByYear) {
  return {
    animationDuration: 300,
    grid: { left: 48, right: 18, top: 52, bottom: 42, containLabel: true },
    title: { text: 'Starostni deleži skozi čas', textStyle: { fontSize: 15, fontWeight: 700, color: '#163d57' } },
    tooltip: { trigger: 'axis' },
    legend: { top: 18, textStyle: { color: '#425a68' } },
    xAxis: { type: 'category', data: years, axisLabel: { color: '#425a68' }, axisLine: { lineStyle: { color: '#b8c5cd' } } },
    yAxis: { type: 'value', axisLabel: { color: '#425a68', formatter: '{value} %' }, splitLine: { lineStyle: { color: '#e3eaee' } } },
    series: [
      { name: '0-14', type: 'line', smooth: true, data: years.map((year) => aggregatedByYear[year]?.pct_p00_14 ?? null), lineStyle: { color: COLORS.blue, width: 2.5 }, itemStyle: { color: COLORS.blue } },
      { name: '15-64', type: 'line', smooth: true, data: years.map((year) => aggregatedByYear[year]?.pct_p15_64 ?? null), lineStyle: { color: COLORS.green, width: 2.5 }, itemStyle: { color: COLORS.green } },
      { name: '65+', type: 'line', smooth: true, data: years.map((year) => aggregatedByYear[year]?.pct_p65_ ?? null), lineStyle: { color: COLORS.red, width: 2.5 }, itemStyle: { color: COLORS.red } },
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

export default function ChartsPanel({ selectedYears, aggregatedByYear, latestAggregate, selectedCount }) {
  const latest = latestAggregate;
  const years = selectedYears;
  const hasSelection = selectedCount > 0;
  const seriesByMetric = {
    tot_p: years.map((year) => aggregatedByYear[year]?.tot_p ?? null),
    tot_m: years.map((year) => aggregatedByYear[year]?.tot_m ?? null),
    tot_f: years.map((year) => aggregatedByYear[year]?.tot_f ?? null),
  };

  const totalAgeBands = FIVE_YEAR_FIELDS.reduce((sum, field) => sum + (latest?.[field] ?? 0), 0);
  const totalEducation = EDUCATION_FIELDS.reduce((sum, field) => sum + (latest?.[field] ?? 0), 0);

  const statCards = [
    { key: 'tot_p', label: 'Skupaj prebivalcev', value: formatMetric(latest?.tot_p ?? null, 0) },
    { key: 'age_p', label: 'Povprečna starost', value: formatMetric(latest?.age_p ?? null, 1) },
    { key: 'ind_age_p', label: 'Indeks staranja', value: formatMetric(latest?.ind_age_p ?? null, 1), info: 'Število oseb 65+ na 100 oseb starih 0-14 let. Izračun: p_65_ / p_00_14 * 100.' },
    { key: 'ind_fem', label: 'Indeks feminitete', value: formatMetric(latest?.ind_fem ?? null, 1), info: 'Število žensk na 100 moških. Izračun: tot_f / tot_m * 100.' },
  ];

  return (
    <section className="charts-panel">
      <div className="stats-header">
        <div>
          <strong>Analiza izbora</strong>
          <p>{hasSelection ? `Izbranih celic: ${selectedCount}` : 'Trenutno ni izbranih celic. Grafi ostanejo prazni, dokler ne izbereš območja.'}</p>
        </div>
      </div>

      <div className="stats-grid">
        {statCards.map((card) => (
          <article key={card.key} className="stat-card">
            <span className="stat-card__label">
              {card.label}
              {card.info ? <InfoBadge text={card.info} /> : null}
            </span>
            <strong>{card.value}</strong>
          </article>
        ))}
      </div>

      <div className="chart-grid">
        <div className="chart-card">
          <ReactECharts option={hasSelection ? buildLineOption(seriesByMetric, years) : emptyOption('Časovna vrsta')} style={{ height: 320 }} />
        </div>

        <div className="chart-card">
          <ReactECharts
            option={
              hasSelection
                ? buildBarOption({
                    title: 'Starostna struktura',
                    labels: FIVE_YEAR_FIELDS.map((field) => METRIC_LABELS[field]),
                    values: FIVE_YEAR_FIELDS.map((field) => latest?.[field] ?? 0),
                    color: COLORS.navy,
                    shareBase: totalAgeBands,
                    xAxisRotate: 28,
                  })
                : emptyOption('Starostna struktura')
            }
            style={{ height: 320 }}
          />
        </div>

        <div className="chart-card">
          <ReactECharts
            option={
              hasSelection
                ? buildBarOption({
                    title: 'Velike starostne skupine',
                    labels: BIG_GROUP_FIELDS.map((field) => METRIC_LABELS[field]),
                    values: BIG_GROUP_FIELDS.map((field) => latest?.[field] ?? 0),
                    color: COLORS.green,
                    shareBase: latest?.tot_p ?? 0,
                  })
                : emptyOption('Velike starostne skupine')
            }
            style={{ height: 300 }}
          />
        </div>

        <div className="chart-card">
          <ReactECharts option={hasSelection ? buildPyramidOption(latest) : emptyOption('Starostna piramida')} style={{ height: 300 }} />
        </div>

        <div className="chart-card">
          <ReactECharts
            option={
              hasSelection
                ? buildBarOption({
                    title: 'Izobrazbena struktura',
                    labels: EDUCATION_FIELDS.map((field) => METRIC_LABELS[field]),
                    values: EDUCATION_FIELDS.map((field) => latest?.[field] ?? 0),
                    color: COLORS.gold,
                    shareBase: totalEducation,
                  })
                : emptyOption('Izobrazbena struktura')
            }
            style={{ height: 300 }}
          />
        </div>

        <div className="chart-card">
          <ReactECharts option={hasSelection ? buildShareTrendOption(years, aggregatedByYear) : emptyOption('Starostni deleži skozi čas')} style={{ height: 300 }} />
        </div>
      </div>
    </section>
  );
}
