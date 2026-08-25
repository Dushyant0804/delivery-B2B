// src/pages/BagManagement.jsx
import React, { useEffect, useState, useCallback, useMemo } from "react";
import axios from "axios";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { Dropdown } from "primereact/dropdown";
import { MultiSelect } from "primereact/multiselect";
import { InputText } from "primereact/inputtext";
import { Chips } from "primereact/chips";
import { SelectButton } from "primereact/selectbutton";
import { Toast } from "primereact/toast";
import { ConfirmDialog, confirmDialog } from "primereact/confirmdialog";
import Swal from "sweetalert2";

import "../styles/bagManager.css";

const API_BASE = "http://localhost:5001/api";
const PAGE_SIZE = 100;
const isAdmin = () => localStorage.getItem("username") === "admin";

// Same First/Prev/pages/Next/Last pagination builder used on the
// Parcels report page, for a consistent UX across both tables.
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

const BagManagement = () => {
  // Table states
  const [data, setData] = useState([]);
  const [totalRecords, setTotalRecords] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1); // 1-indexed

  // Filters
  const [filterBagCode, setFilterBagCode] = useState("");
  const [filterRejCode, setFilterRejCode] = useState("");

  // Summary counts
  const regularCount = data.filter(r => r.type === "REGULAR").length;
  const directCount = data.filter(r => r.type === "DIRECT").length;
  const rejectedCount = data.filter(r => r.type === "REJECTED").length;

  // Dialog states
  const [dialogVisible, setDialogVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingRow, setEditingRow] = useState(null);

  const [formType, setFormType] = useState("REGULAR");
  const [bagCode, setBagCode] = useState(null);
  const [ptlIds, setPtlIds] = useState([]);
  const [rejectionCodes, setRejectionCodes] = useState([]);

  // CSV bulk-upload dialog states — nothing is ever saved to disk here,
  // the file is parsed in memory and thrown away after the request.
  const [uploadDialogVisible, setUploadDialogVisible] = useState(false);
  const [uploadFile, setUploadFile] = useState(null);
  const [uploading, setUploading] = useState(false);

  const toastRef = React.useRef(null);

  // Dropdown Bag Codes (D001–D100 + R001–R010)
  const bagCodeOptions = useMemo(() => {
    const list = [];
    for (let i = 1; i <= 100; i++) {
      const code = `D${String(i).padStart(3, "0")}`;
      list.push({ label: code, value: code });
    }
    for (let i = 1; i <= 10; i++) {
      const code = `R${String(i).padStart(3, "0")}`;
      list.push({ label: code, value: code });
    }
    return list;
  }, []);

  const rejectionOptions = [
    "DBO", "IBO", "MSE", "NDIM_UD", "NDIM_OD", "UK", "MR", "DNF", "UNX", "HV", "REJ", "NSZ", "AR", "LMM", "DUP", "CHUTE_FULL"
  ].map(v => ({ label: v, value: v }));

  const typeOptions = useMemo(() => {
    const base = [
      { label: "Regular", value: "REGULAR" },
      { label: "Direct", value: "DIRECT" },
      { label: "Rejected", value: "REJECTED" },
    ];
    if (!editingRow) return base;
    const isRejectedRow = editingRow.type === "REJECTED";
    return base.map((opt) => ({
      ...opt,
      disabled: isRejectedRow ? opt.value !== "REJECTED" : opt.value === "REJECTED",
    }));
  }, [editingRow]);

  // ------------------- Fetch Page -------------------
  const fetchPage = useCallback(async (p = page) => {
    try {
      setLoading(true);

      const params = {
        page: p,
        limit: PAGE_SIZE,
        bag_code: filterBagCode || undefined,
        rejection_code: filterRejCode || undefined,
      };

      const res = await axios.get(`${API_BASE}/bag-mappings`, { params });

      if (res.data.success) {
        setData(res.data.rows);
        setTotalRecords(res.data.total);
      }
    } catch (err) {
      console.error(err);
      toastRef.current?.show({
        severity: "error",
        summary: "Error",
        detail: "Failed to load bag mappings.",
      });
    } finally {
      setLoading(false);
    }
  }, [page, filterBagCode, filterRejCode]);

  useEffect(() => {
    fetchPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------- Search + Refresh -------------------
  const handleRefresh = () => {
    setPage(1);
    fetchPage(1);
  };

  const handleFilterKeyDown = (e) => {
    if (e.key === "Enter") handleRefresh();
  };

  const goToPage = (p) => {
    setPage(p);
    fetchPage(p);
  };

  // ------------------- Open Dialogs -------------------
  const resetForm = () => {
    setFormType("REGULAR");
    setBagCode(null);
    setPtlIds([]);
    setRejectionCodes([]);
    setEditingRow(null);
  };

  const openNew = () => {
    resetForm();
    setDialogVisible(true);
  };

  const openEdit = (row) => {
    setEditingRow(row);
    setFormType(row.type);
    setBagCode(row.bag_code);
    setPtlIds(row.ptl_ids || []);
    setRejectionCodes(row.rejection_codes || []);
    setDialogVisible(true);
  };

  // ------------------- Save Mapping -------------------
  const handleSave = async () => {
    if (!bagCode) {
      toastRef.current.show({ severity: "warn", summary: "Missing", detail: "Bag code required" });
      return;
    }

    if (formType === "REGULAR" || formType === "DIRECT") {
      if (!ptlIds.length) {
        toastRef.current.show({ severity: "warn", summary: "PTL required", detail: "Add at least one PTL ID" });
        return;
      }
    }

    const payload = {
      bag_code: bagCode,
      type: formType,
      ptl_ids: formType === "REGULAR" || formType === "DIRECT" ? ptlIds : [],
      rejection_codes: formType === "REJECTED" ? rejectionCodes : []
    };

    try {
      setSaving(true);

      if (editingRow) {
        await axios.put(`${API_BASE}/bag-mappings/${editingRow.id}`, payload);
      } else {
        await axios.post(`${API_BASE}/bag-mappings`, payload);
      }

      setDialogVisible(false);
      handleRefresh();
    } catch (err) {
      console.error(err);
      Swal.fire({
        icon: "warning",
        title: "Action Blocked",
        text: err.response?.data?.error || "Operation not allowed",
        confirmButtonText: "OK"
      });
    } finally {
      setSaving(false);
    }
  };

  // ------------------- Delete -------------------
  const deleteRow = (row) => {
    confirmDialog({
      header: "Delete Mapping",
      message: `Delete bag ${row.bag_code}?`,
      acceptClassName: "p-button-danger",
      accept: async () => {
        try {
          await axios.delete(`${API_BASE}/bag-mappings/${row.id}`);
          handleRefresh();
        } catch (err) {
          Swal.fire({
            icon: "warning",
            title: "Action Blocked",
            text: err.response?.data?.error || "Operation not allowed",
            confirmButtonText: "OK"
          });
        }
      }
    });
  };

  const triggerNodeRedClearAll = async () => {
    try {
      await axios.post("http://localhost:1880/clear-all-bags", { payload: true });
    } catch (err) {
      console.error("Node-RED trigger failed", err);
      toastRef.current?.show({
        severity: "warn",
        summary: "Node-RED",
        detail: "Failed to notify Node-RED",
      });
    }
  };

  const handleClearAllBags = () => {
    if (!isAdmin()) {
      Swal.fire("Permission Denied", "Only admin can perform this action", "error");
      return;
    }

    Swal.fire({
      title: "⚠️ Clear ALL Bags?",
      html: `
        <b>This will remove ALL parcels from ALL bags.</b><br/>
        This action cannot be undone.
      `,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Yes, Clear All",
      cancelButtonText: "Cancel",
      confirmButtonColor: "#D71920",
    }).then(async (result) => {
      if (!result.isConfirmed) return;

      try {
        await axios.post(`${API_BASE}/bag-mappings/clear-all-wbns`);

        toastRef.current?.show({
          severity: "success",
          summary: "Cleared",
          detail: "All bags have been cleared successfully",
        });

        handleRefresh();
      } catch (err) {
        Swal.fire(
          "Failed",
          err.response?.data?.error || "Clear operation failed",
          "error"
        );
      }
    });
  };

  const clearBagWbns = (row) => {
    if (!isAdmin()) {
      Swal.fire({
        icon: "error",
        title: "Permission Denied",
        text: "Only admin can clear WBNs from a bag",
      });
      return;
    }

    confirmDialog({
      header: "Clear Bag WBNs",
      message: `This will remove ALL parcels from bag ${row.bag_code}. Continue?`,
      icon: "pi pi-exclamation-triangle",
      acceptClassName: "p-button-danger",
      accept: async () => {
        try {
          await axios.post(`${API_BASE}/bag-mappings/clear-all-wbns`);
          await triggerNodeRedClearAll();

          toastRef.current?.show({
            severity: "success",
            summary: "Cleared",
            detail: "All bags cleared & Node-RED notified",
          });

          handleRefresh();
        } catch (err) {
          Swal.fire(
            "Failed",
            err.response?.data?.error || "Clear operation failed",
            "error"
          );
        }
      },
    });
  };

  // ------------------- CSV Bulk Upload -------------------
  const handleUploadFileChange = (e) => {
    const f = e.target.files?.[0];
    setUploadFile(f || null);
  };

  const handleSampleDownload = () => {
    window.location.href = `${API_BASE}/bag-mappings/sample/download`;
  };

  const openUploadDialog = () => {
    setUploadFile(null);
    setUploadDialogVisible(true);
  };

  const handleCsvUpload = async () => {
    if (!uploadFile) {
      toastRef.current?.show({
        severity: "warn",
        summary: "No File",
        detail: "Please select a CSV file first.",
        life: 3000,
      });
      return;
    }

    const formData = new FormData();
    formData.append("file", uploadFile);

    try {
      setUploading(true);

      const res = await axios.post(`${API_BASE}/bag-mappings/upload-csv`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      if (res.data?.success) {
        toastRef.current?.show({
          severity: "success",
          summary: "Upload Complete",
          detail: res.data.message,
          life: 5000,
        });
        setUploadFile(null);
        setUploadDialogVisible(false);
        handleRefresh();
      }
    } catch (err) {
      console.error("Bag mapping CSV upload error:", err);
      const data = err?.response?.data;

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
        return;
      }

      Swal.fire({
        icon: "error",
        title: "Upload Failed",
        text: data?.error || data?.message || err.message || "Failed to upload CSV.",
        confirmButtonText: "OK",
      });
    } finally {
      setUploading(false);
    }
  };

  // ------------------- Table Templates -------------------
  const typeTemplate = (row) =>
    <span className={`bm-type-tag bm-type-${row.type.toLowerCase()}`}>{row.type}</span>;

  const ptlTemplate = (row) =>
    row.ptl_ids?.length ? row.ptl_ids.join(", ") : <span className="bm-muted">—</span>;

  const rejTemplate = (row) =>
    row.rejection_codes?.length ? row.rejection_codes.join(", ") : <span className="bm-muted">—</span>;

  const updatedAtTemplate = (row) =>
    row.updated_at ? new Date(row.updated_at).toLocaleString() : "—";

  const actionsTemplate = (row) => (
    <div className="bm-actions">
      <Button icon="pi pi-pencil" className="p-button-text bm-btn-edit" onClick={() => openEdit(row)} />
      <Button icon="pi pi-trash" className="p-button-text p-button-danger bm-btn-delete" onClick={() => deleteRow(row)} />
      <Button icon="pi pi-times-circle" className="p-button-text p-button-warning bm-btn-clear" tooltip="Clear all WBNs" tooltipOptions={{ position: "top" }} onClick={() => clearBagWbns(row)} disabled={!isAdmin()} />
    </div>
  );

  const totalPages = Math.max(1, Math.ceil(totalRecords / PAGE_SIZE));

  // ------------------- UI -------------------
  return (
    <div className="bm-page">
      <Toast ref={toastRef} />
      <ConfirmDialog />

      {/* Header */}
      <div className="bm-header">
        <div>
          <h1 className="bm-title">Bag Manager</h1>
          {/* <p className="bm-subtitle">Manage Regular, Direct &amp; Rejected bags and PTL mappings</p> */}
        </div>
        <span className="bm-total-count">{totalRecords.toLocaleString()} bags</span>
      </div>

      {/* Summary cards */}
      <div className="bm-summary-row">
        <div className="bm-summary-card">
          <div className="bm-summary-label">Total Bags</div>
          <div className="bm-summary-value">{totalRecords}</div>
        </div>
        <div className="bm-summary-card bm-summary-card--regular">
          <div className="bm-summary-label">Regular</div>
          <div className="bm-summary-value">{regularCount}</div>
        </div>
        <div className="bm-summary-card bm-summary-card--direct">
          <div className="bm-summary-label">Direct</div>
          <div className="bm-summary-value">{directCount}</div>
        </div>
        <div className="bm-summary-card bm-summary-card--rejected">
          <div className="bm-summary-label">Rejected</div>
          <div className="bm-summary-value">{rejectedCount}</div>
        </div>
      </div>

      {/* Filter card */}
      <div className="bm-filter-card">
        <div className="bm-filter-row">
          <div className="bm-field-group">
            <label className="bm-field-label">Bag Code</label>
            <InputText
              value={filterBagCode}
              onChange={(e) => setFilterBagCode(e.target.value)}
              onKeyDown={handleFilterKeyDown}
              placeholder="Search bag code…"
              className="bm-field-input"
            />
          </div>

          <div className="bm-field-group">
            <label className="bm-field-label">Rejection Code</label>
            <InputText
              value={filterRejCode}
              onChange={(e) => setFilterRejCode(e.target.value)}
              onKeyDown={handleFilterKeyDown}
              placeholder="Search rejection code…"
              className="bm-field-input"
            />
          </div>
        </div>

        <div className="bm-filter-actions">
          <Button label="Refresh" icon="pi pi-refresh" onClick={handleRefresh} className="bm-action-btn bm-action-btn--reset" />
          {isAdmin() && (
            <Button
              label="Clear All Bags"
              icon="pi pi-trash"
              className="bm-action-btn bm-action-btn--clear-all"
              onClick={handleClearAllBags}
            />
          )}
          <Button label="Upload CSV" icon="pi pi-upload" className="bm-action-btn bm-action-btn--upload" onClick={openUploadDialog} />
          <Button label="New Bag" icon="pi pi-plus" className="bm-action-btn bm-action-btn--new" onClick={openNew} />
        </div>
      </div>

      {/* Table */}
      <div className="bm-table-card">
        <DataTable
          value={data}
          loading={loading}
          className="bm-table"
          scrollable
          scrollHeight="60vh"
          emptyMessage="No bag mappings found."
        >
          <Column field="bag_code" header="Bag Code" style={{ width: "120px" }} />
          <Column field="type" header="Type" body={typeTemplate} style={{ width: "140px" }} />
          <Column field="ptl_ids" header="PTL IDs" body={ptlTemplate} />
          <Column field="rejection_codes" header="Rejection Codes" body={rejTemplate} />
          <Column field="updated_at" header="Updated At" body={updatedAtTemplate} style={{ width: "200px" }} />
          <Column header="Actions" body={actionsTemplate} style={{ width: "120px" }} />
        </DataTable>
      </div>

      {/* Pagination — same First/Prev/pages/Next/Last pattern as Parcels */}
      <div className="bm-pagination">
        <span className="bm-pagination__label">displaying page</span>
        <button className="bm-page-btn" disabled={page === 1} onClick={() => goToPage(1)}>First</button>
        <button className="bm-page-btn bm-page-btn--arrow" disabled={page === 1} onClick={() => goToPage(Math.max(1, page - 1))}>‹</button>

        {buildPageList(page, totalPages).map((p, i) =>
          p === "…"
            ? <span key={`e${i}`} className="bm-page-ellipsis">…</span>
            : <button
                key={p}
                className={`bm-page-btn ${p === page ? "bm-page-btn--active" : ""}`}
                onClick={() => goToPage(p)}
              >
                {p}
              </button>
        )}

        <button className="bm-page-btn bm-page-btn--arrow" disabled={page === totalPages} onClick={() => goToPage(Math.min(totalPages, page + 1))}>›</button>
        <button className="bm-page-btn" disabled={page === totalPages} onClick={() => goToPage(totalPages)}>Last</button>
      </div>

      {/* New / Edit Dialog */}
      <Dialog
        visible={dialogVisible}
        header={editingRow ? "Edit Bag Mapping" : "New Bag Mapping"}
        onHide={() => setDialogVisible(false)}
        className="bm-dialog"
        modal
        footer={
          <div className="bm-dialog-footer">
            <Button label="Cancel" className="p-button-text" onClick={() => setDialogVisible(false)} />
            <Button label={saving ? "Saving..." : "Save"} icon="pi pi-check" onClick={handleSave} disabled={saving} />
          </div>
        }
      >
        <div className="bm-dialog-body">

          <label className="bm-label">Bag Type</label>
          <SelectButton
            value={formType}
            onChange={(e) => setFormType(e.value)}
            options={typeOptions}
            optionDisabled="disabled"
          />

          <label className="bm-label">Bag Code</label>
          <Dropdown
            value={bagCode}
            options={bagCodeOptions}
            onChange={(e) => setBagCode(e.value)}
            placeholder="Select Bag Code"
            disabled={!!editingRow}
            className="bm-dropdown"
          />

          {(formType === "REGULAR" || formType === "DIRECT") && (
            <>
              <label className="bm-label">PTL IDs</label>
              <Chips
                value={ptlIds}
                onChange={(e) => setPtlIds(e.value)}
                placeholder="Type a PTL ID and press Enter"
                className="bm-chips"
                separator=","
              />
              <span className="bm-help">Add as many PTL IDs as this bag should accept. They're auto-padded to 4 digits.</span>
            </>
          )}

          {formType === "REJECTED" && (
            <>
              <label className="bm-label">Rejection Codes</label>
              <MultiSelect
                value={rejectionCodes}
                options={rejectionOptions}
                onChange={(e) => setRejectionCodes(e.value)}
                display="chip"
                className="bm-multiselect"
              />
            </>
          )}

        </div>
      </Dialog>

      {/* CSV Bulk Upload Dialog */}
      <Dialog
        visible={uploadDialogVisible}
        header="Bulk Create Bags via CSV"
        onHide={() => setUploadDialogVisible(false)}
        className="bm-dialog bm-upload-dialog"
        modal
        footer={
          <div className="bm-dialog-footer">
            <Button label="Cancel" className="p-button-text" onClick={() => setUploadDialogVisible(false)} />
            <Button
              label={uploading ? "Uploading..." : "Upload"}
              icon={uploading ? "pi pi-spin pi-spinner" : "pi pi-cloud-upload"}
              onClick={handleCsvUpload}
              disabled={!uploadFile || uploading}
            />
          </div>
        }
      >
        <div className="bm-dialog-body">
          <p className="bm-upload-hint">
            Upload a CSV with <strong>BAG_CODE</strong>, <strong>TYPE</strong> (Regular / Direct / Rejection)
            and <strong>PTL_ID</strong> columns. Existing bags get new PTL IDs merged in automatically —
            nothing is stored on the server, the file is read once and discarded.
          </p>

          <div className="bm-upload-dropzone">
            <div className="bm-upload-icon pi pi-upload" />
            <div className="bm-upload-text-main">Select a CSV file to upload</div>

            <label className="bm-upload-file-label">
              <input
                type="file"
                accept=".csv"
                onChange={handleUploadFileChange}
                className="bm-upload-file-input"
              />
              <span className="bm-upload-file-button">
                {uploadFile ? uploadFile.name : "Choose File"}
              </span>
            </label>
          </div>

          <Button
            label="Download Sample CSV"
            icon="pi pi-download"
            className="p-button-sm p-button-success bm-upload-sample-btn"
            onClick={handleSampleDownload}
          />
        </div>
      </Dialog>
    </div>
  );
};

export default BagManagement;