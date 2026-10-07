/*
 * Campus Guide publishing Worker.
 *
 *   Editor  ->  this Worker  ->  GitHub API  ->  Cloudflare Pages rebuild  ->  live site
 *   Editor  ->  this Worker  ->  R2 media storage  ->  public media URL  ->  student's browser cache
 *
 * Secrets (set with `wrangler secret put`, never in code or in the browser):
 *   GITHUB_TOKEN   fine-grained token, ONE repository, "Contents: Read and write" only
 *   EDITOR_KEY     long random passphrase the Editor sends as a Bearer token
 * Variables (worker.wrangler.toml):
 *   EDITOR_ORIGIN  comma-separated Editor origin(s) allowed by CORS, e.g. https://campus-guide-editor.pages.dev
 *   GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH
 *   MEDIA_PUBLIC_BASE (optional) public base URL of the media bucket (R2 custom domain). Default: <this worker>/media
 * Binding (worker.wrangler.toml):  MEDIA = an R2 bucket (free tier: 10 GB, no egress fees)
 * Optional secret: DEPLOY_HOOK_URL  (a Cloudflare Pages deploy hook; used by the scheduled trigger so expiries are rebuilt)
 *
 * All source data is stored in ONE GitHub file, data.json (a map of "data/source/<name>.json" -> content).
 *
 * This is NOT a general GitHub proxy and NOT a general file host. It only reads/writes data/source/<known>.json,
 * validates the WHOLE merged dataset (records, relationships, custom features) with the same schema the Editor and
 * the build use, limits sizes, and accepts only sniff-verified images and office/PDF documents.
 *
 * Storage is isolated in storage(env): to move media to another provider later, change that one function.
 */
// ---- shared schema (identical to the "editor/schema.js" asset inside assets.txt; keep the two in sync) ----
const S = (() => {
const module = { exports: {} };
/*
 * Campus Guide — shared schema.
 * One definition of record types, fields, relationships, lifecycle and validation.
 * Works in Node (build tools, tests, dev server) and in the browser (Editor).
 * The public website does NOT load this file.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CGSchema = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var f = function (k, l, t, o) {
    var x = { k: k, l: l, t: t };
    if (o) for (var i in o) x[i] = o[i];
    return x;
  };
  // ref / refs: relationship by record ID. `l` = label on this record, `rev` = label shown on the target record.
  var ref = function (k, l, to, rev, multi) {
    return f(k, l, multi ? 'refs' : 'ref', { to: to, rev: rev });
  };

  var BASE = {
    // ---------- CONTENT ----------
    office: { label: 'Office', plural: 'offices', group: 'content', fields: [
      ref('building', 'Building', ['building'], 'Offices inside'),
      f('floor', 'Floor', 'text'), f('room', 'Room', 'text'),
      f('hours', 'Opening hours', 'text'), f('phone', 'Phone', 'phone'), f('email', 'Email', 'email'),
      ref('services', 'Services offered', ['service'], 'Offered by', true),
      f('bring', 'What students should bring (one per line)', 'list'),
      f('directions', 'Directions', 'textarea')]},
    lecturer: { label: 'Lecturer', plural: 'lecturers', group: 'content', fields: [
      ref('department', 'Department', ['department'], 'Lecturers'),
      f('role', 'Role', 'text'),
      ref('office', 'Office', ['office'], 'Lecturers'),
      ref('courses', 'Courses taught', ['course'], 'Lecturers', true),
      f('email', 'Email', 'email'), f('phone', 'Phone', 'phone'),
      f('bio', 'Biography', 'textarea')]},
    course: { label: 'Course', plural: 'courses', group: 'content', fields: [
      ref('department', 'Department', ['department'], 'Courses'),
      f('level', 'Level', 'text'), f('semester', 'Semester', 'text'),
      ref('lecturers', 'Lecturers', ['lecturer'], 'Courses taught', true)]},
    department: { label: 'Department', plural: 'departments', group: 'content', fields: [
      ref('faculty', 'Faculty', ['faculty'], 'Departments'),
      ref('hod', 'Head of department', ['lecturer'], 'Head of'),
      ref('office', 'Office', ['office'], 'Department'),
      f('phone', 'Phone', 'phone'), f('email', 'Email', 'email')]},
    faculty: { label: 'Faculty', plural: 'faculties', group: 'content', fields: [
      ref('dean', 'Dean', ['lecturer'], 'Dean of'),
      ref('office', 'Office', ['office'], 'Faculty'),
      f('phone', 'Phone', 'phone'), f('email', 'Email', 'email')]},
    service: { label: 'Service', plural: 'services', group: 'content', fields: [
      ref('office', 'Offered by', ['office'], 'Services offered'),
      f('hours', 'Opening hours', 'text'), f('phone', 'Phone', 'phone'), f('email', 'Email', 'email'),
      f('link', 'Link', 'url')]},
    building: { label: 'Building', plural: 'buildings', group: 'content', fields: [
      f('address', 'Address', 'text'), f('lat', 'Latitude', 'number'), f('lng', 'Longitude', 'number'),
      f('directions', 'Directions', 'textarea')]},
    location: { label: 'Location', plural: 'locations', group: 'content', fields: [
      ref('building', 'Building', ['building'], 'Locations'),
      f('address', 'Address', 'text'), f('lat', 'Latitude', 'number'), f('lng', 'Longitude', 'number'),
      f('directions', 'Directions', 'textarea')]},
    // ---------- INFORMATION ----------
    admission: { label: 'Admission', plural: 'admissions', group: 'info', fields: [
      f('level', 'Level', 'select', { opts: ['Undergraduate', 'Postgraduate', 'Direct Entry', 'Other'] }),
      f('deadline', 'Deadline', 'date'),
      f('requirements', 'Requirements (one per line)', 'list'),
      f('link', 'Link', 'url'), f('email', 'Email', 'email'), f('phone', 'Phone', 'phone'),
      f('files', 'Documents', 'files')]},
    fee: { label: 'School Fees', plural: 'fees', group: 'info', fields: [
      f('session', 'Session', 'text'), f('amount', 'Amount', 'text'),
      f('steps', 'How to pay (one step per line)', 'list'),
      ref('office', 'Office', ['office'], 'Fees information'),
      f('link', 'Link', 'url'),
      f('files', 'Documents', 'files')]},
    timetable: { label: 'Timetable', plural: 'timetables', group: 'info', fields: [
      ref('department', 'Department', ['department'], 'Timetables'),
      ref('course', 'Course', ['course'], 'Timetable'),
      f('level', 'Level', 'text'), f('semester', 'Semester', 'text'),
      f('slots', 'Slots (one per line: Day | Time | Course | Venue)', 'list'),
      f('files', 'Documents', 'files')]},
    calendar: { label: 'Academic Calendar', plural: 'calendars', group: 'info', fields: [
      f('session', 'Session', 'text'),
      f('entries', 'Entries (one per line: Date | Event)', 'list'),
      f('files', 'Documents', 'files')]},
    announcement: { label: 'Announcement', plural: 'announcements', group: 'info', fields: [
      f('date', 'Date', 'date'), f('source', 'Author / source', 'text'),
      f('priority', 'Priority', 'select', { opts: ['normal', 'important'] }),
      f('link', 'Link', 'url'),
      f('files', 'Documents', 'files')]},
    event: { label: 'Event', plural: 'events', group: 'info', fields: [
      f('date', 'Date', 'date'), f('startTime', 'Start time', 'time'), f('endTime', 'End time', 'time'),
      f('venue', 'Venue', 'text'), f('organizer', 'Organizer', 'text'),
      f('link', 'Registration link', 'url'), f('contact', 'Contact', 'text'),
      ref('faculty', 'Faculty', ['faculty'], 'Events'),
      ref('department', 'Department', ['department'], 'Events'),
      f('files', 'Documents', 'files')]},
    campaign: { label: 'Campaign', plural: 'campaigns', group: 'info', fields: [
      f('startDate', 'Start date', 'date'), f('endDate', 'End date', 'date'),
      f('organizer', 'Organizer', 'text'), f('link', 'Link', 'url'), f('contact', 'Contact', 'text'),
      f('campaignStatus', 'Campaign status', 'select', { opts: ['Upcoming', 'Ongoing', 'Ended'] }),
      f('files', 'Documents', 'files')]},
    notice: { label: 'Important Notice', plural: 'notices', group: 'info', fields: [
      f('date', 'Date', 'date'), f('source', 'Source', 'text'),
      f('priority', 'Priority', 'select', { opts: ['normal', 'high', 'urgent'] }),
      f('link', 'Link', 'url'),
      f('files', 'Documents', 'files')]},
    live: { label: 'Live Update', plural: 'live', group: 'info', fields: [
      f('priority', 'Priority', 'select', { opts: ['normal', 'urgent'] }),
      f('startsAt', 'Starts at (optional)', 'datetime')]}
,
    document: { label: 'Document', plural: 'documents', group: 'info', fields: [
      f('category', 'Category', 'text'), f('docDate', 'Document date', 'date'),
      f('file', 'File', 'file')]}
  };

  // ---------------------------------------------------------------------------------------------
  // Live registry. BASE holds the built-in types; configure() layers the Editor-defined Custom
  // Features and extra Custom Fields (data/source/features.json) on top. TYPES / TYPE_IDS / GROUPS
  // are mutated in place so every module that holds a reference sees the change.
  // ---------------------------------------------------------------------------------------------
  var TYPES = {}, TYPE_IDS = [], GROUPS = [], FEATURES = [];
  var BASE_GROUPS = [
    { id: 'all', label: 'All', types: [] },
    { id: 'offices', label: 'Offices', types: ['office'] },
    { id: 'lecturers', label: 'Lecturers', types: ['lecturer'] },
    { id: 'courses', label: 'Courses', types: ['course'] },
    { id: 'departments', label: 'Departments', types: ['department'] },
    { id: 'faculties', label: 'Faculties', types: ['faculty'] },
    { id: 'services', label: 'Services', types: ['service'] },
    { id: 'buildings', label: 'Buildings', types: ['building', 'location'] },
    { id: 'information', label: 'Information', types: [] }
  ];
  var CATEGORY_IDS = BASE_GROUPS.slice(1).map(function (g) { return g.id; });
  var RESERVED = ['data', 'editor', 'api', 'media', 'assets', 'css', 'js', 'img', 'doc', 'sw', 'index', 'custom', 'features', 'settings'];

  // Field kinds offered by the Custom Field builder (and their internal representation).
  var BUILDER_KINDS = [
    ['text', 'Text'], ['textarea', 'Long text'], ['number', 'Number'], ['date', 'Date'], ['time', 'Time'],
    ['phone', 'Phone'], ['email', 'Email'], ['url', 'URL'], ['website', 'Website'], ['location', 'Location'],
    ['image', 'Image'], ['document', 'Document'], ['pdf', 'PDF'], ['select', 'Select / dropdown'],
    ['checkbox', 'Checkbox'], ['link', 'Link (label + URL)'], ['related', 'Related record']
  ];
  // Kinds that can be switched between safely when records already hold data in the field.
  var FAMILIES = [
    ['text', 'textarea', 'phone', 'email', 'url', 'website', 'location', 'select'],
    ['number'], ['date'], ['time'], ['image'], ['document', 'pdf'], ['checkbox'], ['link'], ['related']
  ];
  function safeKinds(kind, inUse) {
    if (!inUse) return BUILDER_KINDS.map(function (k) { return k[0]; });
    for (var i = 0; i < FAMILIES.length; i++) if (FAMILIES[i].indexOf(kind) >= 0) return FAMILIES[i].slice();
    return [kind];
  }

  function normField(d, ownerLabel) {
    var o = { k: d.k, l: d.l, t: d.t, kind: d.t, custom: true, req: !!d.req, pub: d.pub !== false, hidden: !!d.hidden };
    if (d.t === 'website') o.t = 'url';
    else if (d.t === 'document') { o.t = 'file'; o.accept = 'doc'; }
    else if (d.t === 'pdf') { o.t = 'file'; o.accept = 'pdf'; }
    else if (d.t === 'related') {
      o.t = d.multi ? 'refs' : 'ref'; o.multi = !!d.multi;
      o.to = d.to && d.to.length ? d.to.slice() : null;
      o.rev = d.rev || ownerLabel || 'Related';
    } else if (d.t === 'select') o.opts = (d.opts || []).slice();
    return o;
  }

  function configure(cfg) {
    cfg = cfg || {};
    Object.keys(TYPES).forEach(function (k) { delete TYPES[k]; });
    TYPE_IDS.length = 0; FEATURES.length = 0;
    Object.keys(BASE).forEach(function (t) {
      var b = BASE[t];
      TYPES[t] = { label: b.label, plural: b.plural, group: b.group, fields: b.fields.slice() };
      TYPE_IDS.push(t);
    });
    var ext = cfg.extend || {};
    Object.keys(ext).forEach(function (t) {
      if (!BASE[t]) return;
      (ext[t] || []).forEach(function (d) { TYPES[t].fields.push(normField(d, BASE[t].label)); });
    });
    (cfg.features || []).forEach(function (ft) {
      if (!ft || !ft.id || TYPES[ft.id]) return;
      FEATURES.push(ft);
      TYPES[ft.id] = {
        label: ft.singular || ft.name, plural: ft.id, pluralLabel: ft.name, group: 'custom', feature: ft.id,
        fields: (ft.fields || []).map(function (d) { return normField(d, ft.name); })
      };
      TYPE_IDS.push(ft.id);
    });
    GROUPS.length = 0;
    BASE_GROUPS.forEach(function (g) { GROUPS.push({ id: g.id, label: g.label, types: g.types.slice() }); });
    GROUPS[0].types = TYPE_IDS.slice();
    GROUPS[8].types = TYPE_IDS.filter(function (t) { return TYPES[t].group === 'info'; });
    FEATURES.forEach(function (ft) {
      var g = GROUPS.filter(function (x) { return x.id === (CATEGORY_IDS.indexOf(ft.category) >= 0 ? ft.category : 'information'); })[0];
      if (g.types.indexOf(ft.id) < 0) g.types.push(ft.id);
    });
  }
  configure({});

  function BASE_TYPE_IDS() { return Object.keys(BASE); }
  function featureOf(type) { for (var i = 0; i < FEATURES.length; i++) if (FEATURES[i].id === type) return FEATURES[i]; return null; }
  // A feature set to "hidden" keeps its data in the Editor but is left out of the public build.
  function typeHidden(type) { var ft = featureOf(type); return !!ft && ft.status === 'hidden'; }
  function typeSearchable(type) { var ft = featureOf(type); return !ft || ft.searchable !== false; }

  function groupOf(type) {
    for (var i = 1; i < GROUPS.length; i++) if (GROUPS[i].types.indexOf(type) >= 0) return GROUPS[i].id;
    return 'information';
  }

  var STATUSES = ['draft', 'published', 'archived'];
  var VERIFY = {
    verified: 'Verified Information',
    verified_staff: 'Verified Staff',
    official_staff: 'Official Staff',
    pending: 'Pending Verification',
    unverified: 'Unverified'
  };
  var isVerified = function (s) { return s === 'verified' || s === 'verified_staff' || s === 'official_staff'; };

  var EXPIRY_PRESETS = [
    ['never', 'Never expires', null], ['5m', '5 minutes', 5], ['30m', '30 minutes', 30], ['1h', '1 hour', 60],
    ['6h', '6 hours', 360], ['24h', '24 hours', 1440], ['3d', '3 days', 4320], ['7d', '7 days', 10080],
    ['custom', 'Custom date/time', null]
  ];
  function expiryFromPreset(key, now) {
    for (var i = 0; i < EXPIRY_PRESETS.length; i++) {
      if (EXPIRY_PRESETS[i][0] === key && EXPIRY_PRESETS[i][2]) return new Date(now + EXPIRY_PRESETS[i][2] * 60000).toISOString();
    }
    return null;
  }

  var ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  var TIME_RE = /^\d{2}:\d{2}$/;
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var IMG_KEY = /^img\/[a-z0-9][a-z0-9\/._-]{3,120}$/;
  var DOC_KEY = /^doc\/[a-z0-9][a-z0-9\/._-]{3,140}$/;
  var FIELD_KEY = /^c_[a-z0-9_]{1,30}$/;
  var FEATURE_ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
  // Upload rules shared by the Editor (pre-check) and the Worker (authoritative check).
  var LIMITS = { imageMB: 3, thumbKB: 300, rawImageMB: 15, docMB: 15 };
  var DOC_EXT = { pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
  var isImageKey = function (v) { return typeof v === 'string' && IMG_KEY.test(v) && v.indexOf('..') < 0; };
  var isDocKey = function (v) { return typeof v === 'string' && DOC_KEY.test(v) && v.indexOf('..') < 0; };
  var isImageRef = function (v) { return isImageKey(v) || (typeof v === 'string' && isUrl(v)); };

  function slugify(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }
  function slugOf(rec) { return rec.id.slice(rec.type.length + 1); }

  function refFields(type) {
    return TYPES[type].fields.filter(function (x) { return x.t === 'ref' || x.t === 'refs'; });
  }

  function expiryMs(r) {
    if (!r.expires) return null;
    var t = Date.parse(r.expires);
    return isNaN(t) ? null : t;
  }
  // draft | active | expiring | expired | archived
  function lifecycle(r, now) {
    if (r.status === 'archived') return 'archived';
    if (r.status !== 'published') return 'draft';
    var e = expiryMs(r);
    if (e != null) {
      if (e <= now) return 'expired';
      if (e - now <= 3600000) return 'expiring';
    }
    return 'active';
  }
  function isPublic(r, now) {
    var l = lifecycle(r, now);
    return l === 'active' || l === 'expiring';
  }

  function isUrl(u) {
    try { var x = new URL(u); return x.protocol === 'http:' || x.protocol === 'https:'; } catch (e) { return false; }
  }
  function validDate(s) {
    return DATE_RE.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z'));
  }

  // lookup(id) -> type string or undefined (omit to skip relationship checks)
  function validateRecord(r, lookup) {
    var e = [];
    var T = r && TYPES[r.type];
    if (!T) return ['Unknown record type "' + (r && r.type) + '"'];
    if (!r.title || !String(r.title).trim()) e.push('Title is required');
    if (!r.id || !ID_RE.test(r.id)) e.push('ID must use lowercase letters, numbers and hyphens only');
    else if (r.id.indexOf(r.type + '-') !== 0) e.push('ID must start with "' + r.type + '-"');
    else if (r.id.length === r.type.length + 1) e.push('ID is incomplete');
    if (STATUSES.indexOf(r.status) < 0) e.push('Status must be draft, published or archived');
    var v = r.verification || {};
    var vs = v.status || 'unverified';
    if (!VERIFY[vs]) e.push('Unknown verification status');
    if (isVerified(vs) && !String(v.by || '').trim()) e.push('"Verified by" is required for verified records');
    if (v.date && !validDate(v.date)) e.push('Verification date must be YYYY-MM-DD');
    if (r.image && !isImageRef(r.image)) e.push('Image must be an uploaded image (img/…) or a valid http(s) URL');
    if (r.expires != null && r.expires !== '' && isNaN(Date.parse(r.expires))) e.push('Expiration is not a valid date/time');
    ['keywords', 'aliases', 'related'].forEach(function (k) {
      if (r[k] != null && (!Array.isArray(r[k]) || r[k].some(function (x) { return typeof x !== 'string'; }))) e.push(k + ' must be a list of text values');
    });
    (r.related || []).forEach(function (id) {
      if (lookup && !lookup(id)) e.push('Related record "' + id + '" does not exist');
    });
    T.fields.forEach(function (fd) {
      var val = r[fd.k];
      var empty = val == null || val === '' || (Array.isArray(val) && !val.length) || (fd.t === 'checkbox' && val === false && !fd.req);
      if (fd.req && !fd.hidden && r.status === 'published' && (empty || (fd.t === 'checkbox' && val !== true))) { e.push(fd.l.replace(/ \(.*\)$/, '') + ' is required'); return; }
      if (val == null || val === '' || (Array.isArray(val) && !val.length)) return;
      var bad = function (m) { e.push(fd.l.replace(/ \(.*\)$/, '') + ': ' + m); };
      var chkFile = function (o) {
        if (!o || typeof o !== 'object' || !isDocKey(o.k)) { bad('invalid file reference'); return; }
        if (o.n != null && (typeof o.n !== 'string' || o.n.length > 200)) bad('invalid file name');
        if (o.dl != null && [0, 1, true, false].indexOf(o.dl) < 0) bad('invalid download permission');
        if (fd.accept === 'pdf' && !/\.pdf$/i.test(o.k)) bad('only PDF files are allowed here');
      };
      switch (fd.t) {
        case 'email': if (!EMAIL_RE.test(val)) bad('invalid email address'); break;
        case 'phone': if (!/^[+()\-.\s\d]{7,25}$/.test(val) || String(val).replace(/\D/g, '').length < 7) bad('invalid phone number'); break;
        case 'url': if (!isUrl(val)) bad('invalid link (must start with http:// or https://)'); break;
        case 'date': if (!validDate(val)) bad('use the format YYYY-MM-DD'); break;
        case 'time': if (!TIME_RE.test(val)) bad('use the format HH:MM'); break;
        case 'number': if (!isFinite(Number(val))) bad('must be a number'); break;
        case 'select': if ((fd.opts || []).indexOf(val) < 0) bad('invalid option'); break;
        case 'list': if (!Array.isArray(val)) bad('must be a list'); break;
        case 'datetime': if (isNaN(Date.parse(val))) bad('not a valid date/time'); break;
        case 'location': if (typeof val !== 'string' || val.length > 300) bad('invalid location'); break;
        case 'checkbox': if (typeof val !== 'boolean') bad('must be yes or no'); break;
        case 'image': if (!isImageRef(val)) bad('invalid image'); break;
        case 'file': chkFile(val); break;
        case 'files': if (!Array.isArray(val) || val.length > 20) bad('invalid document list'); else val.forEach(chkFile); break;
        case 'link': if (!val || typeof val !== 'object' || !isUrl(val.u) || (val.l != null && typeof val.l !== 'string')) bad('needs a valid web address'); break;
        case 'ref':
          if (typeof val !== 'string') { bad('invalid reference'); break; }
          if (lookup) {
            var t1 = lookup(val);
            if (!t1) bad('record "' + val + '" does not exist');
            else if (fd.to && fd.to.indexOf(t1) < 0) bad('"' + val + '" is a ' + t1 + ', expected ' + fd.to.join('/'));
          }
          break;
        case 'refs':
          if (!Array.isArray(val)) { bad('invalid reference list'); break; }
          val.forEach(function (id) {
            if (!lookup) return;
            var t2 = lookup(id);
            if (!t2) bad('record "' + id + '" does not exist');
            else if (fd.to && fd.to.indexOf(t2) < 0) bad('"' + id + '" is a ' + t2 + ', expected ' + fd.to.join('/'));
          });
          break;
      }
    });
    if (T.fields.some(function (x) { return x.k === 'lat'; })) {
      if (r.lat !== '' && r.lat != null && Math.abs(Number(r.lat)) > 90) e.push('Latitude must be between -90 and 90');
      if (r.lng !== '' && r.lng != null && Math.abs(Number(r.lng)) > 180) e.push('Longitude must be between -180 and 180');
    }
    return e;
  }

  // data: { office:[...], lecturer:[...], ... } -> { errors:[{id,type,msg}], warnings:[...] }
  function validateAll(data, now) {
    var errors = [], warnings = [];
    var seen = {};
    var types = {};
    TYPE_IDS.forEach(function (t) {
      (data[t] || []).forEach(function (r) { if (r && r.id) types[r.id] = r.type; });
    });
    var lookup = function (id) { return types[id]; };
    (data.__orphans || []).forEach(function (r) { errors.push({ id: (r && r.id) || '?', type: (r && r.type) || '?', msg: 'Unknown record type "' + (r && r.type) + '" (its Custom Feature was removed)' }); });
    TYPE_IDS.forEach(function (t) {
      var arr = data[t] || [];
      if (!Array.isArray(arr)) { errors.push({ id: '-', type: t, msg: 'File for ' + t + ' must be a list' }); return; }
      arr.forEach(function (r, i) {
        if (!r || typeof r !== 'object') { errors.push({ id: '#' + i, type: t, msg: 'Record is not an object' }); return; }
        if (r.type !== t) errors.push({ id: r.id, type: t, msg: 'Record type "' + r.type + '" is stored in the ' + t + ' file' });
        if (r.id) {
          if (seen[r.id]) errors.push({ id: r.id, type: t, msg: 'Duplicate ID' });
          seen[r.id] = 1;
        }
        validateRecord(r, lookup).forEach(function (m) { errors.push({ id: r.id || '#' + i, type: t, title: r.title, msg: m }); });
        // Warn when a published record points at something that will not be public.
        if (r.status === 'published') {
          var chk = function (id) {
            var tg = id && findRec(data, id);
            if (tg && !isPublic(tg, now)) warnings.push({ id: r.id, type: t, title: r.title, msg: 'Links to "' + (tg.title || tg.id) + '", which is not public (' + lifecycle(tg, now) + ')' });
          };
          refFields(t).forEach(function (fd) { (fd.t === 'ref' ? [r[fd.k]] : (r[fd.k] || [])).forEach(chk); });
          (r.related || []).forEach(chk);
        }
      });
    });
    return { errors: errors, warnings: warnings };
  }

  // cfg = { features: [...], extend: { office: [fieldDef,...] } }  -> array of message strings
  function validateConfig(cfg) {
    var e = [];
    if (cfg == null) return e;
    if (typeof cfg !== 'object' || Array.isArray(cfg)) return ['Features file must be an object'];
    var feats = cfg.features || [], ext = cfg.extend || {};
    if (!Array.isArray(feats) || feats.length > 100) return ['features must be a list of at most 100'];
    var ids = {};
    var kinds = BUILDER_KINDS.map(function (k) { return k[0]; });
    var allIds = Object.keys(BASE).concat(feats.map(function (x) { return x && x.id; }));
    var chkFields = function (owner, fields) {
      if (!Array.isArray(fields) || fields.length > 40) { e.push(owner + ': fields must be a list of at most 40'); return; }
      var seen = {};
      fields.forEach(function (d, i) {
        var w = owner + ' field ' + (i + 1) + ': ';
        if (!d || typeof d !== 'object') { e.push(w + 'invalid'); return; }
        if (!FIELD_KEY.test(d.k || '')) e.push(w + 'internal key must look like c_amount');
        else if (seen[d.k]) e.push(w + 'duplicate key ' + d.k);
        seen[d.k] = 1;
        if (!d.l || !String(d.l).trim() || String(d.l).length > 80) e.push(w + 'needs a name (max 80 characters)');
        if (kinds.indexOf(d.t) < 0) e.push(w + 'unknown field type "' + d.t + '"');
        if (d.t === 'select' && (!Array.isArray(d.opts) || !d.opts.length || d.opts.some(function (o) { return typeof o !== 'string' || !o.trim(); }))) e.push(w + 'a dropdown needs at least one option');
        if (d.t === 'related' && d.to && (!Array.isArray(d.to) || d.to.some(function (t) { return allIds.indexOf(t) < 0; }))) e.push(w + 'related record type does not exist');
      });
    };
    feats.forEach(function (ft, i) {
      var w = 'Feature ' + (i + 1) + (ft && ft.name ? ' (' + ft.name + ')' : '') + ': ';
      if (!ft || typeof ft !== 'object') { e.push(w + 'invalid'); return; }
      if (!FEATURE_ID.test(ft.id || '') || ft.id.length > 30) e.push(w + 'id must be lowercase letters, numbers and hyphens');
      else if (BASE[ft.id] || RESERVED.indexOf(ft.id) >= 0) e.push(w + 'id "' + ft.id + '" is reserved');
      else if (ids[ft.id]) e.push(w + 'duplicate id');
      ids[ft.id] = 1;
      if (!ft.name || !String(ft.name).trim() || String(ft.name).length > 80) e.push(w + 'needs a name');
      if (['published', 'hidden'].indexOf(ft.status || 'published') < 0) e.push(w + 'status must be published or hidden');
      if (ft.category && CATEGORY_IDS.indexOf(ft.category) < 0) e.push(w + 'unknown public category');
      if (ft.sort != null && !isFinite(Number(ft.sort))) e.push(w + 'sort order must be a number');
      if (ft.icon && !isImageRef(ft.icon)) e.push(w + 'invalid icon');
      chkFields('Feature "' + ft.name + '"', ft.fields || []);
    });
    Object.keys(ext).forEach(function (t) {
      if (!BASE[t]) { e.push('Custom fields: "' + t + '" is not a built-in record type'); return; }
      chkFields('Fields of ' + BASE[t].label, ext[t]);
    });
    return e;
  }

  function findRec(data, id) {
    for (var i = 0; i < TYPE_IDS.length; i++) {
      var a = data[TYPE_IDS[i]] || [];
      for (var j = 0; j < a.length; j++) if (a[j] && a[j].id === id) return a[j];
    }
    return null;
  }

  return {
    TYPES: TYPES, TYPE_IDS: TYPE_IDS, GROUPS: GROUPS, FEATURES: FEATURES, BASE: BASE, configure: configure, validateConfig: validateConfig,
    featureOf: featureOf, BASE_TYPE_IDS: BASE_TYPE_IDS, typeHidden: typeHidden, typeSearchable: typeSearchable, normField: normField, BUILDER_KINDS: BUILDER_KINDS,
    safeKinds: safeKinds, LIMITS: LIMITS, DOC_EXT: DOC_EXT, isImageKey: isImageKey, isDocKey: isDocKey, isImageRef: isImageRef,
    CATEGORY_IDS: CATEGORY_IDS, RESERVED: RESERVED, FIELD_KEY: FIELD_KEY, STATUSES: STATUSES, VERIFY: VERIFY,
    EXPIRY_PRESETS: EXPIRY_PRESETS, groupOf: groupOf, isVerified: isVerified, expiryFromPreset: expiryFromPreset,
    slugify: slugify, slugOf: slugOf, refFields: refFields, lifecycle: lifecycle, isPublic: isPublic,
    expiryMs: expiryMs, isUrl: isUrl, validateRecord: validateRecord, validateAll: validateAll, findRec: findRec,
    ID_RE: ID_RE
  };
});
return module.exports;
})();
// ---- end shared schema ----

const BASE_FILES = {};
for (const t of S.BASE_TYPE_IDS()) BASE_FILES['data/source/' + S.BASE[t].plural + '.json'] = t;
const CUSTOM_FILE = 'data/source/custom.json';
const FEATURES_FILE = 'data/source/features.json';
const SETTINGS_FILE = 'data/source/settings.json';
const ALLOWED_FILES = new Set([...Object.keys(BASE_FILES), CUSTOM_FILE, FEATURES_FILE, SETTINGS_FILE]);
const defaultFor = (f) => (f === SETTINGS_FILE ? {} : f === FEATURES_FILE ? { features: [], extend: {} } : []);

const MAX_BODY = 3 * 1024 * 1024;   // publish payload: 3 MB
const MAX_RECORDS = 20000;
const IMMUTABLE = 'public, max-age=31536000, immutable';

export default {
  async fetch(request, env) {
    try { return await handle(request, env); }
    catch (e) { return reply(env, request, { ok: false, error: 'Unexpected error in the publishing Worker.' }, 500); }
  },
  // Optional: rebuild the site on a schedule so expired records leave the static build even if nobody publishes.
  async scheduled(_event, env, ctx) {
    if (env.DEPLOY_HOOK_URL) ctx.waitUntil(fetch(env.DEPLOY_HOOK_URL, { method: 'POST' }));
  }
};

/* ---------------- http helpers ---------------- */
function allowedOrigins(env) {
  return String(env.EDITOR_ORIGIN || '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
}
function cors(env, request) {
  const origin = request.headers.get('Origin');
  const h = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Vary': 'Origin' };
  if (origin && allowedOrigins(env).includes(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    h['Access-Control-Allow-Headers'] = 'Authorization, Content-Type, X-Kind, X-File-Name, X-Thumb-Of';
    h['Access-Control-Max-Age'] = '600';
  }
  return h;
}
function reply(env, request, body, status) {
  return new Response(JSON.stringify(body), { status: status || 200, headers: cors(env, request) });
}
// Constant-time comparison of two strings (compares SHA-256 digests so lengths do not leak).
async function safeEqual(a, b) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const A = new Uint8Array(x), B = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < A.length; i++) diff |= A[i] ^ B[i];
  return diff === 0;
}
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/* ---------------- media storage (the ONE place to change storage provider) ---------------- */
function storage(env) {
  const b = env.MEDIA;
  if (!b) return null;
  return {
    put: (key, bytes, contentType) => b.put(key, bytes, { httpMetadata: { contentType, cacheControl: IMMUTABLE } }),
    get: (key) => b.get(key),
    head: (key) => b.head(key),
    delete: (keys) => b.delete(keys),
    async list() {
      const out = []; let cursor;
      for (let i = 0; i < 20; i++) {
        const r = await b.list({ limit: 1000, cursor });
        r.objects.forEach((o) => out.push({ key: o.key, size: o.size, uploaded: o.uploaded }));
        if (!r.truncated) break;
        cursor = r.cursor;
      }
      return out;
    }
  };
}
const mediaBase = (env, request) => (String(env.MEDIA_PUBLIC_BASE || '').replace(/\/+$/, '') || new URL(request.url).origin + '/media');

/* ---------------- routing ---------------- */
async function handle(request, env) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');

  // Public, read-only media (images/documents). Immutable, content-hashed names; no auth, no listing.
  if (url.pathname.startsWith('/media/') && (request.method === 'GET' || request.method === 'HEAD')) return serveMedia(request, env, url);

  if (request.method === 'OPTIONS') {
    if (origin && !allowedOrigins(env).includes(origin)) return new Response(null, { status: 403 });
    return new Response(null, { status: 204, headers: cors(env, request) });
  }
  if (!env.GITHUB_TOKEN || !env.EDITOR_KEY || !env.GITHUB_OWNER || !env.GITHUB_REPO) {
    return reply(env, request, { ok: false, error: 'The Worker is not fully configured (missing secrets or variables).' }, 500);
  }
  // Browser requests must come from the configured Editor origin.
  if (origin && !allowedOrigins(env).includes(origin)) return reply(env, request, { ok: false, error: 'This origin is not allowed.' }, 403);

  const auth = request.headers.get('Authorization') || '';
  const key = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!key || !(await safeEqual(key, env.EDITOR_KEY))) return reply(env, request, { ok: false, error: 'Unauthorized.' }, 401);

  const m = request.method, p = url.pathname;
  if (p === '/api/source' && m === 'GET') return getSource(request, env);
  if (p === '/api/publish' && m === 'POST') return publish(request, env);
  if (p === '/api/upload' && m === 'POST') return upload(request, env);
  if (p === '/api/media' && m === 'GET') return listMedia(request, env);
  if (p === '/api/media/delete' && m === 'POST') return deleteMedia(request, env);
  return reply(env, request, { ok: false, error: 'Not found.' }, 404);
}

/* ---------------- GitHub ---------------- */
function gh(env, path, init) {
  init = init || {};
  return fetch('https://api.github.com/repos/' + encodeURIComponent(env.GITHUB_OWNER) + '/' + encodeURIComponent(env.GITHUB_REPO) + path, {
    method: init.method || 'GET',
    headers: Object.assign({
      Authorization: 'Bearer ' + env.GITHUB_TOKEN,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'campus-guide-publisher'
    }, init.headers || {}),
    body: init.body
  });
}
const branch = (env) => env.GITHUB_BRANCH || 'main';

// All source data lives in ONE GitHub file: data.json = { "data/source/offices.json": [...], ... }
const DATA_FILE = 'data.json';
async function readData(env) {
  const r = await gh(env, '/contents/' + DATA_FILE + '?ref=' + encodeURIComponent(branch(env)), { headers: { Accept: 'application/vnd.github.raw+json' } });
  if (r.status === 404) return {};
  if (!r.ok) throw new Error('github ' + r.status);
  const d = JSON.parse(await r.text());
  return d && typeof d === 'object' && !Array.isArray(d) ? d : {};
}
function pick(all, names) { const o = {}; names.forEach((f) => { o[f] = f in all ? all[f] : defaultFor(f); }); return o; }
async function loadFiles(env, names) { return pick(await readData(env), names); }

async function getSource(request, env) {
  return reply(env, request, { ok: true, files: await loadFiles(env, [...ALLOWED_FILES]) });
}

/* ---------------- validation ---------------- */
function shapeProblem(files) {
  if (!files || typeof files !== 'object' || Array.isArray(files)) return 'files must be an object';
  const names = Object.keys(files);
  if (!names.length) return 'No files to publish';
  for (const name of names) {
    if (!ALLOWED_FILES.has(name)) return 'File not allowed: ' + name;
    const v = files[name];
    if (name === SETTINGS_FILE) {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return 'settings must be an object';
      for (const [k, val] of Object.entries(v)) {
        if (typeof val !== 'string' || val.length > 500 || k === '__proto__') return 'Invalid settings value';
        if (k === 'mediaBase' && val && !/^https:\/\/[^\s]+$|^http:\/\/localhost[:/]/.test(val)) return 'mediaBase must be an https:// address';
      }
    } else if (name === FEATURES_FILE) {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return 'features must be an object';
    } else {
      if (!Array.isArray(v)) return name + ' must be a list';
      if (v.length > MAX_RECORDS) return name + ' has too many records';
      for (const r of v) {
        if (!r || typeof r !== 'object' || Array.isArray(r)) return name + ': record is not an object';
        for (const k of Object.keys(r)) if (k === '__proto__' || k === 'constructor') return name + ': forbidden key';
      }
    }
  }
  return '';
}
function toData(files) {
  S.configure(files[FEATURES_FILE]);
  const data = {};
  S.TYPE_IDS.forEach((t) => { data[t] = []; });
  for (const [f, t] of Object.entries(BASE_FILES)) data[t] = files[f] || [];
  data.__orphans = [];
  for (const r of files[CUSTOM_FILE] || []) {
    if (r && data[r.type] && S.TYPES[r.type].group === 'custom') data[r.type].push(r); else data.__orphans.push(r);
  }
  return data;
}
function mediaKeys(obj, set) {
  set = set || new Set();
  if (typeof obj === 'string') { if (S.isImageKey(obj) || S.isDocKey(obj)) set.add(obj); }
  else if (Array.isArray(obj)) obj.forEach((x) => mediaKeys(x, set));
  else if (obj && typeof obj === 'object') Object.values(obj).forEach((x) => mediaKeys(x, set));
  return set;
}
// Full-dataset validation. configure()+validate run synchronously so concurrent requests cannot interleave.
function semanticProblem(merged) {
  const cfgErrors = S.validateConfig(merged[FEATURES_FILE]);
  if (cfgErrors.length) return 'Custom features: ' + cfgErrors.slice(0, 3).join('; ');
  const data = toData(merged);
  const v = S.validateAll(data, Date.now());
  if (v.errors.length) {
    return v.errors.length + ' problem(s). First: ' + v.errors.slice(0, 3).map((e) => (e.title || e.id) + ': ' + e.msg).join('; ');
  }
  return '';
}

async function publish(request, env) {
  const len = Number(request.headers.get('Content-Length') || 0);
  if (len > MAX_BODY) return reply(env, request, { ok: false, error: 'Request is too large.' }, 413);
  const text = await request.text();
  if (text.length > MAX_BODY) return reply(env, request, { ok: false, error: 'Request is too large.' }, 413);
  let body;
  try { body = JSON.parse(text); } catch (e) { return reply(env, request, { ok: false, error: 'Request is not valid JSON.' }, 400); }
  const problem = shapeProblem(body && body.files);
  if (problem) return reply(env, request, { ok: false, error: problem }, 400);
  const message = String((body && body.message) || 'Campus Guide: update content').replace(/[\r\n]+/g, ' ').slice(0, 200);

  // Validate the dataset as it WILL be: payload files merged over what GitHub already holds.
  const all = await readData(env);
  const missing = [...ALLOWED_FILES].filter((f) => !(f in body.files));
  const stored = pick(all, missing);
  const merged = Object.assign({}, stored, body.files);
  const bad = semanticProblem(merged);
  if (bad) return reply(env, request, { ok: false, error: bad }, 400);

  // Every uploaded image/document the payload newly references must really exist in storage.
  const st = storage(env);
  const before = pick(all, Object.keys(body.files));
  const known = mediaKeys(before), wanted = mediaKeys(body.files);
  for (const k of wanted) {
    if (known.has(k)) continue;
    if (!st) return reply(env, request, { ok: false, error: 'Media storage is not configured, so uploaded files cannot be referenced.' }, 400);
    if (!(await st.head(k))) return reply(env, request, { ok: false, error: 'A file was not uploaded or was removed: ' + k }, 400);
  }

  // One atomic commit containing every changed file.
  const ref = await gh(env, '/git/ref/heads/' + encodeURIComponent(branch(env)));
  if (!ref.ok) return reply(env, request, { ok: false, error: 'Could not read the GitHub branch (' + ref.status + '). Check GITHUB_REPO, GITHUB_BRANCH and the token permissions.' }, 502);
  const headSha = (await ref.json()).object.sha;
  const commit = await (await gh(env, '/git/commits/' + headSha)).json();
  const next = Object.assign({}, all, body.files), ordered = {};
  Object.keys(next).sort().forEach((k) => { ordered[k] = next[k]; });
  const tree = [{ path: DATA_FILE, mode: '100644', type: 'blob', content: JSON.stringify(ordered, null, 2) + '\n' }];
  const t = await gh(env, '/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: commit.tree.sha, tree }) });
  if (!t.ok) return reply(env, request, { ok: false, error: 'GitHub rejected the changes (' + t.status + '). Check the token has Contents: Read and write.' }, 502);
  const newTree = await t.json();
  if (newTree.sha === commit.tree.sha) return reply(env, request, { ok: true, unchanged: true, commit: headSha });
  const c = await gh(env, '/git/commits', { method: 'POST', body: JSON.stringify({ message, tree: newTree.sha, parents: [headSha] }) });
  if (!c.ok) return reply(env, request, { ok: false, error: 'GitHub could not create the commit (' + c.status + ').' }, 502);
  const newCommit = await c.json();
  const u = await gh(env, '/git/refs/heads/' + encodeURIComponent(branch(env)), { method: 'PATCH', body: JSON.stringify({ sha: newCommit.sha }) });
  if (!u.ok) return reply(env, request, { ok: false, error: 'GitHub could not update the branch (' + u.status + '). It may be protected; allow this token to push.' }, 502);
  return reply(env, request, { ok: true, commit: newCommit.sha });
}

/* ---------------- media: upload / serve / list / delete ---------------- */
const startsWith = (b, sig, off) => sig.every((x, i) => b[(off || 0) + i] === x);
function sniffImage(b) {
  if (b.length < 12) return '';
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(b, [0xff, 0xd8, 0xff])) return 'jpg';
  if (startsWith(b, [0x47, 0x49, 0x46, 0x38])) return 'gif';
  if (startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8)) return 'webp';
  return '';
}
function docMatches(b, ext) {
  if (ext === 'pdf') return startsWith(b, [0x25, 0x50, 0x44, 0x46, 0x2d]);
  if (ext === 'docx' || ext === 'xlsx' || ext === 'pptx') return startsWith(b, [0x50, 0x4b, 0x03, 0x04]);
  if (ext === 'doc' || ext === 'xls' || ext === 'ppt') return startsWith(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  return false;
}
const IMG_MIME = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

async function upload(request, env) {
  const st = storage(env);
  if (!st) return reply(env, request, { ok: false, error: 'Media storage is not configured. Bind an R2 bucket named MEDIA in worker.wrangler.toml.' }, 501);
  const kind = request.headers.get('X-Kind') || '';
  if (!['image', 'thumb', 'doc'].includes(kind)) return reply(env, request, { ok: false, error: 'Unknown upload kind.' }, 400);
  const max = kind === 'doc' ? S.LIMITS.docMB * 1048576 : kind === 'thumb' ? S.LIMITS.thumbKB * 1024 : S.LIMITS.imageMB * 1048576;
  const limitText = kind === 'doc' ? S.LIMITS.docMB + ' MB' : kind === 'thumb' ? S.LIMITS.thumbKB + ' KB' : S.LIMITS.imageMB + ' MB';
  if (Number(request.headers.get('Content-Length') || 0) > max) return reply(env, request, { ok: false, error: 'File is too large (limit ' + limitText + ').' }, 413);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length) return reply(env, request, { ok: false, error: 'The file is empty.' }, 400);
  if (bytes.length > max) return reply(env, request, { ok: false, error: 'File is too large (limit ' + limitText + ').' }, 413);

  const digest = hex(await crypto.subtle.digest('SHA-256', bytes));
  const month = new Date().toISOString().slice(0, 7).replace('-', '');
  let key, type, ext;
  if (kind === 'doc') {
    let rawName = 'file';
    try { rawName = decodeURIComponent(request.headers.get('X-File-Name') || 'file'); } catch (e) { /* keep default */ }
    ext = (rawName.split('.').pop() || '').toLowerCase();
    if (!S.DOC_EXT[ext]) return reply(env, request, { ok: false, error: 'This file type is not allowed. Use PDF, Word, Excel or PowerPoint.' }, 400);
    if (!docMatches(bytes, ext)) return reply(env, request, { ok: false, error: 'The file contents do not match its type.' }, 400);
    const slug = S.slugify(rawName.replace(/\.[^.]+$/, '')).slice(0, 50) || 'file';
    key = 'doc/' + month + '/' + digest.slice(0, 12) + '-' + slug + '.' + ext;
    type = S.DOC_EXT[ext];
  } else {
    ext = sniffImage(bytes);
    if (!ext) return reply(env, request, { ok: false, error: 'This is not a supported image (use JPG, PNG, WebP or GIF).' }, 400);
    type = IMG_MIME[ext];
    if (kind === 'image') key = 'img/' + month + '/' + digest.slice(0, 20) + '.' + ext;
    else {
      const full = request.headers.get('X-Thumb-Of') || '';
      if (!S.isImageKey(full) || !full.endsWith('.' + ext) || /\.t\.[a-z]+$/.test(full)) return reply(env, request, { ok: false, error: 'Thumbnail does not match its image.' }, 400);
      key = full.replace(/\.[a-z]+$/, '.t.' + ext);
    }
  }
  if (!(kind === 'doc' ? S.isDocKey(key) : S.isImageKey(key))) return reply(env, request, { ok: false, error: 'Could not create a storage name.' }, 400);
  await st.put(key, bytes, type);
  const base = mediaBase(env, request);
  return reply(env, request, { ok: true, key, url: base + '/' + key, base, size: bytes.length, type, ext });
}

async function serveMedia(request, env, url) {
  const st = storage(env);
  let key = '';
  try { key = decodeURIComponent(url.pathname.slice('/media/'.length)); } catch (e) { return new Response('Not found', { status: 404 }); }
  if (!st || !(S.isImageKey(key) || S.isDocKey(key))) return new Response('Not found', { status: 404 });
  const hit = typeof caches !== 'undefined' && caches.default ? await caches.default.match(request) : null;
  if (hit) return hit;
  const obj = await st.get(key);
  if (!obj) return new Response('Not found', { status: 404 });
  const h = new Headers();
  h.set('Content-Type', (obj.httpMetadata && obj.httpMetadata.contentType) || 'application/octet-stream');
  h.set('Cache-Control', IMMUTABLE);
  h.set('Access-Control-Allow-Origin', '*');
  h.set('Cross-Origin-Resource-Policy', 'cross-origin');
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('Content-Disposition', 'inline');
  h.set('Content-Security-Policy', "default-src 'none'; sandbox");
  if (obj.httpEtag) h.set('ETag', obj.httpEtag);
  const res = new Response(request.method === 'HEAD' ? null : obj.body, { status: 200, headers: h });
  if (typeof caches !== 'undefined' && caches.default && request.method === 'GET') { try { await caches.default.put(request, res.clone()); } catch (e) { /* ignore */ } }
  return res;
}

async function listMedia(request, env) {
  const st = storage(env);
  if (!st) return reply(env, request, { ok: false, error: 'Media storage is not configured.' }, 501);
  return reply(env, request, { ok: true, base: mediaBase(env, request), objects: await st.list() });
}

// Deletes unreferenced media only. A file still referenced by any record in GitHub is never deleted.
async function deleteMedia(request, env) {
  const st = storage(env);
  if (!st) return reply(env, request, { ok: false, error: 'Media storage is not configured.' }, 501);
  let body;
  try { body = await request.json(); } catch (e) { return reply(env, request, { ok: false, error: 'Request is not valid JSON.' }, 400); }
  const keys = Array.isArray(body && body.keys) ? body.keys : [];
  if (!keys.length || keys.length > 50 || keys.some((k) => !(S.isImageKey(k) || S.isDocKey(k)))) return reply(env, request, { ok: false, error: 'Invalid list of files.' }, 400);
  const used = mediaKeys(await loadFiles(env, [...ALLOWED_FILES]));
  const deleted = [], kept = [];
  for (const k of keys) {
    const full = k.replace(/\.t\.([a-z]+)$/, '.$1');
    if (used.has(k) || used.has(full)) { kept.push(k); continue; }
    const del = [k];
    if (S.isImageKey(k) && !/\.t\.[a-z]+$/.test(k)) del.push(k.replace(/\.([a-z]+)$/, '.t.$1'));
    await st.delete(del);
    deleted.push(k);
  }
  return reply(env, request, { ok: true, deleted, kept });
}
