// src/pages/BagsLayout.jsx
import React, { useEffect, useState, useMemo } from "react";
import axios from "axios";
import { Dialog } from "primereact/dialog";
import { ProgressSpinner } from "primereact/progressspinner";
import { Toast } from "primereact/toast";
import Swal from "sweetalert2";
import { BAG_LAYOUT } from "../utils/bagLayoutMap";
import "../styles/BagsLayout.css";

const API_BASE = "http://localhost:5001/api";

const BagsLayout = () => {
  const [bags, setBags] = useState([]);
  const [loading, setLoading] = useState(true);

  const [dialogVisible, setDialogVisible] = useState(false);
  const [selectedBag, setSelectedBag] = useState(null);
  const [bagWbns, setBagWbns] = useState([]);
  const [bagStats, setBagStats] = useState({ count: 0, weight: 0, realvolume: 0 });
  const [loadingWbns, setLoadingWbns] = useState(false);
  const [resetting, setResetting] = useState(false);

  const toastRef = React.useRef(null);

  const refreshBags = async () => {
    try {
      const res = await axios.get(`${API_BASE}/bags/summary`);
      setBags(res.data.bags || []);
    } catch {
      toastRef.current?.show({ severity: "error", summary: "Error", detail: "Failed to load bags" });
    }
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      await refreshBags();
      setLoading(false);
    })();
    const i = setInterval(refreshBags, 5000);
    return () => clearInterval(i);
  }, []);

  // Keyed by bag_code -> { count, blocked, full }
  const bagStatusMap = useMemo(() => {
    const m = {};
    bags.forEach((b) => {
      m[b.bag_code] = { count: b.count || 0, blocked: !!b.blocked, full: !!b.full };
    });
    return m;
  }, [bags]);

  const openBag = async (code) => {
    setSelectedBag(code);
    setDialogVisible(true);
    setLoadingWbns(true);
    try {
      const res = await axios.get(`${API_BASE}/bags/${code}/wbns`);
      setBagWbns(res.data.wbns || []);
      setBagStats({
        count: res.data.count || 0,
        weight: res.data.weight || 0,
        realvolume: res.data.realvolume || 0,
      });
    } finally {
      setLoadingWbns(false);
    }
  };

  // Same block -> clear sequence the operator's Clear Bag page uses —
  // block first so the sorter stops routing into this bag mid-clear,
  // then clear. Skipping the block step would risk a parcel landing in
  // the bag at the exact moment it's being emptied.
  const handleResetBag = async () => {
    if (!selectedBag) return;

    const result = await Swal.fire({
      title: `Reset bag ${selectedBag}?`,
      text: "This clears all parcels currently tracked in this bag.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Yes, reset it",
      cancelButtonText: "Cancel",
      confirmButtonColor: "#D71920",
    });
    if (!result.isConfirmed) return;

    setResetting(true);
    try {
      await axios.post(`${API_BASE}/clear-bag/${selectedBag}/block`);
      await axios.post(`${API_BASE}/clear-bag/${selectedBag}/clear`);

      toastRef.current?.show({
        severity: "success",
        summary: "Bag Reset",
        detail: `Bag ${selectedBag} has been cleared.`,
      });

      setBagWbns([]);
      setBagStats({ count: 0, weight: 0, realvolume: 0 });
      setDialogVisible(false);
      refreshBags(); // don't wait for the next 5s poll
    } catch (err) {
      Swal.fire(
        "Reset Failed",
        err.response?.data?.error || "Could not reset this bag.",
        "error"
      );
    } finally {
      setResetting(false);
    }
  };

  const renderBag = (code) => {
    const status = bagStatusMap[code] || { count: 0, blocked: false, full: false };

    // Priority: full (most urgent) > blocked > active (has parcels,
    // existing non-blinking style) > default green.
    let stateClass = "";
    if (status.full) stateClass = "bag-tile--full";
    else if (status.blocked) stateClass = "bag-tile--blocked";
    else if (status.count > 0) stateClass = "active";

    return (
      <div
        key={code}
        className={`bag-tile ${stateClass}`}
        onClick={() => openBag(code)}
      >
        <div className="bag-code">{code}</div>
        <div className="bag-count">{status.count}</div>
      </div>
    );
  };

  const renderBlock = (rows) => (
    <div className="bags-block">
      {rows.map((row, i) => (
        <div key={i} className="bags-row">
          {row.map(renderBag)}
        </div>
      ))}
    </div>
  );

  const dialogHeader = (
    <div className="bag-dialog-header">
      <span>Bag {selectedBag}</span>
      <button
        className="bag-reset-btn"
        title="Reset this bag"
        onClick={handleResetBag}
        disabled={resetting}
      >
        <i className={resetting ? "pi pi-spin pi-spinner" : "pi pi-trash"} />
      </button>
    </div>
  );

  return (
    <div className="bags-page">
      <Toast ref={toastRef} />

      {/* ── Legend ── */}
      <div className="bags-legend">
        <div className="bags-legend__item">
          <span className="bags-legend__swatch bags-legend__swatch--normal" />
          Normal
        </div>
        <div className="bags-legend__item">
          <span className="bags-legend__swatch bags-legend__swatch--blocked" />
          Blocked
        </div>
        <div className="bags-legend__item">
          <span className="bags-legend__swatch bags-legend__swatch--full" />
          Full
        </div>
      </div>

      {loading ? (
        <div className="bags-loading"><ProgressSpinner /></div>
      ) : (
        <div className="bags-layout">

          {/* TOP — 7 columns x 3 rows, D001–D021 */}
          <div className="bags-top">
            {renderBlock(BAG_LAYOUT.top)}
          </div>

          <div className="carriage-bar">CARRIAGE</div>

          {/* BOTTOM — D022–D027 left, lifter in the middle, D028–D033 right */}
          <div className="bags-bottom">
            {renderBlock(BAG_LAYOUT.bottomLeft)}

            <div className="lifter-unit">
              <div className="lifter-label">LIFTER</div>
              <div className="lifter-ids">
                <div className="lifter-id">ID<br />1</div>
                <div className="lifter-id">ID<br />2</div>
              </div>
            </div>

            {renderBlock(BAG_LAYOUT.bottomRight)}
          </div>
        </div>
      )}

      <Dialog
        header={dialogHeader}
        visible={dialogVisible}
        style={{ width: 380 }}
        onHide={() => setDialogVisible(false)}
        className="bag-wbn-dialog"
        modal
      >
        {loadingWbns ? (
          <div className="bags-loading"><ProgressSpinner /></div>
        ) : (
          <>
            <div className="bag-stats-row">
              <div className="bag-stat">
                <span className="bag-stat__label">Count</span>
                <span className="bag-stat__value">{bagStats.count}</span>
              </div>
              <div className="bag-stat">
                <span className="bag-stat__label">Weight</span>
                <span className="bag-stat__value">{bagStats.weight}</span>
              </div>
              <div className="bag-stat">
                <span className="bag-stat__label">Real Volume</span>
                <span className="bag-stat__value">{bagStats.realvolume}</span>
              </div>
            </div>

            {bagWbns.length === 0 ? (
              <div className="empty-text">No parcels</div>
            ) : (
              <ul className="wbn-list">{bagWbns.map(w => <li key={w}>{w}</li>)}</ul>
            )}
          </>
        )}
      </Dialog>
    </div>
  );
};

export default BagsLayout;