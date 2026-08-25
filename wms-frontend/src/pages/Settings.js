import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import { TabPanel, TabView } from "primereact/tabview";
import { Button } from "primereact/button";
import { Card } from "primereact/card";
import { Column } from "primereact/column";
import { DataTable } from "primereact/datatable";
import { Dialog } from "primereact/dialog";
import { Dropdown } from "primereact/dropdown";
import { InputNumber } from "primereact/inputnumber";
import { InputSwitch } from "primereact/inputswitch";
import { InputText } from "primereact/inputtext";
import { Toast } from "primereact/toast";
import "../styles/SettingsPage.css";

const API = "http://localhost:5001/api";

const initialSettings = {
  sorter_name: "", state: "", center_name: "", data_incoming: false, live_fetching: false,
  source: "", source_id: "", source_type: "", secondary_api_token: "", primary_api_token: "",
  weight_api_token: "", bag_seal_api_token: "", primary_api: false, secondary_api: false,
  bagseal_api: false, gi_api: false, weight_api: false, calibration_api: false,
  calibration_wbn: "", calibration_length: null, calibration_width: null, calibration_height: null,
  calibration_weight: null, calibration_real_volume: null, calibration_length_tolerance: null,
  calibration_width_tolerance: null, calibration_height_tolerance: null,
  calibration_weight_tolerance: null, calibration_real_volume_tolerance: null, calibration_threshold: null,
  box_length_min: null, box_length_max: null, box_width_min: null, box_width_max: null,
  box_height_min: null, box_height_max: null, box_weight_min: null, box_weight_max: null,
  cutoff_count: null, cutoff_weight: null, cutoff_realvolume: null,
};

const settingFields = {
  sorter: [
    ["sorter_name", "Sorter name", "pi-tag", "text"], ["state", "State", "pi-map-marker", "text"],
    ["center_name", "Center name", "pi-building", "text"], ["data_incoming", "Data incoming", "pi-download", "switch"],
    ["live_fetching", "Live fetching", "pi-bolt", "switch"], ["cutoff_realvolume", "Cut-off real volume", "pi-box", "number"],
    ["cutoff_weight", "Cut-off weight", "pi-chart-bar", "number"], ["cutoff_count", "Cut-off count", "pi-hashtag", "number"],
  ],
  api: [
    ["source", "Source", "pi-database", "text"], ["source_id", "Source ID", "pi-id-card", "text"],
    ["source_type", "Source type", "pi-sliders-h", "text"], ["secondary_api_token", "Secondary API token", "pi-key", "password"],
    ["primary_api_token", "Primary API token", "pi-key", "password"], ["weight_api_token", "Weight API token", "pi-key", "password"],
    ["bag_seal_api_token", "Bag seal API token", "pi-lock", "password"], ["primary_api", "Primary API", "pi-cloud", "switch"],
    ["secondary_api", "Secondary API", "pi-cloud", "switch"], ["bagseal_api", "Bag seal API", "pi-cloud", "switch"],
    ["gi_api", "GI API", "pi-cloud", "switch"], ["weight_api", "Weight API", "pi-cloud", "switch"],
    ["calibration_api", "Calibration API", "pi-cloud", "switch"],
  ],
  calibration: [
    ["calibration_wbn", "Calibration WBN", "pi-barcode", "text"], ["calibration_length", "Length", "pi-arrows-h",],
    ["calibration_width", "Width", "pi-arrows-h",], ["calibration_height", "Height", "pi-arrows-v",],
    ["calibration_weight", "Weight", "pi-chart-bar",], ["calibration_real_volume", "Real volume", "pi-box",],
    ["calibration_length_tolerance", "Length tolerance", "pi-arrows-h", ], ["calibration_width_tolerance", "Width tolerance", "pi-arrows-h",],
    ["calibration_height_tolerance", "Height tolerance", "pi-arrows-v",], ["calibration_weight_tolerance", "Weight tolerance", "pi-chart-bar"],
    ["calibration_real_volume_tolerance", "Volume tolerance", "pi-box",], ["calibration_threshold", "Threshold", "pi-sliders-h"],
  ],
  limits: [
    ["box_length_min", "Minimum length", "pi-arrow-down",], ["box_length_max", "Maximum length", "pi-arrow-up", ],
    ["box_width_min", "Minimum width", "pi-arrow-down", ], ["box_width_max", "Maximum width", "pi-arrow-up",],
    ["box_height_min", "Minimum height", "pi-arrow-down",], ["box_height_max", "Maximum height", "pi-arrow-up",],
    ["box_weight_min", "Minimum weight", "pi-arrow-down",], ["box_weight_max", "Maximum weight", "pi-arrow-up",],
  ],
};

function SettingField({ field, value, onChange }) {
  const [key, label, icon, type] = field;
  return (
    <div className={`setting-field ${type === "switch" ? "setting-field--switch" : ""}`}>
      <label htmlFor={key}><i className={`pi ${icon}`} />{label}</label>
      {type === "switch" ? (
        <InputSwitch inputId={key} checked={Boolean(value)} onChange={(e) => onChange(key, e.value)} />
      ) : type === "number" || type === "decimal" ? (
        <InputNumber inputId={key} value={value ?? null} onValueChange={(e) => onChange(key, e.value)}
          mode={type === "decimal" ? "decimal" : undefined} minFractionDigits={type === "decimal" ? 1 : undefined}
          maxFractionDigits={type === "decimal" ? 2 : undefined} />
      ) : (
        <InputText id={key} type={type === "password" ? "password" : "text"} value={value ?? ""}
          onChange={(e) => onChange(key, e.target.value)} />
      )}
    </div>
  );
}

function SettingsSection({ eyebrow, title, description, fields, settings, onChange }) {
  return <section className="settings-section">
    <div className="section-heading"><span>{eyebrow}</span><h3>{title}</h3><p>{description}</p></div>
    <div className="settings-grid">{fields.map((field) => <SettingField key={field[0]} field={field} value={settings[field[0]]} onChange={onChange} />)}</div>
  </section>;
}

function RegexRuleEditor({ title, description, patterns, onChange }) {
  const [draft, setDraft] = useState("");
  const rules = Array.isArray(patterns) ? patterns : [];
  const addRule = () => {
    const value = draft.trim();
    if (!value) return;
    onChange([...rules, value]);
    setDraft("");
  };
  const renderRule = (rule) => typeof rule === "string" ? rule : rule?.pattern || rule?.regex || String(rule);

  return <article className="regex-editor">
    <header className="regex-editor__header"><div className="regex-editor__icon"><i className="pi pi-code" /></div><div><h4>{title}</h4><p>{description}</p></div><span className="regex-editor__count">{rules.length} {rules.length === 1 ? "rule" : "rules"}</span></header>
    <div className="regex-editor__add"><InputText value={draft} placeholder="Enter regex pattern" onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addRule()} /><Button label="Add" icon="pi pi-plus" onClick={addRule} /></div>
    <div className="regex-table-wrap"><table className="regex-table"><thead><tr><th>Regex pattern</th><th aria-label="Actions">Action</th></tr></thead><tbody>{rules.length ? rules.map((rule, index) => <tr key={`${renderRule(rule)}-${index}`}><td><code>{renderRule(rule)}</code></td><td><Button icon="pi pi-trash" text rounded severity="danger" aria-label={`Delete pattern ${index + 1}`} // ✅ CORRECT
onClick={() => onChange(rules.filter((_, ruleIndex) => ruleIndex !== index))} /></td></tr>) : <tr><td colSpan="2" className="regex-table__empty"><i className="pi pi-inbox" /> No patterns added yet</td></tr>}</tbody></table></div>
  </article>;
}

export default function SettingsPage() {
  const toast = useRef(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [settings, setSettings] = useState(initialSettings);
  const [originalSettings, setOriginalSettings] = useState(initialSettings);
  const [syncState, setSyncState] = useState("synced");
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState([]);
  const [userDialog, setUserDialog] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [userForm, setUserForm] = useState({ username: "", password: "", role: "Operator" });

  const notify = (severity, summary, detail) => toast.current?.show({ severity, summary, detail, life: 3000 });
  const fetchSettings = async () => {
    try {
      const { data } = await axios.get(`${API}/settings/settings-get`);
      const merged = { ...initialSettings, ...data };
      setSettings(merged); setOriginalSettings(merged); setSyncState("synced");
    } catch { notify("error", "Unable to load settings", "Check that the local server is running."); }
  };
  const fetchUsers = async () => {
    try { const { data } = await axios.get(`${API}/operators`); setUsers(Array.isArray(data) ? data : []); }
    catch { setUsers([]); notify("error", "Unable to load users", "Please try again."); }
  };
  useEffect(() => { fetchSettings(); }, []);

  const updateSetting = (key, value) => setSettings((current) => {
    const updated = { ...current, [key]: value };
    setSyncState(JSON.stringify(updated) === JSON.stringify(originalSettings) ? "synced" : "unsaved");
    return updated;
  });
  const save = async () => {
    setLoading(true); setSyncState("saving");
    try { await axios.put(`${API}/settings/settings-update`, settings); setOriginalSettings(settings); setSyncState("synced"); notify("success", "Settings saved", "Your changes are now stored."); }
    catch { setSyncState("unsaved"); notify("error", "Save failed", "Your changes have not been saved."); }
    finally { setLoading(false); }
  };
  const push = async () => {
    setLoading(true);
    try { await axios.post(`${API}/settings/settings-push-nodered`); notify("success", "Pushed to sorter", "The sorter has received the latest settings."); }
    catch { notify("error", "Push failed", "Could not reach the sorter."); }
    finally { setLoading(false); }
  };
  const openUser = (user = null) => { setEditingUser(user); setUserForm(user ? { username: user.username, password: "", role: user.role } : { username: "", password: "", role: "Operator" }); setUserDialog(true); };
  const saveUser = async () => {
    try {
      if (editingUser) await axios.put(`${API}/operators/${editingUser.id}`, userForm);
      else await axios.post(`${API}/operators`, userForm);
      setUserDialog(false); fetchUsers(); notify("success", editingUser ? "User updated" : "User added", "Access details were saved.");
    } catch { notify("error", "Unable to save user", "Please review the details and try again."); }
  };
  const deleteUser = async (user) => {
    if (!window.confirm(`Remove ${user.username}?`)) return;
    try { await axios.delete(`${API}/operators/${user.id}`); fetchUsers(); notify("success", "User removed", "The user no longer has access."); }
    catch { notify("error", "Unable to remove user", "Please try again."); }
  };
  const stateLabel = { synced: ["pi-check-circle", "All changes saved"], unsaved: ["pi-exclamation-circle", "Unsaved changes"], saving: ["pi-spin pi-spinner", "Saving changes"] }[syncState];

  return <main className="settings-page">
    <Toast ref={toast} />
    <header className="settings-page__header">
      <div className="page-title"><div className="page-title__icon"><i className="pi pi-cog" /></div><div><h1>System settings</h1></div></div>
      <div className="page-actions"><span className={`sync-status sync-status--${syncState}`}><i className={`pi ${stateLabel[0]}`} />{stateLabel[1]}</span><Button label="Push to sorter" icon="pi pi-send" className="push-button" onClick={push} loading={loading} /><Button label="Save changes" icon="pi pi-check" className="save-button" onClick={save} loading={loading} /></div>
    </header>
    <Card className="settings-shell"><TabView activeIndex={activeIndex} onTabChange={(e) => { setActiveIndex(e.index); if (e.index === 2) fetchUsers(); }} className="settings-tabs">
      <TabPanel header={<><i className="pi pi-box" />Sorter</>}><SettingsSection eyebrow="Machine" title="Sorter configuration"  fields={settingFields.sorter} settings={settings} onChange={updateSetting} /></TabPanel>
      <TabPanel header={<><i className="pi pi-server" />Integrations</>}><SettingsSection title="API configuration"  fields={settingFields.api} settings={settings} onChange={updateSetting} /></TabPanel>
      <TabPanel header={<><i className="pi pi-users" />Users</>}><section className="settings-section"><div className="section-heading section-heading--row"><div><span>Access control</span><h3>Operator accounts</h3><p>Create and manage local console access.</p></div><Button label="Add operator" icon="pi pi-plus" className="add-user-button" onClick={() => openUser()} /></div><DataTable value={users} emptyMessage="No operators have been added." className="users-table" stripedRows responsiveLayout="scroll"><Column header="#" body={(_, options) => options.rowIndex + 1} style={{ width: "5rem" }} /><Column field="username" header="Username" /><Column field="role" header="Role" body={(row) => <span className="role-badge">{row.role}</span>} /><Column header="Actions" body={(row) => <div className="table-actions"><Button icon="pi pi-pencil" text rounded aria-label={`Edit ${row.username}`} onClick={() => openUser(row)} /><Button icon="pi pi-trash" text rounded severity="danger" aria-label={`Delete ${row.username}`} onClick={() => deleteUser(row)} /></div>} /></DataTable></section></TabPanel>
      <TabPanel header={<><i className="pi pi-sliders-h" />Calibration</>}><SettingsSection eyebrow="Measurements" title="Calibration profile"  fields={settingFields.calibration} settings={settings} onChange={updateSetting} /></TabPanel>
      <TabPanel header={<><i className="pi pi-expand" />Box limits</>}><SettingsSection eyebrow="Guardrails" title="Box dimension limits"  fields={settingFields.limits} settings={settings} onChange={updateSetting} /></TabPanel>
      <TabPanel header={<><i className="pi pi-code" />Regex</>}><section className="settings-section"><div className="section-heading"><span>Scanning rules</span></div><div className="regex-grid"><RegexRuleEditor title="Shipment / GI" description="Shipment and GI barcode formats" patterns={settings.barcode_regexes} onChange={(value) => updateSetting("barcode_regexes", value)} /><RegexRuleEditor title="Bag seal" description="Bag-seal barcode formats" patterns={settings.bagseal_regexes} onChange={(value) => updateSetting("bagseal_regexes", value)} /></div></section></TabPanel>
    </TabView></Card>
    <Dialog header={editingUser ? "Edit operator" : "Add operator"} visible={userDialog} className="user-dialog" onHide={() => setUserDialog(false)}><div className="dialog-fields"><div><label htmlFor="username">Username</label><InputText id="username" value={userForm.username} onChange={(e) => setUserForm({ ...userForm, username: e.target.value })} autoFocus /></div><div><label htmlFor="password">{editingUser ? "New password (optional)" : "Password"}</label><InputText id="password" type="password" value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} /></div><div><label htmlFor="role">Role</label><Dropdown inputId="role" value={userForm.role} options={[{ label: "Operator", value: "Operator" }]} onChange={(e) => setUserForm({ ...userForm, role: e.value })} /></div><Button label="Save operator" icon="pi pi-check" className="save-button" onClick={saveUser} /></div></Dialog>
  </main>;
}
