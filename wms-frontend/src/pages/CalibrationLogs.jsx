import React, { useEffect, useRef, useState, useCallback } from "react";
import axios from "axios";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Toast } from "primereact/toast";
import "../styles/CalibrationLogs.css";

const API = "http://localhost:5001/api";

const PAGE_SIZES = [100, 500, 1000];

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

function FilterChip({ label, value, onRemove }) {
  if (!value) return null;
  return (
    <span className="cl-chip">
      <span className="cl-chip__label">{label}:</span>
      <span className="cl-chip__val">{value}</span>
      <button className="cl-chip__x" onClick={onRemove}>✕</button>
    </span>
  );
}

const CalibrationLogs = () => {
  const toast = useRef(null);

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(100);

  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");

  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [appliedRange, setAppliedRange] = useState({ start: null, end: null });

  const [loading, setLoading] = useState(false);

  // ---------------- FETCH ----------------
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);

      const params = { page, limit };
      if (appliedSearch) {
        params.search = appliedSearch;
      } else if (appliedRange.start && appliedRange.end) {
        params.startTime = appliedRange.start;
        params.endTime = appliedRange.end;
      }

      const res = await axios.get(`${API}/calibration/logs`, { params });

      setRows(res.data.rows);
      setTotal(res.data.total);
    } catch (err) {
      toast.current?.show({
        severity: "error",
        summary: "Error",
        detail: err.response?.data?.error || err.message,
        life: 3000,
      });
    } finally {
      setLoading(false);
    }
  }, [page, limit, appliedSearch, appliedRange]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ---------------- SEARCH ----------------
  const handleSearch = () => {
    if ((startTime || endTime) && search) {
      return toast.current.show({
        severity: "warn",
        summary: "Reset Required",
        detail: "Please reset data first",
        life: 3000,
      });
    }

    setAppliedSearch(search);
    setAppliedRange({ start: null, end: null });
    setPage(1);
  };

  // ---------------- FILTER ----------------
  const applyFilter = () => {
    if (search && (startTime || endTime)) {
      return toast.current.show({
        severity: "warn",
        summary: "Reset Required",
        detail: "Please reset data first",
        life: 3000,
      });
    }
    if (!startTime || !endTime) return;

    setAppliedRange({
      start: new Date(startTime).toISOString(),
      end: new Date(endTime).toISOString(),
    });
    setAppliedSearch("");
    setPage(1);
  };

  // ---------------- RESET ----------------
  const resetAll = () => {
    setSearch("");
    setAppliedSearch("");
    setStartTime("");
    setEndTime("");
    setAppliedRange({ start: null, end: null });
    setPage(1);
  };

  // ---------------- EXPORT ----------------
  const exportData = () => {
    if (search && (startTime || endTime)) {
      return toast.current.show({
        severity: "warn",
        summary: "Reset Required",
        detail: "Please reset data first",
        life: 3000,
      });
    }

    const params = new URLSearchParams();

    if (appliedSearch) params.append("search", appliedSearch);
    if (appliedRange.start) params.append("startTime", appliedRange.start);
    if (appliedRange.end) params.append("endTime", appliedRange.end);

    window.open(`${API}/calibration/logs/export?${params.toString()}`, "_blank");
  };

  // ---------------- TAG ----------------
  const statusBadge = (val) => {
    if (!val) return <span className="cl-cell-muted">—</span>;
    const ok = val === "pass";
    return (
      <span className={`cl-badge ${ok ? "cl-badge-pass" : "cl-badge-fail"}`}>
        {val.toUpperCase()}
      </span>
    );
  };

  const chips = [
    appliedSearch && {
      key: "wbn",
      label: "WBN",
      value: `"${appliedSearch}"`,
      clear: resetAll,
    },
    !appliedSearch && appliedRange.start && {
      key: "date",
      label: "Range",
      value: `${new Date(appliedRange.start).toLocaleString("en-IN")} → ${new Date(appliedRange.end).toLocaleString("en-IN")}`,
      clear: resetAll,
    },
  ].filter(Boolean);

  const badgeText =
    !appliedSearch && appliedRange.start
      ? `${new Date(appliedRange.start).toLocaleString("en-IN")} → ${new Date(appliedRange.end).toLocaleString("en-IN")}`
      : null;

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="cl-root">
      <Toast ref={toast} />

      <div className="cl-card">

        {/* PAGE HEADER */}
        <div className="cl-page-header">
          <div className="cl-page-header__left">
            <h2 className="cl-page-title">Calibration Report</h2>
            {badgeText && <span className="cl-range-badge">{badgeText}</span>}
            {appliedSearch && (
              <span className="cl-range-badge cl-range-badge--search">🔍 "{appliedSearch}"</span>
            )}
          </div>
          <span className="cl-total-count">{total.toLocaleString()} records</span>
        </div>

        {/* FILTER CARD */}
        <div className="cl-filter-card">

          <div className="cl-filter-row">

            <div className="cl-field-group">
              <label className="cl-field-label">WBN Number</label>
              <div className="cl-field-input-wrap">
                <input
                  className="cl-field-input"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search WBN…"
                />
                {search && (
                  <button className="cl-field-clear" onClick={() => setSearch("")}>✕</button>
                )}
              </div>
            </div>

            <div className="cl-field-group cl-field-group--wide">
              <label className="cl-field-label">Date &amp; Time Range</label>
              <div className="cl-datetime-inline">
                <input
                  type="datetime-local"
                  step="1"
                  className="cl-field-input"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
                <span className="cl-dt-arrow">→</span>
                <input
                  type="datetime-local"
                  step="1"
                  className="cl-field-input"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                />
              </div>
            </div>

            <div className="cl-field-group">
              <label className="cl-field-label">Rows</label>
              <select
                className="cl-field-input cl-field-select"
                value={limit}
                onChange={(e) => { setLimit(Number(e.target.value)); setPage(1); }}
              >
                {PAGE_SIZES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

          </div>

          <div className="cl-filter-actions">
            <button className="cl-action-btn cl-action-btn--export" onClick={exportData}>
              ⬇ Export CSV
            </button>
            <button className="cl-action-btn cl-action-btn--filter" onClick={applyFilter}>
              📅 Apply Filter
            </button>
            <button className="cl-action-btn cl-action-btn--reset" onClick={resetAll}>
              ↺ Reset
            </button>
            <button className="cl-action-btn cl-action-btn--search" onClick={handleSearch}>
              🔍 Search
            </button>
          </div>
        </div>

        {chips.length > 0 && (
          <div className="cl-chips">
            {chips.map((c) => (
              <FilterChip key={c.key} label={c.label} value={c.value} onRemove={c.clear} />
            ))}
            <button className="cl-chip-clear-all" onClick={resetAll}>Clear all</button>
          </div>
        )}

        {/* TABLE */}
        <DataTable
          value={rows}
          loading={loading}
          scrollable
          scrollHeight="60vh"
          className="cl-table"
          emptyMessage="No calibration logs found for the selected filters."
        >
          <Column field="wbn" header="WBN" frozen style={{ minWidth: 140 }} />
          <Column field="feedlane" header="Feedlane" style={{ minWidth: 100 }} />

          <Column field="length_mm" header="Length" style={{ minWidth: 80 }} />
          <Column field="width_mm" header="Width" style={{ minWidth: 80 }} />
          <Column field="height_mm" header="Height" style={{ minWidth: 80 }} />
          <Column field="weight_g" header="Weight" style={{ minWidth: 80 }} />
          <Column field="real_volume" header="RV" style={{ minWidth: 80 }} />
          <Column field="volume" header="Volume" style={{ minWidth: 80 }} />

          <Column header="L" body={(r) => statusBadge(r.length_status)} style={{ minWidth: 70 }} />
          <Column header="W" body={(r) => statusBadge(r.width_status)} style={{ minWidth: 70 }} />
          <Column header="H" body={(r) => statusBadge(r.height_status)} style={{ minWidth: 70 }} />
          <Column header="WT" body={(r) => statusBadge(r.weight_status)} style={{ minWidth: 70 }} />

          <Column header="Final" body={(r) => statusBadge(r.final_result)} style={{ minWidth: 80 }} />

          <Column field="length_variance" header="L Variance" style={{ minWidth: 120 }} />
          <Column field="width_variance" header="W Variance" style={{ minWidth: 120 }} />
          <Column field="height_variance" header="H Variance" style={{ minWidth: 120 }} />
          <Column field="weight_variance" header="WT Variance" style={{ minWidth: 120 }} />

          <Column field="dimension_tolerance" header="Tolerance" style={{ minWidth: 90 }} />

          <Column
            field="created_at"
            header="Time"
            body={(r) => new Date(r.created_at).toLocaleString("en-IN")}
            style={{ minWidth: 155 }}
          />
        </DataTable>

        <div className="cl-pagination">
          <span className="cl-pagination__label">displaying page</span>
          <button className="cl-page-btn" disabled={page === 1} onClick={() => setPage(1)}>First</button>
          <button
            className="cl-page-btn cl-page-btn--arrow"
            disabled={page === 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >‹</button>

          {buildPageList(page, totalPages).map((p, i) =>
            p === "…" ? (
              <span key={`e${i}`} className="cl-page-ellipsis">…</span>
            ) : (
              <button
                key={p}
                className={`cl-page-btn ${p === page ? "cl-page-btn--active" : ""}`}
                onClick={() => setPage(p)}
              >
                {p}
              </button>
            )
          )}

          <button
            className="cl-page-btn cl-page-btn--arrow"
            disabled={page === totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >›</button>
          <button
            className="cl-page-btn"
            disabled={page === totalPages}
            onClick={() => setPage(totalPages)}
          >Last</button>
        </div>

      </div>
    </div>
  );
};

export default CalibrationLogs;
