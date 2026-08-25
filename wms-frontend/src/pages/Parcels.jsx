import React, { useEffect, useState, useRef, useCallback } from "react";
import axios from "axios";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Toast } from "primereact/toast";
import "../styles/Parcels.css";

const API = "http://localhost:5001/api";
const PAGE_SIZE = 100;

// IST helpers
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

const QUICK_RANGES = [
  { label: "Last 24 Hours", icon: "🕐", getRange: () => ({ start: subtractHoursFromNow(24), end: nowIST() }) },
  { label: "Last 48 Hours", icon: "🕑", getRange: () => ({ start: subtractHoursFromNow(48), end: nowIST() }) },
  { label: "Last 72 Hours", icon: "🕒", getRange: () => ({ start: subtractHoursFromNow(72), end: nowIST() }) },
  { label: "Today",         icon: "📅", getRange: () => ({ start: todayMidnightIST(), end: todayEndIST() }) },
  { label: "Yesterday",     icon: "📆", getRange: () => yesterdayRangeIST() },
  { label: "Last 2 Days",   icon: "🗓", getRange: () => ({ start: subtractHoursFromNow(48), end: todayEndIST() }) },
  { label: "Last 3 Days",   icon: "📋", getRange: () => ({ start: subtractHoursFromNow(72), end: todayEndIST() }) },
];

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
                      {isActive && <span className="pr-fd-preset__check">✓</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {tab === "custom" && (
            <div className="pr-fd-custom">
              <DateTimePicker label="Start" color="#D71920" value={start} onChange={setStart} />
              <div className="pr-fd-divider" />
              <DateTimePicker label="End"   color="#1F2937" value={end}   onChange={setEnd} />

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

const MODE_OPTIONS   = ["auto", "semi", "hhd"];
const SORT_OPTIONS   = ["INDUCTED", "SORTED", "REJECTED"];
const REASON_OPTIONS = ["dbo", "nle", "dnf", "ibo", "hv", "ndim", "ndim_ud", "ndim_od", "unx", "rej", "ar", "mse", "nsz", "lmm", "api_fail", "chute_full"];
const INFEED_OPTIONS = ["01", "02"];

const Parcels = () => {
  const toastRef = useRef(null);

  const [rows,    setRows   ] = useState([]);
  const [total,   setTotal  ] = useState(0);
  const [page,    setPage   ] = useState(1);
  const [loading, setLoading] = useState(false);

  const [wbnInput,     setWbnInput    ] = useState("");
  const [modeFilter,   setModeFilter  ] = useState("");
  const [sortFilter,   setSortFilter  ] = useState("");
  const [reasonFilter, setReasonFilter] = useState("");
  const [infeedFilter, setInfeedFilter] = useState("");
  const [ptlFilter,    setPtlFilter   ] = useState("");
  const [bayFilter,    setBayFilter   ] = useState("");

  const [appliedSearch, setAppliedSearch] = useState("");

  const [dateRange,   setDateRange  ] = useState({ start: null, end: null });
  const [activeLabel, setActiveLabel] = useState(null);
  const [drawerOpen,  setDrawerOpen ] = useState(false);

  const [imgSrc, setImgSrc] = useState(null);

  const debounceRef = useRef(null);
  const [searchTrigger, setSearchTrigger] = useState(0);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const p = {
        page,
        limit: PAGE_SIZE,
        mode: modeFilter,
        sort: sortFilter,
        reason: reasonFilter,
        infeed: infeedFilter,
        ptl_id: ptlFilter,
        bay_id: bayFilter,
      };

      if (appliedSearch) {
        p.search = appliedSearch;
      } else if (dateRange.start && dateRange.end) {
        p.startTime = istLocalToUTC(dateRange.start);
        p.endTime   = istLocalToUTC(dateRange.end);
      }

      Object.keys(p).forEach(k => {
        if (p[k] === "" || p[k] == null) delete p[k];
      });

      const res = await axios.get(`${API}/parcels`, { params: p });

      if (!res.data || typeof res.data.total !== "number" || !Array.isArray(res.data.rows)) {
        throw new Error("Unexpected response from /parcels");
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
  }, [page, appliedSearch, dateRange, searchTrigger, modeFilter, sortFilter, reasonFilter, infeedFilter, ptlFilter, bayFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (wbnInput.length >= 2) {
      debounceRef.current = setTimeout(() => {
        setAppliedSearch(wbnInput);
        setPage(1);
        setDateRange({ start: null, end: null });
        setActiveLabel(null);
      }, 500);
    } else if (wbnInput.length === 0 && appliedSearch) {
      setAppliedSearch("");
      setPage(1);
    }
    return () => clearTimeout(debounceRef.current);
  }, [wbnInput]);

  const handleApplyDate = (start, end) => {
    setDateRange({ start, end });
    setActiveLabel(null);
    setWbnInput("");
    setAppliedSearch("");
    setPage(1);
  };

  const handleQuickSelect = (label, { start, end }) => {
    setDateRange({ start, end });
    setActiveLabel(label);
    setWbnInput("");
    setAppliedSearch("");
    setPage(1);
  };

  const handleReset = () => {
    setWbnInput("");
    setAppliedSearch("");
    setModeFilter("");
    setSortFilter("");
    setReasonFilter("");
    setInfeedFilter("");
    setPtlFilter("");
    setBayFilter("");
    setDateRange({ start: null, end: null });
    setActiveLabel(null);
    setPage(1);
  };

  const withPageReset = (setter) => (value) => {
    setter(value);
    setPage(1);
  };

  const exportData = () => {
    const params = new URLSearchParams();
    if (appliedSearch) {
      params.append("search", appliedSearch);
    } else if (dateRange.start && dateRange.end) {
      params.append("startTime", istLocalToUTC(dateRange.start));
      params.append("endTime",   istLocalToUTC(dateRange.end));
    }
    if (modeFilter)   params.append("mode", modeFilter);
    if (sortFilter)   params.append("sort", sortFilter);
    if (reasonFilter) params.append("reason", reasonFilter);
    if (infeedFilter) params.append("infeed", infeedFilter);
    if (ptlFilter)    params.append("ptl_id", ptlFilter);
    if (bayFilter)    params.append("bay_id", bayFilter);
    window.open(`${API}/parcels/export?${params.toString()}`, "_blank");
  };

  const chips = [
    wbnInput      && { key: "wbn",    label: "WBN",    value: `"${wbnInput}"`,    clear: () => setWbnInput("") },
    modeFilter    && { key: "mode",   label: "Mode",   value: modeFilter,         clear: () => withPageReset(setModeFilter)("") },
    sortFilter    && { key: "sort",   label: "Status", value: sortFilter,         clear: () => withPageReset(setSortFilter)("") },
    reasonFilter  && { key: "reason", label: "Reason", value: reasonFilter.toUpperCase(), clear: () => withPageReset(setReasonFilter)("") },
    infeedFilter  && { key: "infeed", label: "Infeed", value: infeedFilter,       clear: () => withPageReset(setInfeedFilter)("") },
    ptlFilter     && { key: "ptl",    label: "PTL ID", value: ptlFilter,          clear: () => withPageReset(setPtlFilter)("") },
    bayFilter     && { key: "bay",    label: "Bay ID", value: bayFilter,          clear: () => withPageReset(setBayFilter)("") },
    !wbnInput && (activeLabel || dateRange.start) && {
      key: "date", label: "Range",
      value: activeLabel || `${dateRange.start?.replace("T"," ")} → ${dateRange.end?.replace("T"," ")}`,
      clear: handleReset,
    },
  ].filter(Boolean);

  const sortBadge = (r) => {
    const s = r.sort || "—";
    const cls = s === "SORTED" ? "pr-badge-sorted" : s === "REJECTED" ? "pr-badge-rej" : s === "INDUCTED" ? "pr-badge-inducted" : "";
    return <span className={`pr-badge ${cls}`}>{s}</span>;
  };
  const modeBadge = (r) => {
    const m = (r.mode || "").toLowerCase();
    return <span className={`pr-badge ${m === "auto" ? "pr-badge-auto" : m === "semi" ? "pr-badge-semi" : m === "hhd" ? "pr-badge-hhd" : ""}`}>{r.mode || "—"}</span>;
  };
  const infeedBadge = (r) => {
    if (!r.infeed) return <span className="pr-cell-muted">—</span>;
    return <span className="pr-badge">{r.infeed}</span>;
  };
  const scannedWbnCell = (r) => {
    if (!r.scanned_wbn) return <span className="pr-cell-muted">—</span>;
    const differs = r.wbn && r.wbn !== r.scanned_wbn;
    return <span className={differs ? "pr-cell-muted" : ""}>{r.scanned_wbn}</span>;
  };
  const imageBtn = (r) => {
    if (!r.imagepath || r.imagepath === "image_missing") return <span className="pr-cell-muted">—</span>;
    return (
      <button className="pr-img-btn"
        onClick={() => setImgSrc(`http://localhost:5001${r.imagepath}`)}>
        🖼
      </button>
    );
  };

  const badgeText = activeLabel || (dateRange.start ? `${dateRange.start.replace("T"," ")} → ${dateRange.end?.replace("T"," ")}` : null);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="pr-root">
      <Toast ref={toastRef} />

      <div className="pr-card">

        <div className="pr-page-header">
          <div className="pr-page-header__left">
            <h2 className="pr-page-title">Parcels Report</h2>
            {!wbnInput && badgeText && <span className="pr-range-badge">{badgeText}</span>}
            {wbnInput && <span className="pr-range-badge pr-range-badge--search">🔍 "{wbnInput}"</span>}
          </div>
          <span className="pr-total-count">{total.toLocaleString()} records</span>
        </div>

        <div className="pr-filter-card">

          <div className="pr-filter-row">

            <div className="pr-field-group">
              <label className="pr-field-label">WBN Number</label>
              <div className="pr-field-input-wrap">
                <input
                  className="pr-field-input"
                  value={wbnInput}
                  onChange={e => setWbnInput(e.target.value)}
                  placeholder="Enter WBN Number here…"
                />
                {wbnInput && <button className="pr-field-clear" onClick={() => setWbnInput("")}>✕</button>}
              </div>
            </div>

            <div className="pr-field-group">
              <label className="pr-field-label">Package Status</label>
              <select className="pr-field-input pr-field-select"
                value={sortFilter} onChange={e => withPageReset(setSortFilter)(e.target.value)}>
                <option value="">All</option>
                {SORT_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>

            <div className="pr-field-group">
              <label className="pr-field-label">Scanning Mode</label>
              <select className="pr-field-input pr-field-select"
                value={modeFilter} onChange={e => withPageReset(setModeFilter)(e.target.value)}>
                <option value="">All</option>
                {MODE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>

            <div className="pr-field-group">
              <label className="pr-field-label">Reason Code</label>
              <select className="pr-field-input pr-field-select"
                value={reasonFilter} onChange={e => withPageReset(setReasonFilter)(e.target.value)}>
                <option value="">All</option>
                {REASON_OPTIONS.map(o => <option key={o} value={o}>{o.toUpperCase()}</option>)}
              </select>
            </div>

            <div className="pr-field-group">
              <label className="pr-field-label">Infeed</label>
              <select className="pr-field-input pr-field-select"
                value={infeedFilter} onChange={e => withPageReset(setInfeedFilter)(e.target.value)}>
                <option value="">All</option>
                {INFEED_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>

            <div className="pr-field-group">
              <label className="pr-field-label">PTL ID</label>
              <div className="pr-field-input-wrap">
                <input
                  className="pr-field-input"
                  value={ptlFilter}
                  onChange={e => withPageReset(setPtlFilter)(e.target.value)}
                  placeholder="Filter by PTL ID…"
                />
                {ptlFilter && <button className="pr-field-clear" onClick={() => withPageReset(setPtlFilter)("")}>✕</button>}
              </div>
            </div>

            <div className="pr-field-group">
              <label className="pr-field-label">Bay ID</label>
              <div className="pr-field-input-wrap">
                <input
                  className="pr-field-input"
                  value={bayFilter}
                  onChange={e => withPageReset(setBayFilter)(e.target.value)}
                  placeholder="Filter by Bay ID…"
                />
                {bayFilter && <button className="pr-field-clear" onClick={() => withPageReset(setBayFilter)("")}>✕</button>}
              </div>
            </div>

          </div>

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
                if (wbnInput.length >= 2) {
                  setAppliedSearch(wbnInput);
                  setDateRange({ start: null, end: null });
                  setActiveLabel(null);
                  setPage(1);
                } else {
                  setPage(1);
                  setSearchTrigger(t => t + 1);
                }
              }}>
              🔍 Search
            </button>
          </div>
        </div>

        {chips.length > 0 && (
          <div className="pr-chips">
            {chips.map(c => <FilterChip key={c.key} label={c.label} value={c.value} onRemove={c.clear} />)}
            <button className="pr-chip-clear-all" onClick={handleReset}>Clear all</button>
          </div>
        )}

        <DataTable
          value={rows}
          loading={loading}
          className="pr-table"
          emptyMessage="No parcels found for the selected filters."
          scrollable
          scrollHeight="55vh"
          resizableColumns
          columnResizeMode="expand"
          tableStyle={{ minWidth: "1800px" }}
        >
          <Column
            header="S.No"
            style={{ minWidth: 60, textAlign: "center" }}
            body={(_, opts) => (page - 1) * PAGE_SIZE + opts.rowIndex + 1}
          />
          <Column field="wbn"      header="WBN"          style={{ minWidth: 160 }} />
          <Column header="Scanned WBN" body={scannedWbnCell} style={{ minWidth: 160 }} />
          <Column header="Infeed"  body={infeedBadge}    style={{ minWidth: 70  }} />
          <Column header="Mode"    body={modeBadge}      style={{ minWidth: 80  }} />
          <Column header="Status"  body={sortBadge}      style={{ minWidth: 95  }} />
          <Column header="Reason"  body={r => r.reason ? <span className="pr-reason-tag">{r.reason.toUpperCase()}</span> : <span className="pr-cell-muted">—</span>} style={{ minWidth: 80 }} />
          <Column
            header="Expected Bag"
            body={r => r.expected_bag
              ? <span className="pr-bag-tag">{r.expected_bag}</span>
              : <span className="pr-cell-muted">—</span>}
            style={{ minWidth: 120 }}
          />
          <Column
            header="Final Bag"
            body={r => r.final_bag
              ? <span className="pr-bag-tag pr-bag-tag--final">{r.final_bag}</span>
              : <span className="pr-cell-muted">—</span>}
            style={{ minWidth: 100 }}
          />
          <Column
            header="PTL ID"
            body={r => r.ptl_id
              ? <span className="pr-bag-tag">{r.ptl_id}</span>
              : <span className="pr-cell-muted">—</span>}
            style={{ minWidth: 90 }}
          />
          <Column
            header="Bay ID"
            body={r => r.bay_id
              ? <span className="pr-bag-tag">{r.bay_id}</span>
              : <span className="pr-cell-muted">—</span>}
            style={{ minWidth: 80 }}
          />
          <Column header="Wt (g)"  body={r => r.weight    || "—"} style={{ minWidth: 80 }} />
          <Column header="L"       body={r => r.length    || "—"} style={{ minWidth: 55 }} />
          <Column header="W"       body={r => r.width     || "—"} style={{ minWidth: 55 }} />
          <Column header="H"       body={r => r.height    || "—"} style={{ minWidth: 55 }} />
          <Column header="Volume"  body={r => r.volume    || "—"} style={{ minWidth: 80 }} />
          <Column header="Real Vol" body={r => r.real_volume || "—"} style={{ minWidth: 80 }} />
          <Column header="Scan Time"     body={r => fmtIST(r.scantime)}   style={{ minWidth: 155 }} />
          <Column header="Sort Time"     body={r => fmtIST(r.sorttime)}   style={{ minWidth: 155 }} />
          <Column header="Secondary Scan" body={r => fmtIST(r.secondary_scantime)} style={{ minWidth: 155 }} />
          <Column header="Created (IST)" body={r => fmtIST(r.created_at)} style={{ minWidth: 155 }} />
          <Column header="Image"   body={imageBtn}       style={{ minWidth: 65, textAlign: "center" }} />
        </DataTable>

        <div className="pr-pagination">
          <span className="pr-pagination__label">displaying page</span>
          <button className="pr-page-btn" disabled={page === 1} onClick={() => setPage(1)}>First</button>
          <button className="pr-page-btn pr-page-btn--arrow" disabled={page === 1} onClick={() => setPage(p => Math.max(1, p - 1))}>‹</button>

          {buildPageList(page, totalPages).map((p, i) =>
            p === "…"
              ? <span key={`e${i}`} className="pr-page-ellipsis">…</span>
              : <button
                  key={p}
                  className={`pr-page-btn ${p === page ? "pr-page-btn--active" : ""}`}
                  onClick={() => setPage(p)}
                >
                  {p}
                </button>
          )}

          <button className="pr-page-btn pr-page-btn--arrow" disabled={page === totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>›</button>
          <button className="pr-page-btn" disabled={page === totalPages} onClick={() => setPage(totalPages)}>Last</button>
        </div>

      </div>

      <FilterDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        dateRange={dateRange}
        onApplyDate={handleApplyDate}
        onQuickSelect={handleQuickSelect}
        activeLabel={activeLabel}
      />

      {imgSrc && (
        <div className="pr-img-overlay" onClick={() => setImgSrc(null)}>
          <div className="pr-img-modal" onClick={e => e.stopPropagation()}>
            <div className="pr-img-modal__header">
              <span>Parcel Image</span>
              <button onClick={() => setImgSrc(null)}>✕</button>
            </div>
            <img src={imgSrc} alt="parcel" className="pr-img-modal__img" />
          </div>
        </div>
      )}

    </div>
  );
};

function buildPageList(current, total) {
  const windowSize = 2;
  const pages = new Set([1, total, current]);
  for (let i = 1; i <= windowSize; i++) {
    if (current - i >= 1) pages.add(current - i);
    if (current + i <= total) pages.add(current + i);
  }
  const sorted = Array.from(pages).sort((a, b) => a - b);

  const result = [];
  let prev = null;
  for (const p of sorted) {
    if (prev !== null && p - prev > 1) result.push("…");
    result.push(p);
    prev = p;
  }
  return result;
}

export default Parcels;