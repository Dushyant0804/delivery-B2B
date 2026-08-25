import React from "react";
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import Login from "./pages/Login";
import DashboardLayout from "./pages/Dashboard";
import Signup from "./pages/Signup";
import { Toaster } from "react-hot-toast";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import "./App.css";

import Settings from "./pages/Settings";
import BagManagement from "./pages/BagManagement";
import ConfigSettings from "./pages/ConfigSettings";
import SortEvents from "./pages/SortEvents";
import BagsLayout from "./pages/BagsLayout";
import SortedParcels from "./pages/SortedParcels";
import ProductionReport from "./pages/ProductionReport";
import Parcels from "./pages/Parcels";
import CalibrationLogs from "./pages/CalibrationLogs";
import BagSealEvents from "./pages/BagSealEvents";
import AlarmDashboard from "./pages/AlarmDashboard";
import AlarmHistory from "./pages/AlarmHistory";
import SorterDashboard from "./pages/SorterDashboard";
import PrimarySortingReport from "./pages/PrimarySortingReport";
import SecondarySortingReport from "./pages/SecondarySortingReport";
import Sortedpayloadsreport from "./pages/Sortedpayloadsreport";
import Sortedpayloadserrorsreport from "./pages/Sortedpayloaderrorsreport";

import { PAGE_NAME_TO_PATH } from "./utils/pageNameToPath";

// ---- Route guard — same check Dashboard.jsx used to do itself, now
// applied once at the route level instead of duplicated per-page.
// Fixed to redirect to /dashboard/login (the route that actually
// exists) instead of the old /login target.
const ProtectedRoute = ({ children }) => {
  if (!localStorage.getItem("token")) {
    return <Navigate to="/dashboard/login" replace />;
  }
  return children;
};

// AlarmDashboard expects a setActiveComponent(name) callback (it likely
// calls this internally to jump to "Alarm History"). This wrapper keeps
// that exact calling convention intact — AlarmDashboard.jsx needs zero
// changes — but translates the name to a real route and navigates there.
const AlarmDashboardRoute = () => {
  const navigate = useNavigate();
  const goTo = (name) => navigate(PAGE_NAME_TO_PATH[name] || "/dashboard/alarms");
  return <AlarmDashboard setActiveComponent={goTo} />;
};

const AppContent = () => {
  return (
    <>
      <ToastContainer
        position="top-right"
        autoClose={false}
        hideProgressBar={false}
        newestOnTop
        closeOnClick
        pauseOnHover
        draggable
        theme="colored"
      />
      <Toaster position="bottom-center" />

      <Routes>
        <Route path="/" element={<Navigate to="/dashboard/login" replace />} />
        <Route path="/dashboard/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />

        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <DashboardLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<SorterDashboard />} />
          <Route path="settings" element={<Settings />} />
          <Route path="calibration" element={<CalibrationLogs />} />
          <Route path="payload-status" element={<ProductionReport />} />
          <Route path="alarms" element={<AlarmDashboardRoute />} />
          <Route path="alarms/history" element={<AlarmHistory />} />
          <Route path="bag-management" element={<BagManagement />} />
          <Route path="bag-layout" element={<BagsLayout />} />
          <Route path="configuration-settings" element={<ConfigSettings />} />
          <Route path="sort-events" element={<SortEvents />} />
          <Route path="sorted-parcels" element={<SortedParcels />} />
          <Route path="parcels/auto-primary" element={<Parcels />} />
          <Route path="parcels/primary-sessions" element={<PrimarySortingReport />} />
          <Route path="bag-seal/primary" element={<BagSealEvents />} />
          <Route path="bag-seal/secondary" element={<SecondarySortingReport />} />
          <Route path="bulk-data/active" element={<Sortedpayloadsreport />} />
          <Route path="bulk-data/error" element={<Sortedpayloadserrorsreport />} />
        </Route>
      </Routes>
    </>
  );
};

const App = () => (
  <Router>
    <AppContent />
  </Router>
);

export default App;