import React, { useEffect, useState, useRef, useCallback } from "react";
import axios from "axios";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Toast } from "primereact/toast";
import "../styles/SortedPayloadErrorsReport.css";

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
    <div className="se-spb" style={{ width }} tabIndex={0}
      onKeyDown={e => { if (e.key === "ArrowUp") { e.preventDefault(); inc(); } if (e.key === "ArrowDown") { e.preventDefault(); dec(); } }}>
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

  const days = getDaysInMonth(view.year, view.month);
  const firstDay = getFirstDay(view.year, view.month);
  const cells = Array.from({ length: firstDay + days }, (_, i) => i < firstDay ? null : i - firstDay + 1);
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
                      {isActive && <span className="se-fd-preset__check">✓</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {tab === "custom" && (
            <div className="se-fd-custom">
              <DateTimePicker label="Start" color="#D71920" value={start} onChange={setStart} />
              <div className="se-fd-divider" />
              <DateTimePicker label="End"   color="#1F2937" value={end}   onChange={setEnd} />
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
                ? <span style={{ fontSize: 11 }}>{dateRange.start.replace("T"," ")} → {dateRange.end?.replace("T"," ")} IST</span>
                : <span style={{ fontSize: 11, color: "#9CA3AF" }}>All records</span>
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
    <span className="se-chip">
      <span className="se-chip__label">{label}:</span>
      <span className="se-chip__val">{value}</span>
      <button className="se-chip__x" onClick={onRemove}>✕</button>
    </span>
  );
}

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

const SortedPayloadErrorsReport = () => {
  const toastRef = useRef(null);

  const [rows,    setRows   ] = useState([]);
  const [total,   setTotal  ] = useState(0);
  const [page,    setPage   ] = useState(1);
  const [loading, setLoading] = useState(false);

  const [wbnInput,     setWbnInput    ] = useState("");
  const [errorFilter,  setErrorFilter ] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");

  const [dateRange,   setDateRange  ] = useState({ start: null, end: null });
  const [activeLabel, setActiveLabel] = useState(null);
  const [drawerOpen,  setDrawerOpen ] = useState(false);
  const [searchTrigger, setSearchTrigger] = useState(0);

  const [jsonDialog, setJsonDialog] = useState(false);
  const [jsonData,   setJsonData  ] = useState(null);
  const [jsonWbn,    setJsonWbn   ] = useState("");

  const debounceRef = useRef(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const p = { page, limit: PAGE_SIZE, error_search: errorFilter };

      if (appliedSearch) {
        p.search = appliedSearch;
      } else if (dateRange.start && dateRange.end) {
        p.startTime = istLocalToUTC(dateRange.start);
        p.endTime   = istLocalToUTC(dateRange.end);
      }

      Object.keys(p).forEach(k => { if (p[k] === "" || p[k] == null) delete p[k]; });

      const res = await axios.get(`${API}/sorted-payload-errors-report`, { params: p });

      if (!res.data || typeof res.data.total !== "number" || !Array.isArray(res.data.rows)) {
        throw new Error("Unexpected response from /sorted-payload-errors-report");
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
  }, [page, appliedSearch, dateRange, searchTrigger, errorFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (wbnInput.length >= 2) {
      debounceRef.current = setTimeout(() => {
        setAppliedSearch(wbnInput);
        setDateRange({ start: null, end: null });
        setActiveLabel(null);
        setPage(1);
      }, 500);
    } else if (wbnInput.length === 0 && appliedSearch) {
      setAppliedSearch("");
      setDateRange({ start: null, end: null });
      setActiveLabel(null);
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
    setErrorFilter("");
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
    if (errorFilter) params.append("error_search", errorFilter);
    window.open(`${API}/sorted-payload-errors-report/export?${params.toString()}`, "_blank");
  };

  const openJson = (payload, wbn) => {
    setJsonData(payload);
    setJsonWbn(wbn || "—");
    setJsonDialog(true);
  };

  const badgeText = activeLabel || (dateRange.start ? `${dateRange.start.replace("T"," ")} → ${dateRange.end?.replace("T"," ")}` : null);

  const chips = [
    wbnInput      && { key: "wbn",   label: "WBN",   value: `"${wbnInput}"`,  clear: () => setWbnInput("") },
    errorFilter   && { key: "error", label: "Error",  value: errorFilter,     clear: () => withPageReset(setErrorFilter)("") },
    !wbnInput && badgeText && { key: "date", label: "Range", value: badgeText, clear: handleReset },
  ].filter(Boolean);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="se-root">
      <Toast ref={toastRef} />

      <div className="se-card">

        <div className="se-page-header">
          <div className="se-page-header__left">
            <h2 className="se-page-title">Sorted Payload Errors</h2>
            {!wbnInput && badgeText && <span className="se-range-badge">{badgeText}</span>}
            {wbnInput && <span className="se-range-badge se-range-badge--search">🔍 "{wbnInput}"</span>}
          </div>
          <span className="se-total-count">{total.toLocaleString()} records</span>
        </div>

        <div className="se-filter-card">
          <div className="se-filter-row">
            <div className="se-field-group">
              <label className="se-field-label">WBN</label>
              <div className="se-field-input-wrap">
                <input
                  className="se-field-input"
                  value={wbnInput}
                  onChange={e => setWbnInput(e.target.value)}
                  placeholder="Search WBN…"
                />
                {wbnInput && <button className="se-field-clear" onClick={() => setWbnInput("")}>✕</button>}
              </div>
            </div>

            <div className="se-field-group">
              <label className="se-field-label">Error Message</label>
              <div className="se-field-input-wrap">
                <input
                  className="se-field-input"
                  value={errorFilter}
                  onChange={e => withPageReset(setErrorFilter)(e.target.value)}
                  placeholder="e.g. Invalid datatype for pin…"
                />
                {errorFilter && <button className="se-field-clear" onClick={() => withPageReset(setErrorFilter)("")}>✕</button>}
              </div>
            </div>
          </div>

          <div className="se-filter-actions">
            <button className="se-action-btn se-action-btn--export" onClick={exportData}>⬇ Export CSV</button>
            <button
              className={`se-action-btn se-action-btn--date ${drawerOpen ? "se-action-btn--date-active" : ""}`}
              onClick={() => setDrawerOpen(true)}
            >
              📅 Date Filter
            </button>
            <button className="se-action-btn se-action-btn--reset" onClick={handleReset}>↺ Reset</button>
            <button className="se-action-btn se-action-btn--search"
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
          <div className="se-chips">
            {chips.map(c => <FilterChip key={c.key} label={c.label} value={c.value} onRemove={c.clear} />)}
            <button className="se-chip-clear-all" onClick={handleReset}>Clear all</button>
          </div>
        )}

        <DataTable
          value={rows}
          loading={loading}
          className="se-table"
          emptyMessage="No payload errors found."
          scrollable
          scrollHeight="55vh"
          resizableColumns
          columnResizeMode="expand"
          tableStyle={{ minWidth: "1000px" }}
        >
          <Column
            header="S.No"
            style={{ minWidth: 60, textAlign: "center" }}
            body={(_, opts) => (page - 1) * PAGE_SIZE + opts.rowIndex + 1}
          />
          <Column
            header="WBN"
            body={r => r.wbn || <span className="se-cell-muted">—</span>}
            style={{ minWidth: 160 }}
          />
          <Column
            header="Error"
            body={r => <span className="se-error-tag">{r.error}</span>}
            style={{ minWidth: 320 }}
          />
          <Column
            header="Payload"
            body={r => (
              <button className="se-json-btn" onClick={() => openJson(r.payload, r.wbn)}>👁 View</button>
            )}
            style={{ minWidth: 90 }}
          />
          <Column header="Created (IST)" body={r => fmtIST(r.created_at)} style={{ minWidth: 165 }} />
        </DataTable>

        <div className="se-pagination">
          <span className="se-pagination__label">displaying page</span>
          <button className="se-page-btn" disabled={page === 1} onClick={() => setPage(1)}>First</button>
          <button className="se-page-btn se-page-btn--arrow" disabled={page === 1} onClick={() => setPage(p => Math.max(1, p - 1))}>‹</button>

          {buildPageList(page, totalPages).map((p, i) =>
            p === "…"
              ? <span key={`e${i}`} className="se-page-ellipsis">…</span>
              : <button
                  key={p}
                  className={`se-page-btn ${p === page ? "se-page-btn--active" : ""}`}
                  onClick={() => setPage(p)}
                >
                  {p}
                </button>
          )}

          <button className="se-page-btn se-page-btn--arrow" disabled={page === totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>›</button>
          <button className="se-page-btn" disabled={page === totalPages} onClick={() => setPage(totalPages)}>Last</button>
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

      {jsonDialog && (
        <div className="se-json-overlay" onClick={() => setJsonDialog(false)}>
          <div className="se-json-modal" onClick={e => e.stopPropagation()}>
            <div className="se-json-modal__header">
              <span>Payload — {jsonWbn}</span>
              <button onClick={() => setJsonDialog(false)}>✕</button>
            </div>
            <pre className="se-json-box">
              {JSON.stringify(jsonData, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
};

export default SortedPayloadErrorsReport;