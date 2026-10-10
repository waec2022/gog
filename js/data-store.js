/* =========================================================
   CAMPUS GUIDE EDITOR — data-store.js

   Phase 2 note: this stores working data in the browser
   (localStorage), seeded from MAIN's sample data. There is no
   real backend yet. "Publish" currently copies this store into
   a downloadable data.js you paste into MAIN manually — once
   the Worker (phase 3) exists, Publish will call it instead and
   this manual step goes away.
   ========================================================= */

(function (global) {
  "use strict";

  var RECORDS_KEY = "campusGuideEditor.records";
  var LIVE_KEY = "campusGuideEditor.liveUpdate";
  var FEATURES_KEY = "campusGuideEditor.customFeatures";
  var ACTIVITY_KEY = "campusGuideEditor.activity";
  var WORKER_CONFIG_KEY = "campusGuideEditor.workerConfig";

  var BUILT_IN_TYPES = [
    { type: "office", label: "Office", icon: "🏢" },
    { type: "lecturer", label: "Lecturer", icon: "👤" },
    { type: "course", label: "Course", icon: "📘" },
    { type: "department", label: "Department", icon: "🏛️" },
    { type: "faculty", label: "Faculty", icon: "🎓" },
    { type: "service", label: "Service", icon: "🛎️" },
    { type: "building", label: "Building", icon: "📍" },
    { type: "information", label: "Information", icon: "📄" },
    { type: "update", label: "Update", icon: "📣" },
    { type: "announcement", label: "Announcement", icon: "📢" },
    { type: "event", label: "Event", icon: "📅" },
    { type: "campaign", label: "Campaign", icon: "🎯" }
  ];

  var VERIFICATION_OPTIONS = [
    { value: "verified-information", label: "Verified Information" },
    { value: "verified-staff", label: "Verified Staff" },
    { value: "official-staff", label: "Official Staff" },
    { value: "pending-verification", label: "Pending Verification" },
    { value: "unverified", label: "Unverified" }
  ];

  var EXPIRATION_OPTIONS = [
    { value: "", label: "Never" },
    { value: "5m", label: "5 minutes" },
    { value: "30m", label: "30 minutes" },
    { value: "1h", label: "1 hour" },
    { value: "6h", label: "6 hours" },
    { value: "24h", label: "24 hours" },
    { value: "3d", label: "3 days" },
    { value: "7d", label: "7 days" },
    { value: "custom", label: "Custom date/time" }
  ];

  function uid(prefix) {
    return prefix + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function readJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function seedIfEmpty() {
    if (localStorage.getItem(RECORDS_KEY)) return;
    // Seed from MAIN's CAMPUS_DATA if it happens to be loaded on this
    // page (it isn't, normally) — otherwise start with a small seed.
    var seedRecords = (global.CAMPUS_DATA && global.CAMPUS_DATA.records) || [];
    writeJSON(RECORDS_KEY, seedRecords);
    writeJSON(LIVE_KEY, (global.CAMPUS_DATA && global.CAMPUS_DATA.liveUpdate) || null);
    writeJSON(FEATURES_KEY, []);
    writeJSON(ACTIVITY_KEY, []);
  }

  function logActivity(message) {
    var activity = readJSON(ACTIVITY_KEY, []);
    activity.unshift({ message: message, at: new Date().toISOString() });
    activity = activity.slice(0, 20);
    writeJSON(ACTIVITY_KEY, activity);
  }

  function getRecords() {
    return readJSON(RECORDS_KEY, []);
  }

  function getRecord(id) {
    return getRecords().filter(function (r) { return r.id === id; })[0] || null;
  }

  function saveRecord(record) {
    var records = getRecords();
    var isNew = !record.id;
    if (isNew) record.id = uid(record.type || "record");
    var idx = records.findIndex(function (r) { return r.id === record.id; });
    if (idx === -1) records.push(record); else records[idx] = record;
    writeJSON(RECORDS_KEY, records);
    logActivity((isNew ? "Created " : "Updated ") + (record.title || record.id));
    return record;
  }

  function deleteRecord(id) {
    var records = getRecords().filter(function (r) { return r.id !== id; });
    writeJSON(RECORDS_KEY, records);
    logActivity("Deleted " + id);
  }

  function getLiveUpdate() {
    return readJSON(LIVE_KEY, null);
  }

  function setLiveUpdate(update) {
    writeJSON(LIVE_KEY, update);
    logActivity(update ? "Updated live notification" : "Cleared live notification");
  }

  function getCustomFeatures() {
    return readJSON(FEATURES_KEY, []);
  }

  function saveCustomFeature(feature) {
    var features = getCustomFeatures();
    var isNew = !feature.id;
    if (isNew) feature.id = uid("feature");
    var idx = features.findIndex(function (f) { return f.id === feature.id; });
    if (idx === -1) features.push(feature); else features[idx] = feature;
    writeJSON(FEATURES_KEY, features);
    logActivity((isNew ? "Created custom feature " : "Updated custom feature ") + feature.name);
    return feature;
  }

  function deleteCustomFeature(id) {
    writeJSON(FEATURES_KEY, getCustomFeatures().filter(function (f) { return f.id !== id; }));
  }

  function allTypes() {
    var custom = getCustomFeatures().map(function (f) {
      return { type: f.slug, label: f.name, icon: f.icon || "✨" };
    });
    return BUILT_IN_TYPES.concat(custom);
  }

  function getActivity() {
    return readJSON(ACTIVITY_KEY, []);
  }

  function getWorkerConfig() {
    return readJSON(WORKER_CONFIG_KEY, { url: "", key: "" });
  }

  function setWorkerConfig(config) {
    writeJSON(WORKER_CONFIG_KEY, config);
  }

  function expirationToISO(code, customDate) {
    if (!code) return null;
    if (code === "custom") return customDate ? new Date(customDate).toISOString() : null;
    var now = Date.now();
    var map = { "5m": 5 * 60e3, "30m": 30 * 60e3, "1h": 3600e3, "6h": 6 * 3600e3, "24h": 24 * 3600e3, "3d": 3 * 86400e3, "7d": 7 * 86400e3 };
    var ms = map[code];
    if (!ms) return null;
    return new Date(now + ms).toISOString();
  }

  global.EditorStore = {
    BUILT_IN_TYPES: BUILT_IN_TYPES,
    VERIFICATION_OPTIONS: VERIFICATION_OPTIONS,
    EXPIRATION_OPTIONS: EXPIRATION_OPTIONS,
    seedIfEmpty: seedIfEmpty,
    getRecords: getRecords,
    getRecord: getRecord,
    saveRecord: saveRecord,
    deleteRecord: deleteRecord,
    getLiveUpdate: getLiveUpdate,
    setLiveUpdate: setLiveUpdate,
    getCustomFeatures: getCustomFeatures,
    saveCustomFeature: saveCustomFeature,
    deleteCustomFeature: deleteCustomFeature,
    allTypes: allTypes,
    getActivity: getActivity,
    expirationToISO: expirationToISO,
    uid: uid,
    getWorkerConfig: getWorkerConfig,
    setWorkerConfig: setWorkerConfig
  };
})(window);
