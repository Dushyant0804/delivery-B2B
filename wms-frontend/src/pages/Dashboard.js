import React from "react";
import { Outlet } from "react-router-dom";
import Navbar from "../components/Navbar";
import Sidebar from "../components/Sidebar";

// This used to hold activeComponent state + a big switch statement
// rendering ~15 different pages, plus its own localStorage("token")
// check. Both are gone now — the auth check moved to ProtectedRoute
// in App.jsx (one check instead of a duplicate per page), and the
// page switching is now real routes rendered via <Outlet />.
const DashboardLayout = () => {
  return (
    <div className="dashboard-container">
      <Navbar />
      <div className="d-flex flex-grow-1">
        <div className="sidebar-container">
          <Sidebar />
        </div>
        <div className="main-content">
          <Outlet />
        </div>
      </div>
    </div>
  );
};

export default DashboardLayout;