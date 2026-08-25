import React from "react";
import "../styles/footer.css";

const Footer = () => {
  return (
    <footer className="footer-container">
      <div className="footer-content">
        <span className="footer-title">3D Sorter Machine</span>
        <span className="footer-separator">•</span>
        <span className="footer-text">© 2025 Mechatronics International</span>
        <span className="footer-separator">•</span>
        <span className="footer-version">Version 1.0</span>
      </div>
    </footer>
  );
}

export default Footer;
