import React, { useEffect, useState, useRef, useCallback } from "react";
import axios from "axios";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Toast } from "primereact/toast";
import "../styles/AlarmHistory.css";

const API = "http://localhost:5001/api";

// ─── IST Helpers ─────────────────────────────────────────────────────────────

function nowIST() {
  const ist = new Date(new Date().getTime() + 5.5 * 60 * 60 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${ist.getUTCFullYear()}-${p(ist.getUTCMonth() + 1)}-${p(ist.getUTCDate())}T${p(ist.getUTCHours())}:${p(ist.getUTCMinutes())}`;
}
function todayMidnightIST() {
  const ist = new Date(new Date().getTime() + 5.5 * 60 * 60 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${ist.getUTCFullYear()}-${p(ist.getUTCMonth() + 1)}-${p(ist.getUTCDate())}T00:00`;
}
function todayEndIST() {
  const ist = new Date(new Date().getTime() + 5.5 * 60 * 60 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${ist.getUTCFullYear()}-${p(ist.getUTCMonth() + 1)}-${p(ist.getUTCDate())}T23:59`;
}
function subtractHoursFromNow(h) {
  const shifted = new Date(new Date().getTime() - h * 60 * 60 * 1000);
  const ist = new Date(shifted.getTime() + 5.5 * 60 * 60 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${ist.getUTCFullYear()}-${p(ist.getUTCMonth() + 1)}-${p(ist.getUTCDate())}T${p(ist.getUTCHours())}:${p(ist.getUTCMinutes())}`;
}
function yesterdayRangeIST() {
  const ist = new Date(new Date().getTime() + 5.5 * 60 * 60 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  const y = new Date(ist.getTime() - 24 * 60 * 60 * 1000);
  const date = `${y.getUTCFullYear()}-${p(y.getUTCMonth() + 1)}-${p(y.getUTCDate())}`;
  return { start: `${date}T00:00`, end: `${date}T23:59` };
}
function istLocalToUTC(s) {
  return new Date(s + ":00+05:30").toISOString();
}
function fmtIST(utcStr) {
  if (!utcStr) return "—";
  return new Date(utcStr).toLocaleString("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
}
function fmtDuration(seconds) {
  if (!seconds) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(h)}:${p(m)}:${p(s)}`;
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

// ─── DateTimePicker ───────────────────────────────────────────────────────────

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
  const p = (n) => String(n).padStart(2, "0");
  return `${year}-${p(month + 1)}-${p(day)}T${p(hour)}:${p(minute)}`;
}
function getDaysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }
function getFirstDay(y, m)    { return new Date(y, m, 1).getDay(); }

function SpinBox({ value, min, max, onChange, color, width = 52 }) {
  const p = (n) => String(n).padStart(2, "0");
  const inc = () => onChange(value >= max ? min : value + 1);
  const dec = () => onChange(value <= min ? max : value - 1);
  return (
    <div className="ah-spb" style={{ width }} tabIndex={0}
      onKeyDown={e => {
        if (e.key === "ArrowUp")   { e.preventDefault(); inc(); }
        if (e.key === "ArrowDown") { e.preventDefault(); dec(); }
      }}>
      <button className="ah-spb__arrow" onClick={inc} tabIndex={-1}>▲</button>
      <div className="ah-spb__val" style={{ color, borderColor: color + "80" }}>{p(value)}</div>
      <button className="ah-spb__arrow" onClick={dec} tabIndex={-1}>▼</button>
    </div>
  );
}

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

  const prevM = () => setView(v => v.month === 0  ? { year: v.year - 1, month: 11 } : { ...v, month: v.month - 1 });
  const nextM = () => setView(v => v.month === 11 ? { year: v.year + 1, month: 0  } : { ...v, month: v.month + 1 });

  const days     = getDaysInMonth(view.year, view.month);
  const firstDay = getFirstDay(view.year, view.month);
  const cells    = Array.from({ length: firstDay + days }, (_, i) => i < firstDay ? null : i - firstDay + 1);
  while (cells.length % 7 !== 0) cells.push(null);

  const istNow  = new Date(new Date().getTime() + 5.5 * 60 * 60 * 1000);
  const isToday = d => d && istNow.getUTCDate() === d && istNow.getUTCMonth() === view.month && istNow.getUTCFullYear() === view.year;
  const isSel   = d => d && sel.day === d && sel.month === view.month && sel.year === view.year;

  return (
    <div className="ah-dtp">
      <div className="ah-dtp__label" style={{ color }}>
        <span className="ah-dtp__dot" style={{ background: color }} />
        {label}
      </div>
      <div className="ah-dtp__body">
        <div className="ah-dtp__cal">
          <div className="ah-dtp__nav">
            <button className="ah-dtp__navbtn" onClick={prevM}>‹</button>
            <span className="ah-dtp__navtitle">{MONTHS_SHORT[view.month]} {view.year}</span>
            <button className="ah-dtp__navbtn" onClick={nextM}>›</button>
          </div>
          <div className="ah-dtp__dayhdr">
            {DAYS_SHORT.map(d => <span key={d}>{d}</span>)}
          </div>
          <div className="ah-dtp__grid">
            {cells.map((d, i) => (
              <button key={i} disabled={!d}
                className={["ah-dtp__cell",
                  !d       ? "ah-dtp__cell--blank" : "",
                  isSel(d) ? "ah-dtp__cell--sel"   : "",
                  isToday(d) && !isSel(d) ? "ah-dtp__cell--today" : "",
                ].join(" ")}
                style={isSel(d) ? { background: color, borderColor: color } : {}}
                onClick={() => d && emit({ ...sel, year: view.year, month: view.month, day: d })}
              >{d || ""}</button>
            ))}
          </div>
        </div>
        <div className="ah-dtp__time">
          <div className="ah-dtp__time-title">TIME</div>
          <div className="ah-dtp__time-hint">24h IST</div>
          <div className="ah-dtp__spinrow">
            <SpinBox value={sel.hour}   min={0} max={23} onChange={h => emit({ ...sel, hour: h })}   color={color} />
            <span className="ah-dtp__colon">:</span>
            <SpinBox value={sel.minute} min={0} max={59} onChange={m => emit({ ...sel, minute: m })} color={color} />
          </div>
          <div className="ah-dtp__timedisp" style={{ color, borderColor: color + "50" }}>
            {String(sel.hour).padStart(2, "0")}:{String(sel.minute).padStart(2, "0")}
          </div>
          <div className="ah-dtp__datedisp">
            {String(sel.day).padStart(2, "0")} {MONTHS_SHORT[sel.month]} {sel.year}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Filter Drawer ────────────────────────────────────────────────────────────

function FilterDrawer({ open, onClose, dateRange, onApplyDate, onQuickSelect, activeLabel }) {
  const [tab,   setTab  ] = useState("quick");
  const [start, setStart] = useState(dateRange.start || todayMidnightIST());
  const [end,   setEnd  ] = useState(dateRange.end   || todayEndIST());

  const prevStart = useRef(dateRange.start);
  const prevEnd   = useRef(dateRange.end);
  useEffect(() => {
    if (dateRange.start !== prevStart.current || dateRange.end !== prevEnd.current) {
      prevStart.current = dateRange.start;
      prevEnd.current   = dateRange.end;
      if (dateRange.start) setStart(dateRange.start);
      if (dateRange.end)   setEnd(dateRange.end);
    }
  }, [dateRange.start, dateRange.end]);

  const diffMs = start && end ? new Date(end + ":00+05:30") - new Date(start + ":00+05:30") : 0;
  const hrs  = Math.floor(diffMs / 3600000);
  const mins = Math.floor((diffMs % 3600000) / 60000);

  return (
    <>
      <div className={`ah-drawer-backdrop ${open ? "ah-drawer-backdrop--open" : ""}`} onClick={onClose} />
      <div className={`ah-filter-drawer ${open ? "ah-filter-drawer--open" : ""}`}>

        <div className="ah-fd-header">
          <div className="ah-fd-header__left">
            <span style={{ fontSize: 20 }}>🔍</span>
            <div>
              <div className="ah-fd-header__title">Date &amp; Time Filter</div>
              <div className="ah-fd-header__sub">All times in IST</div>
            </div>
          </div>
          <button className="ah-fd-close" onClick={onClose}>✕</button>
        </div>

        <div className="ah-fd-tabs">
          <button className={`ah-fd-tab ${tab === "quick"  ? "ah-fd-tab--active" : ""}`} onClick={() => setTab("quick")}>⚡ Quick</button>
          <button className={`ah-fd-tab ${tab === "custom" ? "ah-fd-tab--active" : ""}`} onClick={() => setTab("custom")}>🗓 Custom</button>
        </div>

        <div className="ah-fd-body">
          {tab === "quick" && (
            <div>
              <p className="ah-fd-section-label">Select preset range</p>
              <div className="ah-fd-quick-grid">
                {QUICK_RANGES.map(r => {
                  const isActive = activeLabel === r.label;
                  return (
                    <button key={r.label}
                      className={`ah-fd-preset ${isActive ? "ah-fd-preset--active" : ""}`}
                      onClick={() => { onQuickSelect(r.label, r.getRange()); onClose(); }}
                    >
                      <span style={{ fontSize: 15 }}>{r.icon}</span>
                      <span className="ah-fd-preset__label">{r.label}</span>
                      {isActive && <span style={{ color: "#60a5fa", fontSize: 11 }}>✓</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {tab === "custom" && (
            <div className="ah-fd-custom">
              <DateTimePicker label="Start" color="#3b82f6" value={start} onChange={setStart} />
              <div style={{ height: 1, background: "#1e2740", margin: "6px 0 10px" }} />
              <DateTimePicker label="End"   color="#f97316" value={end}   onChange={setEnd} />
              {diffMs > 0
                ? <div className="ah-fd-duration">⏱ Duration: <b>{hrs}h {mins}m</b></div>
                : start && end && <div className="ah-fd-duration ah-fd-duration--warn">⚠️ End must be after Start</div>
              }
              <button className="ah-fd-apply-btn"
                onClick={() => { if (diffMs > 0) { onApplyDate(start, end); onClose(); } }}>
                Apply Range
              </button>
            </div>
          )}
        </div>

        <div className="ah-fd-footer">
          <div className="ah-fd-footer__label">Currently showing</div>
          <div className="ah-fd-footer__range">
            {activeLabel
              ? <span className="ah-fd-footer__badge">{activeLabel}</span>
              : dateRange.start
                ? <span style={{ fontSize: 11 }}>{dateRange.start.replace("T", " ")} → {dateRange.end?.replace("T", " ")} IST</span>
                : <span style={{ fontSize: 11, color: "#475569" }}>All records</span>
            }
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Filter Chip ──────────────────────────────────────────────────────────────

function FilterChip({ label, value, onRemove }) {
  if (!value) return null;
  return (
    <span className="ah-chip">
      <span className="ah-chip__label">{label}:</span>
      <span className="ah-chip__val">{value}</span>
      <button className="ah-chip__x" onClick={onRemove}>✕</button>
    </span>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

const AlarmHistory = () => {
  const toastRef = useRef(null);

  const [rows,    setRows   ] = useState([]);
  const [total,   setTotal  ] = useState(0);
  const [page,    setPage   ] = useState(1);
  const [limit,   setLimit  ] = useState(100);
  const [loading, setLoading] = useState(false);

  const [dateRange,     setDateRange    ] = useState({ start: null, end: null });
  const [activeLabel,   setActiveLabel  ] = useState(null);
  const [drawerOpen,    setDrawerOpen   ] = useState(false);
  const [searchTrigger, setSearchTrigger] = useState(0);

  // ── Fetch ────────────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const p = { page, limit };

      // AlarmHistory API uses startDate / endDate (not startTime/endTime)
      if (dateRange.start && dateRange.end) {
        p.startDate = istLocalToUTC(dateRange.start);
        p.endDate   = istLocalToUTC(dateRange.end);
      }

      Object.keys(p).forEach(k => { if (!p[k] && p[k] !== 0) delete p[k]; });

      const res = await axios.get(`${API}/alarm-history`, { params: p });
      setRows(res.data.data || res.data.rows || []);
      setTotal(res.data.total || 0);
    } catch (err) {
      toastRef.current?.show({
        severity: "error", summary: "Error",
        detail: err.response?.data?.error || err.message, life: 3000,
      });
    } finally {
      setLoading(false);
    }
  }, [page, limit, dateRange, searchTrigger]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleApplyDate = (start, end) => {
    setDateRange({ start, end });
    setActiveLabel(null);
    setPage(1);
  };

  const handleQuickSelect = (label, { start, end }) => {
    setDateRange({ start, end });
    setActiveLabel(label);
    setPage(1);
  };

  const handleReset = () => {
    setDateRange({ start: null, end: null });
    setActiveLabel(null);
    setPage(1);
    setSearchTrigger(t => t + 1);
  };

  const exportData = () => {
    const params = new URLSearchParams();
    if (dateRange.start && dateRange.end) {
      params.append("startDate", istLocalToUTC(dateRange.start));
      params.append("endDate",   istLocalToUTC(dateRange.end));
    }
    window.open(`${API}/alarm-history/export?${params.toString()}`, "_blank");
  };

  // ── Chip ─────────────────────────────────────────────────────────────────
  const badgeText = activeLabel || (dateRange.start
    ? `${dateRange.start.replace("T", " ")} → ${dateRange.end?.replace("T", " ")}`
    : null);

  const chips = [
    badgeText && { key: "date", label: "Range", value: badgeText, clear: handleReset },
  ].filter(Boolean);

  // ── Duration badge ────────────────────────────────────────────────────────
  const durationBadge = (seconds) => {
    if (!seconds) return <span className="ah-cell-muted">—</span>;
    const str = fmtDuration(seconds);
    const color = seconds > 3600 ? "ah-dur--high" : seconds > 300 ? "ah-dur--med" : "ah-dur--low";
    return <span className={`ah-dur-badge ${color}`}>{str}</span>;
  };

  return (
    <div className="ah-root">
      <Toast ref={toastRef} />

      <div className="ah-card">

        {/* ── Header ── */}
        <div className="ah-page-header">
          <div className="ah-page-header__left">
            <h2 className="ah-page-title">Alarm History</h2>
            {badgeText && <span className="ah-range-badge">{badgeText}</span>}
          </div>
          <span className="ah-total-count">{total.toLocaleString()} records</span>
        </div>

        {/* ── Filter Card ── */}
        <div className="ah-filter-card">
          <div className="ah-filter-card__title">Search Alarm Records</div>

          <div className="ah-filter-row">
            <div className="ah-field-group">
              <label className="ah-field-label">Start Date &amp; Time</label>
              <button className="ah-field-input ah-field-input--btn" onClick={() => setDrawerOpen(true)}>
                {dateRange.start
                  ? <span style={{ color: "#e2e8f0" }}>{dateRange.start.replace("T", " ")}</span>
                  : <span style={{ color: "#6b7280" }}>Select start…</span>
                }
                <span className="ah-field-input__icon">📅</span>
              </button>
            </div>

            <div className="ah-field-group">
              <label className="ah-field-label">End Date &amp; Time</label>
              <button className="ah-field-input ah-field-input--btn" onClick={() => setDrawerOpen(true)}>
                {dateRange.end
                  ? <span style={{ color: "#e2e8f0" }}>{dateRange.end.replace("T", " ")}</span>
                  : <span style={{ color: "#6b7280" }}>Select end…</span>
                }
                <span className="ah-field-input__icon">📅</span>
              </button>
            </div>
          </div>

          {/* Action Row */}
          <div className="ah-filter-actions">
            <button className="ah-action-btn ah-action-btn--export" onClick={exportData}>⬇ Export CSV</button>
            <button
              className={`ah-action-btn ah-action-btn--date ${drawerOpen ? "ah-action-btn--date-active" : ""}`}
              onClick={() => setDrawerOpen(true)}
            >
              📅 Date Filter
            </button>
            <button className="ah-action-btn ah-action-btn--reset" onClick={handleReset}>↺ Reset</button>
            <button className="ah-action-btn ah-action-btn--search"
              onClick={() => { setPage(1); setSearchTrigger(t => t + 1); }}>
              🔍 Search
            </button>
          </div>
        </div>

        {/* ── Active Chips ── */}
        {chips.length > 0 && (
          <div className="ah-chips">
            {chips.map(c => <FilterChip key={c.key} label={c.label} value={c.value} onRemove={c.clear} />)}
            <button className="ah-chip-clear-all" onClick={handleReset}>Clear all</button>
          </div>
        )}

        {/* ── Table ── */}
        <DataTable
          value={rows}
          loading={loading}
          paginator
          lazy
          rows={limit}
          totalRecords={total}
          first={(page - 1) * limit}
          rowsPerPageOptions={[100, 500, 1000]}
          onPage={(e) => { setPage(e.page + 1); setLimit(e.rows); }}
          scrollable
          scrollHeight="50vh"
          resizableColumns
          columnResizeMode="expand"
          className="ah-table"
          emptyMessage="No alarm records found for the selected range."
          tableStyle={{ minWidth: "800px" }}
        >
          <Column
            header="S.No"
            style={{ minWidth: 60, textAlign: "center" }}
            body={(_, opts) => (page - 1) * limit + opts.rowIndex + 1}
          />
          <Column
            field="code"
            header="Code"
            style={{ minWidth: 100 }}
            body={r => r.code
              ? <span className="ah-code-tag">{r.code}</span>
              : <span className="ah-cell-muted">—</span>}
          />
          <Column
            field="message"
            header="Message"
            style={{ minWidth: 260 }}
            body={r => r.message || <span className="ah-cell-muted">—</span>}
          />
          <Column
            header="Arrived At (IST)"
            style={{ minWidth: 160 }}
            body={r => fmtIST(r.arrived_at)}
          />
          <Column
            header="Resolved At (IST)"
            style={{ minWidth: 160 }}
            body={r => r.resolved_at ? fmtIST(r.resolved_at) : <span className="ah-unresolved">● Active</span>}
          />
          <Column
            header="Duration"
            style={{ minWidth: 120 }}
            body={r => durationBadge(r.duration_seconds)}
          />
        </DataTable>

      </div>

      {/* ── Filter Drawer ── */}
      <FilterDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        dateRange={dateRange}
        onApplyDate={handleApplyDate}
        onQuickSelect={handleQuickSelect}
        activeLabel={activeLabel}
      />
    </div>
  );
};

export default AlarmHistory;