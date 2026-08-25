// src/utils/pageNameToPath.js
//
// Maps the old activeComponent name strings (from the pre-routing
// Dashboard.jsx) to their real routes. Exists so components that still
// call setActiveComponent("Some Name") internally — currently just
// AlarmDashboard — keep working unchanged after the switch to real
// routing; the wrapper around them translates the name and navigates.

export const PAGE_NAME_TO_PATH = {
  "Dashboard": "/dashboard",
  "Settings": "/dashboard/settings",
  "Sort Events": "/dashboard/sort-events",
  "Bag Management": "/dashboard/bag-management",
  "Bag Layout": "/dashboard/bag-layout",
  "Configuration Settings": "/dashboard/configuration-settings",
  "Sorted Parcels": "/dashboard/sorted-parcels",
  "Payload Status": "/dashboard/payload-status",
  "Auto + Primary": "/dashboard/parcels/auto-primary",
  "Primary Sessions": "/dashboard/parcels/primary-sessions",
  "Secondary": "/dashboard/bag-seal/secondary",
  "Calibration": "/dashboard/calibration",
  "Primary": "/dashboard/bag-seal/primary",
  "Alarms": "/dashboard/alarms",
  "Alarm History": "/dashboard/alarms/history",
};