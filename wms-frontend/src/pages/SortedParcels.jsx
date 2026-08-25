import React, { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { InputText } from "primereact/inputtext";
import { Button } from "primereact/button";
import { Toast } from "primereact/toast";
import { Dialog } from "primereact/dialog";

import "primereact/resources/themes/saga-blue/theme.css";
import "primereact/resources/primereact.min.css";
import "primeicons/primeicons.css";

import "../styles/SortedParcels.css";

const API_BASE = "http://localhost:5001/api";

const SortedParcels = () => {
  const [data, setData] = useState([]);
  const [totalRecords, setTotalRecords] = useState(0);
  const [loading, setLoading] = useState(false);

  const [page, setPage] = useState(0);
  const [first, setFirst] = useState(0);
  const [rows, setRows] = useState(50);

  const [searchWbn, setSearchWbn] = useState("");

  const [payloadDialog, setPayloadDialog] = useState(false);
  const [selectedPayload, setSelectedPayload] = useState(null);

  const toastRef = React.useRef(null);

  // ---------------- Fetch Data ----------------
  const fetchData = useCallback(async (p = page, r = rows) => {
    try {
      setLoading(true);

      const params = {
        page: p + 1,
        limit: r,
        wbn: searchWbn || undefined,
      };

      const res = await axios.get(`${API_BASE}/sorted-payloads`, { params });

      if (res.data?.success) {
        setData(res.data.rows);
        setTotalRecords(res.data.total);
      }
    } catch (err) {
      toastRef.current?.show({
        severity: "error",
        summary: "Error",
        detail: "Failed to load sorted parcels",
      });
    } finally {
      setLoading(false);
    }
  }, [page, rows, searchWbn]);

  useEffect(() => {
    fetchData();
  }, []);

  // ---------------- Actions ----------------
  const handleSearch = () => {
    setPage(0);
    setFirst(0);
    fetchData(0, rows);
  };

  const handleReset = () => {
    setSearchWbn("");
    setPage(0);
    setFirst(0);
    fetchData(0, rows);
  };

  // ---------------- Templates ----------------
  const snoTemplate = (_, options) => options.rowIndex + 1 + first;

  const timeTemplate = (row) =>
    row.updated_at
      ? new Date(row.updated_at).toLocaleString()
      : "—";

  const payloadTemplate = (row) => (
    <Button
      label="View"
      icon="pi pi-eye"
      className="p-button-text"
      onClick={() => {
        setSelectedPayload(row.payload);
        setPayloadDialog(true);
      }}
    />
  );

  // ---------------- UI ----------------
  return (
    <div className="sp-page">
      <Toast ref={toastRef} />

      {/* Header */}
      <div className="sp-header">
        <div>
          <h2>Sorted Parcels</h2>
          <p>Successfully sorted payload records</p>
        </div>

        <div className="sp-actions">
          <InputText
            value={searchWbn}
            onChange={(e) => setSearchWbn(e.target.value)}
            placeholder="Search WBN"
            style={{ width: "200px" }}
          />
          <Button
            label="Search"
            icon="pi pi-search"
            onClick={handleSearch}
          />
          <Button
            label="Reset"
            icon="pi pi-refresh"
            className="p-button-secondary"
            onClick={handleReset}
          />
        </div>
      </div>

      {/* Table */}
      <div className="sp-table-card">
        <DataTable
          value={data}
          paginator
          lazy
          first={first}
          rows={rows}
          totalRecords={totalRecords}
          loading={loading}
          rowsPerPageOptions={[50, 100, 200]}
          onPage={(e) => {
            setFirst(e.first);
            setRows(e.rows);
            setPage(e.page);
            fetchData(e.page, e.rows);
          }}
          scrollable
          scrollHeight="65vh"
        >
          <Column header="S.No" body={snoTemplate} style={{ width: "80px" }} />
          <Column field="wbn" header="WBN" style={{ width: "200px" }} />
          <Column header="Payload" body={payloadTemplate} style={{ width: "120px" }} />
          <Column header="Time" body={timeTemplate} style={{ width: "220px" }} />
        </DataTable>
      </div>

      {/* Payload Dialog */}
      <Dialog
        header="Payload"
        visible={payloadDialog}
        style={{ width: "60vw" }}
        onHide={() => setPayloadDialog(false)}
      >
        <pre className="sp-payload">
          {JSON.stringify(selectedPayload, null, 2)}
        </pre>
      </Dialog>
    </div>
  );
};

export default SortedParcels;
