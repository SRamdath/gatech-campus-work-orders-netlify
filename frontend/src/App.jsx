import { useEffect, useMemo, useState } from "react";
import L from "leaflet";
import { GeoJSON, MapContainer, TileLayer, useMap } from "react-leaflet";
import {
  Line,
  LineChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  PieChart,
  Pie,
  Cell,
} from "recharts";

const GT_CENTER = [33.7756, -84.3963];

const CRAFT_COLORS = {
  CARPENTRY: "#22c55e",
  ELECTRIC: "#f59e0b",
  HVAC: "#3b82f6",
  "MULTI-CRAFT": "#a855f7",
  PAINT: "#92400e",
  PLUMBING: "#ef4444",
  "WORK CONTROL": "#64748b",
  ADMINISTRATIVE: "#0ea5e9",
  LOCKSHOP: "#111827",
  "PROJECT MANAGEMENT": "#14b8a6",
  UNKNOWN: "#94a3b8",
};

const FALLBACK_COLORS = [
  "#06b6d4",
  "#84cc16",
  "#f97316",
  "#e11d48",
  "#8b5cf6",
  "#14b8a6",
  "#a16207",
  "#475569",
];

function getCraftColor(craft, index = 0) {
  if (CRAFT_COLORS[craft]) return CRAFT_COLORS[craft];
  return FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

function fitFeatureBounds(map, featureLayer) {
  const bounds = featureLayer.getBounds?.();
  if (bounds && bounds.isValid()) {
    map.fitBounds(bounds, { padding: [30, 30] });
  }
}

function getPercentile(sortedValues, percentile) {
  if (!sortedValues.length) return 0;
  if (sortedValues.length === 1) return sortedValues[0];

  const index = (sortedValues.length - 1) * percentile;
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);

  if (lowerIndex === upperIndex) {
    return sortedValues[lowerIndex];
  }

  const weight = index - lowerIndex;
  return (
    sortedValues[lowerIndex] * (1 - weight) +
    sortedValues[upperIndex] * weight
  );
}

function getClippedScaleStats(values, lowerPct = 0.01, upperPct = 0.99) {
  const clean = values
    .map((v) => Number(v || 0))
    .filter((v) => v > 0)
    .sort((a, b) => a - b);

  if (!clean.length) {
    return {
      lowerBound: 0,
      upperBound: 0,
      ticks: [],
    };
  }

  const lowerBound = getPercentile(clean, lowerPct);
  const upperBound = getPercentile(clean, upperPct);

  const ticks = [
    lowerBound,
    getPercentile(clean, 0.25),
    getPercentile(clean, 0.5),
    getPercentile(clean, 0.75),
    upperBound,
  ];

  return {
    lowerBound,
    upperBound,
    ticks,
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function interpolateChannel(start, end, t) {
  return Math.round(start + (end - start) * t);
}

function interpolateColor(startRgb, endRgb, t) {
  const r = interpolateChannel(startRgb[0], endRgb[0], t);
  const g = interpolateChannel(startRgb[1], endRgb[1], t);
  const b = interpolateChannel(startRgb[2], endRgb[2], t);
  return `rgb(${r}, ${g}, ${b})`;
}

function getContinuousMapColor(value, scaleStats) {
  if (!value || value <= 0) return "#f3f4f6";

  const { lowerBound, upperBound } = scaleStats || {};

  if (!upperBound || upperBound <= 0 || upperBound <= lowerBound) {
    return "rgb(37, 99, 235)";
  }

  const clipped = clamp(Number(value || 0), lowerBound, upperBound);
  const normalized = (clipped - lowerBound) / (upperBound - lowerBound);

  const stretched = Math.pow(normalized, 0.65);

  return interpolateColor([219, 234, 254], [29, 78, 216], stretched);
}

function formatLegendValue(value, displayMode) {
  return displayMode === "density"
    ? Number(value || 0).toFixed(1)
    : Math.round(Number(value || 0)).toLocaleString();
}

function MapLegend({ scaleStats, displayMode }) {
  const ticks = scaleStats?.ticks || [];
  const gradientStyle = {
    background:
      "linear-gradient(to right, rgb(219, 234, 254), rgb(29, 78, 216))",
  };

  return (
    <div className="legend">
      <div className="legend-title">
        {displayMode === "density" ? "WO / 1000 sqft" : "Work Orders"}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          flexWrap: "wrap",
        }}
      >
        <span className="legend-row" style={{ margin: 0 }}>
          <span className="legend-swatch" style={{ background: "#f3f4f6" }} />
          <span>0</span>
        </span>

        <div
          style={{
            width: "260px",
            maxWidth: "100%",
            display: "flex",
            flexDirection: "column",
            gap: "4px",
          }}
        >
          <div
            style={{
              ...gradientStyle,
              height: "12px",
              borderRadius: "999px",
              border: "1px solid #cbd5e1",
            }}
          />
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "8px",
              fontSize: "12px",
              color: "#334155",
            }}
          >
            {ticks.length > 0 ? (
              ticks.map((tick, index) => (
                <span key={`${tick}-${index}`}>
                  {formatLegendValue(tick, displayMode)}
                </span>
              ))
            ) : (
              <span>0</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ZoomToSelected({ selectedFeature }) {
  const map = useMap();

  useEffect(() => {
    if (!selectedFeature) return;
    const layer = L.geoJSON(selectedFeature);
    fitFeatureBounds(map, layer);
  }, [map, selectedFeature]);

  return null;
}

function totalForRange(timeseries, startYear, endYear) {
  if (!Array.isArray(timeseries)) return 0;

  return timeseries.reduce((sum, row) => {
    const year = Number(String(row.year_month).slice(0, 4));
    if (year >= startYear && year <= endYear) {
      return sum + Number(row.total || 0);
    }
    return sum;
  }, 0);
}

function craftCountsForRange(timeseries, startYear, endYear) {
  const counts = {};

  if (!Array.isArray(timeseries)) return counts;

  for (const row of timeseries) {
    const year = Number(String(row.year_month).slice(0, 4));
    if (year < startYear || year > endYear) continue;

    for (const [key, value] of Object.entries(row)) {
      if (key === "year_month" || key === "total") continue;
      counts[key] = (counts[key] || 0) + Number(value || 0);
    }
  }

  return counts;
}

function filterTimeseriesRange(timeseries, startYear, endYear) {
  if (!Array.isArray(timeseries)) return [];
  return timeseries.filter((row) => {
    const year = Number(String(row.year_month).slice(0, 4));
    return year >= startYear && year <= endYear;
  });
}

function buildCraftKeys(timeseries) {
  const keys = new Set();
  for (const row of timeseries || []) {
    for (const key of Object.keys(row)) {
      if (key !== "year_month" && key !== "total") {
        keys.add(key);
      }
    }
  }
  return Array.from(keys).sort();
}

function aggregateTimeseriesAcrossBuildings(buildingsLookup) {
  const monthMap = {};

  for (const building of Object.values(buildingsLookup || {})) {
    for (const row of building.timeseries || []) {
      const monthKey = row.year_month;
      if (!monthMap[monthKey]) {
        monthMap[monthKey] = { year_month: monthKey, total: 0 };
      }

      monthMap[monthKey].total += Number(row.total || 0);

      for (const [key, value] of Object.entries(row)) {
        if (key === "year_month" || key === "total") continue;
        monthMap[monthKey][key] = (monthMap[monthKey][key] || 0) + Number(value || 0);
      }
    }
  }

  return Object.values(monthMap).sort((a, b) =>
    String(a.year_month).localeCompare(String(b.year_month))
  );
}

function normalizeCount(rawValue, gsf) {
  if (!gsf || Number(gsf) <= 0) return 0;
  return Number(rawValue || 0) / (Number(gsf) / 1000);
}

function normalizeTimeseries(timeseries, gsf) {
  if (!Array.isArray(timeseries)) return [];
  if (!gsf || Number(gsf) <= 0) return timeseries.map((row) => ({ ...row }));

  const divisor = Number(gsf) / 1000;

  return timeseries.map((row) => {
    const next = {
      year_month: row.year_month,
      total: Number(row.total || 0) / divisor,
    };

    for (const [key, value] of Object.entries(row)) {
      if (key === "year_month" || key === "total") continue;
      next[key] = Number(value || 0) / divisor;
    }

    return next;
  });
}

function CustomPieTooltip({ active, payload, displayMode }) {
  if (!active || !payload || !payload.length) return null;

  const item = payload[0];
  const value =
    displayMode === "density"
      ? Number(item.value || 0).toFixed(2)
      : Number(item.value || 0).toLocaleString();

  return (
    <div
      style={{
        background: "white",
        border: "1px solid #e2e8f0",
        borderRadius: "8px",
        padding: "8px 10px",
        fontSize: "12px",
      }}
    >
      <div style={{ fontWeight: 700 }}>{item.name}</div>
      <div>{displayMode === "density" ? "WO / 1000 sqft" : "Count"}: {value}</div>
    </div>
  );
}

function formatDisplayValue(value, displayMode) {
  return displayMode === "density"
    ? Number(value || 0).toFixed(2)
    : Number(value || 0).toLocaleString();
}

function Sidebar({
  meta,
  yearStart,
  yearEnd,
  setYearStart,
  setYearEnd,
  totalVisible,
  mappedCount,
  selectedBuilding,
  clearSelection,
  displayMode,
  setDisplayMode,
}) {
  const minYear = meta?.year_bounds?.min ?? 2018;
  const maxYear = meta?.year_bounds?.max ?? 2022;

  return (
    <aside className="sidebar">
      <h1>Campus Work Orders</h1>

      <div className="panel">
        <h2>Filters</h2>

        <label>Start Year</label>
        <input
          type="number"
          min={minYear}
          max={maxYear}
          value={yearStart}
          onChange={(e) => setYearStart(Number(e.target.value))}
        />

        <label>End Year</label>
        <input
          type="number"
          min={minYear}
          max={maxYear}
          value={yearEnd}
          onChange={(e) => setYearEnd(Number(e.target.value))}
        />

        <div className="mode-toggle">
          <label>Display Mode</label>
          <div className="mode-toggle-row">
            <button
              type="button"
              className={`mode-button${displayMode === "count" ? " active" : ""}`}
              onClick={() => setDisplayMode("count")}
            >
              Count
            </button>
            <button
              type="button"
              className={`mode-button${displayMode === "density" ? " active" : ""}`}
              onClick={() => setDisplayMode("density")}
            >
              Count / 1000 sqft
            </button>
          </div>
        </div>

        <p className="small-note">
          Current range: {yearStart} to {yearEnd}
        </p>
      </div>

      <div className="panel">
        <h2>Summary</h2>
        <div className="stat">
          <span>
            {displayMode === "density"
              ? "Total visible WO / 1000 sqft"
              : "Total visible work orders"}
          </span>
          <strong>{formatDisplayValue(totalVisible, displayMode)}</strong>
        </div>
        <div className="stat">
          <span>Mapped buildings with data</span>
          <strong>{mappedCount}</strong>
        </div>
      </div>

      <div className="panel">
        <h2>{selectedBuilding ? "Selected Building" : "Current View"}</h2>
        {selectedBuilding ? (
          <>
            <div className="stat">
              <span>Name</span>
              <strong>{selectedBuilding.building_name || selectedBuilding.fac_id}</strong>
            </div>
            <div className="stat">
              <span>FAC_ID</span>
              <strong>{selectedBuilding.fac_id || "N/A"}</strong>
            </div>
            <div className="stat">
              <span>Facility Number</span>
              <strong>{selectedBuilding.facility_number || "N/A"}</strong>
            </div>
            <div className="stat">
              <span>GSF</span>
              <strong>
                {selectedBuilding.gsf
                  ? Number(selectedBuilding.gsf).toLocaleString()
                  : "N/A"}
              </strong>
            </div>
            <div className="stat">
              <span>{displayMode === "density" ? "WO / 1000 sqft" : "Total"}</span>
              <strong>{formatDisplayValue(selectedBuilding.filteredTotal, displayMode)}</strong>
            </div>
            <button className="reset-button" onClick={clearSelection}>
              Show All Buildings
            </button>
          </>
        ) : (
          <>
            <p className="muted overall-note">
              Showing aggregated charts across all buildings.
            </p>
            <button className="reset-button disabled" disabled>
              All Buildings Active
            </button>
          </>
        )}
      </div>
    </aside>
  );
}

function PiePanel({ title, pieData, displayMode }) {
  const [activePie, setActivePie] = useState([]);

  useEffect(() => {
    setActivePie(pieData.map((d) => d.name));
  }, [pieData]);

  const filteredPieData = pieData.filter((d) => activePie.includes(d.name));

  const togglePie = (name) => {
    setActivePie((prev) =>
      prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name]
    );
  };

  return (
    <div className="panel pie-side-panel">
      <h2>{title}</h2>
      {pieData.length > 0 ? (
        <div className="pie-side-layout">
          <div className="pie-graphic">
            <div className="chart-wrap pie-chart-wrap">
              <ResponsiveContainer width="100%" height={210}>
                <PieChart>
                  <Pie
                    data={filteredPieData}
                    dataKey="value"
                    nameKey="name"
                    outerRadius={62}
                    label={false}
                    labelLine={false}
                  >
                    {filteredPieData.map((entry, index) => (
                      <Cell
                        key={`${entry.name}-${index}`}
                        fill={getCraftColor(entry.name, index)}
                      />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomPieTooltip displayMode={displayMode} />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="pie-legend-side">
            <div className="craft-legend side-legend">
              {pieData.map((item, index) => {
                const isActive = activePie.includes(item.name);

                return (
                  <div
                    key={item.name}
                    className={`craft-legend-row${isActive ? "" : " inactive"}`}
                    onClick={() => togglePie(item.name)}
                  >
                    <div className="craft-legend-left">
                      <span
                        className="craft-legend-swatch"
                        style={{ background: getCraftColor(item.name, index) }}
                      />
                      <span>{item.name}</span>
                    </div>
                    <strong>{formatDisplayValue(item.value, displayMode)}</strong>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <p className="muted">No craft data in this range.</p>
      )}
    </div>
  );
}

function TimeSeriesPanel({ title, lineData, lineKeys, displayMode }) {
  const [activeLines, setActiveLines] = useState([]);

  useEffect(() => {
    setActiveLines(lineKeys);
  }, [lineKeys]);

  const toggleLine = (key) => {
    setActiveLines((prev) =>
      prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]
    );
  };

  return (
    <div className="panel time-panel">
      <h2>{title}</h2>
      {lineData.length > 0 ? (
        <>
          <div className="chart-wrap line-chart-wrap">
            <ResponsiveContainer width="100%" height={230}>
              <LineChart data={lineData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="year_month" />
                <YAxis allowDecimals={displayMode === "density"} />
                <Tooltip formatter={(value) => formatDisplayValue(value, displayMode)} />
                {lineKeys
                  .filter((key) => activeLines.includes(key))
                  .map((key, index) => (
                    <Line
                      key={key}
                      type="monotone"
                      dataKey={key}
                      stroke={getCraftColor(key, index)}
                      strokeWidth={2}
                      dot={false}
                    />
                  ))}
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="line-legend">
            {lineKeys.map((key, index) => {
              const isActive = activeLines.includes(key);

              return (
                <div
                  key={key}
                  className={`line-legend-row${isActive ? "" : " inactive"}`}
                  onClick={() => toggleLine(key)}
                >
                  <span
                    className="craft-legend-swatch"
                    style={{ background: getCraftColor(key, index) }}
                  />
                  <span>{key}</span>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <p className="muted">No time-series data in this range.</p>
      )}
    </div>
  );
}

export default function App() {
  const [dashboardData, setDashboardData] = useState(null);
  const [geojsonData, setGeojsonData] = useState(null);
  const [selectedFacId, setSelectedFacId] = useState(null);
  const [selectedFeature, setSelectedFeature] = useState(null);
  const [yearStart, setYearStart] = useState(2018);
  const [yearEnd, setYearEnd] = useState(2022);
  const [displayMode, setDisplayMode] = useState("count");

  useEffect(() => {
    async function loadData() {
      const [dashboardRes, geoRes] = await Promise.all([
        fetch("/dashboard_data.json"),
        fetch("/buildings_processed.geojson"),
      ]);

      const dashboardJson = await dashboardRes.json();
      const geoJson = await geoRes.json();

      setDashboardData(dashboardJson);
      setGeojsonData(geoJson);

      const minYear = dashboardJson?.meta?.year_bounds?.min ?? 2018;
      const maxYear = dashboardJson?.meta?.year_bounds?.max ?? 2022;
      setYearStart(minYear);
      setYearEnd(maxYear);
    }

    loadData();
  }, []);

  const buildingsLookup = dashboardData?.buildings ?? {};

  const gsfLookup = useMemo(() => {
    const result = {};
    for (const feature of geojsonData?.features || []) {
      const facId = feature?.properties?.fac_id;
      const gsf = feature?.properties?.Sheet3__GSF;
      if (facId) result[facId] = Number(gsf || 0);
    }
    return result;
  }, [geojsonData]);

  const aggregatedTimeseriesRaw = useMemo(() => {
    return aggregateTimeseriesAcrossBuildings(buildingsLookup);
  }, [buildingsLookup]);

  const aggregateGsf = useMemo(() => {
    return Object.values(gsfLookup).reduce((sum, gsf) => sum + Number(gsf || 0), 0);
  }, [gsfLookup]);

  const rawBuildingTotals = useMemo(() => {
    const result = {};

    for (const [facId, building] of Object.entries(buildingsLookup)) {
      result[facId] = totalForRange(building.timeseries, yearStart, yearEnd);
    }

    return result;
  }, [buildingsLookup, yearStart, yearEnd]);

  const filteredBuildingTotals = useMemo(() => {
    const result = {};

    for (const [facId, rawTotal] of Object.entries(rawBuildingTotals)) {
      const gsf = gsfLookup[facId] || 0;
      result[facId] =
        displayMode === "density"
          ? normalizeCount(rawTotal, gsf)
          : rawTotal;
    }

    return result;
  }, [rawBuildingTotals, gsfLookup, displayMode]);

  const mapScaleStats = useMemo(() => {
    return getClippedScaleStats(Object.values(filteredBuildingTotals), 0.01, 0.99);
  }, [filteredBuildingTotals]);

  const totalVisible = useMemo(() => {
    if (displayMode === "density") {
      const rawTotal = Object.values(rawBuildingTotals).reduce(
        (sum, value) => sum + Number(value || 0),
        0
      );
      return normalizeCount(rawTotal, aggregateGsf);
    }

    return Object.values(filteredBuildingTotals).reduce(
      (sum, value) => sum + Number(value || 0),
      0
    );
  }, [displayMode, rawBuildingTotals, aggregateGsf, filteredBuildingTotals]);

  const mappedCount = useMemo(() => {
    return Object.values(rawBuildingTotals).filter((value) => value > 0).length;
  }, [rawBuildingTotals]);

  const selectedBuilding = useMemo(() => {
    if (!selectedFacId || !buildingsLookup[selectedFacId]) return null;
    const building = buildingsLookup[selectedFacId];
    return {
      ...building,
      gsf: gsfLookup[selectedFacId] || 0,
      filteredTotal: filteredBuildingTotals[selectedFacId] || 0,
    };
  }, [selectedFacId, buildingsLookup, filteredBuildingTotals, gsfLookup]);

  const activeTimeseries = useMemo(() => {
    if (selectedBuilding) {
      return displayMode === "density"
        ? normalizeTimeseries(selectedBuilding.timeseries, selectedBuilding.gsf)
        : selectedBuilding.timeseries;
    }

    return displayMode === "density"
      ? normalizeTimeseries(aggregatedTimeseriesRaw, aggregateGsf)
      : aggregatedTimeseriesRaw;
  }, [selectedBuilding, aggregatedTimeseriesRaw, aggregateGsf, displayMode]);

  const pieData = useMemo(() => {
    const counts = craftCountsForRange(activeTimeseries, yearStart, yearEnd);
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [activeTimeseries, yearStart, yearEnd]);

  const lineData = useMemo(() => {
    return filterTimeseriesRange(activeTimeseries, yearStart, yearEnd);
  }, [activeTimeseries, yearStart, yearEnd]);

  const lineKeys = useMemo(() => {
    const rawKeys = buildCraftKeys(lineData);
    const pieOrder = pieData.map((item) => item.name);

    return [
      ...pieOrder.filter((key) => rawKeys.includes(key)),
      ...rawKeys.filter((key) => !pieOrder.includes(key)),
    ];
  }, [lineData, pieData]);

  const styledGeojson = useMemo(() => {
    if (!geojsonData) return null;

    return {
      ...geojsonData,
      features: geojsonData.features.map((feature) => {
        const facId = feature?.properties?.fac_id;
        const filteredTotal = facId ? filteredBuildingTotals[facId] || 0 : 0;
        const rawTotal = facId ? rawBuildingTotals[facId] || 0 : 0;

        return {
          ...feature,
          properties: {
            ...feature.properties,
            filtered_total_work_orders: filteredTotal,
            raw_total_work_orders: rawTotal,
          },
        };
      }),
    };
  }, [geojsonData, filteredBuildingTotals, rawBuildingTotals]);

  function onEachFeature(feature, layer) {
    const props = feature.properties || {};
    const facId = props.fac_id;
    const filteredTotal = props.filtered_total_work_orders || 0;
    const name = props.mapped_building_name || props.Sheet3__Common_Name || "Unknown";

    layer.bindTooltip(
      `<div style="font-size:12px;">
        <strong>${name}</strong><br/>
        FAC_ID: ${facId || "N/A"}<br/>
        ${displayMode === "density" ? "WO / 1000 sqft" : "Work Orders"}: ${
          displayMode === "density"
            ? Number(filteredTotal || 0).toFixed(2)
            : Math.round(Number(filteredTotal || 0)).toLocaleString()
        }
      </div>`
    );

    layer.on({
      click: () => {
        if (!facId) return;
        setSelectedFacId(facId);
        setSelectedFeature(feature);
      },
    });
  }

  function geojsonStyle(feature) {
    const value = feature?.properties?.filtered_total_work_orders || 0;

    return {
      fillColor: getContinuousMapColor(value, mapScaleStats),
      weight: 1,
      opacity: 1,
      color: "#475569",
      fillOpacity: 0.8,
    };
  }

  function clearSelection() {
    setSelectedFacId(null);
    setSelectedFeature(null);
  }

  if (!dashboardData || !styledGeojson) {
    return <div className="loading">Loading dashboard...</div>;
  }

  const pieTitle = selectedBuilding
    ? displayMode === "density"
      ? "Craft Breakdown / 1000 sqft"
      : "Craft Breakdown"
    : displayMode === "density"
      ? "Craft Breakdown / 1000 sqft - All Buildings"
      : "Craft Breakdown - All Buildings";

  const lineTitle = selectedBuilding
    ? displayMode === "density"
      ? "Time Series by Craft / 1000 sqft"
      : "Time Series by Craft"
    : displayMode === "density"
      ? "Time Series by Craft / 1000 sqft - All Buildings"
      : "Time Series by Craft - All Buildings";

  return (
    <div className="app-shell">
      <Sidebar
        meta={dashboardData.meta}
        yearStart={yearStart}
        yearEnd={yearEnd}
        setYearStart={setYearStart}
        setYearEnd={setYearEnd}
        totalVisible={totalVisible}
        mappedCount={mappedCount}
        selectedBuilding={selectedBuilding}
        clearSelection={clearSelection}
        displayMode={displayMode}
        setDisplayMode={setDisplayMode}
      />

      <main className="main-content">
        <div className="top-visuals">
          <div className="map-panel">
            <div className="map-header">
              <MapLegend scaleStats={mapScaleStats} displayMode={displayMode} />
            </div>

            <div className="map-wrap">
              <MapContainer
                center={GT_CENTER}
                zoom={16}
                style={{ height: "100%", width: "100%" }}
              >
                <TileLayer
                  attribution="&copy; OpenStreetMap contributors"
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <GeoJSON
                  data={styledGeojson}
                  style={geojsonStyle}
                  onEachFeature={onEachFeature}
                />
                <ZoomToSelected selectedFeature={selectedFeature} />
              </MapContainer>
            </div>
          </div>

          <PiePanel
            title={pieTitle}
            pieData={pieData}
            displayMode={displayMode}
          />
        </div>

        <TimeSeriesPanel
          title={lineTitle}
          lineData={lineData}
          lineKeys={lineKeys}
          displayMode={displayMode}
        />
      </main>
    </div>
  );
}
