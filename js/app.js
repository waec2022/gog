/* =========================================================
   CAMPUS GUIDE EDITOR — app.js
   ========================================================= */

(function () {
  "use strict";

  var Store = window.EditorStore;

  function el(tag, className, html) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (html !== undefined) node.innerHTML = html;
    return node;
  }

  function escapeHTML(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function timeAgo(iso) {
    var diff = Date.now() - new Date(iso).getTime();
    var mins = Math.round(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + " min ago";
    var hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + " hour" + (hrs === 1 ? "" : "s") + " ago";
    return Math.round(hrs / 24) + " day(s) ago";
  }

  /* ---------------- shell / nav ---------------- */

  var NAV_ITEMS = [
    { route: "dashboard", label: "Dashboard", icon: "📊" },
    { route: "add", label: "Add New", icon: "➕" },
    { route: "manage", label: "Manage Content", icon: "📁" },
    { route: "live", label: "Live Notification", icon: "🔴" },
    { route: "features", label: "Custom Features", icon: "✨" },
    { route: "publish", label: "Publish", icon: "🚀" },
    { route: "settings", label: "Settings", icon: "⚙️" }
  ];

  function renderSidebar(activeRoute) {
    var nav = document.getElementById("sidebarNav");
    if (!nav) return;
    nav.innerHTML = NAV_ITEMS.map(function (item) {
      var active = item.route === activeRoute ? " sidenav-item--active" : "";
      return '<a class="sidenav-item' + active + '" href="#/' + item.route + '"><span class="sidenav-item__icon">' + item.icon + '</span>' + item.label + "</a>";
    }).join("");
  }

  function mountView(html) {
    document.getElementById("editorMain").innerHTML = html;
  }

  /* ---------------- Dashboard ---------------- */

  function viewDashboard() {
    var records = Store.getRecords();
    var now = Date.now();
    var verified = records.filter(function (r) { return (r.verification || "").indexOf("verified") === 0 || r.verification === "official-staff"; }).length;
    var pending = records.filter(function (r) { return r.verification === "pending-verification"; }).length;
    var expired = records.filter(function (r) { return r.expiresAt && new Date(r.expiresAt).getTime() < now; }).length;

    var activity = Store.getActivity();
    var activityHTML = activity.length
      ? activity.map(function (a) {
          return '<li class="activity-item"><span>' + escapeHTML(a.message) + '</span><span class="activity-item__time">' + timeAgo(a.at) + "</span></li>";
        }).join("")
      : '<li class="activity-item activity-item--empty">No activity yet.</li>';

    mountView(
      '<div class="view-header"><h1>Dashboard</h1><a class="btn-primary" href="#/add">+ Add New</a></div>' +
      '<div class="stat-grid">' +
        statCard("Total Records", records.length, "") +
        statCard("Verified", verified, "stat-card--green") +
        statCard("Pending", pending, "stat-card--orange") +
        statCard("Expired", expired, "stat-card--red") +
      "</div>" +
      '<div class="panel">' +
        '<h2 class="panel__title">Recent Activity</h2>' +
        '<ul class="activity-list">' + activityHTML + "</ul>" +
      "</div>"
    );
  }

  function statCard(label, value, extraClass) {
    return (
      '<div class="stat-card ' + (extraClass || "") + '">' +
        '<span class="stat-card__value">' + value + "</span>" +
        '<span class="stat-card__label">' + label + "</span>" +
      "</div>"
    );
  }

  /* ---------------- Manage Content ---------------- */

  function viewManage(params) {
    var records = Store.getRecords();
    var typeFilter = params.type || "all";
    var query = (params.q || "").toLowerCase();

    var types = Store.allTypes();
    var filterChips = ['<a class="filter-chip' + (typeFilter === "all" ? " filter-chip--active" : "") + '" href="#/manage">All (' + records.length + ")</a>"]
      .concat(types.map(function (t) {
        var count = records.filter(function (r) { return r.type === t.type; }).length;
        var active = typeFilter === t.type ? " filter-chip--active" : "";
        return '<a class="filter-chip' + active + '" href="#/manage?type=' + t.type + '">' + t.icon + " " + t.label + " (" + count + ")</a>";
      }))
      .join("");

    var filtered = records.filter(function (r) {
      if (typeFilter !== "all" && r.type !== typeFilter) return false;
      if (query && (r.title || "").toLowerCase().indexOf(query) === -1) return false;
      return true;
    });

    var rows = filtered.length
      ? filtered.map(function (r) {
          var expired = r.expiresAt && new Date(r.expiresAt).getTime() < Date.now();
          return (
            '<div class="record-row">' +
              '<div class="record-row__main">' +
                '<span class="record-row__title">' + escapeHTML(r.title) + "</span>" +
                '<span class="record-row__meta">' + r.type + (expired ? " · expired" : "") + "</span>" +
              "</div>" +
              '<div class="record-row__actions">' +
                '<a class="btn-small" href="#/edit/' + r.id + '">Edit</a>' +
                '<button type="button" class="btn-small btn-small--danger" data-delete="' + r.id + '">Delete</button>' +
              "</div>" +
            "</div>"
          );
        }).join("")
      : '<div class="empty-state">No records match. <a href="#/add">Add one →</a></div>';

    mountView(
      '<div class="view-header"><h1>Manage Content</h1></div>' +
      '<input class="search-input" id="manageSearch" type="search" placeholder="Search records…" value="' + escapeHTML(params.q || "") + '">' +
      '<div class="filter-chips">' + filterChips + "</div>" +
      '<div class="record-list">' + rows + "</div>"
    );

    var searchInput = document.getElementById("manageSearch");
    if (searchInput) {
      searchInput.addEventListener("input", function () {
        var newParams = Object.assign({}, params, { q: searchInput.value });
        window.location.hash = "#/manage" + toQuery(newParams);
      });
      searchInput.focus();
      searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
    }

    document.querySelectorAll("[data-delete]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (confirm("Delete this record? This cannot be undone.")) {
          Store.deleteRecord(btn.getAttribute("data-delete"));
          route();
        }
      });
    });
  }

  function toQuery(params) {
    var parts = Object.keys(params)
      .filter(function (k) { return params[k]; })
      .map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]); });
    return parts.length ? "?" + parts.join("&") : "";
  }

  /* ---------------- Add / Edit record form ---------------- */

  var FIELD_SETS = {
    office: ["location", "hours", "phone", "email", "mapUrl"],
    building: ["location", "mapUrl"],
    lecturer: ["photo", "phone", "email", "department", "office"],
    course: ["level", "semester", "department"],
    department: ["faculty"],
    information: ["category", "downloadAllowed", "documentUrl"]
  };

  function viewForm(type, existingId) {
    var types = Store.allTypes();
    var record = existingId ? Store.getRecord(existingId) : null;
    var activeType = (record && record.type) || type || types[0].type;

    var typeOptions = types.map(function (t) {
      return '<option value="' + t.type + '"' + (t.type === activeType ? " selected" : "") + ">" + t.label + "</option>";
    }).join("");

    var verificationRadios = Store.VERIFICATION_OPTIONS.map(function (v) {
      var checked = (record && record.verification === v.value) || (!record && v.value === "pending-verification") ? " checked" : "";
      return (
        '<label class="radio-pill">' +
          '<input type="radio" name="verification" value="' + v.value + '"' + checked + ">" +
          '<span>' + v.label + "</span>" +
        "</label>"
      );
    }).join("");

    var expirationOptions = Store.EXPIRATION_OPTIONS.map(function (o) {
      return '<option value="' + o.value + '">' + o.label + "</option>";
    }).join("");

    var extraFields = (FIELD_SETS[activeType] || []).map(function (f) {
      var value = record ? record[f] : "";
      if (f === "downloadAllowed") {
        var checked = record && record.downloadAllowed ? " checked" : "";
        return '<label class="checkbox-row"><input type="checkbox" name="downloadAllowed"' + checked + "> Allow download (otherwise view-only)</label>";
      }
      return (
        '<label class="form-field">' +
          '<span class="form-field__label">' + fieldLabel(f) + "</span>" +
          '<input type="text" name="' + f + '" value="' + escapeHTML(value || "") + '">' +
        "</label>"
      );
    }).join("");

    mountView(
      '<div class="view-header"><h1>' + (record ? "Edit Record" : "Add New Record") + "</h1></div>" +
      '<form class="record-form" id="recordForm">' +
        '<label class="form-field"><span class="form-field__label">Type</span>' +
          '<select name="type" id="typeSelect">' + typeOptions + "</select>" +
        "</label>" +

        '<label class="form-field"><span class="form-field__label">Title</span>' +
          '<input type="text" name="title" required value="' + escapeHTML(record ? record.title : "") + '" placeholder="e.g. Bursary"></label>' +

        '<label class="form-field"><span class="form-field__label">Subtitle</span>' +
          '<input type="text" name="subtitle" value="' + escapeHTML(record ? record.subtitle : "") + '" placeholder="e.g. Office · Administration Block"></label>' +

        '<label class="form-field"><span class="form-field__label">Description</span>' +
          '<textarea name="description" rows="3">' + escapeHTML(record ? record.description : "") + "</textarea></label>" +

        '<label class="form-field"><span class="form-field__label">Keywords / aliases (comma-separated)</span>' +
          '<input type="text" name="keywords" value="' + escapeHTML(record && record.keywords ? record.keywords.join(", ") : "") + '" placeholder="bursary, finance office, pay school fees"></label>' +

        '<div id="extraFields">' + extraFields + "</div>" +

        '<div class="form-section">' +
          '<span class="form-field__label">Photo</span>' +
          (workerConfigured()
            ? '<div class="image-loader"><input type="file" id="photoFileInput" accept="image/png,image/jpeg,image/webp"><button type="button" class="btn-secondary" id="uploadImageBtn">Upload</button></div>'
            : "") +
          '<div class="image-loader">' +
            '<input type="text" id="photoUrlInput" value="' + escapeHTML((record && (record.photo || record.image)) || "") + '" placeholder="https://example.com/photo.jpg">' +
            '<button type="button" class="btn-secondary" id="fetchImageBtn">' + (workerConfigured() ? "Use Link Instead" : "Fetch Image") + "</button>" +
          "</div>" +
          '<div class="image-preview" id="imagePreview"></div>' +
          '<p class="field-hint">' + (workerConfigured() ? "Upload goes through your Worker to R2 storage, or paste a hosted link instead." : "No Worker connected yet (see Settings) — paste a hosted image link for now.") + "</p>" +
        "</div>" +

        '<div class="form-section">' +
          '<span class="form-field__label">Verification</span>' +
          '<div class="radio-pill-group">' + verificationRadios + "</div>" +
        "</div>" +

        '<div class="form-section">' +
          '<label class="form-field"><span class="form-field__label">Expiration</span>' +
            '<select name="expiration" id="expirationSelect">' + expirationOptions + "</select>" +
          "</label>" +
          '<input type="datetime-local" name="customExpiration" id="customExpirationInput" style="display:none">' +
          (record && record.expiresAt ? '<p class="field-hint">Currently expires: ' + new Date(record.expiresAt).toLocaleString() + "</p>" : "") +
        "</div>" +

        '<div class="form-actions">' +
          '<a class="btn-secondary" href="#/manage">Cancel</a>' +
          '<button type="submit" class="btn-primary">Save Record</button>' +
        "</div>" +
      "</form>"
    );

    bindFormEvents(record);
  }

  function fieldLabel(key) {
    var map = {
      location: "Location", hours: "Opening Hours", phone: "Phone", email: "Email",
      mapUrl: "Map Link (Google Maps URL)", photo: "Photo URL", department: "Department ID",
      office: "Office ID", level: "Level", semester: "Semester", faculty: "Faculty ID",
      category: "Category", documentUrl: "Document URL"
    };
    return map[key] || key;
  }

  function bindFormEvents(record) {
    var typeSelect = document.getElementById("typeSelect");
    if (typeSelect) {
      typeSelect.addEventListener("change", function () {
        // Re-render extra fields for the newly chosen type. Simplicity
        // over cleverness: just re-mount the whole form on type change.
        viewForm(typeSelect.value, record ? record.id : null);
      });
    }

    var fetchBtn = document.getElementById("fetchImageBtn");
    if (fetchBtn) {
      fetchBtn.addEventListener("click", function () {
        var url = document.getElementById("photoUrlInput").value.trim();
        var preview = document.getElementById("imagePreview");
        if (!url) { preview.innerHTML = ""; return; }
        preview.innerHTML = '<img src="' + escapeHTML(url) + '" alt="Preview" onerror="this.outerHTML=\'<span class=&quot;field-hint&quot;>Could not load that image URL.</span>\'">';
      });
      if (document.getElementById("photoUrlInput").value) fetchBtn.click();
    }

    var uploadBtn = document.getElementById("uploadImageBtn");
    if (uploadBtn) {
      uploadBtn.addEventListener("click", function () {
        var fileInput = document.getElementById("photoFileInput");
        var preview = document.getElementById("imagePreview");
        var file = fileInput.files[0];
        if (!file) { preview.innerHTML = '<span class="field-hint">Choose a file first.</span>'; return; }

        var fd = new FormData();
        fd.append("file", file);
        uploadBtn.disabled = true;
        preview.innerHTML = '<span class="field-hint">Uploading…</span>';

        workerFetch("/api/upload", { method: "POST", body: fd })
          .then(function (res) { return res.json().then(function (body) { return { ok: res.ok, body: body }; }); })
          .then(function (result) {
            uploadBtn.disabled = false;
            if (result.ok) {
              document.getElementById("photoUrlInput").value = result.body.url;
              preview.innerHTML = '<img src="' + escapeHTML(result.body.url) + '" alt="Preview">';
            } else {
              preview.innerHTML = '<span class="field-hint">Upload failed: ' + escapeHTML(result.body.error || "unknown error") + "</span>";
            }
          })
          .catch(function (err) {
            uploadBtn.disabled = false;
            preview.innerHTML = '<span class="field-hint">Could not reach the Worker: ' + escapeHTML(err.message) + "</span>";
          });
      });
    }

    var expSelect = document.getElementById("expirationSelect");
    var customInput = document.getElementById("customExpirationInput");
    if (expSelect) {
      expSelect.addEventListener("change", function () {
        customInput.style.display = expSelect.value === "custom" ? "" : "none";
      });
    }

    var form = document.getElementById("recordForm");
    if (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var fd = new FormData(form);
        var type = fd.get("type");

        var updated = Object.assign({}, record, {
          id: record ? record.id : undefined,
          type: type,
          title: fd.get("title"),
          subtitle: fd.get("subtitle"),
          description: fd.get("description"),
          keywords: String(fd.get("keywords") || "").split(",").map(function (k) { return k.trim(); }).filter(Boolean),
          verification: fd.get("verification"),
          photo: document.getElementById("photoUrlInput") ? document.getElementById("photoUrlInput").value.trim() : undefined
        });

        (FIELD_SETS[type] || []).forEach(function (f) {
          if (f === "downloadAllowed") {
            updated.downloadAllowed = fd.get("downloadAllowed") === "on";
          } else {
            updated[f] = fd.get(f);
          }
        });

        var expCode = fd.get("expiration");
        updated.expiresAt = Store.expirationToISO(expCode, fd.get("customExpiration"));

        Store.saveRecord(updated);
        window.location.hash = "#/manage";
      });
    }
  }

  /* ---------------- Live Notification ---------------- */

  function viewLive() {
    var live = Store.getLiveUpdate() || {};
    mountView(
      '<div class="view-header"><h1>Live Notification</h1></div>' +
      '<form class="record-form" id="liveForm">' +
        '<label class="form-field"><span class="form-field__label">Title</span>' +
          '<input type="text" name="title" value="' + escapeHTML(live.title || "") + '" placeholder="e.g. Shuttle is currently operating on campus"></label>' +
        '<label class="form-field"><span class="form-field__label">Priority</span>' +
          '<select name="priority">' +
            '<option value="normal"' + (live.priority === "normal" ? " selected" : "") + ">Normal</option>" +
            '<option value="urgent"' + (live.priority === "urgent" ? " selected" : "") + ">Urgent</option>" +
          "</select></label>" +
        '<label class="form-field"><span class="form-field__label">Expires</span>' +
          '<select name="expiration">' + Store.EXPIRATION_OPTIONS.map(function (o) {
            return '<option value="' + o.value + '">' + o.label + "</option>";
          }).join("") + "</select></label>" +
        '<div class="form-actions">' +
          '<button type="button" class="btn-secondary" id="clearLiveBtn">Clear Notification</button>' +
          '<button type="submit" class="btn-primary">Publish Notification</button>' +
        "</div>" +
      "</form>"
    );

    document.getElementById("liveForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var fd = new FormData(e.target);
      var expiresAt = Store.expirationToISO(fd.get("expiration") || "24h");
      Store.setLiveUpdate({ id: "live-001", title: fd.get("title"), priority: fd.get("priority"), expiresAt: expiresAt });
      route();
    });
    document.getElementById("clearLiveBtn").addEventListener("click", function () {
      Store.setLiveUpdate(null);
      route();
    });
  }

  /* ---------------- Custom Features ---------------- */

  function viewFeatures() {
    var features = Store.getCustomFeatures();
    var list = features.length
      ? features.map(function (f) {
          return (
            '<div class="record-row">' +
              '<div class="record-row__main">' +
                '<span class="record-row__title">' + (f.icon || "✨") + " " + escapeHTML(f.name) + "</span>" +
                '<span class="record-row__meta">' + escapeHTML(f.description || "") + "</span>" +
              "</div>" +
              '<div class="record-row__actions">' +
                '<button type="button" class="btn-small btn-small--danger" data-delete-feature="' + f.id + '">Delete</button>' +
              "</div>" +
            "</div>"
          );
        }).join("")
      : '<div class="empty-state">No custom features yet.</div>';

    mountView(
      '<div class="view-header"><h1>Custom Features</h1></div>' +
      '<div class="record-list">' + list + "</div>" +
      '<div class="panel">' +
        '<h2 class="panel__title">+ Add Feature</h2>' +
        '<form class="record-form" id="featureForm">' +
          '<label class="form-field"><span class="form-field__label">Name</span><input type="text" name="name" required placeholder="e.g. Hostel"></label>' +
          '<label class="form-field"><span class="form-field__label">Slug (used internally, no spaces)</span><input type="text" name="slug" required placeholder="hostel"></label>' +
          '<label class="form-field"><span class="form-field__label">Description</span><input type="text" name="description" placeholder="On-campus student housing"></label>' +
          '<label class="form-field"><span class="form-field__label">Icon (emoji)</span><input type="text" name="icon" placeholder="🏠" maxlength="4"></label>' +
          '<div class="checkbox-grid">' +
            '<label class="checkbox-row"><input type="checkbox" name="public" checked> Public</label>' +
            '<label class="checkbox-row"><input type="checkbox" name="searchable" checked> Searchable</label>' +
            '<label class="checkbox-row"><input type="checkbox" name="homepage"> Show on homepage</label>' +
            '<label class="checkbox-row"><input type="checkbox" name="verificationEnabled" checked> Verification enabled</label>' +
            '<label class="checkbox-row"><input type="checkbox" name="expirationEnabled" checked> Expiration enabled</label>' +
          "</div>" +
          '<div class="form-actions"><button type="submit" class="btn-primary">Create Feature</button></div>' +
        "</form>" +
        '<p class="field-hint">After creating a feature it appears as a selectable Type in Add New. Per-field custom schema (text/date/select/etc.) is the next layer to add once this is wired to the Worker — for now, new feature records use the same general fields as Information.</p>' +
      "</div>"
    );

    document.getElementById("featureForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var fd = new FormData(e.target);
      Store.saveCustomFeature({
        name: fd.get("name"),
        slug: fd.get("slug").toLowerCase().replace(/\s+/g, "-"),
        description: fd.get("description"),
        icon: fd.get("icon"),
        public: fd.get("public") === "on",
        searchable: fd.get("searchable") === "on",
        homepage: fd.get("homepage") === "on",
        verificationEnabled: fd.get("verificationEnabled") === "on",
        expirationEnabled: fd.get("expirationEnabled") === "on"
      });
      route();
    });

    document.querySelectorAll("[data-delete-feature]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (confirm("Delete this custom feature?")) {
          Store.deleteCustomFeature(btn.getAttribute("data-delete-feature"));
          route();
        }
      });
    });
  }

  /* ---------------- Worker helper ---------------- */

  function workerConfigured() {
    var cfg = Store.getWorkerConfig();
    return !!(cfg.url && cfg.key);
  }

  function workerFetch(path, options) {
    var cfg = Store.getWorkerConfig();
    options = options || {};
    options.headers = Object.assign({}, options.headers, { "X-Editor-Key": cfg.key });
    return fetch(cfg.url.replace(/\/$/, "") + path, options);
  }

  /* ---------------- Publish ---------------- */

  function viewPublish() {
    var records = Store.getRecords();
    var live = Store.getLiveUpdate();
    var dataFile =
      "var CAMPUS_DATA = " + JSON.stringify({ liveUpdate: live, records: records }, null, 2) + ";\n";
    var configured = workerConfigured();

    mountView(
      '<div class="view-header"><h1>Publish</h1></div>' +
      '<div class="panel">' +
        (configured
          ? '<p class="field-hint">Worker is configured — Publish will push directly to GitHub, and Cloudflare Pages redeploys the public site automatically.</p>'
          : '<p class="field-hint">No Worker configured yet (see Settings) — Publish will download a ready-made <code>data.js</code> instead. Replace <code>main/js/data.js</code> in your GitHub repo with it and commit.</p>') +
        '<div class="form-actions">' +
          (configured
            ? '<button type="button" class="btn-primary" id="publishBtn">Publish to Live Site</button>'
            : '<button type="button" class="btn-primary" id="downloadDataBtn">Download data.js</button>') +
        "</div>" +
        '<p class="field-hint" id="publishStatus"></p>' +
        '<p class="field-hint">' + records.length + " record(s) staged.</p>" +
      "</div>"
    );

    var downloadBtn = document.getElementById("downloadDataBtn");
    if (downloadBtn) {
      downloadBtn.addEventListener("click", function () {
        var blob = new Blob([dataFile], { type: "text/javascript" });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = "data.js";
        a.click();
        URL.revokeObjectURL(url);
      });
    }

    var publishBtn = document.getElementById("publishBtn");
    if (publishBtn) {
      publishBtn.addEventListener("click", function () {
        var status = document.getElementById("publishStatus");
        publishBtn.disabled = true;
        status.textContent = "Publishing…";
        workerFetch("/api/publish", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ liveUpdate: live, records: records })
        })
          .then(function (res) { return res.json().then(function (body) { return { ok: res.ok, body: body }; }); })
          .then(function (result) {
            publishBtn.disabled = false;
            if (result.ok) {
              status.textContent = "Published. The live site will update shortly.";
              logLocalActivity();
            } else {
              status.textContent = "Publish failed: " + (result.body.error || "unknown error");
            }
          })
          .catch(function (err) {
            publishBtn.disabled = false;
            status.textContent = "Could not reach the Worker: " + err.message;
          });
      });
    }
  }

  function logLocalActivity() {
    // best-effort, non-blocking activity note
    try { Store.saveRecord; } catch (e) {}
  }

  /* ---------------- Settings ---------------- */

  function viewSettings() {
    var cfg = Store.getWorkerConfig();
    mountView(
      '<div class="view-header"><h1>Settings</h1></div>' +
      '<div class="panel">' +
        '<h2 class="panel__title">Worker Connection</h2>' +
        '<form class="record-form" id="workerForm">' +
          '<label class="form-field"><span class="form-field__label">Worker URL</span>' +
            '<input type="text" name="url" value="' + escapeHTML(cfg.url || "") + '" placeholder="https://campus-guide-worker.your-subdomain.workers.dev"></label>' +
          '<label class="form-field"><span class="form-field__label">Editor API Key</span>' +
            '<input type="password" name="key" value="' + escapeHTML(cfg.key || "") + '" placeholder="the EDITOR_API_KEY secret you set in the Worker"></label>' +
          '<div class="form-actions">' +
            '<button type="button" class="btn-secondary" id="testWorkerBtn">Test Connection</button>' +
            '<button type="submit" class="btn-primary">Save</button>' +
          "</div>" +
          '<p class="field-hint" id="workerTestResult"></p>' +
        "</form>" +
        '<p class="field-hint">This key is only stored in this browser\'s local storage and sent to your own Worker — it is never written into MAIN or EDITOR\'s public files.</p>' +
      "</div>"
    );

    document.getElementById("workerForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var fd = new FormData(e.target);
      Store.setWorkerConfig({ url: fd.get("url").trim(), key: fd.get("key").trim() });
      window.location.hash = "#/dashboard";
    });

    document.getElementById("testWorkerBtn").addEventListener("click", function () {
      var fd = new FormData(document.getElementById("workerForm"));
      Store.setWorkerConfig({ url: fd.get("url").trim(), key: fd.get("key").trim() });
      var result = document.getElementById("workerTestResult");
      result.textContent = "Testing…";
      workerFetch("/api/health")
        .then(function (res) { return res.ok ? (result.textContent = "Connected.") : (result.textContent = "Worker responded with an error."); })
        .catch(function (err) { result.textContent = "Could not reach the Worker: " + err.message; });
    });
  }

  /* ---------------- routing ---------------- */

  function parseHash() {
    var hash = window.location.hash.replace(/^#\/?/, "");
    var parts = hash.split("?");
    var segments = parts[0].split("/").filter(Boolean);
    var params = {};
    if (parts[1]) {
      parts[1].split("&").forEach(function (pair) {
        var kv = pair.split("=");
        params[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || "");
      });
    }
    return { segments: segments, params: params };
  }

  function route() {
    var r = parseHash();
    var top = r.segments[0] || "dashboard";
    renderSidebar(top);

    if (top === "add") { viewForm(r.params.type || null, null); return; }
    if (top === "edit") { viewForm(null, r.segments[1]); return; }
    if (top === "manage") { viewManage(r.params); return; }
    if (top === "live") { viewLive(); return; }
    if (top === "features") { viewFeatures(); return; }
    if (top === "publish") { viewPublish(); return; }
    if (top === "settings") { viewSettings(); return; }
    viewDashboard();
  }

  function init() {
    Store.seedIfEmpty();
    window.addEventListener("hashchange", route);
    route();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
