import React, { useEffect, useState, useRef, useCallback } from "react";
import "../styles/AlarmDashboard.css";
import alarmDictionary from "../utils/alarmDictionary";

const WS_URL = "ws://localhost:5001/machine-status";
const RECONNECT_DELAY = 3000; // ms

const AlarmDashboard = ({ setActiveComponent }) => {
  const [alarms, setAlarms]           = useState({});
  const [wsStatus, setWsStatus]       = useState("connecting"); // "connecting" | "live" | "disconnected"
  const [lastUpdate, setLastUpdate]   = useState(null);

  // New — user-friendly filtering, purely client-side over the same
  // alarms state, no change to the WS data flow at all.
  const [search, setSearch]           = useState("");
  const [activeOnly, setActiveOnly]   = useState(false);

  const wsRef        = useRef(null);
  const reconnectRef = useRef(null);
  const pingRef      = useRef(null);

  // ── Connect / Reconnect ──────────────────────────────────────────────────
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setWsStatus("connecting");
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("✅ WS connected");
      setWsStatus("live");
      // Heartbeat every 20s to keep connection alive
      pingRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping" }));
        }
      }, 20000);
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);

        if (message.type === "pong") return; // heartbeat reply

        if (message.type === "ALARM_UPDATE") {
          const updated = message.data;
          setAlarms((prev) => {
            const next = { ...prev };
            Object.keys(updated).forEach((code) => {
              next[code] = updated[code];
            });
            return next;
          });
          setLastUpdate(new Date(message.time || Date.now()));
        }
      } catch (err) {
        console.error("WS parse error:", err);
      }
    };

    ws.onerror = () => {
      setWsStatus("disconnected");
    };

    ws.onclose = () => {
      clearInterval(pingRef.current);
      setWsStatus("disconnected");
      console.log("🔌 WS closed — reconnecting in 3s…");
      // Auto-reconnect
      reconnectRef.current = setTimeout(connect, RECONNECT_DELAY);
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectRef.current);
      clearInterval(pingRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  // ── Derived stats ────────────────────────────────────────────────────────
  const allCodes   = Object.keys(alarmDictionary);
  const total      = allCodes.length;
  const activeCount = allCodes.filter(code => alarms[code] === 1).length;
  const normalCount = total - activeCount;

  // Separate active alarms to the top
  const sortedCodes = [
    ...allCodes.filter(code => alarms[code] === 1),
    ...allCodes.filter(code => alarms[code] !== 1),
  ];

  // Apply search + active-only filters on top of the active-first sort
  const q = search.trim().toLowerCase();
  const visibleCodes = sortedCodes.filter((code) => {
    if (activeOnly && alarms[code] !== 1) return false;
    if (!q) return true;
    const msg = (alarmDictionary[code]?.message || "").toLowerCase();
    return code.toLowerCase().includes(q) || msg.includes(q);
  });

  return (
    <div className="adash">

      {/* ── Header ── */}
      <div className="adash__header">
        <div className="adash__header-left">
          <h1 className="adash__title">Machine Alarm Status</h1>
          {lastUpdate && (
            <span className="adash__last-update">
              Updated: {lastUpdate.toLocaleTimeString("en-IN", { hour12: false, timeZone: "Asia/Kolkata" })} IST
            </span>
          )}
        </div>

        <div className="adash__stats">
          {/* History button */}
          <button
            className="adash__hist-btn"
            onClick={() => setActiveComponent("Alarm History")}
          >
            🕐 History
          </button>

          <div className="adash__stat">
            <span className="adash__stat-label">Total</span>
            <strong className="adash__stat-val">{total}</strong>
          </div>
          <div className="adash__stat adash__stat--red">
            <span className="adash__stat-label">Active</span>
            <strong className="adash__stat-val">{activeCount}</strong>
          </div>
          <div className="adash__stat adash__stat--green">
            <span className="adash__stat-label">Normal</span>
            <strong className="adash__stat-val">{normalCount}</strong>
          </div>

          {/* Live / status badge */}
          <div className={`adash__live-badge adash__live-badge--${wsStatus}`}>
            {wsStatus === "live"         && <><span className="adash__live-dot" />LIVE</>}
            {wsStatus === "connecting"   && <>⟳ CONNECTING</>}
            {wsStatus === "disconnected" && <>⚠ DISCONNECTED</>}
          </div>
        </div>
      </div>

      {/* ── Active alarms banner ── */}
      {activeCount > 0 && (
        <div className="adash__active-banner">
          🚨 {activeCount} alarm{activeCount > 1 ? "s" : ""} currently active
        </div>
      )}

      {/* Disconnected warning */}
      {wsStatus === "disconnected" && (
        <div className="adash__warn-banner">
          ⚠️ WebSocket disconnected — attempting to reconnect. Displayed state may be stale.
        </div>
      )}

      {/* ── Search + Active-only filter row ── */}
      <div className="adash__filter-row">
        <div className="adash__search-wrap">
          <span className="adash__search-icon">🔍</span>
          <input
            className="adash__search-input"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter by code or message…"
          />
          {search && (
            <button className="adash__search-clear" onClick={() => setSearch("")}>✕</button>
          )}
        </div>

        <label className="adash__toggle-wrap">
          <span className="adash__toggle-label">Active only</span>
          <div
            className={`adash__toggle ${activeOnly ? "adash__toggle--on" : ""}`}
            onClick={() => setActiveOnly(a => !a)}
            role="switch"
            aria-checked={activeOnly}
          >
            <div className="adash__toggle-thumb" />
          </div>
        </label>

        {visibleCodes.length !== sortedCodes.length && (
          <span className="adash__filter-count">{visibleCodes.length} / {sortedCodes.length} shown</span>
        )}
      </div>

      {/* ── Alarm Grid — scrollable container, doesn't push page content
           below the viewport once there are enough tiles ── */}
      <div className="adash__grid-wrap">
        {visibleCodes.length === 0 ? (
          <div className="adash__empty">
            {activeOnly ? "No active alarms right now." : "No alarms match this filter."}
          </div>
        ) : (
          <div className="adash__grid">
            {visibleCodes.map((code) => {
              const isActive = alarms[code] === 1;
              return (
                <div
                  key={code}
                  className={`adash__tile ${isActive ? "adash__tile--active" : "adash__tile--normal"}`}
                >
                  <div className="adash__tile-code">{code}</div>
                  <div className="adash__tile-msg">
                    {alarmDictionary[code]?.message || "Unknown alarm"}
                  </div>
                  <div className={`adash__tile-status ${isActive ? "adash__tile-status--active" : ""}`}>
                    {isActive
                      ? <><span className="adash__pulse" />ACTIVE</>
                      : "NORMAL"
                    }
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
};

export default AlarmDashboard;