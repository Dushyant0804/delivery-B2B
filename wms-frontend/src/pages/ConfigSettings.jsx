// src/pages/ConfigSettings.jsx
import React, { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { InputSwitch } from "primereact/inputswitch";
import { Dialog } from "primereact/dialog";
import { ProgressSpinner } from "primereact/progressspinner";
import { Toast } from "primereact/toast";
import "primereact/resources/themes/saga-blue/theme.css";
import "primereact/resources/primereact.min.css";
import "primeicons/primeicons.css";
import { ConfirmDialog, confirmDialog } from "primereact/confirmdialog";
import Footer from "../components/Footer";
import Swal from "sweetalert2";


import "../styles/configSettings.css";

const API_BASE = "http://localhost:5001/api"; // adjust if your backend prefix is different
const SAMPLE_CSV_URL = "/assets/files/sample-files/Sample_Config.csv"; // adjust if needed

const ConfigSettings = () => {
  const [configs, setConfigs] = useState([]);
  const [loadingConfigs, setLoadingConfigs] = useState(false);

  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);

  const [viewVisible, setViewVisible] = useState(false);
  const [viewLoading, setViewLoading] = useState(false);
  const [viewData, setViewData] = useState({ columns: [], rows: [], totalRows: 0 });
  const [viewTitle, setViewTitle] = useState("");

  const toastRef = React.useRef(null);

  // ---------- Fetch Config List ----------
  const fetchConfigs = useCallback(async () => {
    try {
      setLoadingConfigs(true);
      const res = await axios.get(`${API_BASE}/configs/ptl`);
      setConfigs(res.data || []);
    } catch (err) {
      console.error(err);
      toastRef.current?.show({
        severity: "error",
        summary: "Error",
        detail: "Failed to load configurations.",
        life: 4000,
      });
    } finally {
      setLoadingConfigs(false);
    }
  }, []);

  useEffect(() => {
    fetchConfigs();
    const interval = setInterval(fetchConfigs, 8000); // poll every 8s
    return () => clearInterval(interval);
  }, [fetchConfigs]);

  // ---------- File Upload ----------
  const handleFileChange = (e) => {
    const f = e.target.files?.[0];
    setFile(f || null);
  };

  const handleSampleDownload = () => {
    window.location.href = `${API_BASE}/configs/ptl/sample/download`;
  };

  // const handleUpload = async () => {
  //   if (!file) {
  //     toastRef.current?.show({
  //       severity: "warn",
  //       summary: "No File",
  //       detail: "Please select a CSV file first.",
  //       life: 3000,
  //     });
  //     return;
  //   }

  //   const formData = new FormData();
  //   formData.append("file", file);

  //   try {
  //     setUploading(true);
  //     const res = await axios.post(`${API_BASE}/configs/ptl/upload`, formData, {
  //       headers: { "Content-Type": "multipart/form-data" },
  //     });

  //     if (res.data?.success) {
  //       toastRef.current?.show({
  //         severity: "success",
  //         summary: "Upload Started",
  //         detail: "Configuration is being processed in background.",
  //         life: 4000,
  //       });
  //       setFile(null);
  //       // re-fetch list to show new row with PROCESSING
  //       fetchConfigs();
  //     } else {
  //       throw new Error(res.data?.error || "Upload failed");
  //     }
  //   } catch (err) {
  //     console.error(err);
  //     toastRef.current?.show({
  //       severity: "error",
  //       summary: "Upload Error",
  //       detail: err.message || "Failed to upload CSV.",
  //       life: 5000,
  //     });
  //   } finally {
  //     setUploading(false);
  //   }
  // };

  const handleUpload = async () => {
    if (!file) {
      toastRef.current?.show({
        severity: "warn",
        summary: "No File",
        detail: "Please select a CSV file first.",
        life: 3000,
      });
      return;
    }

    const formData = new FormData();
    formData.append("file", file);

    try {
      setUploading(true);

      const res = await axios.post(
        `${API_BASE}/configs/ptl/upload`,
        formData,
        { headers: { "Content-Type": "multipart/form-data" } }
      );

      if (res.data?.success) {
        toastRef.current?.show({
          severity: "success",
          summary: "Upload Started",
          detail: "Configuration is being processed in background.",
          life: 4000,
        });

        setFile(null);
        fetchConfigs(); // refresh table
        return;
      }

      // should not reach here normally
      throw new Error("Upload failed");

    } catch (err) {
      console.error("PTL Upload Error:", err);

      const data = err?.response?.data;

      // ✅ CASE 1: CSV validation errors (row-wise)
      if (Array.isArray(data?.errors) && data.errors.length > 0) {
        Swal.fire({
          icon: "error",
          title: "CSV Validation Failed",
          html: `
          <div style="text-align:left; max-height:320px; overflow:auto;">
            ${data.errors
              .map(
                e => `
                  <div style="margin-bottom:8px;">
                    <b>Row ${e.row}</b> — ${e.message}
                  </div>
                `
              )
              .join("")}
          </div>
        `,
          width: 720,
          confirmButtonText: "Fix CSV",
        });

        fetchConfigs(); // 🔥 ensure ERROR rows appear
        return;
      }

      // ✅ CASE 2: Backend business error
      toastRef.current?.show({
        severity: "error",
        summary: "Upload Failed",
        detail:
          data?.message ||
          data?.reason ||
          data?.error ||
          err.message ||
          "Failed to upload CSV.",
        life: 5000,
      });

      fetchConfigs(); // 🔥 always refresh

    } finally {
      setUploading(false);
    }
  };


  // ---------- Activation / Deactivation ----------
  const handleActivateToggle = async (cfg, value) => {

    // ------------------ CASE 1: DEACTIVATE ------------------
    if (!value) {
      try {
        const res = await axios.post(`${API_BASE}/configs/ptl/${cfg.id}/deactivate`);
        if (res.data?.success) {
          toastRef.current?.show({
            severity: "success",
            summary: "Deactivated",
            detail: `${cfg.name} has been deactivated.`,
            life: 3000,
          });

          await fetchConfigs(); // refresh UI
        } else {
          throw new Error(res.data?.error || "Deactivation failed");
        }
      } catch (err) {
        const backendMsg =
          err.response?.data?.error ||
          err.message ||
          "Deactivation failed";

        Swal.fire({
          icon: "warning",
          title: "Cannot Deactivate Config",
          html: `
      <div style="text-align:left">
        <p>${backendMsg}</p>
        ${err.response?.data?.bags
              ? `<b>Bags with parcels:</b><br/>
               ${err.response.data.bags.join("<br/>")}`
              : ""
            }
      </div>
    `,
          confirmButtonText: "OK"
        });
      }
      return;
    }

    // ------------------ CASE 2: ACTIVATE ------------------

    // 🔥 ALWAYS fetch fresh list (DO NOT trust React state)
    const fresh = (await axios.get(`${API_BASE}/configs/ptl`)).data;

    const activeOther = fresh.find((c) => c.is_active && c.id !== cfg.id);

    if (activeOther) {
      confirmDialog({
        header: "Another configuration is active",
        message: "Please deactivate the currently active configuration first.",
        icon: "pi pi-exclamation-triangle",
        acceptLabel: "OK",
        rejectClassName: "p-hidden",
        accept: () => { },
      });
      return;
    }

    // Activate this config
    try {
      const res = await axios.post(`${API_BASE}/configs/ptl/${cfg.id}/activate`);

      if (res.data?.success) {
        toastRef.current?.show({
          severity: "success",
          summary: "Activated",
          detail: `${cfg.name} is now active.`,
          life: 3000,
        });

        await fetchConfigs(); // reload table
      }
    } catch (err) {
      toastRef.current?.show({
        severity: "error",
        summary: "Activation Error",
        detail: err.response?.data?.error || err.message,
        life: 5000,
      });
    }
  };


  // ---------- Switch Column ----------
  const activateBodyTemplate = (rowData) => {
    const disabled = rowData.status !== "READY";

    return (
      <div className="cs-activate-cell">
        <InputSwitch
          checked={!!rowData.is_active}
          disabled={disabled}
          onChange={(e) => handleActivateToggle(rowData, e.value)}
        />
      </div>
    );
  };


  // ---------- Status Tag ----------
  const statusTemplate = (rowData) => {
    const status = rowData.status;
    let cls = "cs-status-tag cs-status-processing";
    let label = status;

    if (status === "READY") {
      cls = "cs-status-tag cs-status-ready";
      label = "Ready";
    } else if (status === "ERROR") {
      cls = "cs-status-tag cs-status-error";
      label = "Error";
    } else if (status === "PROCESSING") {
      cls = "cs-status-tag cs-status-processing";
      label = "Processing";
    }

    return <span className={cls}>{label}</span>;
  };

  // ---------- Date Formatting ----------
  const formatDateTime = (value) => {
    if (!value) return "--";
    const d = new Date(value);
    if (isNaN(d.getTime())) return value;
    return d.toLocaleString();
  };

  const lastActivatedTemplate = (rowData) => (
    <span>{formatDateTime(rowData.last_activated_at)}</span>
  );
  const lastDeactivatedTemplate = (rowData) => (
    <span>{formatDateTime(rowData.last_deactivated_at)}</span>
  );

  // ---------- Actions: View / Download / Delete ----------
  const handleView = async (cfg) => {
    try {
      setViewTitle(cfg.name);
      setViewVisible(true);
      setViewLoading(true);

      const res = await axios.get(
        `${API_BASE}/configs/ptl/${cfg.id}/view`
      );

      const { columns, rows, totalRows } = res.data || {};
      setViewData({
        columns: columns || [],
        rows: rows || [],
        totalRows: totalRows || (rows ? rows.length : 0),
      });
    } catch (err) {
      console.error(err);
      toastRef.current?.show({
        severity: "error",
        summary: "View Error",
        detail: "Failed to load file preview.",
        life: 4000,
      });
      setViewVisible(false);
    } finally {
      setViewLoading(false);
    }
  };

  const handleDownload = (cfg) => {
    window.open(
      `${API_BASE}/configs/ptl/${cfg.id}/download`,
      "_blank"
    );
  };

  const handleDelete = (cfg) => {
    confirmDialog({
      header: "Delete Configuration",
      message: `Are you sure you want to delete "${cfg.name}"?`,
      icon: "pi pi-trash",
      acceptClassName: "p-button-danger",
      acceptLabel: "Delete",
      accept: async () => {
        try {
          await axios.delete(`${API_BASE}/configs/ptl/${cfg.id}`);
          toastRef.current?.show({
            severity: "success",
            summary: "Deleted",
            detail: "Configuration deleted successfully.",
            life: 3000,
          });
          fetchConfigs();
        } catch (err) {
          console.error(err);
          toastRef.current?.show({
            severity: "error",
            summary: "Delete Error",
            detail: err.response?.data?.error || "Failed to delete configuration.",
            life: 4000,
          });
        }
      },
    });
  };

  const actionsTemplate = (rowData) => (
    <div className="cs-actions">
      <Button
        icon="pi pi-eye"
        className="p-button-rounded p-button-text cs-btn-view"
        onClick={() => handleView(rowData)}
        tooltip="View file"
      />
      <Button
        icon="pi pi-download"
        className="p-button-rounded p-button-text cs-btn-download"
        onClick={() => handleDownload(rowData)}
        tooltip="Download file"
      />
      <Button
        icon="pi pi-trash"
        className="p-button-rounded p-button-text p-button-danger cs-btn-delete"
        onClick={() => handleDelete(rowData)}
        disabled={rowData.is_active}
        tooltip={rowData.is_active ? "Deactivate first to delete" : "Delete"}
      />
    </div>
  );

  // ---------- Upload Panel ----------
  const uploadCard = (
    <div className="cs-upload-card">
      <div className="cs-upload-dropzone">
        <div className="cs-upload-icon pi pi-upload" />
        <div className="cs-upload-text-main">Select a CSV file to upload</div>
        <div className="cs-upload-text-sub">or drag and drop it here</div>

        <label className="cs-upload-file-label">
          <input
            type="file"
            accept=".csv"
            onChange={handleFileChange}
            className="cs-upload-file-input"
          />
          <span className="cs-upload-file-button">
            {file ? file.name : "Choose File"}
          </span>
        </label>
      </div>

      <div className="cs-upload-actions">
        <Button
          label="Sample CSV"
          icon="pi pi-download"
          className="p-button-sm p-button-success cs-upload-sample-btn"
          onClick={handleSampleDownload}
        />
        <Button
          label={uploading ? "Uploading..." : "Upload CSV"}
          icon={uploading ? "pi pi-spin pi-spinner" : "pi pi-cloud-upload"}
          className="p-button-sm cs-upload-submit-btn"
          disabled={!file || uploading}
          onClick={handleUpload}
        />
      </div>
    </div>
  );

  // ---------- View/Preview Dialog ----------
  const previewFooter = (
    <div className="cs-dialog-footer">
      <Button label="Close" onClick={() => setViewVisible(false)} />
    </div>
  );

  return (
    <div className="cs-page-wrapper">
      <div className="cs-page">
        <Toast ref={toastRef} />
        <ConfirmDialog />

        <div className="cs-page-header">
          <div className="cs-page-title">Config Settings</div>
          <div className="cs-page-subtitle">
            Manage PTL configuration files and bag mapping rules.
          </div>
        </div>

        <div className="cs-page-content">
          {uploadCard}

          <div className="cs-table-card">
            <div className="cs-table-header">
              <div className="cs-table-title">PTL Config Files</div>
              <div className="cs-table-subtitle">
                Activate one configuration at a time. Older configs can be re-activated.
              </div>
            </div>

            <DataTable
              value={configs}
              paginator
              rows={10}
              rowsPerPageOptions={[10, 20, 50]}
              loading={loadingConfigs}
              className="cs-table"
              responsiveLayout="stack"
            >
              <Column
                header="ACTIVATE"
                body={activateBodyTemplate}
                style={{ width: "120px" }}
              />
              <Column field="id" header="CONFIG ID" style={{ width: "110px" }} />
              <Column field="name" header="CONFIG NAME" />
              <Column
                field="type"
                header="CONFIG TYPE"
                style={{ width: "110px" }}
              />
              <Column
                header="STATUS"
                body={statusTemplate}
                style={{ width: "130px" }}
              />
              <Column
                header="LAST ACTIVATED TIME"
                body={lastActivatedTemplate}
              />
              <Column
                header="LAST DEACTIVATED TIME"
                body={lastDeactivatedTemplate}
              />
              <Column
                header="ACTION"
                body={actionsTemplate}
                style={{ width: "150px" }}
              />
            </DataTable>
          </div>
        </div>

        <Dialog
          visible={viewVisible}
          onHide={() => setViewVisible(false)}
          header={`Preview - ${viewTitle}`}
          className="cs-dialog"
          footer={previewFooter}
          maximizable
          modal
        >
          {viewLoading ? (
            <div className="cs-dialog-loading">
              <ProgressSpinner />
              <span>Loading full file...</span>
            </div>
          ) : (
            <div className="cs-dialog-table-wrapper">
              {viewData.rows.length === 0 ? (
                <div className="cs-dialog-empty">No data found in file.</div>
              ) : (
                <DataTable
                  value={viewData.rows}
                  scrollable
                  scrollHeight="60vh"
                  className="cs-dialog-table"
                >
                  {viewData.columns.map((col) => (
                    <Column
                      key={col}
                      field={col}
                      header={col}
                      style={{ minWidth: "180px" }}
                    />
                  ))}
                </DataTable>
              )}
            </div>
          )}
        </Dialog>
      </div>
    </div>
  );
};

export default ConfigSettings;
