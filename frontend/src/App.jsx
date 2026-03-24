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

function MapLegend({ maxValue }) {
  const bins = useMemo(() => {
    if (!maxValue || maxValue <= 0) {
      return [{ label: "0", color: "#f3f4f6" }];
    }

    const b1 = Math.max(1, Math.round(maxValue * 0.2));
    const b2 = Math.max(b1 + 1, Math.round(maxValue * 0.4));
    const b3 = Math.max(b2 + 1, Math.round(maxValue * 0.6));
    const b4 = Math.max(b3 + 1, Math.round(maxValue * 0.8));

    return [
      { label: "0", color: "#f3f4f6" },
      { label: `1–${b1}`, color: "#dbeafe" },
      { label: `${b1 + 1}–${b2}`, color: "#93c5fd" },
      { label: `${b2 + 1}–${b3}`, color: "#60a5fa" },
      { label: `${b3 + 1}–${b4}`, color: "#2563eb" },
      { label: `${b4 + 1}+`, color: "#1d4ed8" },
    ];
  }, [maxValue]);

  return (
    <div className="legend">
      <div className="legend-title">Work Orders</div>
      {bins.map((bin) => (
        <div key={bin.label} className="legend-row">
          <span className="legend-swatch" style={{ background: bin.color }} />
          <span>{bin.label}</span>
        </div>
      ))}
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

function getColor(value, maxValue) {
  if (!value || value <= 0 || !maxValue) return "#f3f4f6";
  const ratio = value / maxValue;
  if (ratio <= 0.2) return "#dbeafe";
  if (ratio <= 0.4) return "#93c5fd";
  if (ratio <= 0.6) return "#60a5fa";
  if (ratio <= 0.8) return "#2563eb";
  return "#1d4ed8";
}

function totalForRange(timeseries, startYear, endYear) {
  if (!Array.isArray(timeseries)) return 0;

  return timeseries.reduce((sum, row) => {
    const year = Number(String(row.year_month).slice(0, 4));
    if (year >= startYear && year <= endYear) {
      return sum + (row.total || 0);
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

function CustomPieTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;

  const item = payload[0];

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
      <div>Count: {item.value?.toLocaleString()}</div>
    </div>
  );
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
}) {
  const minYear = meta?.year_bounds?.min ?? 2018;
  const maxYear = meta?.year_bounds?.max ?? 2022;

  return (
    <aside className="sidebar">
      <h1>Campus Work Orders</h1>
      <p className="muted"></p>

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

        <p className="small-note">
          Current range: {yearStart} to {yearEnd}
        </p>
      </div>

      <div className="panel">
        <h2>Summary</h2>
        <div className="stat">
          <span>Total visible work orders</span>
          <strong>{totalVisible.toLocaleString()}</strong>
        </div>
        <div className="stat">
          <span>Mapped buildings with data</span>
          <strong>{mappedCount}</strong>
        </div>
      </div>

      <div className="panel">
        <h2>Selected Building</h2>
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
              <span>Total</span>
              <strong>{selectedBuilding.filteredTotal.toLocaleString()}</strong>
            </div>
          </>
        ) : (
          <p className="muted">Click a building on the map.</p>
        )}
      </div>
    </aside>
  );
}

function DetailsPanel({ selectedBuilding, pieData, lineData, lineKeys }) {
  const [activePie, setActivePie] = useState([]);
  const [activeLines, setActiveLines] = useState([]);

  useEffect(() => {
    setActivePie(pieData.map((d) => d.name));
  }, [pieData]);

  useEffect(() => {
    setActiveLines(lineKeys);
  }, [lineKeys]);

  const filteredPieData = pieData.filter((d) => activePie.includes(d.name));

  const togglePie = (name) => {
    setActivePie((prev) =>
      prev.includes(name)
        ? prev.filter((x) => x !== name)
        : [...prev, name]
    );
  };

  const toggleLine = (key) => {
    setActiveLines((prev) =>
      prev.includes(key)
        ? prev.filter((x) => x !== key)
        : [...prev, key]
    );
  };

  return (
    <section className="details">
      <div className="panel">
        <h2>Craft Breakdown</h2>
        {selectedBuilding ? (
          pieData.length > 0 ? (
            <>
              <div className="chart-wrap">
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={filteredPieData}
                      dataKey="value"
                      nameKey="name"
                      outerRadius={58}
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
                    <Tooltip content={<CustomPieTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="craft-legend">
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
                      <strong>{item.value.toLocaleString()}</strong>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <p className="muted">No craft data in this range.</p>
          )
        ) : (
          <p className="muted">Select a building to see craft breakdown.</p>
        )}
      </div>

      <div className="panel">
        <h2>Time Series by Craft</h2>
        {selectedBuilding ? (
          lineData.length > 0 ? (
            <>
              <div className="chart-wrap">
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={lineData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="year_month" />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
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

              <div className="craft-legend">
                {lineKeys.map((key, index) => {
                  const isActive = activeLines.includes(key);

                  return (
                    <div
                      key={key}
                      className={`craft-legend-row${isActive ? "" : " inactive"}`}
                      onClick={() => toggleLine(key)}
                    >
                      <div className="craft-legend-left">
                        <span
                          className="craft-legend-swatch"
                          style={{ background: getCraftColor(key, index) }}
                        />
                        <span>{key}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <p className="muted">No time-series data in this range.</p>
          )
        ) : (
          <p className="muted">Select a building to see its trend over time.</p>
        )}
      </div>
    </section>
  );
}

export default function App() {
  const [dashboardData, setDashboardData] = useState(null);
  const [geojsonData, setGeojsonData] = useState(null);
  const [selectedFacId, setSelectedFacId] = useState(null);
  const [selectedFeature, setSelectedFeature] = useState(null);
  const [yearStart, setYearStart] = useState(2018);
  const [yearEnd, setYearEnd] = useState(2022);

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

  const filteredBuildingTotals = useMemo(() => {
    const result = {};

    for (const [facId, building] of Object.entries(buildingsLookup)) {
      result[facId] = totalForRange(building.timeseries, yearStart, yearEnd);
    }

    return result;
  }, [buildingsLookup, yearStart, yearEnd]);

  const maxVisibleValue = useMemo(() => {
    const values = Object.values(filteredBuildingTotals);
    return values.length ? Math.max(...values) : 0;
  }, [filteredBuildingTotals]);

  const totalVisible = useMemo(() => {
    return Object.values(filteredBuildingTotals).reduce((sum, value) => sum + value, 0);
  }, [filteredBuildingTotals]);

  const mappedCount = useMemo(() => {
    return Object.values(filteredBuildingTotals).filter((v) => v > 0).length;
  }, [filteredBuildingTotals]);

  const selectedBuilding = useMemo(() => {
    if (!selectedFacId || !buildingsLookup[selectedFacId]) return null;
    const building = buildingsLookup[selectedFacId];
    return {
      ...building,
      filteredTotal: filteredBuildingTotals[selectedFacId] || 0,
    };
  }, [selectedFacId, buildingsLookup, filteredBuildingTotals]);

  const pieData = useMemo(() => {
    if (!selectedBuilding) return [];
    const counts = craftCountsForRange(selectedBuilding.timeseries, yearStart, yearEnd);
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [selectedBuilding, yearStart, yearEnd]);

  const lineData = useMemo(() => {
    if (!selectedBuilding) return [];
    return filterTimeseriesRange(selectedBuilding.timeseries, yearStart, yearEnd);
  }, [selectedBuilding, yearStart, yearEnd]);

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

        return {
          ...feature,
          properties: {
            ...feature.properties,
            filtered_total_work_orders: filteredTotal,
          },
        };
      }),
    };
  }, [geojsonData, filteredBuildingTotals]);

  function onEachFeature(feature, layer) {
    const props = feature.properties || {};
    const facId = props.fac_id;
    const filteredTotal = props.filtered_total_work_orders || 0;
    const name = props.mapped_building_name || props.Sheet3__Common_Name || "Unknown";

    layer.bindTooltip(
      `<div style="font-size:12px;">
        <strong>${name}</strong><br/>
        FAC_ID: ${facId || "N/A"}<br/>
        Work Orders: ${filteredTotal}
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
      fillColor: getColor(value, maxVisibleValue),
      weight: 1,
      opacity: 1,
      color: "#475569",
      fillOpacity: 0.8,
    };
  }

  if (!dashboardData || !styledGeojson) {
    return <div className="loading">Loading dashboard...</div>;
  }

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
      />

      <main className="main-content">
        <div className="map-panel">
          <div className="map-header">
            <MapLegend maxValue={maxVisibleValue} />
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

        <DetailsPanel
          selectedBuilding={selectedBuilding}
          pieData={pieData}
          lineData={lineData}
          lineKeys={lineKeys}
        />
      </main>
    </div>
  );
}
