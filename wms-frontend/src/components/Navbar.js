import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faGlobe,
  faBell,
  faPowerOff,
  faUserCircle
} from "@fortawesome/free-solid-svg-icons";
import "../styles/Navbar.css";
import logo from "../assets/mechint_logo.jpeg";

const Navbar = () => {
  const navigate = useNavigate();
  const [currentTime, setCurrentTime] = useState(new Date());
  const [username, setUsername] = useState("");
  const [isInternetOnline, setIsInternetOnline] = useState(navigator.onLine);
  const [showNotifications, setShowNotifications] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);

    const checkInternet = async () => {
      if (!navigator.onLine) {
        setIsInternetOnline(false);
        return;
      }
      try {
        await fetch("https://clients3.google.com/generate_204", {
          method: "GET",
          mode: "no-cors",
        });
        setIsInternetOnline(true);
      } catch {
        setIsInternetOnline(false);
      }
    };

    checkInternet();
    const net = setInterval(checkInternet, 5000);

    const user = localStorage.getItem("username");
    if (user) {
      setUsername(user.charAt(0).toUpperCase() + user.slice(1));
    }

    return () => {
      clearInterval(timer);
      clearInterval(net);
    };
  }, []);

  const handleLogout = async () => {
    try {
      await axios.post("http://localhost:1880/login-code", { code: true });
    } catch (e) {}

    localStorage.removeItem("token");
    localStorage.removeItem("username");
    navigate("/dashboard/login");
  };

  return (
    <nav className="custom-navbar">
      <div className="navbar-left">
        <img src={logo} alt="logo" className="navbar-logo" />

        <div className="navbar-brand">
          <div className="navbar-title">
            MECHATRONICS INTERNATIONAL
          </div>

          <div className="navbar-subtitle">
            Smart Automation and Robotics
          </div>
        </div>
      </div>

      <div className="navbar-right">
        <div className="nav-status">
          <FontAwesomeIcon
            icon={faGlobe}
            className={isInternetOnline ? "status-online" : "status-offline"}
          />
          <span>{isInternetOnline ? "Online" : "Offline"}</span>
        </div>

        <div className="nav-time">
          {currentTime
            .toLocaleString("en-GB", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
              hour12: false,
            })
            .replace(/\//g, "-")}
        </div>

        <div className="nav-user">
          <FontAwesomeIcon icon={faUserCircle} className="user-icon" />
          <div className="user-info">
            <span className="user-label">WELCOME</span>
            <span className="user-name">{username || "Admin"}</span>
          </div>
        </div>

        <div className="notification-wrapper">
          <button
            className="notification-btn"
            onClick={() => setShowNotifications(!showNotifications)}
          >
            <FontAwesomeIcon icon={faBell} />
            <span className="notification-badge">0</span>
          </button>

          {showNotifications && (
            <div className="notification-dropdown">
              <div className="notification-title">Notifications</div>
              <div className="notification-empty">
                No notifications yet.
              </div>
            </div>
          )}
        </div>

        <button className="logout-btn" onClick={handleLogout}>
          <FontAwesomeIcon icon={faPowerOff} />
          <span>Logout</span>
        </button>
      </div>
    </nav>
  );
};

export default Navbar;