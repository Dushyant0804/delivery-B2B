import React, { useEffect, useState, useRef, useCallback } from "react";
import axios from "axios";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Toast } from "primereact/toast";
import "../styles/Parcels.css";
import "../styles/SecondarySortingReport.css";

const API = "http://localhost:5001/api";

// ─── IST helpers ──────────────────────────────────────────────────────────────

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

// ─── Quick range presets ──────────────────────────────────────────────────────

const QUICK_RANGES = [
  { label: "Last 24 Hours", icon: "🕐", getRange: () => ({ start: subtractHoursFromNow(24), end: nowIST() }) },
  { label: "Last 48 Hours", icon: "🕑", getRange: () => ({ start: subtractHoursFromNow(48), end: nowIST() }) },
  { label: "Last 72 Hours", icon: "🕒", getRange: () => ({ start: subtractHoursFromNow(72), end: nowIST() }) },
  { label: "Today",         icon: "📅", getRange: () => ({ start: todayMidnightIST(), end: todayEndIST() }) },
  { label: "Yesterday",     icon: "📆", getRange: () => yesterdayRangeIST() },
  { label: "Last 2 Days",   icon: "🗓", getRange: () => ({ start: subtractHoursFromNow(48), end: todayEndIST() }) },
  { label: "Last 3 Days",   icon: "📋", getRange: () => ({ start: subtractHoursFromNow(72), end: todayEndIST() }) },
];

// ─── Compact date-time picker (same as Parcels.jsx) ───────────────────────────

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
    <div className="pr-spb" style={{ width }} tabIndex={0}
      onKeyDown={e => { if (e.key === "ArrowUp") { e.preventDefault(); inc(); } if (e.key === "ArrowDown") { e.preventDefault(); dec(); } }}>
      <button className="pr-spb__arrow" onClick={inc} tabIndex={-1}>▲</button>
      <div className="pr-spb__val" style={{ color, borderColor: color + "80" }}>{p(value)}</div>
      <button className="pr-spb__arrow" onClick={dec} tabIndex={-1}>▼</button>
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

  const days = getDaysInMonth(view.year, view.month);
  const firstDay = getFirstDay(view.year, view.month);
  const cells = Array.from({ length: firstDay + days }, (_, i) => i < firstDay ? null : i - firstDay + 1);
  while (cells.length % 7 !== 0) cells.push(null);

  const istNow  = new Date(new Date().getTime() + 5.5 * 60 * 60 * 1000);
  const isToday = d => d && istNow.getUTCDate() === d && istNow.getUTCMonth() === view.month && istNow.getUTCFullYear() === view.year;
  const isSel   = d => d && sel.day === d && sel.month === view.month && sel.year === view.year;

  return (
    <div className="pr-dtp">
      <div className="pr-dtp__label" style={{ color }}>
        <span className="pr-dtp__dot" style={{ background: color }} />
        {label}
      </div>
      <div className="pr-dtp__body">
        <div className="pr-dtp__cal">
          <div className="pr-dtp__nav">
            <button className="pr-dtp__navbtn" onClick={prevM}>‹</button>
            <span className="pr-dtp__navtitle">{MONTHS_SHORT[view.month]} {view.year}</span>
            <button className="pr-dtp__navbtn" onClick={nextM}>›</button>
          </div>
          <div className="pr-dtp__dayhdr">
            {DAYS_SHORT.map(d => <span key={d}>{d}</span>)}
          </div>
          <div className="pr-dtp__grid">
            {cells.map((d, i) => (
              <button key={i} disabled={!d}
                className={["pr-dtp__cell",
                  !d       ? "pr-dtp__cell--blank" : "",
                  isSel(d) ? "pr-dtp__cell--sel"   : "",
                  isToday(d) && !isSel(d) ? "pr-dtp__cell--today" : "",
                ].join(" ")}
                style={isSel(d) ? { background: color, borderColor: color } : {}}
                onClick={() => d && emit({ ...sel, year: view.year, month: view.month, day: d })}
              >{d || ""}</button>
            ))}
          </div>
        </div>
        <div className="pr-dtp__time">
          <div className="pr-dtp__time-title">TIME</div>
          <div className="pr-dtp__time-hint">24h IST</div>
          <div className="pr-dtp__spinrow">
            <SpinBox value={sel.hour}   min={0} max={23} onChange={h => emit({ ...sel, hour: h })}   color={color} />
            <span className="pr-dtp__colon">:</span>
            <SpinBox value={sel.minute} min={0} max={59} onChange={m => emit({ ...sel, minute: m })} color={color} />
          </div>
          <div className="pr-dtp__timedisp" style={{ color, borderColor: color + "50" }}>
            {String(sel.hour).padStart(2, "0")}:{String(sel.minute).padStart(2, "0")}
          </div>
          <div className="pr-dtp__datedisp">
            {String(sel.day).padStart(2, "0")} {MONTHS_SHORT[sel.month]} {sel.year}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Filter Drawer ────────────────────────────────────────────────────────────

function FilterDrawer({ open, onClose, dateRange, onApplyDate, onQuickSelect, activeLabel }) {
  const [tab, setTab]   = useState("quick");
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
      <div className={`pr-drawer-backdrop ${open ? "pr-drawer-backdrop--open" : ""}`} onClick={onClose} />
      <div className={`pr-filter-drawer ${open ? "pr-filter-drawer--open" : ""}`}>

        <div className="pr-fd-header">
          <div className="pr-fd-header__left">
            <span style={{ fontSize: 20 }}>🔍</span>
            <div>
              <div className="pr-fd-header__title">Date &amp; Time Filter</div>
              <div className="pr-fd-header__sub">All times shown in IST</div>
            </div>
          </div>
          <button className="pr-fd-close" onClick={onClose}>✕</button>
        </div>

        <div className="pr-fd-tabs">
          <button className={`pr-fd-tab ${tab === "quick"  ? "pr-fd-tab--active" : ""}`} onClick={() => setTab("quick")}>⚡ Quick</button>
          <button className={`pr-fd-tab ${tab === "custom" ? "pr-fd-tab--active" : ""}`} onClick={() => setTab("custom")}>🗓 Custom</button>
        </div>

        <div className="pr-fd-body">
          {tab === "quick" && (
            <div>
              <p className="pr-fd-section-label">Select preset range</p>
              <div className="pr-fd-quick-grid">
                {QUICK_RANGES.map(r => {
                  const isActive = activeLabel === r.label;
                  return (
                    <button key={r.label}
                      className={`pr-fd-preset ${isActive ? "pr-fd-preset--active" : ""}`}
                      onClick={() => { onQuickSelect(r.label, r.getRange()); onClose(); }}
                    >
                      <span style={{ fontSize: 15 }}>{r.icon}</span>
                      <span className="pr-fd-preset__label">{r.label}</span>
                      {isActive && <span style={{ color: "#60a5fa", fontSize: 11 }}>✓</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {tab === "custom" && (
            <div className="pr-fd-custom">
              <DateTimePicker label="Start" color="#3b82f6" value={start} onChange={setStart} />
              <div style={{ height: 1, background: "#1e2740", margin: "6px 0 10px" }} />
              <DateTimePicker label="End"   color="#f97316" value={end}   onChange={setEnd} />

              {diffMs > 0
                ? <div className="pr-fd-duration">⏱ Duration: <b>{hrs}h {mins}m</b></div>
                : start && end && <div className="pr-fd-duration pr-fd-duration--warn">⚠️ End must be after Start</div>
              }
              <button className="pr-fd-apply-btn"
                onClick={() => { if (diffMs > 0) { onApplyDate(start, end); onClose(); } }}>
                Apply Range
              </button>
            </div>
          )}
        </div>

        <div className="pr-fd-footer">
          <div className="pr-fd-footer__label">Currently showing</div>
          <div className="pr-fd-footer__range">
            {activeLabel
              ? <span className="pr-fd-footer__badge">{activeLabel}</span>
              : <span style={{ fontSize: 11 }}>{dateRange.start?.replace("T", " ")} → {dateRange.end?.replace("T", " ")} IST</span>
            }
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Filter chip ──────────────────────────────────────────────────────────────

function FilterChip({ label, value, onRemove }) {
  if (!value) return null;
  return (
    <span className="pr-chip">
      <span className="pr-chip__label">{label}:</span>
      <span className="pr-chip__val">{value}</span>
      <button className="pr-chip__x" onClick={onRemove}>✕</button>
    </span>
  );
}

// ─── WBN list modal ─────────────────────────────────────────────────────────

function WbnListModal({ wbns, onClose }) {
  return (
    <div className="ssr-modal-overlay" onClick={onClose}>
      <div className="ssr-modal" onClick={e => e.stopPropagation()}>
        <div className="ssr-modal-header">
          <span>Scanned Parcels ({wbns.length})</span>
          <button className="ssr-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="ssr-modal-list">
          {wbns.length === 0
            ? <div className="ssr-modal-empty">No parcels in this bag</div>
            : wbns.map((w, i) => <div className="ssr-modal-item" key={`${w}-${i}`}>{w}</div>)
          }
        </div>
      </div>
    </div>
  );
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_OPTIONS = [
  { value: "open",   label: "Open" },
  { value: "sealed", label: "Sealed" },
];

// ─── Main component ───────────────────────────────────────────────────────────

const SecondarySortingReport = () => {
  const toastRef = useRef(null);

  const [rows,    setRows   ] = useState([]);
  const [total,   setTotal  ] = useState(0);
  const [page,    setPage   ] = useState(1);
  const [limit,   setLimit  ] = useState(100);
  const [loading, setLoading] = useState(false);

  // Search & field filters
  const [searchInput,    setSearchInput   ] = useState("");
  const [usernameFilter, setUsernameFilter] = useState("");
  const [bayFilter,      setBayFilter     ] = useState("");
  const [statusFilter,   setStatusFilter  ] = useState("");

  const [appliedSearch, setAppliedSearch] = useState("");

  // Date range (filters on created_at)
  const [dateRange,   setDateRange  ] = useState({ start: null, end: null });
  const [activeLabel, setActiveLabel] = useState(null);
  const [drawerOpen,  setDrawerOpen ] = useState(false);

  // WBN list modal
  const [modalWbns, setModalWbns] = useState(null);

  const debounceRef = useRef(null);
  const [searchTrigger, setSearchTrigger] = useState(0);

  // ── Fetch ────────────────────────────────────────────────────────────────
  const fetchData = useCallback(async (overrides = {}) => {
    setLoading(true);
    try {
      const p = {
        page,
        limit,
        username: usernameFilter,
        bay_id: bayFilter,
        status: statusFilter,
        ...overrides,
      };

      const searchVal = overrides.search !== undefined ? overrides.search : appliedSearch;
      if (searchVal) {
        p.search = searchVal;
        delete p.startTime;
        delete p.endTime;
      } else if (dateRange.start && dateRange.end) {
        p.startTime = istLocalToUTC(dateRange.start);
        p.endTime   = istLocalToUTC(dateRange.end);
      }

      Object.keys(p).forEach(k => {
        if (p[k] === "" || p[k] == null) delete p[k];
      });

      const res = await axios.get(`${API}/secondary-sorting-sessions`, { params: p });

      // Defensive: guard against an unregistered route silently
      // returning HTML (SPA fallback) instead of JSON.
      if (!res.data || typeof res.data.total !== "number" || !Array.isArray(res.data.rows)) {
        throw new Error("Unexpected response from /secondary-sorting-sessions — is the route registered?");
      }

      setRows(res.data.rows);
      setTotal(res.data.total);
    } catch (err) {
      toastRef.current?.show({
        severity: "error", summary: "Error",
        detail: err.response?.data?.message || err.message, life: 3000,
      });
    } finally {
      setLoading(false);
    }
  }, [page, limit, appliedSearch, dateRange, searchTrigger, usernameFilter, bayFilter, statusFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Debounced search (virtualbagseal / originalbagseal / exact wbn) ──────
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (searchInput.length >= 2) {
      debounceRef.current = setTimeout(() => {
        setAppliedSearch(searchInput);
        setPage(1);
        setDateRange({ start: null, end: null });
        setActiveLabel(null);
      }, 500);
    } else if (searchInput.length === 0 && appliedSearch) {
      setAppliedSearch("");
      setDateRange({ start: null, end: null });
      setActiveLabel(null);
      setPage(1);
    }
    return () => clearTimeout(debounceRef.current);
  }, [searchInput]);

  // ── Date handlers ─────────────────────────────────────────────────────────
  const handleApplyDate = (start, end) => {
    setDateRange({ start, end });
    setActiveLabel(null);
    setSearchInput("");
    setAppliedSearch("");
    setPage(1);
  };

  const handleQuickSelect = (label, { start, end }) => {
    setDateRange({ start, end });
    setActiveLabel(label);
    setSearchInput("");
    setAppliedSearch("");
    setPage(1);
  };

  const handleReset = () => {
    setSearchInput("");
    setAppliedSearch("");
    setUsernameFilter("");
    setBayFilter("");
    setStatusFilter("");
    setDateRange({ start: null, end: null });
    setActiveLabel(null);
    setPage(1);
  };

  // ── Export ────────────────────────────────────────────────────────────────
  const exportData = () => {
    const params = new URLSearchParams();
    if (appliedSearch) {
      params.append("search", appliedSearch);
    } else if (dateRange.start && dateRange.end) {
      params.append("startTime", istLocalToUTC(dateRange.start));
      params.append("endTime",   istLocalToUTC(dateRange.end));
    }
    if (usernameFilter) params.append("username", usernameFilter);
    if (bayFilter)      params.append("bay_id", bayFilter);
    if (statusFilter)   params.append("status", statusFilter);
    window.open(`${API}/secondary-sorting-sessions/export?${params.toString()}`, "_blank");
  };

  // ── Active chips ──────────────────────────────────────────────────────────
  const chips = [
    searchInput     && { key: "search",   label: "Search",   value: `"${searchInput}"`, clear: () => setSearchInput("") },
    usernameFilter  && { key: "username", label: "Operator", value: usernameFilter, clear: () => { setUsernameFilter(""); setPage(1); } },
    bayFilter       && { key: "bay",      label: "Bay ID",   value: bayFilter,      clear: () => { setBayFilter(""); setPage(1); } },
    statusFilter    && { key: "status",   label: "Status",   value: statusFilter === "open" ? "Open" : "Sealed", clear: () => { setStatusFilter(""); setPage(1); } },
    !searchInput && (activeLabel || dateRange.start) && {
      key: "date", label: "Range",
      value: activeLabel || `${dateRange.start?.replace("T"," ")} → ${dateRange.end?.replace("T"," ")}`,
      clear: handleReset,
    },
  ].filter(Boolean);

  // ── Column templates ──────────────────────────────────────────────────────
  const statusBadge = (r) => {
    const sealed = !!r.sealed_at;
    return <span className={`pr-badge ${sealed ? "pr-badge-sorted" : "pr-badge-semi"}`}>{sealed ? "SEALED" : "OPEN"}</span>;
  };

  const badgeText = activeLabel || (dateRange.start ? `${dateRange.start.replace("T"," ")} → ${dateRange.end?.replace("T"," ")}` : null);

  return (
    <div className="pr-root">
      <Toast ref={toastRef} />

      <div className="pr-card">

        {/* ── Header ── */}
        <div className="pr-page-header">
          <div className="pr-page-header__left">
            <h2 className="pr-page-title">Secondary Sorting Report</h2>
            {!searchInput && badgeText && <span className="pr-range-badge">{badgeText}</span>}
            {searchInput && <span className="pr-range-badge pr-range-badge--search">🔍 "{searchInput}"</span>}
          </div>
          <span className="pr-total-count">{total.toLocaleString()} records</span>
        </div>

        {/* ── Filter card ── */}
        <div className="pr-filter-card">

          <div className="pr-filter-row">

            <div className="pr-field-group">
              <label className="pr-field-label">Start Date &amp; Time</label>
              <button className="pr-field-input pr-field-input--btn" onClick={() => setDrawerOpen(true)}>
                {dateRange.start
                  ? <span style={{color:"#e2e8f0"}}>{dateRange.start.replace("T"," ")}</span>
                  : <span style={{color:"#475569"}}>Select start…</span>
                }
                <span className="pr-field-input__icon">📅</span>
              </button>
            </div>

            <div className="pr-field-group">
              <label className="pr-field-label">End Date &amp; Time</label>
              <button className="pr-field-input pr-field-input--btn" onClick={() => setDrawerOpen(true)}>
                {dateRange.end
                  ? <span style={{color:"#e2e8f0"}}>{dateRange.end.replace("T"," ")}</span>
                  : <span style={{color:"#475569"}}>Select end…</span>
                }
                <span className="pr-field-input__icon">📅</span>
              </button>
            </div>

            <div className="pr-field-group">
              <label className="pr-field-label">Search (Seal / WBN)</label>
              <div className="pr-field-input-wrap">
                <input
                  className="pr-field-input"
                  value={searchInput}
                  onChange={e => setSearchInput(e.target.value)}
                  placeholder="Bag seal or exact WBN…"
                />
                {searchInput && <button className="pr-field-clear" onClick={() => setSearchInput("")}>✕</button>}
              </div>
            </div>

            <div className="pr-field-group">
              <label className="pr-field-label">Operator</label>
              <div className="pr-field-input-wrap">
                <input
                  className="pr-field-input"
                  value={usernameFilter}
                  onChange={e => { setUsernameFilter(e.target.value); setPage(1); }}
                  placeholder="Filter by username…"
                />
                {usernameFilter && <button className="pr-field-clear" onClick={() => { setUsernameFilter(""); setPage(1); }}>✕</button>}
              </div>
            </div>

            <div className="pr-field-group">
              <label className="pr-field-label">Bay ID</label>
              <div className="pr-field-input-wrap">
                <input
                  className="pr-field-input"
                  value={bayFilter}
                  onChange={e => { setBayFilter(e.target.value); setPage(1); }}
                  placeholder="e.g. 27"
                />
                {bayFilter && <button className="pr-field-clear" onClick={() => { setBayFilter(""); setPage(1); }}>✕</button>}
              </div>
            </div>

            <div className="pr-field-group">
              <label className="pr-field-label">Status</label>
              <select className="pr-field-input pr-field-select"
                value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}>
                <option value="">All</option>
                {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

          </div>

          {/* Action row */}
          <div className="pr-filter-actions">
            <button className="pr-action-btn pr-action-btn--export" onClick={exportData}>
              ⬇ Export CSV
            </button>
            <button
              className={`pr-action-btn pr-action-btn--date ${drawerOpen ? "pr-action-btn--date-active" : ""}`}
              onClick={() => setDrawerOpen(true)}
              title="Date & Time Filter"
            >
              📅 Date Filter
            </button>
            <button className="pr-action-btn pr-action-btn--reset" onClick={handleReset}>
              ↺ Reset
            </button>
            <button className="pr-action-btn pr-action-btn--search"
              onClick={() => {
                if (searchInput.length >= 2) {
                  setAppliedSearch(searchInput);
                  setDateRange({ start: null, end: null });
                  setActiveLabel(null);
                  setPage(1);
                  setSearchTrigger(t => t + 1);
                } else if (searchInput.length === 0) {
                  setAppliedSearch("");
                  setPage(1);
                  setSearchTrigger(t => t + 1);
                }
              }}>
              🔍 Search
            </button>
          </div>
        </div>

        {/* ── Active chips ── */}
        {chips.length > 0 && (
          <div className="pr-chips">
            {chips.map(c => <FilterChip key={c.key} label={c.label} value={c.value} onRemove={c.clear} />)}
            <button className="pr-chip-clear-all" onClick={handleReset}>Clear all</button>
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
          className="pr-table"
          emptyMessage="No secondary sorting sessions found for the selected filters."
          tableStyle={{ minWidth: "1250px" }}
        >
          <Column
            header="S.No"
            style={{ minWidth: 60, textAlign: "center" }}
            body={(_, opts) => (page - 1) * limit + opts.rowIndex + 1}
          />
          <Column field="username" header="Operator" style={{ minWidth: 130 }} />
          <Column
            header="Bay ID"
            body={r => r.bay_id ? <span className="pr-bag-tag">{r.bay_id}</span> : <span className="pr-cell-muted">—</span>}
            style={{ minWidth: 80 }}
          />
          <Column header="Status" body={statusBadge} style={{ minWidth: 100 }} />
          <Column field="virtualbagseal" header="Virtual Bag Seal" style={{ minWidth: 200 }} />
          <Column
            header="Original Bag Seal"
            body={r => r.originalbagseal || <span className="pr-cell-muted">—</span>}
            style={{ minWidth: 160 }}
          />
          <Column
            header="Parcels"
            body={r => (
              <button className="ssr-view-btn" onClick={() => setModalWbns(r.wbns || [])}>
                {r.count} — View
              </button>
            )}
            style={{ minWidth: 110 }}
          />
          <Column header="First Scan (IST)" body={r => fmtIST(r.firstscan)} style={{ minWidth: 170 }} />
          <Column header="Sealed At (IST)"  body={r => fmtIST(r.sealed_at)} style={{ minWidth: 170 }} />
          <Column header="Created (IST)"    body={r => fmtIST(r.created_at)} style={{ minWidth: 170 }} />
        </DataTable>

      </div>

      {/* ── Date Filter Drawer ── */}
      <FilterDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        dateRange={dateRange}
        onApplyDate={handleApplyDate}
        onQuickSelect={handleQuickSelect}
        activeLabel={activeLabel}
      />

      {/* ── WBN List Modal ── */}
      {modalWbns && (
        <WbnListModal wbns={modalWbns} onClose={() => setModalWbns(null)} />
      )}
    </div>
  );
};

export default SecondarySortingReport;