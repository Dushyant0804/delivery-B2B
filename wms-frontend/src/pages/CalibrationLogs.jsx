import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Card } from "primereact/card";
import { InputText } from "primereact/inputtext";
import { Button } from "primereact/button";
import { Calendar } from "primereact/calendar";
import { Dropdown } from "primereact/dropdown";
import { Toast } from "primereact/toast";
import { Tag } from "primereact/tag";
import "../styles/CalibrationLogs.css";

const API = "http://localhost:5001/api";

const pageSizes = [
  { label: "100", value: 100 },
  { label: "500", value: 500 },
  { label: "1000", value: 1000 },
];

const CalibrationLogs = () => {
  const toast = useRef(null);

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(100);

  const [search, setSearch] = useState("");
  const [startTime, setStartTime] = useState(null);
  const [endTime, setEndTime] = useState(null);

  const [loading, setLoading] = useState(false);

  // ---------------- FETCH ----------------
  const fetchData = async (custom = {}) => {
    try {
      setLoading(true);

      const params = {
        page,
        limit,
        ...custom,
      };

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
  };

  useEffect(() => {
    fetchData();
  }, [page, limit]);

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

    setPage(1);
    fetchData({ search, page: 1 });
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

    setPage(1);
    fetchData({
      startTime: startTime?.toISOString(),
      endTime: endTime?.toISOString(),
      page: 1,
    });
  };

  // ---------------- RESET ----------------
  const resetAll = () => {
    setSearch("");
    setStartTime(null);
    setEndTime(null);
    setPage(1);
    fetchData({ page: 1 });
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

    if (search) params.append("search", search);
    if (startTime) params.append("startTime", startTime.toISOString());
    if (endTime) params.append("endTime", endTime.toISOString());

    window.open(`${API}/calibration/logs/export?${params.toString()}`, "_blank");
  };

  // ---------------- TAG ----------------
  const statusTag = (val) => (
    <Tag
      value={val?.toUpperCase()}
      severity={val === "pass" ? "success" : "danger"}
      className="pr-tag"
    />
  );

  return (
    <div className="cl-root">
      <Toast ref={toast} />

      <Card className="cl-card">

        {/* HEADER */}
        <div className="cl-header">
          <h2>Calibration Report</h2>
          <div className="cl-actions">
            <Button label="Export" icon="pi pi-download" className="p-button-success" onClick={exportData} />
            <Button label="Reset" icon="pi pi-refresh" className="p-button-secondary" onClick={resetAll} />
          </div>
        </div>

        {/* FILTER BAR */}
        <div className="cl-filter">

          <span className="p-input-icon-left">
            <i className="pi pi-search" />
            <InputText
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search WBN"
            />
          </span>

          <Button label="Search" icon="pi pi-search" onClick={handleSearch} />

          <div className="cl-datetime">

            <Calendar
              value={startTime}
              onChange={(e) => setStartTime(e.value)}
              showTime
              showSeconds
              hourFormat="24"
              showIcon
              placeholder="Start Date & Time"
              className="cl-cal"
            />

            <span className="cl-arrow">→</span>

            <Calendar
              value={endTime}
              onChange={(e) => setEndTime(e.value)}
              showTime
              showSeconds
              hourFormat="24"
              showIcon
              placeholder="End Date & Time"
              className="cl-cal"
            />

            <Button
              label="Apply Filter"
              icon="pi pi-filter"
              className="p-button-info"
              onClick={applyFilter}
            />
          </div>

          <Dropdown
            value={limit}
            options={pageSizes}
            onChange={(e) => setLimit(e.value)}
            placeholder="Rows"
          />
        </div>

        {/* TABLE */}
        <DataTable
          value={rows}
          loading={loading}
          paginator
          lazy
          rows={limit}
          totalRecords={total}
          first={(page - 1) * limit}
          onPage={(e) => {
            setPage(e.page + 1);
            setLimit(e.rows);
          }}
          scrollable
          scrollHeight="60vh"
          className="cl-table"
        >

          <Column field="wbn" header="WBN" frozen />
          <Column field="feedlane" header="Feedlane" />

          <Column field="length_mm" header="Length" />
          <Column field="width_mm" header="Width" />
          <Column field="height_mm" header="Height" />
          <Column field="weight_g" header="Weight" />
          <Column field="real_volume" header="RV" />
          <Column field="volume" header="Volume" />


          <Column header="L" body={(r) => statusTag(r.length_status)} />
          <Column header="W" body={(r) => statusTag(r.width_status)} />
          <Column header="H" body={(r) => statusTag(r.height_status)} />
          <Column header="WT" body={(r) => statusTag(r.weight_status)} />
          {/* <Column header="RV" body={(r) => statusTag(r.real_volume_status)} /> */}

          <Column header="Final" body={(r) => statusTag(r.final_result)} />

          <Column field="length_variance" header="L varience" />
          <Column field="width_variance" header="W varience" />
          <Column field="height_variance" header="H varience" />
          <Column field="weight_variance" header="WT varience" />
          {/* <Column field="real_volume_variance" header="RV varience" /> */}

          <Column field="dimension_tolerance" header="Tolerance" />

          <Column
            field="created_at"
            header="Time"
            body={(r) => new Date(r.created_at).toLocaleString("en-IN")}
          />

        </DataTable>

      </Card>
    </div>
  );
};

export default CalibrationLogs;
