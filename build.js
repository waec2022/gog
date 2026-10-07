#!/usr/bin/env node
/*
 * Campus Guide build  (one of the 5 files: build.js, assets.txt, data.json, worker.js, worker.wrangler.toml)
 *
 *   node build.js           data.json + assets.txt  ->  dist/          the PUBLIC website  (Cloudflare Pages project 1)
 *   node build.js editor    assets.txt              ->  dist-editor/   the Editor          (Cloudflare Pages project 2)
 *
 * Public build:
 *  - validates every record (build FAILS on invalid data, so Cloudflare keeps the previous good deploy)
 *  - removes drafts, archived, expired and hidden-feature records
 *  - resolves relationships (both directions) into display links
 *  - writes a compact search index (chunked), full public records, home.json, live.json, index.json
 *  - writes the website files from assets.txt and stamps a build id for cache busting
 * Editor build: set the Pages environment variables CG_API (your Worker URL) and CG_SITE (your public site URL).
 *
 * Cloudflare Pages settings
 *   Public site: build command  node build.js          output directory  dist
 *   Editor:      build command  node build.js editor   output directory  dist-editor     (+ env CG_API, CG_SITE)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// assets.txt holds every website/Editor file between "##### FILE: path #####" and "##### END FILE #####" lines.
const ASSETS = (() => {
  const txt = fs.readFileSync(path.join(__dirname, 'assets.txt'), 'utf8');
  const m = {}, re = /##### FILE: (.+?) #####\n([\s\S]*?)##### END FILE #####\n/g;
  let x;
  while ((x = re.exec(txt))) m[x[1]] = x[2];
  return m;
})();
// The shared schema (record types, validation) is one of those assets; the Editor and the Worker use the same code.
const S = (() => { const mod = { exports: {} }; new Function('module', 'exports', ASSETS['editor/schema.js'])(mod, mod.exports); return mod.exports; })();

const CHUNK_MAX = 5000;      // max entries per index file
const ALL_MAX = 4000;        // build one combined index for "All" up to this many records

// ALL source data lives in data.json: { "data/source/offices.json": [...], "data/source/settings.json": {...}, ... }
function readData(root) {
  const p = path.join(root, 'data.json');
  if (!fs.existsSync(p)) return {};
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { throw new Error('Invalid JSON in data.json: ' + e.message); }
}

function loadSource(root) {
  const all = readData(root);
  const get = (f, d) => (f in all ? all[f] : d);
  const cfg = get('data/source/features.json', { features: [], extend: {} });
  const cfgErrors = S.validateConfig(cfg);
  if (cfgErrors.length) throw new Error('Custom feature settings are invalid. Nothing was published.\n' + cfgErrors.slice(0, 30).map((m) => '  - ' + m).join('\n'));
  S.configure(cfg);
  const data = {};
  S.TYPE_IDS.forEach((t) => { data[t] = []; });
  S.BASE_TYPE_IDS().forEach((t) => {
    data[t] = get('data/source/' + S.TYPES[t].plural + '.json', []);
    if (!Array.isArray(data[t])) throw new Error('data.json: data/source/' + S.TYPES[t].plural + '.json must be a list');
  });
  const custom = get('data/source/custom.json', []);
  if (!Array.isArray(custom)) throw new Error('data.json: data/source/custom.json must be a list');
  data.__orphans = [];
  custom.forEach((r) => { if (r && data[r.type] && S.TYPES[r.type].group === 'custom') data[r.type].push(r); else data.__orphans.push(r); });
  return { data, settings: get('data/source/settings.json', {}), cfg };
}

const excerpt = (s, n) => {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  if (s.length <= n) return s;
  return s.slice(0, n).replace(/\s+\S*$/, '') + '…';
};
const lines = (a) => (Array.isArray(a) ? a.map((x) => String(x).trim()).filter(Boolean) : []);
const fmtDate = (d) => {
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return '';
  const [y, m, day] = d.split('-').map(Number);
  return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1] + ' ' + day + ', ' + y;
};
const fmtTime = (t) => {
  if (!t) return '';
  let [h, m] = t.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return h + ':' + String(m).padStart(2, '0') + ' ' + ap;
};

function rm(dir) { fs.rmSync(dir, { recursive: true, force: true }); }
function mkdirp(dir) { fs.mkdirSync(dir, { recursive: true }); }
// Writes the assets whose path starts with `prefix` (e.g. "src/") into dst, applying text replacements.
function writeAssets(prefix, dst, replacements) {
  for (const [p, content] of Object.entries(ASSETS)) {
    if (p.indexOf(prefix) !== 0) continue;
    let txt = content;
    for (const [k, v] of Object.entries(replacements)) txt = txt.split(k).join(v);
    const d = path.join(dst, p.slice(prefix.length));
    mkdirp(path.dirname(d));
    fs.writeFileSync(d, txt);
  }
}

function buildEditor(opts) {
  opts = opts || {};
  const out = path.join(opts.root || __dirname, opts.out || 'dist-editor');
  rm(out);
  const api = (process.env.CG_API || '').replace(/\/+$/, ''), site = process.env.CG_SITE || '';
  writeAssets('editor/', out, {});
  const cfgPath = path.join(out, 'config.js');
  fs.writeFileSync(cfgPath, fs.readFileSync(cfgPath, 'utf8').replace('API: ""', 'API: ' + JSON.stringify(api)).replace('SITE: ""', 'SITE: ' + JSON.stringify(site)));
  return { out, api, site };
}

function build(opts) {
  opts = opts || {};
  const root = opts.root || __dirname;
  const now = opts.now || (process.env.BUILD_NOW ? Date.parse(process.env.BUILD_NOW) : Date.now());
  const out = path.join(root, opts.out || 'dist');
  const { data, settings, cfg } = loadSource(root);

  const v = S.validateAll(data, now);
  if (v.errors.length) {
    const msg = v.errors.slice(0, 40).map((e) => '  - ' + e.type + ' ' + e.id + ': ' + e.msg).join('\n');
    const err = new Error('Source data is invalid (' + v.errors.length + ' error(s)). Nothing was published.\n' + msg);
    err.validation = v;
    throw err;
  }

  // ---- decide what is public ----
  const stats = { total: 0, public: 0, draft: 0, archived: 0, expired: 0, hidden: 0 };
  const pub = [];
  const byId = new Map();
  for (const t of S.TYPE_IDS) {
    for (const r of data[t]) {
      stats.total++;
      if (S.typeHidden(t)) { stats.hidden++; continue; }
      const lc = S.lifecycle(r, now);
      if (lc === 'draft') stats.draft++;
      else if (lc === 'archived') stats.archived++;
      else if (lc === 'expired') stats.expired++;
      else { stats.public++; pub.push(r); byId.set(r.id, r); }
    }
  }

  // ---- relationships (stored as IDs, resolved here, both directions) ----
  const links = new Map(); // id -> Map(label -> Map(targetId -> item))
  const item = (r) => ({ id: r.id, t: r.type, n: r.title, s: r.subtitle || '' });
  const addLink = (id, label, target) => {
    if (!label || target.id === id) return;
    if (!links.has(id)) links.set(id, new Map());
    const m = links.get(id);
    if (!m.has(label)) m.set(label, new Map());
    m.get(label).set(target.id, item(target));
  };
  for (const r of pub) {
    for (const fd of S.refFields(r.type)) {
      const ids = fd.t === 'ref' ? [r[fd.k]] : r[fd.k] || [];
      for (const id of ids) {
        const tg = byId.get(id);
        if (!tg) continue;
        addLink(r.id, fd.l, tg);
        addLink(tg.id, fd.rev, r);
      }
    }
    for (const id of r.related || []) {
      const tg = byId.get(id);
      if (!tg) continue;
      addLink(r.id, 'Related information', tg);
      addLink(tg.id, 'Related information', r);
    }
  }
  const linkGroups = (r) => {
    const m = links.get(r.id);
    if (!m) return [];
    const groups = [...m.entries()].map(([l, items]) => ({
      l, items: [...items.values()].sort((a, b) => a.n.localeCompare(b.n, undefined, { numeric: true }))
    }));
    groups.sort((a, b) => (a.l === 'Related information') - (b.l === 'Related information'));
    return groups;
  };

  // ---- helpers for facts ----
  const url = (r) => '/' + r.type + '/' + S.slugOf(r);
  const get = (id) => byId.get(id);
  const rf = (label, id) => { const r = id && get(id); return r ? [label, r.title, url(r)] : null; };
  const tx = (label, val) => (val ? [label, String(val)] : null);
  const place = (office) => {
    if (!office) return '';
    const b = get(office.building);
    return [office.title, b && b.title, office.floor && /floor/i.test(office.floor) ? office.floor : office.floor ? 'Floor ' + office.floor : '', office.room && 'Room ' + office.room].filter(Boolean).join(', ');
  };
  const facultyOf = (r) => { const d = get(r.department); return d && get(d.faculty); };

  function ctx(r) {
    switch (r.type) {
      case 'lecturer': case 'course': { const d = get(r.department); return d ? d.title : ''; }
      case 'office': { const b = get(r.building); return b ? b.title : ''; }
      case 'department': { const f = get(r.faculty); return f ? f.title : ''; }
      case 'service': { const o = get(r.office); return o ? o.title : ''; }
      case 'location': { const b = get(r.building); return b ? b.title : ''; }
      default: return '';
    }
  }
  const subtitleOf = (r) => [...new Set([r.subtitle, ctx(r)].filter(Boolean))].join(' · ');

  function facts(r) {
    let f = [];
    switch (r.type) {
      case 'office': f = [rf('Building', r.building), tx('Floor', r.floor), tx('Room', r.room), tx('Opening hours', r.hours), tx('Phone', r.phone), tx('Email', r.email)]; break;
      case 'lecturer': { const fac = facultyOf(r), off = get(r.office); f = [rf('Department', r.department), fac ? rf('Faculty', fac.id) : null, tx('Role', r.role), off ? ['Office location', place(off), url(off)] : null, tx('Phone', r.phone), tx('Email', r.email)]; break; }
      case 'course': { const fac = facultyOf(r); f = [rf('Department', r.department), fac ? rf('Faculty', fac.id) : null, tx('Level', r.level), tx('Semester', r.semester)]; break; }
      case 'department': f = [rf('Faculty', r.faculty), rf('Head of department', r.hod), rf('Office', r.office), tx('Phone', r.phone), tx('Email', r.email)]; break;
      case 'faculty': f = [rf('Dean', r.dean), rf('Office', r.office), tx('Phone', r.phone), tx('Email', r.email)]; break;
      case 'service': f = [rf('Offered by', r.office), tx('Opening hours', r.hours), tx('Phone', r.phone), tx('Email', r.email)]; break;
      case 'building': f = [tx('Address', r.address)]; break;
      case 'location': f = [rf('Building', r.building), tx('Address', r.address)]; break;
      case 'admission': f = [tx('Level', r.level), tx('Deadline', fmtDate(r.deadline)), tx('Email', r.email), tx('Phone', r.phone)]; break;
      case 'fee': f = [tx('Session', r.session), tx('Amount', r.amount), rf('Office', r.office)]; break;
      case 'timetable': f = [rf('Department', r.department), rf('Course', r.course), tx('Level', r.level), tx('Semester', r.semester)]; break;
      case 'calendar': f = [tx('Session', r.session)]; break;
      case 'announcement': f = [tx('Date', fmtDate(r.date)), tx('Source', r.source), r.priority === 'important' ? ['Priority', 'Important'] : null]; break;
      case 'event': f = [tx('Date', fmtDate(r.date)), tx('Time', [fmtTime(r.startTime), fmtTime(r.endTime)].filter(Boolean).join(' – ')), tx('Venue', r.venue), tx('Organizer', r.organizer), tx('Contact', r.contact), rf('Faculty', r.faculty), rf('Department', r.department)]; break;
      case 'campaign': f = [tx('Status', r.campaignStatus), tx('Starts', fmtDate(r.startDate)), tx('Ends', fmtDate(r.endDate)), tx('Organizer', r.organizer), tx('Contact', r.contact)]; break;
      case 'notice': f = [tx('Date', fmtDate(r.date)), tx('Source', r.source), r.priority && r.priority !== 'normal' ? ['Priority', r.priority[0].toUpperCase() + r.priority.slice(1)] : null]; break;
      case 'live': f = r.priority === 'urgent' ? [['Priority', 'Urgent']] : []; break;
      case 'document': { const fo = fileOut(r.file); f = [tx('Category', r.category), tx('Date', fmtDate(r.docDate)), fo && fo.t ? ['Type', fo.t.toUpperCase()] : null, fo && fo.s ? ['Size', fmtSize(fo.s)] : null]; break; }
    }
    return f.filter(Boolean);
  }
  function listsOf(r) {
    const L = [];
    const add = (l, a) => { a = lines(a); if (a.length) L.push([l, a]); };
    if (r.type === 'office') add('What to bring', r.bring);
    if (r.type === 'admission') add('Requirements', r.requirements);
    if (r.type === 'fee') add('How to pay', r.steps);
    return L;
  }
  function tableOf(r) {
    const split = (a, n) => lines(a).map((l) => { const p = l.split('|').map((x) => x.trim()); while (p.length < n) p.push(''); return p.slice(0, n); });
    if (r.type === 'timetable') { const rows = split(r.slots, 4); return rows.length ? { h: ['Day', 'Time', 'Course', 'Venue'], r: rows } : null; }
    if (r.type === 'calendar') { const rows = split(r.entries, 2); return rows.length ? { h: ['Date', 'Event'], r: rows } : null; }
    return null;
  }
  function dirFor(r) {
    let b = null;
    const viaOffice = (id) => { const o = get(id); return o && get(o.building); };
    if (r.type === 'building' || r.type === 'location') b = r.type === 'location' && !(r.lat && r.lng) ? get(r.building) || r : r;
    else if (r.type === 'office') b = get(r.building);
    else if (['lecturer', 'department', 'faculty', 'service'].includes(r.type)) b = viaOffice(r.office);
    const pt = [r, b].find((x) => x && x.lat !== undefined && x.lat !== '' && x.lng !== undefined && x.lng !== '');
    if (!b && !pt) return null;
    const href = pt
      ? 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(pt.lat + ',' + pt.lng)
      : 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent((b ? b.title : r.title) + (settings.mapSuffix ? ', ' + settings.mapSuffix : ''));
    const text = r.directions || (b && b.directions) || '';
    return { u: href, t: text };
  }

  // ---- files, images, long text and custom fields (data-driven, no per-feature code) ----
  const fmtSize = (n) => (!n ? '' : n < 1024 ? n + ' B' : n < 1048576 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB');
  const hostOf = (u) => { try { return new URL(u).host.replace(/^www\./, ''); } catch (e) { return u; } };
  const mapsUrl = (q) => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q + (settings.mapSuffix ? ', ' + settings.mapSuffix : ''));
  // Download permission lives on each file: dl 1 = Download allowed, anything else = View only (the default).
  const fileOut = (o, label) => {
    if (!o || !S.isDocKey(o.k)) return null;
    const ext = (o.k.split('.').pop() || '').toLowerCase();
    const f = { k: o.k, n: o.n || o.k.split('/').pop(), t: S.DOC_EXT[ext] ? ext : '', s: o.s || 0, dl: o.dl === 1 || o.dl === true ? 1 : 0 };
    if (label) f.l = label;
    return f;
  };
  function extras(r) {
    const out = { facts: [], blocks: [], imgs: [], files: [], text: [] };
    for (const fd of S.TYPES[r.type].fields) {
      const v = r[fd.k];
      if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
      if (fd.t === 'file') { const f = fileOut(v, fd.custom ? fd.l : ''); if (f) out.files.push(f); continue; }
      if (fd.t === 'files') { v.forEach((o) => { const f = fileOut(o); if (f) out.files.push(f); }); continue; }
      if (!fd.custom || fd.hidden || fd.pub === false) continue;
      switch (fd.t) {
        case 'text': case 'select': out.facts.push([fd.l, String(v)]); out.text.push(String(v)); break;
        case 'number': out.facts.push([fd.l, String(v)]); break;
        case 'time': out.facts.push([fd.l, fmtTime(v)]); break;
        case 'date': out.facts.push([fd.l, fmtDate(v)]); break;
        case 'checkbox': out.facts.push([fd.l, v ? 'Yes' : 'No']); break;
        case 'textarea': out.blocks.push([fd.l, String(v)]); break;
        case 'phone': out.facts.push([fd.l, String(v), 'tel:' + String(v).replace(/[^\d+]/g, '')]); break;
        case 'email': out.facts.push([fd.l, String(v), 'mailto:' + v]); break;
        case 'url': out.facts.push([fd.l, hostOf(v), v]); break;
        case 'link': out.facts.push([fd.l, v.l || hostOf(v.u), v.u]); break;
        case 'location': out.facts.push([fd.l, String(v), mapsUrl(String(v))]); break;
        case 'image': out.imgs.push({ k: v, l: fd.l }); break;
      }
    }
    return out;
  }
  const dateOf = (r) => {
    if (r.date || r.startDate) return r.date || r.startDate;
    for (const fd of S.TYPES[r.type].fields) if (fd.t === 'date' && r[fd.k]) return r[fd.k];
    return (r.updated || '').slice(0, 10) || '';
  };

  // ---- write output ----
  rm(out);
  mkdirp(path.join(out, 'data/idx'));
  const hash = crypto.createHash('sha1');
  const write = (rel, obj) => {
    const txt = JSON.stringify(obj);
    hash.update(rel + txt);
    mkdirp(path.dirname(path.join(out, rel)));
    fs.writeFileSync(path.join(out, rel), txt);
  };
  const exp = (r) => { const e = S.expiryMs(r); return e ? Math.floor(e / 1000) : 0; };

  const entries = [];
  for (const r of pub) {
    const lg = linkGroups(r);
    let x = lg.flatMap((g) => g.items.map((i) => i.n));
    if (r.type === 'lecturer' || r.type === 'course') { const fac = facultyOf(r); if (fac) x.push(fac.title); }
    const ex0 = extras(r);
    x = [...new Set(x.concat(ex0.text))].join(' ').slice(0, 300);
    const entry = { i: r.id, t: r.type, n: r.title };
    const sub = subtitleOf(r); if (sub) entry.s = sub;
    if ((r.keywords || []).length) entry.k = r.keywords.join('|');
    if ((r.aliases || []).length) entry.a = r.aliases.join('|');
    if (x) entry.x = x;
    const d = excerpt(r.description, 80); if (d) entry.d = d;
    const e = exp(r); if (e) entry.e = e;
    const vs = r.verification && r.verification.status;
    if (S.isVerified(vs)) entry.v = vs;
    if (r.type === 'live' && r.startsAt && !isNaN(Date.parse(r.startsAt))) entry.b = Math.floor(Date.parse(r.startsAt) / 1000);
    if (S.typeSearchable(r.type)) entries.push(entry);

    const ver = r.verification || {};
    const rec = { id: r.id, type: r.type, title: r.title };
    if (r.subtitle) rec.subtitle = r.subtitle;
    if (r.description) rec.desc = r.description;
    if (r.image) rec.img = r.image;
    rec.ver = { s: ver.status || 'unverified' };
    if (S.isVerified(rec.ver.s)) { if (ver.by) rec.ver.by = ver.by; if (ver.date) rec.ver.d = ver.date; }
    const fc = facts(r).concat(ex0.facts); if (fc.length) rec.facts = fc;
    if (ex0.blocks.length) rec.blocks = ex0.blocks;
    if (ex0.imgs.length) rec.imgs = ex0.imgs;
    if (ex0.files.length) rec.files = ex0.files;
    const ls = listsOf(r); if (ls.length) rec.lists = ls;
    const tb = tableOf(r); if (tb) rec.table = tb;
    if (r.type === 'lecturer' && r.bio && r.bio !== r.description) rec.bio = r.bio;
    const contact = {};
    if (r.phone) contact.phone = r.phone;
    if (r.email) contact.email = r.email;
    if (r.link) { contact.link = r.link; contact.ll = r.type === 'event' ? 'Register' : 'Open link'; }
    if (Object.keys(contact).length) rec.contact = contact;
    const dr = dirFor(r); if (dr) rec.dir = dr;
    if (lg.length) rec.links = lg;
    if (r.updated) rec.upd = r.updated;
    const ex = exp(r); if (ex) rec.exp = ex;
    write('data/pub/' + r.type + '/' + S.slugOf(r) + '.json', rec);
  }

  // search index: one chunked file set per filter group, plus a combined "All" index while small
  const chunks = {};
  const split = (arr) => { const o = []; for (let i = 0; i < arr.length; i += CHUNK_MAX) o.push(arr.slice(i, i + CHUNK_MAX)); return o.length ? o : [[]]; };
  for (const g of S.GROUPS) {
    if (g.id === 'all') continue;
    const sub = entries.filter((e) => S.groupOf(e.t) === g.id);
    chunks[g.id] = split(sub).map((part, n) => {
      const rel = 'data/idx/' + g.id + (n ? '-' + (n + 1) : '') + '.json';
      write(rel, part);
      return rel;
    });
  }
  let all = null;
  if (entries.length <= ALL_MAX) { write('data/idx/all.json', entries); all = ['data/idx/all.json']; }

  // homepage: small curated lists
  const today = new Date(now).toISOString().slice(0, 10);
  const homeItem = (r) => {
    const o = { i: r.id, t: r.type, n: r.title };
    const x = excerpt(r.description, 100); if (x) o.x = x;
    const d = dateOf(r); if (d) o.d = d;
    if (r.image) o.m = r.image;
    const e = exp(r); if (e) o.e = e;
    return o;
  };
  const ofType = (t) => pub.filter((r) => r.type === t);
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const home = {
    events: ofType('event').filter((r) => !r.date || r.date >= today).sort((a, b) => cmp(a.date || '9', b.date || '9')).slice(0, 3).map(homeItem),
    campaigns: ofType('campaign').filter((r) => r.campaignStatus !== 'Ended' && (!r.endDate || r.endDate >= today)).sort((a, b) => cmp(a.endDate || '9', b.endDate || '9')).slice(0, 3).map(homeItem),
    announcements: ofType('announcement').sort((a, b) => (b.priority === 'important') - (a.priority === 'important') || cmp(dateOf(b), dateOf(a))).slice(0, 3).map(homeItem),
    updates: pub.filter((r) => r.type === 'notice' || r.type === 'live').sort((a, b) => cmp(b.updated || '', a.updated || '') || cmp(dateOf(b), dateOf(a))).slice(0, 4).map(homeItem)
  };
  const sortRecent = (a, b) => cmp(dateOf(b), dateOf(a)) || cmp(a.title, b.title);
  home.features = S.FEATURES.filter((ft) => ft.status !== 'hidden' && ft.home)
    .sort((a, b) => (Number(a.sort) || 0) - (Number(b.sort) || 0))
    .map((ft) => { const o = { t: ft.id, n: ft.name, items: ofType(ft.id).sort(sortRecent).slice(0, 3).map(homeItem) }; if (ft.icon) o.ic = ft.icon; return o; })
    .filter((x) => x.items.length);
  write('data/home.json', home);
  write('data/live.json', ofType('live').slice(0, 10).map((r) => {
    const o = { i: r.id, n: r.title, p: r.priority || 'normal', e: exp(r) };
    if (r.startsAt && !isNaN(Date.parse(r.startsAt))) o.s = Math.floor(Date.parse(r.startsAt) / 1000);
    if (S.isVerified(r.verification && r.verification.status)) o.v = r.verification.status;
    return o;
  }));

  const buildId = hash.digest('hex').slice(0, 10);
  const counts = {};
  for (const g of S.GROUPS) counts[g.id] = g.id === 'all' ? entries.length : entries.filter((e) => S.groupOf(e.t) === g.id).length;
  const manifest = {
    v: buildId, built: new Date(now).toISOString(),
    site: { name: 'Campus Guide', university: settings.university || '', campus: settings.campus || '' },
    groups: S.GROUPS.map((g) => ({ id: g.id, label: g.label, types: g.types.filter((t) => !S.typeHidden(t)) })),
    types: Object.fromEntries(S.TYPE_IDS.filter((t) => !S.typeHidden(t)).map((t) => [t, S.TYPES[t].label])),
    media: { base: (settings.mediaBase || '').replace(/\/+$/, '') },
    counts, all, chunks
  };
  fs.writeFileSync(path.join(out, 'data/index.json'), JSON.stringify(manifest));

  // public website
  const desc = 'Campus Guide: search offices, lecturers, courses, departments, services, timetables and campus updates' + (settings.university ? ' at ' + settings.university : '') + '.';
  writeAssets('src/', out, { __BUILD__: buildId, __DESC__: desc.replace(/"/g, '&quot;') });

  return { stats, buildId, out, entries: entries.length, warnings: v.warnings };
}

module.exports = { build, buildEditor, loadSource, S };

if (require.main === module) {
  try {
    if (process.argv[2] === 'editor') {
      const e = buildEditor();
      console.log('Campus Guide Editor built -> ' + path.relative(process.cwd(), e.out) + '/  (Worker URL: ' + (e.api || 'not set: set CG_API or type it in the Editor') + ')');
      process.exit(0);
    }
    const r = build();
    console.log('Campus Guide build ' + r.buildId);
    console.log('  records: ' + r.stats.total + ' (public ' + r.stats.public + ', draft ' + r.stats.draft + ', archived ' + r.stats.archived + ', expired ' + r.stats.expired + ')');
    r.warnings.forEach((w) => console.log('  warning: ' + w.type + ' ' + w.id + ': ' + w.msg));
    console.log('  output: ' + path.relative(process.cwd(), r.out) + '/');
  } catch (e) {
    console.error('\nBUILD FAILED\n' + e.message + '\n');
    process.exit(1);
  }
}
