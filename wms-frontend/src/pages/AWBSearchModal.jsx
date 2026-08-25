import React, { useState, useRef, useEffect } from "react";
import "../styles/AWBSearchModal.css";

const API = "http://localhost:5001/api";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtIST(utcStr) {
  if (!utcStr) return "—";
  try {
    return new Date(utcStr).toLocaleString("en-GB", {
      timeZone: "Asia/Kolkata",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    });
  } catch { return utcStr; }
}

function val(v) {
  if (v === null || v === undefined || v === "") return "—";
  return v;
}

// ─── Fetch single AWB — merges parcels + production + sort_events ─────────────

async function fetchAWBData(wbn) {
  const results = { parcel: null, production: null, sortEvent: null, errors: [] };

  // 1. Parcels API
  try {
    const r = await fetch(`${API}/parcels?search=${encodeURIComponent(wbn)}&limit=1`);
    const d = await r.json();
    if (d.rows && d.rows.length > 0) results.parcel = d.rows[0];
    else results.errors.push("No parcel record found");
  } catch (e) {
    results.errors.push("Parcels API error: " + e.message);
  }

  // 2. Production report API
  try {
    const r = await fetch(`${API}/production-report?search=${encodeURIComponent(wbn)}&limit=1`);
    const d = await r.json();
    if (d.rows && d.rows.length > 0) results.production = d.rows[0];
  } catch (e) {
    results.errors.push("Production API error: " + e.message);
  }

  // 3. Sort Events API
  try {
    const r = await fetch(`http://localhost:5001/sort-events?wbn=${encodeURIComponent(wbn)}&limit=10`);
    const d = await r.json();
    if (d.rows && d.rows.length > 0) results.sortEvent = d.rows;
    else if (d.success && d.rows) results.sortEvent = d.rows;
  } catch (e) {
    results.errors.push("Sort Events API error: " + e.message);
  }

  return results;
}

// ─── JSON Viewer ──────────────────────────────────────────────────────────────

function JsonViewer({ data, title }) {
  const [open, setOpen] = useState(false);
  if (!data) return <span className="awb-muted">—</span>;
  return (
    <>
      <button className="awb-json-btn" onClick={() => setOpen(true)}>👁 View</button>
      {open && (
        <div className="awb-json-overlay" onClick={() => setOpen(false)}>
          <div className="awb-json-modal" onClick={e => e.stopPropagation()}>
            <div className="awb-json-modal__hdr">
              <span>{title}</span>
              <button onClick={() => setOpen(false)}>✕</button>
            </div>
            <pre className="awb-json-modal__body">
              {typeof data === "string" ? data : JSON.stringify(data, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Result Row (single AWB merged data) ─────────────────────────────────────

function ResultCard({ wbn, data, loading, error }) {
  const [sortOpen, setSortOpen] = useState(false);
  const p  = data?.parcel;
  const pr = data?.production;
  const se = data?.sortEvent;

  if (loading) return (
    <div className="awb-result-card">
      <div className="awb-result-card__loading">
        <div className="awb-spinner" />
        <span>Fetching data for <b>{wbn}</b>…</span>
      </div>
    </div>
  );

  if (error || (!p && !pr)) return (
    <div className="awb-result-card awb-result-card--error">
      <div className="awb-result-card__wbn">{wbn}</div>
      <div className="awb-result-card__err">
        ⚠️ {error || "No records found across all data sources."}
      </div>
      {data?.errors?.length > 0 && (
        <ul className="awb-result-card__errs">
          {data.errors.map((e, i) => <li key={i}>{e}</li>)}
        </ul>
      )}
    </div>
  );

  return (
    <div className="awb-result-card">
      {/* WBN header */}
      <div className="awb-result-card__header">
        <span className="awb-result-card__wbn">{val(p?.wbn || pr?.wbn || wbn)}</span>
        <div className="awb-result-card__badges">
          {p?.sort === "SORTED"   && <span className="awb-badge awb-badge--sorted">SORTED</span>}
          {p?.sort === "REJECTED" && <span className="awb-badge awb-badge--rej">REJECTED</span>}
          {p?.mode && <span className="awb-badge awb-badge--mode">{p.mode}</span>}
        </div>
      </div>

      {/* Main data grid */}
      <div className="awb-data-grid">

        {/* ── Parcel dimensions & bag ── */}
        <div className="awb-section">
          <div className="awb-section__title">📦 Parcel Data</div>
          <div className="awb-fields">
            <div className="awb-field"><span className="awb-field__lbl">Expected Bag</span><span className="awb-field__val">{val(p?.expected_bag)}</span></div>
            <div className="awb-field"><span className="awb-field__lbl">Final Bag</span><span className="awb-field__val">{val(p?.final_bag)}</span></div>
            <div className="awb-field"><span className="awb-field__lbl">Reason</span>
              <span className="awb-field__val">
                {p?.reason ? <span className="awb-reason-tag">{p.reason.toUpperCase()}</span> : "—"}
              </span>
            </div>
            <div className="awb-field"><span className="awb-field__lbl">Weight (g)</span><span className="awb-field__val">{val(p?.weight)}</span></div>
            <div className="awb-field"><span className="awb-field__lbl">L (cm)</span><span className="awb-field__val">{val(p?.length)}</span></div>
            <div className="awb-field"><span className="awb-field__lbl">B (cm)</span><span className="awb-field__val">{val(p?.width)}</span></div>
            <div className="awb-field"><span className="awb-field__lbl">H (cm)</span><span className="awb-field__val">{val(p?.height)}</span></div>
            <div className="awb-field"><span className="awb-field__lbl">Volume</span><span className="awb-field__val">{val(p?.volume)}</span></div>
            <div className="awb-field"><span className="awb-field__lbl">Real Volume</span><span className="awb-field__val">{val(p?.real_volume)}</span></div>
            <div className="awb-field"><span className="awb-field__lbl">Scan Time</span><span className="awb-field__val">{fmtIST(p?.scantime)}</span></div>
            <div className="awb-field"><span className="awb-field__lbl">Sort Time</span><span className="awb-field__val">{fmtIST(p?.sorttime)}</span></div>
            <div className="awb-field"><span className="awb-field__lbl">Created (IST)</span><span className="awb-field__val">{fmtIST(p?.created_at)}</span></div>
          </div>
        </div>

        {/* ── Production / Audit ── */}
        <div className="awb-section">
          <div className="awb-section__title">🏭 Production / Audit</div>
          <div className="awb-fields">
            <div className="awb-field"><span className="awb-field__lbl">Tracking ID</span><span className="awb-field__val">{val(pr?.tracking_id)}</span></div>
            <div className="awb-field"><span className="awb-field__lbl">Bag Code</span><span className="awb-field__val">{val(pr?.bag_code)}</span></div>
            <div className="awb-field"><span className="awb-field__lbl">PTL ID</span><span className="awb-field__val">{val(pr?.ptl_id)}</span></div>
            <div className="awb-field"><span className="awb-field__lbl">Sorter ID</span><span className="awb-field__val">{val(pr?.sorter_id)}</span></div>
            <div className="awb-field"><span className="awb-field__lbl">Location</span><span className="awb-field__val">{val(pr?.sorter_location)}</span></div>
            <div className="awb-field"><span className="awb-field__lbl">Rejection Type</span>
              <span className="awb-field__val">
                {pr?.rejection_type ? <span className="awb-reason-tag">{pr.rejection_type}</span> : "—"}
              </span>
            </div>
            <div className="awb-field"><span className="awb-field__lbl">Primary Status</span>
              <span className="awb-field__val">
                {pr?.primary_status === true ? <span className="awb-ok">✔ Pass</span> : pr?.primary_status === false ? <span className="awb-fail">✖ Fail</span> : "—"}
              </span>
            </div>
            <div className="awb-field"><span className="awb-field__lbl">Secondary Status</span>
              <span className="awb-field__val">
                {pr?.secondary_status === true ? <span className="awb-ok">✔ Pass</span> : pr?.secondary_status === false ? <span className="awb-fail">✖ Fail</span> : "—"}
              </span>
            </div>
            <div className="awb-field"><span className="awb-field__lbl">Image Status</span>
              <span className="awb-field__val">
                {pr?.image_status === true ? <span className="awb-ok">✔ Pass</span> : pr?.image_status === false ? <span className="awb-fail">✖ Fail</span> : "—"}
              </span>
            </div>
          </div>
        </div>

      </div>

      {/* ── Payloads row ── */}
      <div className="awb-payloads">
        <div className="awb-payload-item">
          <span className="awb-payload-item__lbl">Fetch Payload</span>
          <JsonViewer data={pr?.primary_payload} title="Fetch Payload" />
        </div>
        <div className="awb-payload-item">
          <span className="awb-payload-item__lbl">Primary Response</span>
          <JsonViewer data={pr?.primary_response} title="Primary Response" />
        </div>
        <div className="awb-payload-item">
          <span className="awb-payload-item__lbl">Secondary Payload</span>
          <JsonViewer data={pr?.secondary_payload} title="Secondary Payload" />
        </div>
        <div className="awb-payload-item">
          <span className="awb-payload-item__lbl">Secondary Response</span>
          <JsonViewer data={pr?.secondary_response} title="Secondary Response" />
        </div>
      </div>

      {/* ── Sort Events ── */}
      {se && se.length > 0 && (
        <div className="awb-sort-events">
          <button className="awb-sort-events__toggle" onClick={() => setSortOpen(o => !o)}>
            📋 Sort Events ({se.length}) {sortOpen ? "▲" : "▼"}
          </button>
          {sortOpen && (
            <div className="awb-sort-events__table-wrap">
              <table className="awb-sort-events__table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Job ID</th>
                    <th>Event Type</th>
                    <th>Details</th>
                    <th>Created (IST)</th>
                  </tr>
                </thead>
                <tbody>
                  {se.map((ev, i) => (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td>{val(ev.job_id)}</td>
                      <td>{ev.event_type ? <span className="awb-event-tag">{ev.event_type}</span> : "—"}</td>
                      <td><JsonViewer data={ev.details} title={`Event #${i + 1} Details`} /></td>
                      <td>{fmtIST(ev.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Parcel image */}
      {p?.imagepath && p.imagepath !== "image_missing" && (
        <div className="awb-image-row">
          <span className="awb-payload-item__lbl">Parcel Image</span>
          <a href={`http://localhost:5001${p.imagepath}`} target="_blank" rel="noreferrer" className="awb-json-btn">
            🖼 View Image
          </a>
        </div>
      )}

      {/* Error notes */}
      {data?.errors?.length > 0 && (
        <div className="awb-partial-warn">
          ⚠️ Some data sources unavailable: {data.errors.join(" · ")}
        </div>
      )}
    </div>
  );
}

// ─── Main Modal Component ─────────────────────────────────────────────────────

export default function AWBSearchModal({ onClose }) {
  const [tab, setTab] = useState("single"); // "single" | "multiple"

  // Single
  const [singleInput, setSingleInput] = useState("");
  const [singleResult, setSingleResult] = useState(null);
  const [singleLoading, setSingleLoading] = useState(false);
  const [singleError, setSingleError] = useState("");
  const singleRef = useRef(null);

  // Multiple
  const [multiInput, setMultiInput] = useState("");
  const [multiResults, setMultiResults] = useState([]); // [{wbn, data, loading, error}]
  const [multiLoading, setMultiLoading] = useState(false);

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // ── Single search ────────────────────────────────────────────────────────
  const handleSingleSearch = async () => {
    const wbn = singleInput.trim();
    if (!wbn) return;
    setSingleLoading(true);
    setSingleError("");
    setSingleResult(null);
    const data = await fetchAWBData(wbn);
    setSingleLoading(false);
    if (!data.parcel && !data.production) {
      setSingleError("No records found for this AWB across all data sources.");
    }
    setSingleResult({ wbn, data });
  };

  const handleSingleKeyDown = (e) => {
    if (e.key === "Enter") handleSingleSearch();
  };

  // ── Multiple search ──────────────────────────────────────────────────────
  const handleMultiSearch = async () => {
    const lines = multiInput
      .split(/[\n,\s]+/)
      .map(s => s.trim())
      .filter(Boolean);

    if (!lines.length) return;

    // Init all as loading
    setMultiResults(lines.map(wbn => ({ wbn, data: null, loading: true, error: null })));
    setMultiLoading(true);

    // Fetch all concurrently
    const settled = await Promise.allSettled(lines.map(wbn => fetchAWBData(wbn)));

    setMultiResults(lines.map((wbn, i) => {
      const res = settled[i];
      if (res.status === "fulfilled") {
        const data = res.value;
        const error = (!data.parcel && !data.production)
          ? "No records found." : null;
        return { wbn, data, loading: false, error };
      } else {
        return { wbn, data: null, loading: false, error: res.reason?.message || "Fetch failed" };
      }
    }));

    setMultiLoading(false);
  };

  return (
    <div className="awb-overlay" onClick={onClose}>
      <div className="awb-modal" onClick={e => e.stopPropagation()}>

        {/* ── Modal Header ── */}
        <div className="awb-modal__header">
          <div className="awb-modal__header-left">
            <span className="awb-modal__header-icon">🔍</span>
            <span className="awb-modal__title">Search Shipments</span>
          </div>
          <button className="awb-modal__close" onClick={onClose}>✕</button>
        </div>

        {/* ── Tabs ── */}
        <div className="awb-tabs">
          <button
            className={`awb-tab ${tab === "single" ? "awb-tab--active" : ""}`}
            onClick={() => setTab("single")}
          >
            Single AWB Search
          </button>
          <button
            className={`awb-tab ${tab === "multiple" ? "awb-tab--active" : ""}`}
            onClick={() => setTab("multiple")}
          >
            Multiple AWB Search
          </button>
        </div>

        <div className="awb-modal__body">

          {/* ── Single Tab ── */}
          {tab === "single" && (
            <div className="awb-single">
              <div className="awb-single__search-row">
                <div className="awb-single__input-wrap">
                  <span className="awb-single__search-icon">📦</span>
                  <input
                    ref={singleRef}
                    className="awb-single__input"
                    placeholder="Enter AWB / WBN number…"
                    value={singleInput}
                    onChange={e => setSingleInput(e.target.value)}
                    onKeyDown={handleSingleKeyDown}
                    autoFocus
                  />
                  {singleInput && (
                    <button className="awb-single__clear"
                      onClick={() => { setSingleInput(""); setSingleResult(null); setSingleError(""); }}>
                      ✕
                    </button>
                  )}
                </div>
                <button
                  className="awb-single__search-btn"
                  onClick={handleSingleSearch}
                  disabled={!singleInput.trim() || singleLoading}
                >
                  {singleLoading ? <span className="awb-spinner awb-spinner--sm" /> : "🔍"} Search
                </button>
                {singleResult && (
                  <button className="awb-single__clear-btn"
                    onClick={() => { setSingleResult(null); setSingleError(""); setSingleInput(""); }}>
                    ↺ Clear
                  </button>
                )}
              </div>

              <p className="awb-hint">Press Enter or click Search. Fetches from Parcels, Production Report, and Sort Events simultaneously.</p>

              {/* Result */}
              {(singleLoading || singleResult) && (
                <div className="awb-results">
                  <ResultCard
                    wbn={singleInput.trim()}
                    data={singleResult?.data}
                    loading={singleLoading}
                    error={singleError}
                  />
                </div>
              )}
            </div>
          )}

          {/* ── Multiple Tab ── */}
          {tab === "multiple" && (
            <div className="awb-multi">
              <label className="awb-multi__label">
                Enter AWB numbers — one per line, or comma/space separated:
              </label>
              <textarea
                className="awb-multi__textarea"
                placeholder={"142285182454214\n149082791932314\n165892743001..."}
                value={multiInput}
                onChange={e => setMultiInput(e.target.value)}
                rows={5}
              />
              <div className="awb-multi__actions">
                <span className="awb-multi__count">
                  {multiInput.split(/[\n,\s]+/).filter(Boolean).length} AWBs entered
                </span>
                <button
                  className="awb-single__clear-btn"
                  onClick={() => { setMultiInput(""); setMultiResults([]); }}
                >
                  ↺ Clear
                </button>
                <button
                  className="awb-single__search-btn"
                  onClick={handleMultiSearch}
                  disabled={!multiInput.trim() || multiLoading}
                >
                  {multiLoading ? <span className="awb-spinner awb-spinner--sm" /> : "🔍"} Search All
                </button>
              </div>

              {multiResults.length > 0 && (
                <div className="awb-results">
                  {multiResults.map((r, i) => (
                    <ResultCard
                      key={i}
                      wbn={r.wbn}
                      data={r.data}
                      loading={r.loading}
                      error={r.error}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}