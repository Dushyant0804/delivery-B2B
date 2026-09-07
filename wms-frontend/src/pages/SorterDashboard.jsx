import { useState, useEffect, useCallback, useRef } from "react";
import {
  Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  LineChart, Line, ResponsiveContainer, ComposedChart,
  PieChart, Pie, Cell
} from "recharts";
import * as XLSX from "xlsx";
import "../styles/SorterDashboard.css";
import AWBSearchModal from "../pages/AWBSearchModal.jsx";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toIST(utcStr) {
  const d = new Date(utcStr);
  return new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
}

function nowIST() {
  const ist = new Date(new Date().getTime() + 5.5 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${ist.getUTCFullYear()}-${pad(ist.getUTCMonth() + 1)}-${pad(ist.getUTCDate())}T${pad(ist.getUTCHours())}:${pad(ist.getUTCMinutes())}`;
}

function istLocalToUTC(istLocalStr) {
  return new Date(istLocalStr + ":00+05:30").toISOString();
}

function todayMidnightIST() {
  const ist = new Date(new Date().getTime() + 5.5 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${ist.getUTCFullYear()}-${pad(ist.getUTCMonth() + 1)}-${pad(ist.getUTCDate())}T00:00`;
}

function todayEndIST() {
  const ist = new Date(new Date().getTime() + 5.5 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${ist.getUTCFullYear()}-${pad(ist.getUTCMonth() + 1)}-${pad(ist.getUTCDate())}T23:59`;
}

function subtractHoursFromNow(hours) {
  const shifted = new Date(new Date().getTime() - hours * 60 * 60 * 1000);
  const ist = new Date(shifted.getTime() + 5.5 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${ist.getUTCFullYear()}-${pad(ist.getUTCMonth() + 1)}-${pad(ist.getUTCDate())}T${pad(ist.getUTCHours())}:${pad(ist.getUTCMinutes())}`;
}

function yesterdayRangeIST() {
  const ist = new Date(new Date().getTime() + 5.5 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  const y = new Date(ist.getTime() - 24 * 60 * 60 * 1000);
  const date = `${y.getUTCFullYear()}-${pad(y.getUTCMonth() + 1)}-${pad(y.getUTCDate())}`;
  return { start: `${date}T00:00`, end: `${date}T23:59` };
}

// ─── Quick Range Presets ──────────────────────────────────────────────────────

const QUICK_RANGES = [
  { label: "Last 24 Hours", icon: "🕐", getRange: () => ({ start: subtractHoursFromNow(24), end: nowIST() }) },
  { label: "Last 48 Hours", icon: "🕑", getRange: () => ({ start: subtractHoursFromNow(48), end: nowIST() }) },
  { label: "Last 72 Hours", icon: "🕒", getRange: () => ({ start: subtractHoursFromNow(72), end: nowIST() }) },
  { label: "Today",         icon: "📅", getRange: () => ({ start: todayMidnightIST(), end: todayEndIST() }) },
  { label: "Yesterday",     icon: "📆", getRange: () => yesterdayRangeIST() },
  { label: "Last 2 Days",   icon: "🗓", getRange: () => ({ start: subtractHoursFromNow(48), end: todayEndIST() }) },
  { label: "Last 3 Days",   icon: "📋", getRange: () => ({ start: subtractHoursFromNow(72), end: todayEndIST() }) },
];

// ─── Rejection labels ─────────────────────────────────────────────────────────

const REJECTION_LABELS = {
  dbo: "DBO", nle: "NLE", dnf: "DNF", ibo: "IBO",
  hv: "High Value", ndim: "NDIM", ndim_ud: "NDIM-UD", ndim_od: "NDIM-OD",
  unx: "UNX", mse: "MSE", nsz: "NSZ", rej: "REJ", ar: "AR", lmm: "LMM",
  api_fail: "API FAIL", chute_full: "Chute Full",
};
const IGNORE_REASON_CODES = new Set(["ul", "null", "none", ""]);

function getRejectionLabel(code) {
  if (!code) return null;
  const lower = code.toLowerCase();
  if (IGNORE_REASON_CODES.has(lower)) return null;
  return REJECTION_LABELS[lower] || code.toUpperCase();
}

// ─── Mode helpers — Machine (Sorter) vs Primary Sorting (HHD) ────────────────

function isHHD(row) {
  return (row.mode || "").toLowerCase() === "hhd";
}

// ─── Export to Excel ──────────────────────────────────────────────────────────

function exportToExcel(data, filename, sheetName = "Data") {
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

// ─── Custom Tooltip ───────────────────────────────────────────────────────────

const CustomBarTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="custom-tooltip">
      <div className="custom-tooltip__label">{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color }}>{p.name}: <b>{p.value}</b></div>
      ))}
    </div>
  );
};

// ─── Toggle (now takes a configurable label — used for the pie-chart switch) ─

function Toggle({ on, onToggle, label = "Count" }) {
  return (
    <div className="toggle-wrap">
      <span className="toggle-label">{label}</span>
      <div className={`toggle ${on ? "toggle--on" : ""}`} onClick={onToggle} role="switch" aria-checked={on}>
        <div className="toggle__thumb" />
      </div>
    </div>
  );
}

// ─── Helpers for picker ───────────────────────────────────────────────────────
const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DAYS_SHORT   = ["Su","Mo","Tu","We","Th","Fr","Sa"];

function parseIST(str) {
  if (!str) return null;
  const [date, time] = str.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = (time || "00:00").split(":").map(Number);
  return { year, month: month - 1, day, hour, minute };
}
function toISTStr({ year, month, day, hour, minute }) {
  const p = n => String(n).padStart(2, "0");
  return `${year}-${p(month + 1)}-${p(day)}T${p(hour)}:${p(minute)}`;
}
function getDaysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }
function getFirstDay(y, m)    { return new Date(y, m, 1).getDay(); }

// ─── Compact SpinBox (▲ value ▼) ─────────────────────────────────────────────
function SpinBox({ value, min, max, onChange, color, width = 52 }) {
  const p = n => String(n).padStart(2, "0");
  const inc = () => onChange(value >= max ? min : value + 1);
  const dec = () => onChange(value <= min ? max : value - 1);
  const handleKey = (e) => {
    if (e.key === "ArrowUp")   { e.preventDefault(); inc(); }
    if (e.key === "ArrowDown") { e.preventDefault(); dec(); }
  };
  return (
    <div className="spb" style={{ width }} onKeyDown={handleKey} tabIndex={0}>
      <button className="spb__arrow" onClick={inc} tabIndex={-1}>▲</button>
      <div className="spb__val" style={{ color, borderColor: color + "80" }}>{p(value)}</div>
      <button className="spb__arrow" onClick={dec} tabIndex={-1}>▼</button>
    </div>
  );
}

// ─── Compact DateTimePicker ───────────────────────────────────────────────────
function DateTimePicker({ label, color, value, onChange }) {
  const fallback = () => {
    const ist = new Date(new Date().getTime() + 5.5 * 60 * 60 * 1000);
    return { year: ist.getUTCFullYear(), month: ist.getUTCMonth(), day: ist.getUTCDate(), hour: 0, minute: 0 };
  };
  const init = parseIST(value) || fallback();
  const [view, setView] = useState({ year: init.year, month: init.month });
  const [sel,  setSel ] = useState(init);

  const lastEmitted = useRef(null);
  useEffect(() => {
    if (value && value !== lastEmitted.current) {
      const p = parseIST(value);
      if (p) { setSel(p); setView({ year: p.year, month: p.month }); }
    }
  }, [value]);

  const emit = (next) => {
    setSel(next);
    const str = toISTStr(next);
    lastEmitted.current = str;
    onChange(str);
  };
  const prevM = () => setView(v => v.month === 0  ? { year: v.year-1, month: 11 } : { ...v, month: v.month-1 });
  const nextM = () => setView(v => v.month === 11 ? { year: v.year+1, month: 0  } : { ...v, month: v.month+1 });

  const days     = getDaysInMonth(view.year, view.month);
  const firstDay = getFirstDay(view.year, view.month);
  const cells    = Array.from({ length: firstDay + days }, (_, i) => i < firstDay ? null : i - firstDay + 1);
  while (cells.length % 7 !== 0) cells.push(null);

  const istNow   = new Date(new Date().getTime() + 5.5 * 60 * 60 * 1000);
  const isToday  = d => d && istNow.getUTCDate()===d && istNow.getUTCMonth()===view.month && istNow.getUTCFullYear()===view.year;
  const isSel    = d => d && sel.day===d && sel.month===view.month && sel.year===view.year;

  return (
    <div className="dtp">
      <div className="dtp__label" style={{ color }}>
        <span className="dtp__dot" style={{ background: color }} />
        {label}
      </div>

      <div className="dtp__body">
        <div className="dtp__cal">
          <div className="dtp__nav">
            <button className="dtp__navbtn" onClick={prevM}>‹</button>
            <span className="dtp__navtitle">{MONTHS_SHORT[view.month]} {view.year}</span>
            <button className="dtp__navbtn" onClick={nextM}>›</button>
          </div>
          <div className="dtp__dayhdr">
            {DAYS_SHORT.map(d => <span key={d}>{d}</span>)}
          </div>
          <div className="dtp__grid">
            {cells.map((d, i) => (
              <button
                key={i}
                disabled={!d}
                className={["dtp__cell",
                  !d        ? "dtp__cell--blank" : "",
                  isSel(d)  ? "dtp__cell--sel"   : "",
                  isToday(d)&&!isSel(d) ? "dtp__cell--today" : "",
                ].join(" ")}
                style={isSel(d) ? { background: color, borderColor: color } : {}}
                onClick={() => d && emit({ ...sel, year: view.year, month: view.month, day: d })}
              >{d || ""}</button>
            ))}
          </div>
        </div>

        <div className="dtp__time">
          <div className="dtp__time-title">TIME</div>
          <div className="dtp__time-hint">24-hour (IST)</div>
          <div className="dtp__spinrow">
            <SpinBox value={sel.hour}   min={0} max={23} onChange={h => emit({ ...sel, hour: h })}   color={color} />
            <span className="dtp__colon">:</span>
            <SpinBox value={sel.minute} min={0} max={59} onChange={m => emit({ ...sel, minute: m })} color={color} />
          </div>
          <div className="dtp__timedisp" style={{ color, borderColor: color + "50" }}>
            {String(sel.hour).padStart(2,"0")}:{String(sel.minute).padStart(2,"0")}
          </div>
          <div className="dtp__datedisp">
            {String(sel.day).padStart(2,"0")} {MONTHS_SHORT[sel.month]} {sel.year}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Filter Drawer ────────────────────────────────────────────────────────────

function FilterDrawer({ open, onClose, onApply, current, activeLabel, onQuickSelect }) {
  const [start, setStart] = useState(current.start || todayMidnightIST());
  const [end,   setEnd  ] = useState(current.end   || todayEndIST());
  const [tab,   setTab  ] = useState("quick");

  const prevStart = useRef(current.start);
  const prevEnd   = useRef(current.end);
  useEffect(() => {
    if (current.start !== prevStart.current || current.end !== prevEnd.current) {
      prevStart.current = current.start;
      prevEnd.current   = current.end;
      if (current.start) setStart(current.start);
      if (current.end)   setEnd(current.end);
    }
  }, [current.start, current.end]);

  return (
    <>
      <div
        className={`drawer-backdrop ${open ? "drawer-backdrop--open" : ""}`}
        onClick={onClose}
      />

      <div className={`filter-drawer ${open ? "filter-drawer--open" : ""}`}>

        <div className="fd-header">
          <div className="fd-header__left">
            <span className="fd-header__icon">🔍</span>
            <div>
              <div className="fd-header__title">Filter Data</div>
              <div className="fd-header__sub">Select a date &amp; time range (IST)</div>
            </div>
          </div>
          <button className="fd-close" onClick={onClose}>✕</button>
        </div>

        <div className="fd-tabs">
          <button
            className={`fd-tab ${tab === "quick" ? "fd-tab--active" : ""}`}
            onClick={() => setTab("quick")}
          >
            ⚡ Quick Select
          </button>
          <button
            className={`fd-tab ${tab === "custom" ? "fd-tab--active" : ""}`}
            onClick={() => setTab("custom")}
          >
            🗓 Custom Range
          </button>
        </div>

        <div className="fd-body">

          {tab === "quick" && (
            <div className="fd-quick">
              <p className="fd-section-label">Select a preset range</p>
              <div className="fd-quick-grid">
                {QUICK_RANGES.map((r) => {
                  const range = r.getRange();
                  const isActive = activeLabel === r.label;
                  return (
                    <button
                      key={r.label}
                      className={`fd-preset ${isActive ? "fd-preset--active" : ""}`}
                      onClick={() => { onQuickSelect(r.label, range); onClose(); }}
                    >
                      <span className="fd-preset__icon">{r.icon}</span>
                      <span className="fd-preset__label">{r.label}</span>
                      {isActive && <span className="fd-preset__check">✓</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {tab === "custom" && (
            <div className="fd-custom">
              <DateTimePicker
                label="Start Date & Time"
                color="#D71920"
                value={start}
                onChange={setStart}
              />

              <div className="fd-divider" />

              <DateTimePicker
                label="End Date & Time"
                color="#1F2937"
                value={end}
                onChange={setEnd}
              />

              {start && end && (() => {
                const diffMs = new Date(end + ":00+05:30") - new Date(start + ":00+05:30");
                if (diffMs <= 0) return (
                  <div className="fd-duration fd-duration--warn">⚠️ End must be after Start</div>
                );
                const hrs = Math.floor(diffMs / 3600000);
                const mins = Math.floor((diffMs % 3600000) / 60000);
                return (
                  <div className="fd-duration">
                    ⏱ Duration: <b>{hrs}h {mins}m</b>
                  </div>
                );
              })()}

              <button
                className="fd-apply-btn"
                onClick={() => {
                  const diffMs = new Date(end + ":00+05:30") - new Date(start + ":00+05:30");
                  if (diffMs > 0) { onApply(start, end); onClose(); }
                }}
              >
                Apply Custom Range
              </button>
            </div>
          )}
        </div>

        <div className="fd-footer">
          <div className="fd-footer__label">Currently showing</div>
          <div className="fd-footer__range">
            {activeLabel
              ? <span className="fd-footer__badge">{activeLabel}</span>
              : <>
                  <span>{current.start?.replace("T", " ") || "—"}</span>
                  <span className="fd-footer__arrow">→</span>
                  <span>{current.end?.replace("T", " ") || "—"}</span>
                </>
            }
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, accent, icon }) {
  return (
    <div className="stat-card" >
      <div className="stat-card__icon" style={{ background: `${accent}14`, color: accent }}>{icon}</div>
      <div className="stat-card__label">{label}</div>
      <div className="stat-card__value">
        {value ?? <span className="stat-card__empty">—</span>}
      </div>
    </div>
  );
}

// ─── Chart Card ───────────────────────────────────────────────────────────────

function ChartCard({ title, children, toggle, onToggle, onDownload, toggleLabel }) {
  return (
    <div className="chart-card">
      <div className="chart-card__header">
        <h2 className="chart-card__title">{title}</h2>
        <div className="chart-card__controls">
          <button className="chart-dl-btn" title="Download Excel" onClick={onDownload}>⬇</button>
          <Toggle on={toggle} onToggle={onToggle} label={toggleLabel} />
        </div>
      </div>
      {children}
    </div>
  );
}

const BarLabel = (props) => {
  const { x, y, width, value } = props;
  if (!value) return null;
  return <text x={x + width / 2} y={y - 4} fill="#1F2937" fontSize={10} fontWeight={600} textAnchor="middle">{value}</text>;
};

const TICK    = { fill: "#6B7280", fontSize: 11 };
const TICK_SM = { fill: "#6B7280", fontSize: 10 };

const PIE_COLORS = ["#D71920", "#2563EB", "#16A34A", "#F59E0B", "#7C3AED", "#0891B2", "#DB2777", "#65A30D"];

// ─── Toggleable Bar+Line / Pie chart (Feedlane + Rejection charts) ───────────

function ToggleableChart({ data, showPie, barColor = "#D71920", nameKey = "name" }) {
  if (data.length === 0) {
    return <div className="chart-empty">No data in the selected range</div>;
  }

  if (showPie) {
    return (
      <ResponsiveContainer width="100%" height={260}>
        <PieChart>
          <Pie
            data={data}
            dataKey="count"
            nameKey={nameKey}
            cx="50%"
            cy="50%"
            outerRadius={90}
            label={({ name, count }) => `${name}: ${count}`}
          >
            {data.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
          </Pie>
          <Tooltip content={<CustomBarTooltip />} />
          <Legend wrapperStyle={{ fontSize: 12, color: "#6B7280" }} />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={data} margin={{ top: 10, right: 28, left: 0, bottom: 30 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#EDEFF3" />
        <XAxis dataKey={nameKey} tick={TICK_SM} angle={-25} textAnchor="end" interval={0} />
        <YAxis yAxisId="left" tick={TICK} />
        <YAxis yAxisId="right" orientation="right" tickFormatter={v => `${v}%`} tick={TICK} />
        <Tooltip content={<CustomBarTooltip />} />
        <Bar yAxisId="left" dataKey="count" name="Count" fill={barColor} radius={[4, 4, 0, 0]} barSize={40} />
        <Line yAxisId="right" dataKey="pct" name="%" stroke="#1F2937" dot={{ fill: "#1F2937", r: 4 }} strokeWidth={2} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ─── Fixed 24-hour throughput chart ──────────────────────────────────────────

function ThroughputChart({ data, series }) {
  const hasData = data.some(d => series.some(s => d[s.key] > 0));
  if (!hasData) {
    return <div className="chart-empty">No throughput data in the selected range</div>;
  }
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 10, right: 28, left: 0, bottom: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#EDEFF3" />
        <XAxis dataKey="time" tick={TICK_SM} interval={1} />
        <YAxis tick={TICK} allowDecimals={false} />
        <Tooltip content={<CustomBarTooltip />} />
        <Legend wrapperStyle={{ paddingTop: 14, fontSize: 12, color: "#6B7280" }} />
        {series.map(s => (
          <Line key={s.key} dataKey={s.key} name={s.key} stroke={s.color} strokeWidth={2.25} dot={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

// ─── Stat computation ─────────────────────────────────────────────────────────

function computeStats(rowsSubset) {
  const scanned = rowsSubset.length;
  const inducted = rowsSubset.filter(r => r.sort === "INDUCTED").length;
  const sorted = rowsSubset.filter(r => r.sort === "SORTED").length;
  const rejected = rowsSubset.filter(r => r.sort === "REJECTED").length;
  const rejectionPct = scanned > 0 ? ((rejected / scanned) * 100).toFixed(2) : "0.00";
  return { scanned, inducted, sorted, rejected, rejectionPct };
}

function buildRejectionData(rowsSubset) {
  const map = {};
  rowsSubset.forEach(r => {
    if (r.sort === "REJECTED" && r.reason) {
      const label = getRejectionLabel(r.reason);
      if (!label) return;
      map[label] = (map[label] || 0) + 1;
    }
  });
  const data = Object.entries(map).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  const total = data.reduce((s, d) => s + d.count, 0);
  return data.map(d => ({ ...d, pct: total > 0 ? +((d.count / total) * 100).toFixed(2) : 0 }));
}

function buildFeedlaneData(rowsSubset) {
  const map = {};
  rowsSubset.forEach(r => {
    const infeed = r.infeed || "Unknown";
    map[infeed] = (map[infeed] || 0) + 1;
  });
  const total = rowsSubset.length;
  return Object.entries(map)
    .map(([infeed, count]) => ({ name: `Infeed ${infeed}`, count, pct: total > 0 ? +((count / total) * 100).toFixed(2) : 0 }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// 24 fixed hourly buckets (00:00–23:00, IST), broken out per mode series
function buildThroughputByMode(rowsSubset, modeKeys) {
  const hourMap = {};
  for (let h = 0; h < 24; h++) {
    const key = String(h).padStart(2, "0") + ":00";
    hourMap[key] = { time: key };
    modeKeys.forEach(mk => { hourMap[key][mk.label] = 0; });
  }
  rowsSubset.forEach(r => {
    if (!r.scantime) return;
    const ist = toIST(r.scantime);
    const key = String(ist.getUTCHours()).padStart(2, "0") + ":00";
    const m = (r.mode || "").toLowerCase();
    const match = modeKeys.find(mk => mk.key === m);
    if (match && hourMap[key]) hourMap[key][match.label]++;
  });
  return Object.values(hourMap);
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function SorterDashboard() {
  const [rows,         setRows        ] = useState([]);
  const [loading,      setLoading     ] = useState(true);
  const [error,        setError       ] = useState(null);
  const [drawerOpen,   setDrawerOpen  ] = useState(false);
  const [filter,       setFilter      ] = useState({ start: todayMidnightIST(), end: todayEndIST() });
  const [activeLabel,  setActiveLabel ] = useState("Today");

  const [awbSearchOpen, setAwbSearchOpen] = useState(false);

  const [feedPie,  setFeedPie ] = useState(false);
  const [rejPie,   setRejPie  ] = useState(false);
  const [hhdRejPie, setHhdRejPie] = useState(false);

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const fetchAll = useCallback(async (startIST, endIST) => {
    setLoading(true);
    setError(null);
    try {
      const startUTC = startIST ? istLocalToUTC(startIST) : null;
      const endUTC   = endIST   ? istLocalToUTC(endIST)   : null;

      const buildQS = (page, limit) => {
        const p = new URLSearchParams({ page, limit });
        if (startUTC) p.set("startTime", startUTC);
        if (endUTC)   p.set("endTime",   endUTC);
        return p.toString();
      };

      const firstRes = await fetch(`http://localhost:5001/api/parcels?${buildQS(1, 100)}`);
      if (!firstRes.ok) {
        const e = await firstRes.json().catch(() => ({}));
        throw new Error(e.message || `API error ${firstRes.status}`);
      }
      const firstData = await firstRes.json();
      let allRows = firstData.rows || [];

      if (firstData.total > 100) {
        const pages = Math.ceil(firstData.total / 100);
        const rest = await Promise.all(
          Array.from({ length: pages - 1 }, (_, i) => i + 2).map((p) =>
            fetch(`http://localhost:5001/api/parcels?${buildQS(p, 100)}`).then(r => r.json()).then(d => d.rows || [])
          )
        );
        allRows = allRows.concat(rest.flat());
      }

      setRows(allRows);

      
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(filter.start, filter.end); }, [fetchAll, filter]);

  // ── Split by mode — every section below derives from ONE fetch + the SAME
  // active date filter, just filtered client-side by mode ──────────────────
  const machineRows = rows.filter(r => !isHHD(r));
  const hhdRows      = rows.filter(r => isHHD(r));

  const machineStats = computeStats(machineRows);
  const hhdStats      = computeStats(hhdRows);

  const feedData         = buildFeedlaneData(machineRows);
  const rejDataMachine   = buildRejectionData(machineRows);
  const rejDataHHD       = buildRejectionData(hhdRows);

  const tpDataMachine = buildThroughputByMode(machineRows, [
    { key: "au", label: "AU" },
    { key: "sa", label: "SA" },
  ]);
  const tpDataHHD = buildThroughputByMode(hhdRows, [
    { key: "hhd", label: "HHD" },
  ]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleReset = () => {
    setFilter({ start: todayMidnightIST(), end: todayEndIST() });
    setActiveLabel("Today");
  };

  const handleApply = (start, end) => {
    setFilter({ start, end });
    setActiveLabel(null);
  };

  const handleQuickSelect = (label, { start, end }) => {
    setFilter({ start, end });
    setActiveLabel(label);
  };

  const badgeText = activeLabel || (filter.start ? `${filter.start.replace("T", " ")} → ${filter.end?.replace("T", " ")}` : null);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="dashboard">

      {/* ── Header ── */}
      <div className="dashboard__header">
        <div className="dashboard__header-left">
          <h1 className="dashboard__title">Sorter Dashboard</h1>
        </div>

        <div className="dashboard__actions">
          {badgeText && <span className="filter-badge">{badgeText}</span>}

          <button
            className={`dash-btn dash-btn--date ${drawerOpen ? "dash-btn--active" : ""}`}
            onClick={() => setDrawerOpen(true)}
          >
            <span className="dash-btn__icon">📅</span>
            <span className="dash-btn__label">Date Filter</span>
          </button>

          <button
            className="dash-btn dash-btn--awb"
            onClick={() => setAwbSearchOpen(true)}
          >
            <span className="dash-btn__icon">🔎</span>
            <span className="dash-btn__label">AWB Search</span>
          </button>

          <button className="dash-btn dash-btn--reset" onClick={handleReset}>
            <span className="dash-btn__icon">↺</span>
            <span className="dash-btn__label">Reset</span>
          </button>
        </div>
      </div>

      {/* ── Error / Warn ── */}
      {error && <div className="error-banner">⚠️ {error} — Check API at <code>localhost:5001</code></div>}
      {!loading && rows.length === 0 && !error && (
        <div className="warn-banner">ℹ️ No data for <b>{badgeText || "selected range"}</b>. Try a different range.</div>
      )}

      {/* ── Loading ── */}
      {loading && (
        <div className="loading-state">
          <div className="loading-state__icon">⟳</div>
          <div>Loading parcel data…</div>
        </div>
      )}

      {!loading && (
        <>
          {/* ══════════════════════ SORTER (MACHINE) SECTION ══════════════════════ */}
          <div className="section-label">Sorter (Machine)</div>

          <div className="stat-cards">
            <StatCard label="Shipments Scanned"  value={machineStats.scanned.toLocaleString()}  accent="#2563EB" icon="📦" />
            <StatCard label="Shipments Inducted" value={machineStats.inducted.toLocaleString()} accent="#7C3AED" icon="⏳" />
            <StatCard label="Shipments Sorted"   value={machineStats.sorted.toLocaleString()}   accent="#16A34A" icon="✅" />
            <StatCard label="Shipments Rejected" value={machineStats.rejected.toLocaleString()} accent="#D71920" icon="⚠️" />
            <StatCard label="Rejection %"        value={`${machineStats.rejectionPct}%`}        accent="#B4151A" icon="📊" />
          </div>

          <div className="charts-row">
            <ChartCard
              title="Feedlane Wise Utilization"
              toggle={feedPie}
              toggleLabel="Pie View"
              onToggle={() => setFeedPie(p => !p)}
              onDownload={() => exportToExcel(feedData, "feedlane_utilization", "Feedlane")}
            >
              <ToggleableChart data={feedData} showPie={feedPie} barColor="#2563EB" />
            </ChartCard>

            <ChartCard
              title="Rejected Shipments Details"
              toggle={rejPie}
              toggleLabel="Pie View"
              onToggle={() => setRejPie(p => !p)}
              onDownload={() => exportToExcel(rejDataMachine, "rejection_details_machine", "Rejections")}
            >
              <ToggleableChart data={rejDataMachine} showPie={rejPie} barColor="#D71920" />
            </ChartCard>
          </div>

          <div className="throughput-card">
            <div className="throughput-card__header">
              <h2 className="throughput-card__title">Sorter Throughput (Time)</h2>
              <button className="chart-dl-btn" title="Download Excel" onClick={() => exportToExcel(tpDataMachine, "sorter_throughput", "Throughput")}>⬇</button>
            </div>
            <ThroughputChart
              data={tpDataMachine}
              series={[
                { key: "AU", color: "#2563EB" },
                { key: "SA", color: "#7C3AED" },
              ]}
            />
          </div>
          <div className="more-charts-placeholder">+ More charts coming soon</div>
        </>
      )}

      {/* ── Filter Drawer ── */}
      <FilterDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onApply={handleApply}
        onQuickSelect={handleQuickSelect}
        current={filter}
        activeLabel={activeLabel}
      />

      {/* ── AWB Search Modal ── */}
      {awbSearchOpen && (
        <AWBSearchModal onClose={() => setAwbSearchOpen(false)} />
      )}
    </div>
  );
}