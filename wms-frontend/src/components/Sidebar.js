import React, { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Link, useLocation, useNavigate } from "react-router-dom";
import axios from "axios";
import {
  faBox, faChartLine, faChevronDown, faCog, faRobot, faSignOutAlt, faSliders,
} from "@fortawesome/free-solid-svg-icons";
import "../styles/sidebar.css";

const navigation = [
  { name: "Dashboard", icon: faChartLine, path: "/dashboard" },
  {
    name: "Parcels", icon: faBox,path: "/dashboard/parcels/auto-primary"
    // subItems: [
    //   { name: "Auto + Primary", icon: faBox, path: "/dashboard/parcels/auto-primary" },
    //   { name: "Primary Sessions", icon: faChartLine, path: "/dashboard/parcels/primary-sessions" },
    // ],
  },
  { name: "Calibration", icon: faSliders, path: "/dashboard/calibration" },
  { name: "Payload Status", icon: faChartLine, path: "/dashboard/payload-status" },
  { name: "Alarms", icon: faRobot, path: "/dashboard/alarms" },
  {
    name: "Bag Seal", icon: faRobot,path: "/dashboard/bag-seal/primary"
    // subItems: [
    //   { name: "Primary", icon: faBox, path: "/dashboard/bag-seal/primary" },
    //   { name: "Secondary", icon: faBox, path: "/dashboard/bag-seal/secondary" },
    // ],
  },
  { name: "Settings", icon: faCog, path: "/dashboard/settings" },
  { name: "Bag Management", icon: faBox, path: "/dashboard/bag-management" },
  { name: "Bag Layout", icon: faBox, path: "/dashboard/bag-layout" },
  { name: "Configuration Settings", icon: faCog, path: "/dashboard/configuration-settings" },
  {
    name: "Bulk Data", icon: faRobot,path: "/dashboard/bulk-data/active"
    // subItems: [
    //   { name: "Active Data", icon: faBox, path: "/dashboard/bulk-data/active" },
    //   { name: "Error Data", icon: faBox, path: "/dashboard/bulk-data/error" },
    // ],
  },
];

const Sidebar = () => {
  const navigate = useNavigate();
  const location = useLocation();

  // Manual toggles still work as before; a group also auto-opens
  // whenever the current route is one of its children, so refreshing
  // on e.g. /dashboard/bag-seal/secondary shows it expanded.
  const [openGroups, setOpenGroups] = useState({ Parcels: false, "Bag Seal": false });
  const toggleGroup = (name) => setOpenGroups((groups) => ({ ...groups, [name]: !groups[name] }));

  const logout = async () => {
    try { await axios.post("http://localhost:1880/login-code", { code: true }); } catch (error) { console.error(error); }
    localStorage.removeItem("token");
    localStorage.removeItem("username");
    navigate("/dashboard/login");
  };

  return (
    <aside className="sidebar-container" aria-label="Main navigation">
      <header className="sidebar-header">
        <div className="sidebar-logo">DELHIVERY</div>
      </header>
      <nav className="sidebar-nav">
        <ul className="sidebar-menu">
          {navigation.map((item) => {
            const hasChildren = Boolean(item.subItems);
            const hasActiveChild = item.subItems?.some((child) => location.pathname === child.path);
            const isActive = !hasChildren && location.pathname === item.path;
            const isOpen = openGroups[item.name] || hasActiveChild;

            return (
              <li className={`sidebar-group ${isOpen ? "sidebar-group--open" : ""}`} key={item.name}>
                {hasChildren ? (
                  <button
                    type="button"
                    className={`sidebar-item ${hasActiveChild ? "active" : ""}`}
                    onClick={() => toggleGroup(item.name)}
                    aria-expanded={isOpen}
                  >
                    <span className="sidebar-icon"><FontAwesomeIcon icon={item.icon} /></span>
                    <span className="sidebar-text">{item.name}</span>
                    <span className="dropdown-icon"><FontAwesomeIcon icon={faChevronDown} /></span>
                  </button>
                ) : (
                  <Link to={item.path} className={`sidebar-item ${isActive ? "active" : ""}`}>
                    <span className="sidebar-icon"><FontAwesomeIcon icon={item.icon} /></span>
                    <span className="sidebar-text">{item.name}</span>
                  </Link>
                )}

                {hasChildren && (
                  <div className="sub-menu-wrap">
                    <ul className="sub-items">
                      {item.subItems.map((child) => (
                        <li key={child.name}>
                          <Link
                            to={child.path}
                            className={`sub-item ${location.pathname === child.path ? "active" : ""}`}
                          >
                            <span className="sub-item__dot" />
                            <span>{child.name}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </nav>
      {/* <footer className="logout-wrapper"><button type="button" className="logout-button" onClick={logout}><FontAwesomeIcon icon={faSignOutAlt} />Log out</button></footer> */}
    </aside>
  );
};

export default Sidebar;