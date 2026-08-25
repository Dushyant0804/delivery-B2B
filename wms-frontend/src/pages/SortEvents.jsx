import React, { useState, useEffect, useRef, useCallback } from "react";
import axios from "axios";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Toast } from "primereact/toast";
import "../styles/SortEvents.css";

const API = "http://localhost:5001/sort-events";

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

// ─── Quick Ranges ─────────────────────────────────────────────────────────────

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
    <div className="se-spb" style={{ width }} tabIndex={0}
      onKeyDown={e => {
        if (e.key === "ArrowUp")   { e.preventDefault(); inc(); }
        if (e.key === "ArrowDown") { e.preventDefault(); dec(); }
      }}>
      <button className="se-spb__arrow" onClick={inc} tabIndex={-1}>▲</button>
      <div className="se-spb__val" style={{ color, borderColor: color + "80" }}>{p(value)}</div>
      <button className="se-spb__arrow" onClick={dec} tabIndex={-1}>▼</button>
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
    <div className="se-dtp">
      <div className="se-dtp__label" style={{ color }}>
        <span className="se-dtp__dot" style={{ background: color }} />
        {label}
      </div>
      <div className="se-dtp__body">
        <div className="se-dtp__cal">
          <div className="se-dtp__nav">
            <button className="se-dtp__navbtn" onClick={prevM}>‹</button>
            <span className="se-dtp__navtitle">{MONTHS_SHORT[view.month]} {view.year}</span>
            <button className="se-dtp__navbtn" onClick={nextM}>›</button>
          </div>
          <div className="se-dtp__dayhdr">
            {DAYS_SHORT.map(d => <span key={d}>{d}</span>)}
          </div>
          <div className="se-dtp__grid">
            {cells.map((d, i) => (
              <button key={i} disabled={!d}
                className={["se-dtp__cell",
                  !d       ? "se-dtp__cell--blank" : "",
                  isSel(d) ? "se-dtp__cell--sel"   : "",
                  isToday(d) && !isSel(d) ? "se-dtp__cell--today" : "",
                ].join(" ")}
                style={isSel(d) ? { background: color, borderColor: color } : {}}
                onClick={() => d && emit({ ...sel, year: view.year, month: view.month, day: d })}
              >{d || ""}</button>
            ))}
          </div>
        </div>
        <div className="se-dtp__time">
          <div className="se-dtp__time-title">TIME</div>
          <div className="se-dtp__time-hint">24h IST</div>
          <div className="se-dtp__spinrow">
            <SpinBox value={sel.hour}   min={0} max={23} onChange={h => emit({ ...sel, hour: h })}   color={color} />
            <span className="se-dtp__colon">:</span>
            <SpinBox value={sel.minute} min={0} max={59} onChange={m => emit({ ...sel, minute: m })} color={color} />
          </div>
          <div className="se-dtp__timedisp" style={{ color, borderColor: color + "50" }}>
            {String(sel.hour).padStart(2, "0")}:{String(sel.minute).padStart(2, "0")}
          </div>
          <div className="se-dtp__datedisp">
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
      <div className={`se-drawer-backdrop ${open ? "se-drawer-backdrop--open" : ""}`} onClick={onClose} />
      <div className={`se-filter-drawer ${open ? "se-filter-drawer--open" : ""}`}>

        <div className="se-fd-header">
          <div className="se-fd-header__left">
            <span style={{ fontSize: 20 }}>🔍</span>
            <div>
              <div className="se-fd-header__title">Date &amp; Time Filter</div>
              <div className="se-fd-header__sub">All times in IST</div>
            </div>
          </div>
          <button className="se-fd-close" onClick={onClose}>✕</button>
        </div>

        <div className="se-fd-tabs">
          <button className={`se-fd-tab ${tab === "quick"  ? "se-fd-tab--active" : ""}`} onClick={() => setTab("quick")}>⚡ Quick</button>
          <button className={`se-fd-tab ${tab === "custom" ? "se-fd-tab--active" : ""}`} onClick={() => setTab("custom")}>🗓 Custom</button>
        </div>

        <div className="se-fd-body">
          {tab === "quick" && (
            <div>
              <p className="se-fd-section-label">Select preset range</p>
              <div className="se-fd-quick-grid">
                {QUICK_RANGES.map(r => {
                  const isActive = activeLabel === r.label;
                  return (
                    <button key={r.label}
                      className={`se-fd-preset ${isActive ? "se-fd-preset--active" : ""}`}
                      onClick={() => { onQuickSelect(r.label, r.getRange()); onClose(); }}
                    >
                      <span style={{ fontSize: 15 }}>{r.icon}</span>
                      <span className="se-fd-preset__label">{r.label}</span>
                      {isActive && <span style={{ color: "#60a5fa", fontSize: 11 }}>✓</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {tab === "custom" && (
            <div className="se-fd-custom">
              <DateTimePicker label="Start" color="#3b82f6" value={start} onChange={setStart} />
              <div style={{ height: 1, background: "#1e2740", margin: "6px 0 10px" }} />
              <DateTimePicker label="End"   color="#f97316" value={end}   onChange={setEnd} />
              {diffMs > 0
                ? <div className="se-fd-duration">⏱ Duration: <b>{hrs}h {mins}m</b></div>
                : start && end && <div className="se-fd-duration se-fd-duration--warn">⚠️ End must be after Start</div>
              }
              <button className="se-fd-apply-btn"
                onClick={() => { if (diffMs > 0) { onApplyDate(start, end); onClose(); } }}>
                Apply Range
              </button>
            </div>
          )}
        </div>

        <div className="se-fd-footer">
          <div className="se-fd-footer__label">Currently showing</div>
          <div className="se-fd-footer__range">
            {activeLabel
              ? <span className="se-fd-footer__badge">{activeLabel}</span>
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
    <span className="se-chip">
      <span className="se-chip__label">{label}:</span>
      <span className="se-chip__val">{value}</span>
      <button className="se-chip__x" onClick={onRemove}>✕</button>
    </span>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

const SortEvents = () => {
  const toastRef = useRef(null);

  const [events,  setEvents ] = useState([]);
  const [total,   setTotal  ] = useState(0);
  const [loading, setLoading] = useState(false);

  const [page,  setPage ] = useState(1);
  const [limit, setLimit] = useState(100);

  // Filters
  const [wbnInput,      setWbnInput     ] = useState("");
  const [appliedWbn,    setAppliedWbn   ] = useState("");
  const [eventTypeFilter, setEventTypeFilter] = useState("");

  const [dateRange,     setDateRange    ] = useState({ start: null, end: null });
  const [activeLabel,   setActiveLabel  ] = useState(null);
  const [drawerOpen,    setDrawerOpen   ] = useState(false);
  const [searchTrigger, setSearchTrigger] = useState(0);

  // Details modal
  const [modalOpen,    setModalOpen   ] = useState(false);
  const [modalContent, setModalContent] = useState(null);
  const [modalTitle,   setModalTitle  ] = useState("Event Details");

  const debounceRef = useRef(null);

  // ── Fetch ────────────────────────────────────────────────────────────────
  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const p = { page, limit };

      if (appliedWbn) {
        p.wbn = appliedWbn.trim();
      }
      if (dateRange.start && dateRange.end) {
        p.start = istLocalToUTC(dateRange.start);
        p.end   = istLocalToUTC(dateRange.end);
      }

      Object.keys(p).forEach(k => { if (!p[k] && p[k] !== 0) delete p[k]; });

      const res = await axios.get(API, { params: p });

      if (res.data.success) {
        setEvents(res.data.rows || []);
        setTotal(res.data.total || 0);
      } else {
        setEvents(res.data.rows || []);
        setTotal(res.data.total || 0);
      }
    } catch (err) {
      toastRef.current?.show({
        severity: "error", summary: "Error",
        detail: err.response?.data?.message || "Failed to load sort events",
        life: 3000,
      });
    } finally {
      setLoading(false);
    }
  }, [page, limit, appliedWbn, dateRange, searchTrigger]);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  // ── Debounced WBN search ─────────────────────────────────────────────────
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (wbnInput.length >= 2) {
      debounceRef.current = setTimeout(() => {
        setAppliedWbn(wbnInput);
        setPage(1);
      }, 500);
    } else if (wbnInput.length === 0 && appliedWbn) {
      setAppliedWbn("");
      setPage(1);
    }
    return () => clearTimeout(debounceRef.current);
  }, [wbnInput]);

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
    setWbnInput("");
    setAppliedWbn("");
    setEventTypeFilter("");
    setDateRange({ start: null, end: null });
    setActiveLabel(null);
    setPage(1);
  };

  const exportCSV = () => {
    const params = new URLSearchParams();
    if (appliedWbn) params.append("wbn", appliedWbn.trim());
    if (dateRange.start && dateRange.end) {
      params.append("start", istLocalToUTC(dateRange.start));
      params.append("end",   istLocalToUTC(dateRange.end));
    }
    window.open(`${API}/export?${params.toString()}`, "_blank");
  };

  // ── Client-side filter ───────────────────────────────────────────────────
  const filteredEvents = events.filter(r => {
    if (eventTypeFilter && (r.event_type || "").toLowerCase() !== eventTypeFilter.toLowerCase()) return false;
    return true;
  });

  // ── Chips ────────────────────────────────────────────────────────────────
  const badgeText = activeLabel || (dateRange.start ? `${dateRange.start.replace("T", " ")} → ${dateRange.end?.replace("T", " ")}` : null);

  const chips = [
    wbnInput       && { key: "wbn",       label: "WBN",        value: `"${wbnInput}"`,     clear: () => setWbnInput("") },
    eventTypeFilter && { key: "eventtype", label: "Event Type", value: eventTypeFilter,      clear: () => setEventTypeFilter("") },
    !wbnInput && badgeText && { key: "date", label: "Range", value: badgeText, clear: handleReset },
  ].filter(Boolean);

  // ── Details modal ────────────────────────────────────────────────────────
  const openDetails = (row) => {
    setModalContent(JSON.stringify(row.details, null, 2));
    setModalTitle(`Event Details — ${row.event_type || row.id}`);
    setModalOpen(true);
  };

  return (
    <div className="se-root">
      <Toast ref={toastRef} />

      <div className="se-card">

        {/* ── Header ── */}
        <div className="se-page-header">
          <div className="se-page-header__left">
            <div>
              <h2 className="se-page-title">Sort Events</h2>
              <p className="se-page-sub">View sorter decisions, confirmations, and event logs.</p>
            </div>
            {!wbnInput && badgeText && <span className="se-range-badge">{badgeText}</span>}
            {wbnInput && <span className="se-range-badge se-range-badge--search">🔍 "{wbnInput}"</span>}
          </div>
          <span className="se-total-count">
            {filteredEvents.length !== events.length
              ? `${filteredEvents.length} / ${total.toLocaleString()}`
              : total.toLocaleString()
            } records
          </span>
        </div>

        {/* ── Filter Card ── */}
        <div className="se-filter-card">
          <div className="se-filter-card__title">Search Sort Events</div>

          <div className="se-filter-row">

            {/* Start Date */}
            <div className="se-field-group">
              <label className="se-field-label">Start Date &amp; Time</label>
              <button className="se-field-input se-field-input--btn" onClick={() => setDrawerOpen(true)}>
                {dateRange.start
                  ? <span style={{ color: "#e2e8f0" }}>{dateRange.start.replace("T", " ")}</span>
                  : <span style={{ color: "#6b7280" }}>Select start…</span>
                }
                <span className="se-field-input__icon">📅</span>
              </button>
            </div>

            {/* End Date */}
            <div className="se-field-group">
              <label className="se-field-label">End Date &amp; Time</label>
              <button className="se-field-input se-field-input--btn" onClick={() => setDrawerOpen(true)}>
                {dateRange.end
                  ? <span style={{ color: "#e2e8f0" }}>{dateRange.end.replace("T", " ")}</span>
                  : <span style={{ color: "#6b7280" }}>Select end…</span>
                }
                <span className="se-field-input__icon">📅</span>
              </button>
            </div>

            {/* WBN */}
            <div className="se-field-group">
              <label className="se-field-label">WBN / Barcode</label>
              <div className="se-field-input-wrap">
                <input
                  className="se-field-input"
                  value={wbnInput}
                  onChange={e => setWbnInput(e.target.value)}
                  placeholder="Search WBN, 2+ chars…"
                />
                {wbnInput && <button className="se-field-clear" onClick={() => setWbnInput("")}>✕</button>}
              </div>
            </div>

            {/* Event Type */}
            <div className="se-field-group">
              <label className="se-field-label">Event Type</label>
              <div className="se-field-input-wrap">
                <input
                  className="se-field-input"
                  value={eventTypeFilter}
                  onChange={e => setEventTypeFilter(e.target.value)}
                  placeholder="e.g. sort, confirm…"
                />
                {eventTypeFilter && <button className="se-field-clear" onClick={() => setEventTypeFilter("")}>✕</button>}
              </div>
            </div>

          </div>

          {/* Action Row */}
          <div className="se-filter-actions">
            <button className="se-action-btn se-action-btn--export" onClick={exportCSV}>⬇ Export CSV</button>
            <button
              className={`se-action-btn se-action-btn--date ${drawerOpen ? "se-action-btn--date-active" : ""}`}
              onClick={() => setDrawerOpen(true)}
            >
              📅 Date Filter
            </button>
            <button className="se-action-btn se-action-btn--reset" onClick={handleReset}>↺ Reset</button>
            <button className="se-action-btn se-action-btn--search"
              onClick={() => {
                if (wbnInput.length >= 2) setAppliedWbn(wbnInput);
                setPage(1);
                setSearchTrigger(t => t + 1);
              }}>
              🔍 Search
            </button>
          </div>
        </div>

        {/* ── Active Chips ── */}
        {chips.length > 0 && (
          <div className="se-chips">
            {chips.map(c => <FilterChip key={c.key} label={c.label} value={c.value} onRemove={c.clear} />)}
            <button className="se-chip-clear-all" onClick={handleReset}>Clear all</button>
          </div>
        )}

        {/* ── Table ── */}
        <DataTable
          value={filteredEvents}
          loading={loading}
          paginator
          lazy
          rows={limit}
          totalRecords={total}
          first={(page - 1) * limit}
          rowsPerPageOptions={[20, 50, 100, 500]}
          onPage={(e) => { setPage(e.page + 1); setLimit(e.rows); }}
          scrollable
          scrollHeight="50vh"
          resizableColumns
          columnResizeMode="expand"
          className="se-table"
          emptyMessage="No sort events found."
          tableStyle={{ minWidth: "900px" }}
        >
          <Column
            header="S.No"
            style={{ minWidth: 60, textAlign: "center" }}
            body={(_, opts) => (page - 1) * limit + opts.rowIndex + 1}
          />
          <Column field="id"         header="ID"         style={{ minWidth: 80  }}
            body={r => r.id || <span className="se-cell-muted">—</span>} />
          <Column field="wbn"        header="WBN"        style={{ minWidth: 160 }}
            body={r => r.wbn || <span className="se-cell-muted">—</span>} />
          <Column field="job_id"     header="Job ID"     style={{ minWidth: 110 }}
            body={r => r.job_id || <span className="se-cell-muted">—</span>} />
          <Column field="event_type" header="Event Type" style={{ minWidth: 130 }}
            body={r => r.event_type
              ? <span className="se-event-tag">{r.event_type}</span>
              : <span className="se-cell-muted">—</span>} />
          <Column header="Details"   style={{ minWidth: 100, textAlign: "center" }}
            body={r => r.details
              ? <button className="se-json-btn" onClick={() => openDetails(r)}>👁 View</button>
              : <span className="se-cell-muted">—</span>} />
          <Column header="Created (IST)" style={{ minWidth: 155 }}
            body={r => fmtIST(r.created_at)} />
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

      {/* ── Details Modal ── */}
      {modalOpen && (
        <div className="se-modal-overlay" onClick={() => setModalOpen(false)}>
          <div className="se-modal" onClick={e => e.stopPropagation()}>
            <div className="se-modal__header">
              <span>{modalTitle}</span>
              <button onClick={() => setModalOpen(false)}>✕</button>
            </div>
            <pre className="se-modal__json">{modalContent}</pre>
          </div>
        </div>
      )}
    </div>
  );
};

export default SortEvents;