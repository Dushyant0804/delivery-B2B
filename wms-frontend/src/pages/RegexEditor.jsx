import React, { useState } from "react";
import { InputText } from "primereact/inputtext";
import { Button } from "primereact/button";
import { Card } from "primereact/card";

const RegexEditor = ({ title, regexList = [], onChange }) => {
  const [newRegex, setNewRegex] = useState("");

  const addRegex = () => {
    if (!newRegex.trim()) return;

    try {
      new RegExp(newRegex); // validate regex
    } catch {
      alert("Invalid regex pattern");
      return;
    }

    onChange([...regexList, newRegex.trim()]);
    setNewRegex("");
  };

  const removeRegex = (index) => {
    onChange(regexList.filter((_, i) => i !== index));
  };

  return (
    <Card className="inner-card">
      <h4>{title}</h4>

      {/* Add Row */}
      <div className="regex-add-row">
        <InputText
          placeholder="Enter regex pattern"
          value={newRegex}
          onChange={(e) => setNewRegex(e.target.value)}
          className="full-width"
        />
        <Button
          label="Add"
          icon="pi pi-plus"
          onClick={addRegex}
        />
      </div>

      {/* Table */}
      <div className="regex-table-wrapper">
        {regexList.length === 0 ? (
          <div className="regex-empty">No regex added</div>
        ) : (
          <table className="regex-table">
            <thead>
              <tr>
                <th>Regex Pattern</th>
                <th style={{ width: "60px" }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {regexList.map((rgx, idx) => (
                <tr key={idx}>
                  <td>
                    <code>{rgx}</code>
                  </td>
                  <td className="regex-action">
                    <Button
                      icon="pi pi-trash"
                      className="p-button-danger p-button-text"
                      onClick={() => removeRegex(idx)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Card>
  );
};

export default RegexEditor;
