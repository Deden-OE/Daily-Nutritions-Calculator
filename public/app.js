/* Nutri Calc — aplikasi tanpa server. Semua data pribadi disimpan di perangkat (localStorage). */
(() => {
'use strict';

/* ---------- Utilitas ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const today = () => ymd(new Date());
const HARI = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const fmtDate = s => { const d = parseYmd(s); return `${HARI[d.getDay()]}, ${d.getDate()} ${BULAN[d.getMonth()]} ${d.getFullYear()}`; };
const fmtShort = s => { const d = parseYmd(s); return `${d.getDate()} ${BULAN[d.getMonth()]}`; };
function fmt(x, unit) {
  if (x == null || !isFinite(x)) return '–';
  const a = Math.abs(x);
  const dec = unit === 'kkal' ? 0 : a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 1 : 2;
  return x.toLocaleString('id-ID', { maximumFractionDigits: dec, minimumFractionDigits: 0 });
}
const numIn = v => { if (v == null) return null; const s = String(v).trim().replace(',', '.'); if (s === '') return null; const n = Number(s); return isFinite(n) ? n : null; };

const LS = {
  get(k, d) { try { const v = localStorage.getItem('kg2.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) {
    try { localStorage.setItem('kg2.' + k, JSON.stringify(v)); return true; }
    catch (e) { toast('Gagal menyimpan di perangkat ini. Unduh cadangan di tab Data.'); return false; }
  },
  del(k) { try { localStorage.removeItem('kg2.' + k); } catch (e) { /* abaikan */ } },
};

let toastTimer;
function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

function download(name, text, type = 'text/csv') {
  const blob = new Blob([type.startsWith('text/csv') ? '﻿' + text : text], { type: type + ';charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const csvCell = v => { if (v == null) return ''; const s = String(v); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const csvLine = arr => arr.map(csvCell).join(',');
function parseCSV(text) {
  const rows = []; let row = [], cell = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

/* ---------- Data ---------- */
let NUTR = [];           // [{key,label,unit,group}]
let NK = [];             // daftar key
let NMAP = {};
let DBV = '';            // versi database
let AKG = [];
const FOODS = new Map(); // id -> makanan
let BASE = [];           // makanan bawaan database
let USDA = null;         // USDA lengkap (dimuat saat diminta)

const MEALS = [['sarapan', 'Sarapan'], ['siang', 'Makan siang'], ['malam', 'Makan malam'], ['camilan', 'Camilan']];
const MEAL_LABEL = Object.fromEntries(MEALS);
const SRC_LABEL = { TKPI: 'TKPI', USDA: 'USDA', Perkiraan: 'Perkiraan', 'Turunan TKPI': 'Turunan TKPI', NutriNusa: 'NutriNusa', Sendiri: 'Buatan saya', 'USDA lengkap': 'USDA' };

let custom = LS.get('custom', []);       // makanan buatan pengguna
let extra = LS.get('extra', {});         // makanan USDA lengkap yang pernah dipakai
let favs = LS.get('favs', []);
let recent = LS.get('recent', []);

function indexFoods() {
  FOODS.clear();
  for (const f of BASE) FOODS.set(f.id, f);
  for (const id in extra) FOODS.set(id, extra[id]);
  for (const f of custom) FOODS.set(f.id, f);
}

/* ---------- Profil ---------- */
const DEFAULT_PROFILE = { id: 'saya', nama: 'Saya', jk: 'L', usia: 32, bb: 62, tb: 167, lp: 73.5, akt: 1.55, tujuan: 'lean', ukur: [] };
let profiles = LS.get('profiles', null);
if (!Array.isArray(profiles) || !profiles.length) { profiles = [structuredCloneSafe(DEFAULT_PROFILE)]; LS.set('profiles', profiles); }
let activeId = LS.get('active', profiles[0].id);
if (!profiles.find(p => p.id === activeId)) activeId = profiles[0].id;
function structuredCloneSafe(o) { return JSON.parse(JSON.stringify(o)); }
const prof = () => profiles.find(p => p.id === activeId) || profiles[0];
const saveProfiles = () => { LS.set('profiles', profiles); LS.set('active', activeId); };

const AKT = [[1.2, 'Sangat jarang bergerak (kerja duduk, tanpa olahraga)'], [1.375, 'Ringan (olahraga 1–3x/minggu)'], [1.55, 'Sedang (olahraga 3–5x/minggu)'], [1.725, 'Berat (olahraga 6–7x/minggu)'], [1.9, 'Sangat berat (atlet / kerja fisik berat)']];
const TUJUAN = {
  lean: { label: 'Otot lean (tambah otot, lemak minimal)', adj: 250, gkg: 1.8 },
  jaga: { label: 'Menjaga berat badan', adj: 0, gkg: 1.2 },
  turun: { label: 'Menurunkan lemak tubuh', adj: -400, gkg: 2.0 },
  naik: { label: 'Menaikkan berat badan', adj: 500, gkg: 1.8 },
};

/* Batas atas asupan (UL) dewasa, dipakai hanya untuk peringatan. */
const UL = { vita: 3000, vitd: 100, vite: 300, vitc: 2000, vitb6: 100, kalsium: 2500, fosfor: 4000, besi: 45, seng: 40, selenium: 400, mangan: 11, tembaga: 10 };

function akgRow(p) {
  const rows = AKG.filter(r => p.usia >= r.min && p.usia <= r.max && (r.jk === 'semua' || r.jk === p.jk));
  return rows[0] || AKG.filter(r => !r.tambah).slice(-1)[0] || {};
}

function calc(p) {
  const row = akgRow(p);
  const bmr = 10 * p.bb + 6.25 * p.tb - 5 * p.usia + (p.jk === 'L' ? 5 : -161);
  const tdee = bmr * p.akt;
  const tj = TUJUAN[p.tujuan] || TUJUAN.jaga;
  const dewasa = p.usia >= 18;
  const t = {}; // key -> {v, type:'min'|'max'|'range', note}
  const add = p.jk === 'P' && p.kondisi ? AKG.find(r => r.tambah && r.jk === p.kondisi) : null;
  const MAKRO = ['energi', 'protein', 'lemak', 'kh', 'serat'];
  for (const k of NK) if (row[k] != null) t[k] = { v: row[k] + (add && !MAKRO.includes(k) ? add[k] || 0 : 0), type: 'min', src: 'AKG' };
  let energi, protein;
  if (dewasa) {
    const adj = add ? 0 : tj.adj, addE = add ? add.energi : 0, addP = add ? add.protein : 0;
    energi = Math.round((tdee + adj + addE) / 10) * 10;
    energi = Math.max(energi, Math.round(bmr * 1.1 / 10) * 10);
    protein = Math.round(Math.max((row.protein || 0) + addP, p.bb * (add ? 1.1 : tj.gkg) + addP));
    const lemak = Math.round(energi * 0.25 / 9);
    const kh = Math.round((energi - protein * 4 - lemak * 9) / 4);
    t.energi = { v: energi, type: 'range', src: 'Hitungan' };
    t.protein = { v: protein, type: 'min', src: 'Hitungan' };
    t.lemak = { v: lemak, type: 'range', src: '25% energi' };
    t.kh = { v: kh, type: 'range', src: 'Sisa energi' };
    t.serat = { v: Math.round(energi * 14 / 1000), type: 'min', src: '14 g/1000 kkal' };
  } else {
    if (add) for (const k of MAKRO) if (t[k]) t[k].v += add[k] || 0;
    energi = t.energi ? t.energi.v : row.energi; protein = t.protein ? t.protein.v : row.protein;
    if (t.energi) t.energi.type = 'range';
    if (t.lemak) t.lemak.type = 'range';
    if (t.kh) t.kh.type = 'range';
  }
  const e = t.energi ? t.energi.v : 2000;
  t.gula = { v: Math.round(Math.min(50, e * 0.10 / 4)), type: 'max', src: 'Batas Kemenkes' };
  t.natrium = { v: 2000, type: 'max', src: 'Batas Kemenkes/WHO', akg: row.natrium };
  t.lemak_jenuh = { v: Math.round(e * 0.10 / 9), type: 'max', src: '<10% energi' };
  t.kolesterol = { v: 300, type: 'max', src: 'Batas umum' };
  const bmi = p.bb / Math.pow(p.tb / 100, 2);
  const whtr = p.lp ? p.lp / p.tb : null;
  return { row, add, bmr, tdee, energi, protein, t, bmi, whtr, dewasa };
}

function bmiGauge(b) {
  const lo = 15, hi = 33, pos = v => (clamp(v, lo, hi) - lo) / (hi - lo) * 100;
  const segs = [[lo, 18.5, 'var(--warn)', 'Kurus'], [18.5, 23, 'var(--good)', 'Normal'], [23, 25, 'var(--warn)', 'Berlebih'], [25, 30, 'var(--bad)', 'Obes. I'], [30, hi, 'var(--bad)', 'Obes. II']];
  return `<div class="gauge" role="img" aria-label="IMT ${fmt(b)}, ${bmiCat(b)[0]}"><span class="mk num" style="left:${pos(b).toFixed(1)}%">IMT ${fmt(b)}</span>
    <div class="seg">${segs.map(([a, z, c]) => `<i style="width:${(pos(z) - pos(a)).toFixed(2)}%;background:${c};opacity:.85"></i>`).join('')}</div>
    <div class="lb">${segs.map(([a, z, , l]) => `<span style="width:${(pos(z) - pos(a)).toFixed(2)}%">${l}</span>`).join('')}</div></div>`;
}
function bmiCat(b) {
  if (b < 18.5) return ['Kurus', 'warn'];
  if (b < 23) return ['Normal', 'good'];
  if (b < 25) return ['Berlebih (berisiko)', 'warn'];
  if (b < 30) return ['Obesitas I', 'bad'];
  return ['Obesitas II', 'bad'];
}

/* ---------- Catatan harian ---------- */
const logKey = () => 'log.' + activeId;
let LOG = LS.get(logKey(), {});
const saveLog = () => LS.set(logKey(), LOG);
const dayEntries = d => LOG[d] || [];

function foodOf(e) { return FOODS.get(e.f) || null; }
function entryVal(e, k) {
  const f = foodOf(e);
  if (f) { const v = f.v[k]; return v == null ? null : v * e.g / 100; }
  if (k === 'energi' && e.e != null) return e.e;
  if (k === 'protein' && e.pr != null) return e.pr;
  return null;
}
function totals(entries) {
  const sum = {}, miss = {};
  for (const k of NK) { sum[k] = 0; miss[k] = 0; }
  for (const e of entries) for (const k of NK) { const v = entryVal(e, k); if (v == null) miss[k]++; else sum[k] += v; }
  return { sum, miss, n: entries.length };
}

function addEntry(date, food, g, meal) {
  const e = { id: uid(), f: food.id, n: food.n, g, m: meal, e: food.v.energi != null ? +(food.v.energi * g / 100).toFixed(1) : null, pr: food.v.protein != null ? +(food.v.protein * g / 100).toFixed(2) : null };
  (LOG[date] = LOG[date] || []).push(e);
  saveLog();
  recent = [food.id, ...recent.filter(x => x !== food.id)].slice(0, 30);
  LS.set('recent', recent);
  if (food.s === 'USDA lengkap' && !extra[food.id]) { extra[food.id] = food; LS.set('extra', extra); }
}

/* ---------- Pencarian ---------- */
const SYN = [[/\bmie\b/g, 'mi'], [/\btelor\b/g, 'telur'], [/\btoge\b|\btauge\b/g, 'taoge'], [/\bcabe\b/g, 'cabai'], [/\bijo\b/g, 'hijau'],
  [/\bbayem\b/g, 'bayam'], [/\bkedele\b/g, 'kedelai'], [/\bketela\b/g, 'singkong'], [/\bsapi\b/g, 'sapi'], [/\bpete\b/g, 'petai'], [/\bduren\b/g, 'durian'],
  [/\bkangkong\b/g, 'kangkung'], [/\btomat\b/g, 'tomat'], [/\bjagong\b/g, 'jagung'], [/\bgoreng2an\b/g, 'gorengan'], [/\bmentimun\b/g, 'ketimun'], [/\btimun\b/g, 'ketimun']];
function norm(s) {
  s = String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  for (const [re, to] of SYN) s = s.replace(re, to);
  return ' ' + s + ' ';
}
function searchList(list, q, limit = 80) {
  const nq = norm(q).trim();
  if (!nq) return list.slice(0, limit);
  const toks = nq.split(' ');
  const out = [];
  for (const f of list) {
    const h = f._h || (f._h = norm(f.n + ' ' + (f.c || '')));
    const hk = f._hk || (f._hk = norm(f.k || ''));
    let ok = true, score = 0;
    for (const t of toks) {
      const i = h.indexOf(' ' + t);
      if (i >= 0) score += i < 2 ? 0 : 1;          // awal kata di nama
      else if (h.indexOf(t) >= 0) score += 3;       // bagian kata di nama
      else if (hk.indexOf(' ' + t) >= 0) score += 8; // hanya cocok di kelompok
      else { ok = false; break; }
    }
    if (!ok) continue;
    if (h.startsWith(' ' + nq)) score -= 1;
    if (/segar|mentah|raw/.test(h)) score -= 0.5;
    score += f.n.length / 100;
    out.push([score, f]);
  }
  out.sort((a, b) => a[0] - b[0]);
  return out.slice(0, limit).map(x => x[1]);
}

/* ---------- Status ---------- */
let tab = 'hari';
let curDate = today();
let catatMeal = defaultMeal();
let catatSrc = 'semua';
let catatKel = '';
let catatQ = '';
let riwRange = 7;

function defaultMeal() { const h = new Date().getHours(); return h < 10 ? 'sarapan' : h < 15 ? 'siang' : h < 18 ? 'camilan' : 'malam'; }

function switchTab(t) {
  tab = t;
  $$('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  $$('.view').forEach(v => { v.hidden = v.id !== 'view-' + t; });
  render();
  window.scrollTo(0, 0);
}

function render() {
  const p = prof();
  $('#profile-chip').innerHTML = `<span class="av">${esc((p.nama || '?').trim().charAt(0).toUpperCase())}</span><span class="nm">${esc(p.nama)}</span>`;
  const h = new Date().getHours();
  $('#hello').textContent = `${h < 11 ? 'Selamat pagi' : h < 15 ? 'Selamat siang' : h < 18 ? 'Selamat sore' : 'Selamat malam'}, ${p.nama} 👋`;
  $('#subhello').textContent = 'Nutri Calc · ' + fmtDate(today());
  if (tab === 'hari') renderHari();
  else if (tab === 'catat') renderCatat();
  else if (tab === 'riwayat') renderRiwayat();
  else if (tab === 'profil') renderProfil();
  else if (tab === 'data') renderData();
}

/* ---------- Komponen ---------- */
function ring(pct, over) {
  const r = 50, c = 2 * Math.PI * r, p = clamp(pct, 0, 1);
  return `<svg class="ring" viewBox="0 0 124 124" role="img" aria-label="${Math.round(pct * 100)}% dari target energi">
    <circle cx="62" cy="62" r="${r}" fill="none" stroke="rgba(255,255,255,.16)" stroke-width="13"/>
    ${p > 0.005 ? `<circle cx="62" cy="62" r="${r}" fill="none" stroke="${over ? '#ffb38a' : 'var(--pop)'}" stroke-width="13" stroke-linecap="round"
      stroke-dasharray="${(c * p).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 62 62)"/>` : ''}
    <text x="62" y="60" text-anchor="middle" font-size="24" font-weight="800" fill="#fff">${Math.round(pct * 100)}%</text>
    <text x="62" y="80" text-anchor="middle" font-size="11" font-weight="600" fill="rgba(255,255,255,.7)">dari target</text></svg>`;
}
function miniRing(pct, color, label) {
  const r = 21, c = 2 * Math.PI * r, p = clamp(pct, 0, 1);
  return `<svg class="mr" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="${r}" fill="none" stroke="var(--track)" stroke-width="7"/>
    ${p > 0.005 ? `<circle cx="26" cy="26" r="${r}" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${(c * p).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 26 26)"/>` : ''}
    <text x="26" y="30" text-anchor="middle" font-size="12" font-weight="800" fill="var(--text)">${label}</text></svg>`;
}

function status(k, val, tg) {
  if (!tg) return { cls: '', pct: null, label: '' };
  const pct = tg.v ? val / tg.v : 0;
  if (tg.type === 'max') {
    if (pct > 1) return { cls: 'bad', pct, label: 'Lewat batas' };
    if (pct > 0.8) return { cls: 'warn', pct, label: 'Mendekati batas' };
    return { cls: 'good', pct, label: 'Aman' };
  }
  if (UL[k] && val > UL[k]) return { cls: 'bad', pct, label: 'Di atas batas aman' };
  if (tg.type === 'range') {
    if (pct > 1.1) return { cls: 'warn', pct, label: 'Melebihi target' };
    if (pct >= 0.9) return { cls: 'good', pct, label: 'Sesuai target' };
    return { cls: '', pct, label: '' };
  }
  if (pct >= 1) return { cls: 'good', pct, label: 'Tercapai' };
  return { cls: '', pct, label: '' };
}

function macroBar(k, tot, C) {
  const n = NMAP[k], tg = C.t[k], v = tot.sum[k], st = status(k, v, tg);
  const ge = tot.miss[k] ? '≥ ' : '';
  const icon = st.cls === 'bad' ? '✕' : st.cls === 'warn' ? '!' : '✓';
  return `<div class="macro"><div class="h"><span>${esc(n.label)} ${tot.n && st.label ? `<span class="tag ${st.cls}">${icon} ${st.label}</span>` : ''}</span>
    <span class="num">${ge}${fmt(v)} <span class="muted">/ ${fmt(tg ? tg.v : null)} ${esc(n.unit)}</span></span></div>
    <div class="bar"><i class="${st.cls}" style="width:${clamp((st.pct || 0) * 100, 0, 100).toFixed(1)}%"></i></div>
    ${tot.miss[k] ? `<div class="gap">${tot.miss[k]} item belum punya data ${esc(n.label.toLowerCase())}</div>` : ''}</div>`;
}

function nutrientTable(tot, C, scaleNote) {
  const groups = ['Makro', 'Lemak', 'Mineral', 'Vitamin'];
  let h = `<table class="nt"><thead><tr><th>Zat gizi</th><th class="right">Jumlah</th><th>% target</th></tr></thead><tbody>`;
  for (const g of groups) {
    h += `<tr><th colspan="3" style="padding-top:14px">${g}</th></tr>`;
    for (const n of NUTR.filter(x => x.group === g)) h += nutRow(n, tot, C);
  }
  h += '</tbody></table>';
  if (scaleNote) h += `<p class="muted">${scaleNote}</p>`;
  return h;
}
function nutRow(n, tot, C) {
  const tg = C ? C.t[n.key] : null, v = tot.sum[n.key], miss = tot.miss[n.key];
  const st = status(n.key, v, tg);
  const allMiss = tot.n && miss === tot.n;
  return `<tr><td>${esc(n.label)}${tg && tg.type === 'max' ? ' <span class="badge">batas</span>' : ''}
      ${miss && !allMiss ? `<div class="gap">${miss} item tanpa data</div>` : ''}${st.label ? `<div class="status ${st.cls}">${st.label}</div>` : ''}</td>
    <td class="v">${allMiss ? '–' : (miss ? '≥ ' : '') + fmt(v)} <span class="muted small">${esc(n.unit)}</span>${tg ? `<div class="muted small">dari ${fmt(tg.v)}</div>` : ''}</td>
    <td class="pc">${tg ? `<div class="pcbar"><div class="bar"><i class="${st.cls}" style="width:${clamp((st.pct || 0) * 100, 0, 100).toFixed(1)}%"></i></div><span>${Math.round((st.pct || 0) * 100)}%</span></div>` : '<span class="muted small">–</span>'}</td></tr>`;
}

/* Kategori kesehatan: skor 0–100 dari zat gizi terkait */
const KATEGORI = [
  { id: 'otot', e: '💪', n: 'Otot & pemulihan', bg: 'var(--p1)', k: ['protein', 'magnesium', 'kalium', 'seng', 'vitb6'], d: 'Protein membangun otot; magnesium, kalium, seng, dan B6 membantu kontraksi dan pemulihan.' },
  { id: 'tulang', e: '🦴', n: 'Tulang & sendi', bg: 'var(--p4)', k: ['kalsium', 'vitd', 'vitk', 'fosfor', 'magnesium'], d: 'Kalsium dan fosfor membentuk tulang; vitamin D dan K membantu penyerapan dan pengikatannya.' },
  { id: 'darah', e: '🩸', n: 'Darah & energi', bg: 'var(--p6)', k: ['besi', 'vitb12', 'folat', 'riboflavin', 'niasin'], d: 'Zat besi, B12, dan folat untuk sel darah merah; B2 dan B3 untuk mengubah makanan jadi energi.' },
  { id: 'imun', e: '🛡️', n: 'Daya tahan', bg: 'var(--p3)', k: ['vitc', 'vita', 'seng', 'selenium', 'vite', 'vitd'], d: 'Vitamin C, A, E, D, seng, dan selenium mendukung sistem imun.' },
  { id: 'jantung', e: '❤️', n: 'Jantung', bg: 'var(--p2)', k: ['serat', 'kalium', 'natrium', 'lemak_jenuh', 'kolesterol'], d: 'Serat dan kalium cukup, sementara natrium, lemak jenuh, dan kolesterol tidak lewat batas.' },
  { id: 'otak', e: '🧠', n: 'Otak & saraf', bg: 'var(--p5)', k: ['kolin', 'vitb12', 'vitb6', 'thiamin', 'folat'], d: 'Kolin dan vitamin B mendukung fungsi saraf dan konsentrasi.' },
];
function catScore(cat, tot, C) {
  let s = 0, n = 0;
  for (const k of cat.k) {
    const tg = C.t[k]; if (!tg || !tot.n || tot.miss[k] === tot.n) continue;
    const v = tot.sum[k];
    s += tg.type === 'max' ? (v <= tg.v ? 1 : Math.max(0, 1 - (v - tg.v) / tg.v)) : Math.min(1, v / tg.v);
    n++;
  }
  return n ? Math.round(s / n * 100) : 0;
}
const scoreTag = s => s >= 80 ? ['good', 'Mantap'] : s >= 50 ? ['warn', 'Lumayan'] : ['bad', 'Kurang'];

function streak() {
  let d = today(), n = 0;
  if (!dayEntries(d).length) d = addDays(d, -1);
  while (dayEntries(d).length) { n++; d = addDays(d, -1); }
  return n;
}

const MEAL_EMOJI = { sarapan: ['🌅', 'var(--p4)'], siang: ['☀️', 'var(--p2)'], malam: ['🌙', 'var(--p5)'], camilan: ['🍪', 'var(--p6)'] };
const KAT_EMOJI = { 'Serealia': '🍚', 'Umbi berpati': '🥔', 'Kacang dan biji': '🥜', 'Sayuran': '🥬', 'Buah': '🍎', 'Daging dan unggas': '🍗', 'Ikan, kerang, udang': '🐟',
  'Telur': '🥚', 'Susu': '🥛', 'Lemak dan minyak': '🫒', 'Gula, sirup, konfeksioneri': '🍬', 'Bumbu': '🧂', 'Minuman': '🥤', 'Restoran & cepat saji': '🍔',
  'Makanan jadi': '🍱', 'Jajanan pasar': '🍡', 'Makanan instan': '🍜', 'Kafe & bakery': '🥐', 'Menu sehat': '🥗', 'Suplemen': '💊', 'Dessert & es krim': '🍨', 'USDA SR Legacy': '🌎' };
const foodEmoji = f => f.id === 'air-putih' ? '💧' : KAT_EMOJI[f.k] || '🍽️';

const WATER_ID = 'air-putih';
function waterCount(ents) { return ents.filter(e => e.f === WATER_ID).reduce((a, e) => a + e.g, 0) / 250; }
function drop(filled) {
  return `<svg viewBox="0 0 22 28" aria-hidden="true"><path d="M11 2C11 2 3 11.5 3 17.5a8 8 0 0 0 16 0C19 11.5 11 2 11 2z" fill="${filled ? 'var(--c1)' : 'none'}" stroke="${filled ? 'var(--c1)' : 'var(--line)'}" stroke-width="2"/></svg>`;
}

/* ---------- Hari ini ---------- */
function renderHari() {
  const el = $('#view-hari'), p = prof(), C = calc(p);
  const ents = dayEntries(curDate), tot = totals(ents);
  const eT = C.t.energi.v, eV = tot.sum.energi, sisa = eT - eV;
  const est = ents.filter(e => { const f = foodOf(e); return f && f.s === 'Perkiraan'; }).length;
  const st = streak();
  let h = `<div class="datebar"><button class="btn" data-act="prev" aria-label="Hari sebelumnya">‹</button>
    <label class="dl">${curDate === today() ? '📅 Hari ini' : '📅 ' + fmtDate(curDate)}
    <input type="date" id="date-pick" value="${curDate}" style="position:absolute;opacity:0;width:1px;height:1px;left:0"></label>
    <button class="btn" data-act="next" aria-label="Hari berikutnya" ${curDate >= today() ? 'disabled' : ''}>›</button></div>`;

  // Hero energi
  h += `<section class="hero"><div class="hrow">${ring(eT ? eV / eT : 0, eV > eT * 1.1)}<div class="grow">
    <div class="lbl">Energi masuk</div>
    <div class="big num">${tot.miss.energi ? '≥' : ''}${fmt(eV, 'kkal')}</div><div class="of">dari ${fmt(eT, 'kkal')} kkal</div>
    <div class="pills"><span class="pill pop">${sisa >= 0 ? `⚡ Sisa ${fmt(sisa, 'kkal')} kkal` : `⚠️ Lebih ${fmt(-sisa, 'kkal')} kkal`}</span>
    ${st ? `<span class="pill">🔥 ${st} hari beruntun</span>` : ''}</div></div></div>
    <div class="goal">🎯 ${esc((TUJUAN[p.tujuan] || TUJUAN.jaga).label)}</div></section>`;

  // Asupan utama
  h += `<div class="card"><h3>Asupan utama</h3>${macroBar('protein', tot, C)}${macroBar('kh', tot, C)}${macroBar('lemak', tot, C)}${macroBar('serat', tot, C)}</div>`;

  // Komposisi energi
  const kP = tot.sum.protein * 4, kK = tot.sum.kh * 4, kL = tot.sum.lemak * 9, kS = kP + kK + kL;
  const tP = C.t.protein.v * 4 / eT, tL = C.t.lemak.v * 9 / eT, tK = 1 - tP - tL;
  const pc = x => kS ? Math.round(x / kS * 100) : 0;
  h += `<div class="card"><h3>Sumber energimu</h3><div class="muted">Persentase kalori dari protein, karbohidrat, dan lemak</div>
    <div class="stack" role="img" aria-label="Protein ${pc(kP)}%, karbohidrat ${pc(kK)}%, lemak ${pc(kL)}%">${kS ? `<i style="width:${pc(kP)}%;background:var(--c1)"></i><i style="width:${pc(kK)}%;background:var(--c2)"></i><i style="width:${pc(kL)}%;background:var(--c3)"></i>` : ''}</div>
    <div class="legend"><div><span class="sw" style="background:var(--c1)"></span>Protein<b class="num">${pc(kP)}%</b>ideal ${Math.round(tP * 100)}%</div>
      <div><span class="sw" style="background:var(--c2)"></span>Karbo<b class="num">${pc(kK)}%</b>ideal ${Math.round(tK * 100)}%</div>
      <div><span class="sw" style="background:var(--c3)"></span>Lemak<b class="num">${pc(kL)}%</b>ideal ${Math.round(tL * 100)}%</div></div></div>`;

  // Skor kategori
  h += `<div class="sec-h"><h2>Skor kesehatan</h2><span class="muted">ketuk untuk detail</span></div><div class="cats">${KATEGORI.map(c => {
    const s = catScore(c, tot, C), [cls, lb] = scoreTag(s);
    return `<button class="cat" data-cat="${c.id}" style="background:${c.bg}"><span class="em">${c.e}</span><span class="cn">${c.n}</span>
      <span class="sc num">${s}<small>/100</small></span><div class="bar"><i style="width:${s}%"></i></div>${tot.n ? `<span class="tag ${cls}" style="align-self:flex-start">${lb}</span>` : ''}</button>`;
  }).join('')}</div>
  <p class="muted small">Skor naik seiring makanan dicatat sepanjang hari. 100 = semua zat gizi di kategori itu memenuhi target.</p>`;

  // Batasi
  h += `<div class="card"><h3>🚦 Batasi</h3>${macroBar('gula', tot, C)}${macroBar('natrium', tot, C)}${macroBar('lemak_jenuh', tot, C)}${macroBar('kolesterol', tot, C)}</div>`;

  // Makanan per waktu makan
  h += `<div class="sec-h"><h2>Makananmu</h2><span class="muted num">${ents.length} item</span></div>`;
  for (const [m, label] of MEALS) {
    const me = ents.filter(e => e.m === m);
    const kcal = me.reduce((a, e) => a + (entryVal(e, 'energi') || 0), 0);
    const [em, bg] = MEAL_EMOJI[m];
    h += `<div class="meal"><div class="meal-h"><span class="me" style="background:${bg}">${em}</span><div class="grow"><b>${label}</b>
      <span class="muted num">${me.length ? fmt(kcal, 'kkal') + ' kkal · ' + me.length + ' item' : 'Belum ada'}</span></div>
      <button class="add" data-act="add" data-meal="${m}" aria-label="Tambah ke ${label}">+</button></div>`;
    for (const e of me) {
      const f = foodOf(e), kc = entryVal(e, 'energi'), pr = entryVal(e, 'protein');
      h += `<div class="item"><button class="pick fx" data-act="edit" data-id="${e.id}"><span class="fe">${f ? foodEmoji(f) : '❔'}</span><div><div class="t">${esc(f ? f.n : e.n)}</div>
        <div class="muted">${fmt(e.g)} g · ${fmt(kc, 'kkal')} kkal · protein ${fmt(pr)} g${f ? '' : ' · <span class="gap">data makanan tidak ditemukan</span>'}</div></div></button></div>`;
    }
    h += `</div>`;
  }
  if (!ents.length) {
    const prev = dayEntries(addDays(curDate, -1));
    h += `<div class="empty"><span class="em">🥗</span>Belum ada catatan. Yuk mulai dari sarapan!<br><button class="btn primary" data-act="add" data-meal="${defaultMeal()}" style="margin-top:12px">+ Catat makanan</button>
      ${prev.length ? `<br><button class="btn link" data-act="copy-prev" style="margin-top:6px">Salin ${prev.length} item dari hari sebelumnya</button>` : ''}</div>`;
  }
  if (ents.length) {
    h += `<details class="card"><summary>Semua zat gizi (${NUTR.length})</summary>${nutrientTable(tot, C,
      'Tanda ≥ berarti sebagian makanan belum punya data zat gizi itu, jadi jumlah sebenarnya bisa lebih tinggi.' + (est ? ` ${est} item memakai nilai perkiraan.` : ''))}</details>`;
  }
  el.innerHTML = h;
}

function openCatSheet(id) {
  const c = KATEGORI.find(x => x.id === id), C = calc(prof()), tot = totals(dayEntries(curDate));
  const s = catScore(c, tot, C), [cls, lb] = scoreTag(s);
  openSheet(`<h2>${c.e} ${c.n}</h2><div class="row"><span style="font-size:30px;font-weight:800" class="num">${s}<span class="muted" style="font-size:14px">/100</span></span><span class="tag ${cls}">${lb}</span></div>
    <p class="muted">${c.d}</p><table class="nt"><tbody>${c.k.map(k => nutRow(NMAP[k], tot, C)).join('')}</tbody></table>
    <div class="row" style="margin-top:14px"><button class="btn grow" data-act="close">Tutup</button></div>`, ev => { if (ev.target.closest('[data-act=close]')) closeSheet(); });
}

$('#view-hari').addEventListener('click', ev => {
  const cat = ev.target.closest('[data-cat]'); if (cat) { openCatSheet(cat.dataset.cat); return; }
  const b = ev.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act;
  if (a === 'prev') { curDate = addDays(curDate, -1); renderHari(); }
  else if (a === 'next') { if (curDate < today()) { curDate = addDays(curDate, 1); renderHari(); } }
  else if (a === 'add') { catatMeal = b.dataset.meal; switchTab('catat'); }
  else if (a === 'edit') openEntrySheet(b.dataset.id);
  else if (a === 'water+') {
    const f = FOODS.get(WATER_ID); if (!f) { toast('Data air putih tidak ditemukan'); return; }
    addEntry(curDate, f, 250, defaultMeal()); renderHari();
  } else if (a === 'water-') {
    const list = dayEntries(curDate); const i = list.map(e => e.f).lastIndexOf(WATER_ID);
    if (i >= 0) { list.splice(i, 1); if (!list.length) delete LOG[curDate]; saveLog(); renderHari(); }
  } else if (a === 'copy-prev') {
    const prev = dayEntries(addDays(curDate, -1));
    LOG[curDate] = prev.map(e => ({ ...e, id: uid() })); saveLog(); renderHari(); toast('Catatan disalin');
  }
});
$('#view-hari').addEventListener('change', ev => {
  if (ev.target.id === 'date-pick' && ev.target.value) { curDate = ev.target.value > today() ? today() : ev.target.value; renderHari(); }
});
$('#view-hari').addEventListener('click', ev => {
  const lab = ev.target.closest('label.dl'); const inp = lab && $('#date-pick', lab);
  if (inp && inp.showPicker) { try { inp.showPicker(); ev.preventDefault(); } catch (e) { /* tidak didukung */ } }
});

/* ---------- Sheet (panel bawah) ---------- */
function openSheet(html, onClick) {
  closeSheet();
  const bg = document.createElement('div');
  bg.className = 'sheet-bg'; bg.id = 'sheet';
  bg.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  bg.addEventListener('click', ev => { if (ev.target === bg) closeSheet(); });
  if (onClick) bg.addEventListener('click', onClick);
  document.body.appendChild(bg);
  document.body.style.overflow = 'hidden';
  const first = $('input:not([type=hidden]),select', bg); if (first && !matchMedia('(pointer:coarse)').matches) first.focus();
  return bg;
}
function closeSheet() { const s = $('#sheet'); if (s) s.remove(); document.body.style.overflow = ''; }
document.addEventListener('keydown', ev => { if (ev.key === 'Escape') closeSheet(); });

function srcBadge(f) {
  const s = f.s;
  const cls = s === 'TKPI' ? 'tkpi' : s === 'Perkiraan' ? 'est' : '';
  return `<span class="badge ${cls}">${esc(SRC_LABEL[s] || s)}</span>`;
}

function preview(f, g) {
  const v = k => f.v[k] == null ? '–' : fmt(f.v[k] * g / 100, k === 'energi' ? 'kkal' : '');
  return `<div class="grid3 small num" style="margin-top:10px;gap:6px">
    <div class="stat"><b>${v('energi')}</b><span>kkal</span></div><div class="stat"><b>${v('protein')}</b><span>protein g</span></div>
    <div class="stat"><b>${v('kh')}</b><span>karbohidrat g</span></div><div class="stat"><b>${v('lemak')}</b><span>lemak g</span></div>
    <div class="stat"><b>${v('serat')}</b><span>serat g</span></div><div class="stat"><b>${v('natrium')}</b><span>natrium mg</span></div></div>`;
}

function foodInfo(f) {
  const lines = [];
  if (f.src) lines.push(esc(f.src));
  if (f.bdd != null && f.bdd < 100) lines.push(`Nilai per 100 g bagian yang dapat dimakan (BDD ${fmt(f.bdd)}%). Masukkan berat tanpa tulang, kulit, atau biji.`);
  if (f.x && f.x.length) lines.push(`${f.x.length} zat gizi yang tidak ada di TKPI dilengkapi dari USDA.`);
  if (f.note && !(f.x && f.x.length)) lines.push(esc(f.note));
  return lines.length ? `<div class="note">${lines.join('<br>')}</div>` : '';
}

function portionButtons(f) {
  const opts = [];
  if (f.p && f.p !== 100) opts.push([f.p, `${f.pk || '1 porsi'} (${fmt(f.p)} g)`]);
  else if (f.pk) opts.push([f.p, `${f.pk} (${fmt(f.p)} g)`]);
  for (const g of [50, 100, 150, 200]) if (!opts.find(o => o[0] === g)) opts.push([g, g + ' g']);
  return `<div class="qty">${opts.map(([g, l]) => `<button type="button" class="chip" data-g="${g}">${esc(l)}</button>`).join('')}</div>`;
}

function per100Table(f) {
  const tot = { sum: {}, miss: {}, n: 1 };
  for (const k of NK) { tot.sum[k] = f.v[k] ?? 0; tot.miss[k] = f.v[k] == null ? 1 : 0; }
  return `<details><summary>Semua zat gizi per 100 g</summary>${nutrientTable(tot, null)}</details>`;
}

function openFoodSheet(f, opts = {}) {
  let g = opts.g || f.p || 100;
  let meal = opts.meal || catatMeal;
  const isFav = favs.includes(f.id);
  const html = `<h2>${esc(f.n)}</h2><div class="muted">${srcBadge(f)} ${esc(f.k || '')}${f.c ? ' · ' + esc(f.c) : ''}</div>
    ${foodInfo(f)}
    <label class="f">Berat yang dimakan (gram)<input type="number" id="fs-g" inputmode="decimal" min="0" step="any" value="${g}"></label>
    ${portionButtons(f)}
    <label class="f">Waktu makan<select id="fs-m">${MEALS.map(([k, l]) => `<option value="${k}" ${k === meal ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <div id="fs-prev">${preview(f, g)}</div>
    ${per100Table(f)}
    <div class="row" style="margin-top:14px"><button class="btn" data-act="fav">${isFav ? '★ Favorit' : '☆ Favorit'}</button>
      <button class="btn primary grow" data-act="${opts.entryId ? 'save' : 'add'}">${opts.entryId ? 'Simpan perubahan' : 'Tambahkan ke ' + esc(MEAL_LABEL[meal])}</button></div>
    ${opts.entryId ? '<div class="row" style="margin-top:8px"><button class="btn danger grow" data-act="del">Hapus dari catatan</button></div>' : ''}`;
  const s = openSheet(html, ev => {
    const c = ev.target.closest('[data-g]');
    if (c) { $('#fs-g', s).value = c.dataset.g; upd(); return; }
    const b = ev.target.closest('[data-act]'); if (!b) return;
    const gram = numIn($('#fs-g', s).value);
    const m = $('#fs-m', s).value;
    if (b.dataset.act === 'fav') {
      favs = favs.includes(f.id) ? favs.filter(x => x !== f.id) : [f.id, ...favs];
      LS.set('favs', favs); b.textContent = favs.includes(f.id) ? '★ Favorit' : '☆ Favorit';
      if (!extra[f.id] && f.s === 'USDA lengkap') { extra[f.id] = f; LS.set('extra', extra); indexFoods(); }
      if (tab === 'catat') renderResults();
    } else if (b.dataset.act === 'add') {
      if (!gram || gram <= 0) { toast('Isi berat dalam gram'); return; }
      addEntry(curDate, f, gram, m); indexFoods(); closeSheet();
      toast(`${f.n.slice(0, 40)} · ${fmt(gram)} g ditambahkan ke ${MEAL_LABEL[m]}`);
      catatMeal = m; render();
    } else if (b.dataset.act === 'save') {
      if (!gram || gram <= 0) { toast('Isi berat dalam gram'); return; }
      const e = dayEntries(curDate).find(x => x.id === opts.entryId);
      if (e) { e.g = gram; e.m = m; e.e = f.v.energi != null ? +(f.v.energi * gram / 100).toFixed(1) : e.e; e.pr = f.v.protein != null ? +(f.v.protein * gram / 100).toFixed(2) : e.pr; saveLog(); }
      closeSheet(); render();
    } else if (b.dataset.act === 'del') {
      LOG[curDate] = dayEntries(curDate).filter(x => x.id !== opts.entryId);
      if (!LOG[curDate].length) delete LOG[curDate];
      saveLog(); closeSheet(); render(); toast('Dihapus dari catatan');
    }
  });
  const upd = () => { const gram = numIn($('#fs-g', s).value) || 0; $('#fs-prev', s).innerHTML = preview(f, gram); };
  $('#fs-g', s).addEventListener('input', upd);
  $('#fs-m', s).addEventListener('change', () => { const b = $('[data-act=add]', s); if (b) b.textContent = 'Tambahkan ke ' + MEAL_LABEL[$('#fs-m', s).value]; });
}

function openEntrySheet(id) {
  const e = dayEntries(curDate).find(x => x.id === id); if (!e) return;
  const f = foodOf(e);
  if (f) { openFoodSheet(f, { g: e.g, meal: e.m, entryId: e.id }); return; }
  const s = openSheet(`<h2>${esc(e.n)}</h2><div class="note">Data makanan ini tidak ada lagi di database (mungkin makanan buatan sendiri yang sudah dihapus). Energi dan protein yang tersimpan tetap dihitung.</div>
    <div class="row"><button class="btn danger grow" data-act="del">Hapus dari catatan</button></div>`, ev => {
    if (ev.target.closest('[data-act=del]')) {
      LOG[curDate] = dayEntries(curDate).filter(x => x.id !== id); saveLog(); closeSheet(); render();
    }
  });
  return s;
}

/* ---------- Catat ---------- */
const SRC_CHIPS = [['semua', '✨ Semua'], ['fav', '⭐ Favorit'], ['recent', '🕘 Terakhir'], ['TKPI', '🇮🇩 TKPI'], ['USDA', '🇺🇸 USDA pilihan'], ['Perkiraan', '🍱 Menu jadi'], ['Sendiri', '✍️ Buatan saya'], ['usdafull', '🌎 USDA lengkap (Inggris)']];

function renderCatat() {
  const el = $('#view-catat');
  const kel = [...new Set(BASE.map(f => f.k).concat(custom.map(f => f.k)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'id'));
  el.innerHTML = `<div class="chips" role="tablist" aria-label="Waktu makan">${MEALS.map(([k, l]) => `<button class="chip ${k === catatMeal ? 'on' : ''}" data-meal="${k}">${MEAL_EMOJI[k][0]} ${l}</button>`).join('')}</div>
    <div class="muted small">Tanggal: ${esc(fmtDate(curDate))}${curDate !== today() ? ' · <button class="btn link" data-act="to-today">ganti ke hari ini</button>' : ''}</div>
    <input type="search" id="q" placeholder="Cari makanan, mis. nasi, telur rebus, tempe" value="${esc(catatQ)}" autocomplete="off" enterkeyhint="search" aria-label="Cari makanan">
    <div class="chips" id="src-chips">${SRC_CHIPS.map(([k, l]) => `<button class="chip ${k === catatSrc ? 'on' : ''}" data-src="${k}">${l}</button>`).join('')}</div>
    <div class="row"><select id="kel" class="grow" aria-label="Kelompok bahan" ${catatSrc === 'usdafull' ? 'disabled' : ''}><option value="">Semua kelompok</option>${kel.map(k => `<option ${k === catatKel ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select>
      <button class="btn small" data-act="new-food" style="margin-top:4px;white-space:nowrap">+ Buat sendiri</button></div>
    <div class="card" id="results" style="padding:4px 12px"></div>`;
  renderResults();
}

async function loadUSDA() {
  if (USDA) return USDA;
  $('#results').innerHTML = '<div class="empty">Memuat 8.789 bahan USDA (sekitar 4,5 MB, sekali saja)…</div>';
  try {
    const r = await fetch('data/usda.json?v=' + DBV);
    const arr = await r.json();
    USDA = arr.map(x => ({ ...x, k: 'USDA SR Legacy', s: 'USDA lengkap', c: x.id.replace('usda-', ''), p: 100, pk: '', src: 'USDA SR Legacy ' + x.id.replace('usda-', '') + ' (nama asli bahasa Inggris)' }));
    return USDA;
  } catch (e) { toast('Gagal memuat data USDA. Periksa koneksi internet.'); return []; }
}

async function renderResults() {
  const box = $('#results'); if (!box) return;
  let list, title = '';
  if (catatSrc === 'usdafull') {
    list = await loadUSDA();
    if (!catatQ.trim()) { box.innerHTML = '<div class="empty">Ketik nama bahan dalam bahasa Inggris, mis. <i>oatmeal</i>, <i>salmon</i>, <i>almond</i>.<br>Data lengkap 34 zat gizi dari USDA (domain publik).</div>'; return; }
  } else {
    let all = BASE.concat(custom);
    if (catatSrc === 'fav') all = favs.map(id => FOODS.get(id)).filter(Boolean);
    else if (catatSrc === 'recent') all = recent.map(id => FOODS.get(id)).filter(Boolean);
    else if (catatSrc === 'USDA') all = all.filter(f => f.s === 'USDA');
    else if (catatSrc === 'Perkiraan') all = all.filter(f => f.s === 'Perkiraan' || f.s === 'Turunan TKPI' || f.s === 'NutriNusa');
    else if (catatSrc !== 'semua') all = all.filter(f => f.s === catatSrc);
    if (catatKel) all = all.filter(f => f.k === catatKel);
    list = all;
    if (!catatQ.trim() && catatSrc === 'semua' && !catatKel) {
      const fv = favs.map(id => FOODS.get(id)).filter(Boolean).slice(0, 8);
      const rc = recent.map(id => FOODS.get(id)).filter(f => f && !fv.includes(f)).slice(0, 10);
      if (fv.length || rc.length) {
        box.innerHTML = (fv.length ? '<h3>★ Favorit</h3>' + fv.map(itemHtml).join('') : '') + (rc.length ? '<h3>Terakhir dipakai</h3>' + rc.map(itemHtml).join('') : '')
          + `<p class="muted" style="padding:8px 0">Ketik untuk mencari di ${BASE.length.toLocaleString('id-ID')} bahan.</p>`;
        return;
      }
      title = `<p class="muted" style="padding:8px 0 0">${BASE.length.toLocaleString('id-ID')} bahan: TKPI lengkap, USDA pilihan, dan menu jadi. Ketik untuk mencari.</p>`;
    }
  }
  const res = searchList(list, catatQ, 80);
  box.innerHTML = title + (res.length ? res.map(itemHtml).join('') + (res.length === 80 ? '<p class="muted">Menampilkan 80 hasil teratas. Perjelas pencarian untuk hasil lain.</p>' : '')
    : `<div class="empty">Tidak ditemukan.${catatSrc !== 'usdafull' ? '<br>Coba sumber <b>USDA lengkap</b> dengan nama bahasa Inggris, atau buat makanan sendiri.' : ''}</div>`);
}

function itemHtml(f) {
  const e = f.v.energi;
  return `<div class="item"><button class="pick fx" data-fid="${esc(f.id)}"><span class="fe">${foodEmoji(f)}</span><div><div class="t">${esc(f.n)}</div>
    <div class="muted">${srcBadge(f)} ${esc(f.k || '')} · ${e == null ? '–' : fmt(e, 'kkal')} kkal · protein ${fmt(f.v.protein)} g /100 g</div></div></button>
    <button class="btn link" data-star="${esc(f.id)}" aria-label="Favorit">${favs.includes(f.id) ? '★' : '☆'}</button></div>`;
}

function findFood(id) { return FOODS.get(id) || (USDA && USDA.find(x => x.id === id)); }

let qTimer;
$('#view-catat').addEventListener('input', ev => {
  if (ev.target.id === 'q') { catatQ = ev.target.value; clearTimeout(qTimer); qTimer = setTimeout(renderResults, 120); }
});
$('#view-catat').addEventListener('change', ev => {
  if (ev.target.id === 'kel') { catatKel = ev.target.value; renderResults(); }
});
$('#view-catat').addEventListener('click', ev => {
  const t = ev.target;
  const m = t.closest('[data-meal]'); if (m) { catatMeal = m.dataset.meal; $$('[data-meal]', $('#view-catat')).forEach(c => c.classList.toggle('on', c === m)); return; }
  const s = t.closest('[data-src]');
  if (s) { catatSrc = s.dataset.src; $$('[data-src]').forEach(c => c.classList.toggle('on', c === s)); $('#kel').disabled = catatSrc === 'usdafull'; renderResults(); return; }
  const st = t.closest('[data-star]');
  if (st) {
    const id = st.dataset.star, f = findFood(id);
    favs = favs.includes(id) ? favs.filter(x => x !== id) : [id, ...favs]; LS.set('favs', favs);
    if (f && f.s === 'USDA lengkap' && !extra[id]) { extra[id] = f; LS.set('extra', extra); indexFoods(); }
    st.textContent = favs.includes(id) ? '★' : '☆'; return;
  }
  const p = t.closest('[data-fid]'); if (p) { const f = findFood(p.dataset.fid); if (f) openFoodSheet(f); return; }
  const a = t.closest('[data-act]');
  if (a && a.dataset.act === 'new-food') openCustomForm();
  if (a && a.dataset.act === 'to-today') { curDate = today(); renderCatat(); }
});

/* ---------- Makanan buatan sendiri ---------- */
const MAIN_KEYS = ['energi', 'protein', 'lemak', 'lemak_jenuh', 'kh', 'gula', 'serat', 'natrium', 'kolesterol'];
function openCustomForm(f) {
  const edit = !!f;
  f = f || { id: '', n: '', k: 'Buatan saya', p: 100, pk: '', v: {}, note: '' };
  const fld = k => { const n = NMAP[k]; return `<label class="f">${esc(n.label)} (${esc(n.unit)})<input type="text" inputmode="decimal" data-k="${k}" value="${f.v[k] ?? ''}"></label>`; };
  const html = `<h2>${edit ? 'Ubah' : 'Buat'} makanan sendiri</h2>
    <p class="muted">Salin dari label gizi kemasan atau resep. Kolom yang kosong dianggap belum diketahui, bukan nol.</p>
    <label class="f">Nama makanan<input type="text" id="cf-n" value="${esc(f.n)}" placeholder="mis. Granola merek X"></label>
    <div class="grid2"><label class="f">Kelompok<input type="text" id="cf-k" value="${esc(f.k)}"></label>
      <label class="f">Porsi biasa (g)<input type="text" inputmode="decimal" id="cf-p" value="${f.p}"></label></div>
    <label class="f">Keterangan porsi<input type="text" id="cf-pk" value="${esc(f.pk || '')}" placeholder="mis. 1 bungkus, 1 sendok makan"></label>
    <label class="f">Nilai gizi yang saya isi adalah<select id="cf-mode"><option value="100">per 100 g (atau 100 ml)</option><option value="saji">per sajian (seperti di label)</option></select></label>
    <label class="f" id="cf-saji-w" hidden>Berat 1 sajian (g)<input type="text" inputmode="decimal" id="cf-saji" placeholder="mis. 30"></label>
    <div class="grid2">${MAIN_KEYS.map(fld).join('')}</div>
    <details><summary>Zat gizi lain (opsional)</summary><div class="grid2">${NK.filter(k => !MAIN_KEYS.includes(k)).map(fld).join('')}</div></details>
    <label class="f">Catatan / sumber<input type="text" id="cf-note" value="${esc(f.note || '')}" placeholder="mis. label kemasan 2026"></label>
    <div class="row" style="margin-top:14px">${edit ? '<button class="btn danger" data-act="cf-del">Hapus</button>' : ''}<button class="btn" data-act="cf-cancel">Batal</button><button class="btn primary grow" data-act="cf-save">Simpan</button></div>`;
  const s = openSheet(html, ev => {
    const b = ev.target.closest('[data-act]'); if (!b) return;
    if (b.dataset.act === 'cf-cancel') closeSheet();
    if (b.dataset.act === 'cf-del') {
      custom = custom.filter(x => x.id !== f.id); LS.set('custom', custom); indexFoods(); closeSheet(); render(); toast('Makanan dihapus');
    }
    if (b.dataset.act === 'cf-save') {
      const n = $('#cf-n', s).value.trim(); if (!n) { toast('Isi nama makanan'); return; }
      const mode = $('#cf-mode', s).value, saji = numIn($('#cf-saji', s).value);
      if (mode === 'saji' && !(saji > 0)) { toast('Isi berat 1 sajian'); return; }
      const v = {};
      for (const inp of $$('[data-k]', s)) { const x = numIn(inp.value); if (x != null) v[inp.dataset.k] = mode === 'saji' ? +(x * 100 / saji).toFixed(4) : x; }
      if (v.energi == null) { toast('Isi minimal energi (kkal)'); return; }
      const food = { id: f.id || 'saya-' + uid(), n, k: $('#cf-k', s).value.trim() || 'Buatan saya', s: 'Sendiri', c: '', p: numIn($('#cf-p', s).value) || (mode === 'saji' ? saji : 100),
        pk: $('#cf-pk', s).value.trim(), v, note: $('#cf-note', s).value.trim(), src: 'Dibuat pengguna' + ($('#cf-note', s).value.trim() ? ': ' + $('#cf-note', s).value.trim() : '') };
      custom = edit ? custom.map(x => x.id === food.id ? food : x) : [food, ...custom];
      LS.set('custom', custom); indexFoods(); closeSheet();
      toast('Tersimpan. Cari di sumber "Buatan saya".');
      if (tab === 'catat' && !edit) openFoodSheet(food); else render();
    }
  });
  $('#cf-mode', s).addEventListener('change', () => { $('#cf-saji-w', s).hidden = $('#cf-mode', s).value !== 'saji'; });
}

/* ---------- Riwayat ---------- */
function dayTotals(d) { const t = totals(dayEntries(d)); return t; }

function barChart(days, key, target, unit, label) {
  const W = Math.round(clamp(($('#main').clientWidth || 360) - 62, 280, 660)), H = 190, L = 40, R = 6, T = 14, B = 24;
  const vals = days.map(d => LOG[d] && LOG[d].length ? dayTotals(d).sum[key] : null);
  const max = Math.max(target * 1.25, ...vals.filter(v => v != null)) || 1;
  const step = (W - L - R) / days.length, bw = Math.max(2, Math.min(36, step * 0.68));
  const y = v => T + (H - T - B) * (1 - v / max);
  const ticks = niceTicks(max);
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)} per hari, target ${fmt(target)} ${esc(unit)}">`;
  for (const tk of ticks) s += `<line class="axis" x1="${L}" x2="${W - R}" y1="${y(tk)}" y2="${y(tk)}" stroke-width="1" opacity=".6"/><text x="${L - 6}" y="${y(tk) + 4}" text-anchor="end">${fmt(tk, 'kkal')}</text>`;
  days.forEach((d, i) => {
    const x = L + step * i + (step - bw) / 2, v = vals[i];
    if (v != null && v > 0) s += `<rect class="barm" x="${x.toFixed(1)}" y="${y(v).toFixed(1)}" width="${bw.toFixed(1)}" height="${(y(0) - y(v)).toFixed(1)}" rx="${Math.min(4, bw / 3).toFixed(1)}"/>`;
    const show = days.length <= 7 || i % Math.ceil(days.length / 7) === 0 || i === days.length - 1;
    if (show) s += `<text x="${(i === days.length - 1 && days.length > 7 ? W - R : L + step * i + step / 2).toFixed(1)}" y="${H - 8}" text-anchor="${i === days.length - 1 && days.length > 7 ? 'end' : 'middle'}">${days.length <= 7 ? HARI[parseYmd(d).getDay()] : fmtShort(d)}</text>`;
  });
  s += `<line class="tgt" x1="${L}" x2="${W - R}" y1="${y(target)}" y2="${y(target)}"/>`;
  s += `<text x="${W - R}" y="${y(target) - 5}" text-anchor="end" style="fill:var(--text-2)">target ${fmt(target, 'kkal')}</text>`;
  days.forEach((d, i) => { s += `<rect class="hit" x="${(L + step * i).toFixed(1)}" y="${T}" width="${step.toFixed(1)}" height="${H - T - B}" data-tip="${esc(fmtDate(d))}: ${vals[i] == null ? 'tidak ada catatan' : fmt(vals[i], 'kkal') + ' ' + unit + ' (' + Math.round(vals[i] / target * 100) + '% target)'}"/>`; });
  s += '</svg>';
  const tbl = `<details><summary>Lihat sebagai tabel</summary><table class="nt"><thead><tr><th>Tanggal</th><th class="right">${esc(label)} (${esc(unit)})</th><th class="right">% target</th></tr></thead><tbody>
    ${days.map((d, i) => `<tr><td>${esc(fmtDate(d))}</td><td class="v">${vals[i] == null ? '–' : fmt(vals[i], 'kkal')}</td><td class="v">${vals[i] == null ? '–' : Math.round(vals[i] / target * 100) + '%'}</td></tr>`).reverse().join('')}</tbody></table></details>`;
  return s + tbl;
}
function niceTicks(max) {
  const raw = max / 4, mag = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / mag;
  const st = (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
  const out = []; for (let v = 0; v <= max; v += st) out.push(v); return out;
}

function renderRiwayat() {
  const el = $('#view-riwayat'), C = calc(prof());
  const days = []; for (let i = riwRange - 1; i >= 0; i--) days.push(addDays(today(), -i));
  const logged = days.filter(d => LOG[d] && LOG[d].length);
  const tots = logged.map(d => dayTotals(d).sum);
  const avg = k => tots.length ? tots.reduce((a, t) => a + t[k], 0) / tots.length : null;
  const protHit = tots.filter(t => t.protein >= C.t.protein.v).length;
  let h = `<div class="chips">${[7, 30, 90].map(n => `<button class="chip ${n === riwRange ? 'on' : ''}" data-range="${n}">${n} hari</button>`).join('')}</div>
    <div class="stats"><div class="stat"><span class="em">⚡</span><b class="num">${fmt(avg('energi'), 'kkal')}</b><span>rata-rata kkal/hari</span></div>
      <div class="stat"><span class="em">🥩</span><b class="num">${fmt(avg('protein'))} g</b><span>rata-rata protein</span></div>
      <div class="stat"><span class="em">🔥</span><b class="num">${streak()} hari</b><span>beruntun · ${logged.length}/${riwRange} tercatat</span></div></div>
    <p class="muted">Rata-rata dihitung dari hari yang ada catatannya. Target protein tercapai ${protHit} dari ${logged.length} hari.</p>
    <div class="card"><h3 style="margin-top:0">⚡ Energi per hari (kkal)</h3>${barChart(days, 'energi', C.t.energi.v, 'kkal', 'Energi')}</div>
    <div class="card"><h3 style="margin-top:0">🥩 Protein per hari (g)</h3>${barChart(days, 'protein', C.t.protein.v, 'g', 'Protein')}</div>`;
  if (tots.length) {
    const avgTot = { sum: {}, miss: {}, n: 1 };
    for (const k of NK) { avgTot.sum[k] = avg(k); avgTot.miss[k] = 0; }
    h += `<details class="card"><summary>Rata-rata semua zat gizi (${logged.length} hari)</summary>${nutrientTable(avgTot, C, 'Nilai bisa lebih rendah dari sebenarnya bila ada makanan tanpa data zat gizi tertentu.')}</details>`;
  }
  const ukur = (prof().ukur || []).slice(-10).reverse();
  if (ukur.length) h += `<div class="card"><h3 style="margin-top:0">Riwayat berat dan lingkar pinggang</h3><table class="nt"><thead><tr><th>Tanggal</th><th class="right">Berat (kg)</th><th class="right">Pinggang (cm)</th></tr></thead><tbody>
    ${ukur.map(u => `<tr><td>${esc(fmtDate(u.d))}</td><td class="v">${fmt(u.bb)}</td><td class="v">${fmt(u.lp)}</td></tr>`).join('')}</tbody></table></div>`;
  h += `<h2>Daftar hari</h2><div class="card" style="padding:4px 12px">${logged.length ? logged.slice().reverse().map(d => { const t = dayTotals(d).sum; return `<div class="item"><button class="pick" data-day="${d}"><div class="t">${esc(fmtDate(d))}</div>
    <div class="muted num">${fmt(t.energi, 'kkal')} kkal · protein ${fmt(t.protein)} g · ${LOG[d].length} item</div></button></div>`; }).join('') : '<div class="empty">Belum ada catatan pada periode ini.</div>'}</div>`;
  el.innerHTML = h;
}
$('#view-riwayat').addEventListener('click', ev => {
  const r = ev.target.closest('[data-range]'); if (r) { riwRange = +r.dataset.range; renderRiwayat(); return; }
  const d = ev.target.closest('[data-day]'); if (d) { curDate = d.dataset.day; switchTab('hari'); }
});
function showTip(ev) {
  const t = ev.target.closest && ev.target.closest('[data-tip]'), tip = $('#tip');
  $$('.barm.hl').forEach(x => x.classList.remove('hl'));
  if (!t) { tip.hidden = true; return; }
  tip.textContent = t.dataset.tip; tip.hidden = false;
  const x = clamp(ev.clientX + 12, 8, innerWidth - tip.offsetWidth - 8), y = clamp(ev.clientY - tip.offsetHeight - 12, 8, innerHeight - tip.offsetHeight - 8);
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
}
document.addEventListener('pointermove', ev => { if (ev.pointerType === 'mouse') showTip(ev); });
document.addEventListener('pointerdown', ev => { if (ev.pointerType !== 'mouse') showTip(ev); });

/* ---------- Profil ---------- */
function renderProfil() {
  const el = $('#view-profil'), p = prof(), C = calc(p);
  const [bc, bcls] = bmiCat(C.bmi);
  const lpRisk = p.lp ? (p.lp >= (p.jk === 'L' ? 90 : 80)) : null;
  const tj = TUJUAN[p.tujuan] || TUJUAN.jaga;
  let h = `<div class="chips">${profiles.map(x => `<button class="chip ${x.id === activeId ? 'on' : ''}" data-pid="${esc(x.id)}">${esc(x.nama)}</button>`).join('')}<button class="chip" data-act="p-new">+ Profil baru</button></div>
  <div class="card"><h3 style="margin-top:0">🙋 Data diri</h3>
    <label class="f">Nama profil<input type="text" id="p-nama" value="${esc(p.nama)}"></label>
    <div class="grid2"><label class="f">Jenis kelamin<select id="p-jk"><option value="L" ${p.jk === 'L' ? 'selected' : ''}>Laki-laki</option><option value="P" ${p.jk === 'P' ? 'selected' : ''}>Perempuan</option></select></label>
      <label class="f">Usia (tahun)<input type="number" inputmode="numeric" id="p-usia" min="1" max="120" value="${p.usia}"></label>
      <label class="f">Berat (kg)<input type="number" inputmode="decimal" step="any" id="p-bb" value="${p.bb}"></label>
      <label class="f">Tinggi (cm)<input type="number" inputmode="decimal" step="any" id="p-tb" value="${p.tb}"></label></div>
    <label class="f">Lingkar pinggang (cm, diukur setinggi pusar)<input type="number" inputmode="decimal" step="any" id="p-lp" value="${p.lp ?? ''}"></label>
    <label class="f" id="p-kon-w" ${p.jk === 'P' ? '' : 'hidden'}>Kondisi khusus<select id="p-kon"><option value="">Tidak hamil / tidak menyusui</option>${AKG.filter(r => r.tambah).map(r => `<option value="${r.jk}" ${p.kondisi === r.jk ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}</select></label>
    <label class="f">Aktivitas harian<select id="p-akt">${AKT.map(([v, l]) => `<option value="${v}" ${+p.akt === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="f">Tujuan<select id="p-tj">${Object.entries(TUJUAN).map(([k, t]) => `<option value="${k}" ${p.tujuan === k ? 'selected' : ''}>${t.label}</option>`).join('')}</select></label>
    <div class="row" style="margin-top:14px"><button class="btn primary grow" data-act="p-save">Simpan</button>${profiles.length > 1 ? '<button class="btn danger" data-act="p-del">Hapus profil</button>' : ''}</div>
    <p class="muted">Menyimpan berat atau lingkar pinggang yang berubah akan menambah baris di Riwayat.</p></div>

  <div class="card"><h3 style="margin-top:0">📏 Komposisi tubuh</h3>
    ${bmiGauge(C.bmi)}
    <div class="stats"><div class="stat"><b class="num">${fmt(C.bmi)}</b><span>IMT · <span class="status ${bcls}">${bc}</span></span></div>
      <div class="stat"><b class="num">${C.whtr ? C.whtr.toLocaleString('id-ID', { maximumFractionDigits: 2 }) : '–'}</b><span>pinggang : tinggi · ${C.whtr ? `<span class="status ${C.whtr < 0.5 ? 'good' : 'warn'}">${C.whtr < 0.5 ? 'baik' : 'perlu perhatian'}</span>` : ''}</span></div>
      <div class="stat"><b class="num">${p.lp ? fmt(p.lp) : '–'}</b><span>pinggang cm · ${lpRisk == null ? '' : `<span class="status ${lpRisk ? 'bad' : 'good'}">${lpRisk ? 'obesitas sentral' : 'normal'}</span>`}</span></div></div>
    <p class="muted">IMT memakai batas Asia-Pasifik (normal 18,5–22,9). Lingkar pinggang dinilai berisiko bila ≥${p.jk === 'L' ? 90 : 80} cm; rasio pinggang/tinggi idealnya di bawah 0,5. IMT tidak membedakan otot dan lemak, jadi untuk tujuan otot lean pantau juga lingkar pinggang.</p></div>

  <div class="card"><h3 style="margin-top:0">🎯 Target harian</h3>
    <table class="nt"><tbody>
      ${C.dewasa ? `<tr><td>Energi basal (BMR, Mifflin-St Jeor)</td><td class="v">${fmt(C.bmr, 'kkal')} kkal</td></tr>
      <tr><td>Kebutuhan harian (TDEE × ${String(p.akt).replace('.', ',')})</td><td class="v">${fmt(C.tdee, 'kkal')} kkal</td></tr>
      ${C.add ? `<tr><td>Tambahan ${esc(C.add.label.toLowerCase())}</td><td class="v">+${fmt(C.add.energi, 'kkal')} kkal</td></tr>` : `<tr><td>Penyesuaian tujuan</td><td class="v">${tj.adj > 0 ? '+' : ''}${fmt(tj.adj, 'kkal')} kkal</td></tr>`}` : ''}
      <tr><td><b>Target energi</b></td><td class="v"><b>${fmt(C.t.energi.v, 'kkal')} kkal</b></td></tr>
      <tr><td>Protein${C.dewasa ? (C.add ? ` (termasuk +${fmt(C.add.protein)} g ${esc(C.add.label.toLowerCase())})` : ` (${String(tj.gkg).replace('.', ',')} g/kg)`) : ''}</td><td class="v">${fmt(C.t.protein.v)} g</td></tr>
      <tr><td>Lemak (25% energi)</td><td class="v">${fmt(C.t.lemak.v)} g</td></tr>
      <tr><td>Karbohidrat</td><td class="v">${fmt(C.t.kh.v)} g</td></tr>
      <tr><td>Serat</td><td class="v">${fmt(C.t.serat.v)} g</td></tr>
      <tr><td>Gula tambahan, maks.</td><td class="v">${fmt(C.t.gula.v)} g</td></tr>
      <tr><td>Natrium, maks. (≈ 5 g garam)</td><td class="v">${fmt(C.t.natrium.v)} mg</td></tr>
      <tr><td>Lemak jenuh, maks.</td><td class="v">${fmt(C.t.lemak_jenuh.v)} g</td></tr>
      <tr><td>Air total (minum + makanan)</td><td class="v">${fmt(C.t.air ? C.t.air.v : null)} ml</td></tr>
    </tbody></table>
    <p class="muted">Vitamin dan mineral mengikuti AKG (Permenkes No. 28 Tahun 2019) untuk ${p.jk === 'L' ? 'laki-laki' : 'perempuan'} ${C.row.min}–${C.row.max} tahun. ${C.dewasa ? 'Protein tidak pernah di bawah AKG.' : 'Untuk usia di bawah 18 tahun, energi dan makro memakai angka AKG langsung.'} ${C.add ? `Ditambah kebutuhan ${esc(C.add.label.toLowerCase())} sesuai Permenkes 28/2019 (energi +${fmt(C.add.energi, 'kkal')} kkal, protein +${fmt(C.add.protein)} g); target turun berat tidak dipakai selama kondisi ini. Tetap konsultasikan dengan bidan, dokter, atau ahli gizi.` : 'Untuk ibu hamil atau menyusui, pilih kondisinya di Data diri.'}</p></div>
  ${p.tujuan === 'lean' && !C.add ? `<div class="card"><h3 style="margin-top:0">💪 Panduan otot lean</h3><ul class="small" style="padding-left:18px;margin:6px 0">
    <li>Surplus kecil sekitar 250 kkal. Targetkan berat naik ±0,25–0,5 kg per bulan. Bila naik lebih cepat dan lingkar pinggang ikut bertambah, kurangi 100–200 kkal.</li>
    <li>Bagi protein ke 3–5 kali makan, masing-masing sekitar ${fmt(Math.round(p.bb * 0.4))} g (0,4 g/kg), termasuk 1 porsi dalam 2 jam setelah latihan.</li>
    <li>Latihan beban atau kalistenik progresif 3–5 kali per minggu: tambah repetisi, beban, atau tingkat kesulitan gerakan secara bertahap.</li>
    <li>Tidur 7–9 jam. Timbang dan ukur pinggang tiap 2 minggu pada pagi hari, lalu perbarui di sini.</li></ul></div>` : ''}`;
  el.innerHTML = h;
}
$('#view-profil').addEventListener('change', ev => {
  if (ev.target.id === 'p-jk') { const w = $('#p-kon-w'); if (w) w.hidden = ev.target.value !== 'P'; }
});
$('#view-profil').addEventListener('click', ev => {
  const c = ev.target.closest('[data-pid]'); if (c) { setActive(c.dataset.pid); return; }
  const b = ev.target.closest('[data-act]'); if (!b) return;
  if (b.dataset.act === 'p-new') {
    const np = { id: 'p' + uid(), nama: 'Profil ' + (profiles.length + 1), jk: 'P', usia: 30, bb: 55, tb: 158, lp: null, akt: 1.375, tujuan: 'jaga', ukur: [] };
    profiles.push(np); setActive(np.id); toast('Profil baru dibuat. Lengkapi datanya lalu simpan.');
  } else if (b.dataset.act === 'p-save') {
    const p = prof();
    const v = { nama: $('#p-nama').value.trim() || p.nama, jk: $('#p-jk').value, usia: numIn($('#p-usia').value), bb: numIn($('#p-bb').value), tb: numIn($('#p-tb').value), lp: numIn($('#p-lp').value), akt: +$('#p-akt').value, tujuan: $('#p-tj').value, kondisi: $('#p-jk').value === 'P' ? $('#p-kon').value : '' };
    if (!(v.usia >= 1 && v.usia <= 120) || !(v.bb > 5 && v.bb < 400) || !(v.tb > 40 && v.tb < 260)) { toast('Periksa usia, berat, dan tinggi'); return; }
    if (v.bb !== p.bb || v.lp !== p.lp || !(p.ukur || []).length) {
      p.ukur = (p.ukur || []).filter(u => u.d !== today()); p.ukur.push({ d: today(), bb: v.bb, lp: v.lp });
    }
    Object.assign(p, v); saveProfiles(); render(); toast('Profil disimpan');
  } else if (b.dataset.act === 'p-del') {
    const p = prof();
    if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Yakin? Ketuk lagi'; return; }
    profiles = profiles.filter(x => x.id !== p.id); LS.del('log.' + p.id); setActive(profiles[0].id); toast('Profil dihapus');
  }
});
function setActive(id) { activeId = id; saveProfiles(); LOG = LS.get(logKey(), {}); render(); }

$('#profile-chip').addEventListener('click', () => {
  openSheet(`<h2>Pilih profil</h2>${profiles.map(p => `<div class="item"><button class="pick" data-pid="${esc(p.id)}"><div class="t">${p.id === activeId ? '● ' : ''}${esc(p.nama)}</div>
    <div class="muted">${p.jk === 'L' ? 'Laki-laki' : 'Perempuan'}, ${p.usia} th, ${fmt(p.bb)} kg</div></button></div>`).join('')}
    <div class="row" style="margin-top:12px"><button class="btn grow" data-act="manage">Kelola profil</button></div>`, ev => {
    const c = ev.target.closest('[data-pid]'); if (c) { closeSheet(); setActive(c.dataset.pid); toast('Profil: ' + prof().nama); return; }
    if (ev.target.closest('[data-act=manage]')) { closeSheet(); switchTab('profil'); }
  });
});

/* ---------- Data & cadangan ---------- */
function renderData() {
  const el = $('#view-data');
  const cnt = {}; for (const f of BASE) cnt[f.s] = (cnt[f.s] || 0) + 1;
  const nDays = Object.keys(LOG).length;
  el.innerHTML = `<div class="card"><h3 style="margin-top:0">🗂️ Database makanan</h3>
    <p><b class="num">${BASE.length.toLocaleString('id-ID')}</b> bahan bawaan + <b class="num">${custom.length}</b> buatan Anda + 8.789 USDA lengkap.</p>
    <p class="muted">TKPI ${cnt.TKPI || 0} · USDA pilihan ${cnt.USDA || 0} · NutriNusa ${cnt.NutriNusa || 0} · Menu jadi (perkiraan) ${(cnt.Perkiraan || 0) + (cnt['Turunan TKPI'] || 0)} · Versi ${esc(fmtVer(DBV))}</p>
    <div class="row wrap"><button class="btn small" data-act="check">Cek pembaruan</button><button class="btn small" data-act="db-csv">Unduh database (CSV)</button></div></div>

  <div class="card"><h3 style="margin-top:0">Makanan buatan saya (${custom.length})</h3>
    ${custom.length ? custom.map(f => `<div class="item"><button class="pick" data-cid="${esc(f.id)}"><div class="t">${esc(f.n)}</div><div class="muted">${fmt(f.v.energi, 'kkal')} kkal · protein ${fmt(f.v.protein)} g /100 g · ketuk untuk ubah</div></button></div>`).join('') : '<p class="muted">Belum ada. Buat dari tab Catat → "+ Buat sendiri".</p>'}
    <div class="row wrap" style="margin-top:8px"><button class="btn small" data-act="new-food">+ Buat makanan</button>${custom.length ? '<button class="btn small" data-act="my-csv">Unduh untuk ditambahkan ke database (CSV)</button>' : ''}</div>
    <p class="muted">File CSV ini formatnya sama dengan <code>data/tambahan.csv</code>. Kirimkan ke project agar makanan Anda masuk database untuk semua orang.</p></div>

  <div class="card"><h3 style="margin-top:0">💾 Cadangan</h3>
    <p class="muted">Semua data pribadi hanya tersimpan di perangkat ini. Unduh cadangan secara berkala, terutama sebelum ganti HP atau menghapus data browser.</p>
    <div class="row wrap"><button class="btn small primary" data-act="backup">Unduh cadangan lengkap (JSON)</button>
      <label class="btn small">Pulihkan dari cadangan<input type="file" id="restore" accept=".json,application/json" hidden></label></div>
    <div class="row wrap" style="margin-top:8px"><button class="btn small" data-act="hist-csv">Riwayat per item (CSV)</button><button class="btn small" data-act="day-csv">Total per hari (CSV)</button></div>
    <p class="muted">Profil aktif: ${esc(prof().nama)} · ${nDays} hari tercatat. Memulihkan cadangan akan menggabungkan data, bukan menghapus yang sudah ada.</p></div>

  <div class="card"><h3 style="margin-top:0">📚 Sumber data</h3><ul class="small" style="padding-left:18px;margin:4px 0">
    <li>Tabel Komposisi Pangan Indonesia (TKPI) 2017, Kementerian Kesehatan RI: ${cnt.TKPI || 0} bahan, per 100 g bagian yang dapat dimakan. Zat gizi yang tidak dimuat TKPI (mis. lemak jenuh, kolesterol, gula, vitamin B6, B12, D, E, K) dilengkapi dari USDA bila ada padanan yang sesuai, dan ditandai.</li>
    <li>USDA National Nutrient Database for Standard Reference, Legacy Release (domain publik).</li>
    <li>NutriNusa (nutrinusa.id): ${cnt.NutriNusa || 0} menu siap saji, jajanan, dan makanan instan, per porsi standar (energi, protein, karbohidrat, lemak). Berat porsinya diperkirakan.</li>
    <li>Angka Kecukupan Gizi: Permenkes RI No. 28 Tahun 2019, termasuk tambahan untuk ibu hamil dan menyusui.</li>
    <li>Menu jadi bertanda <span class="badge est">Perkiraan</span> belum diverifikasi; nilainya bisa berbeda jauh tergantung resep dan porsi.</li></ul>
    <p class="muted">Aplikasi ini alat bantu edukasi, bukan pengganti saran dokter atau ahli gizi.</p></div>`;
}
const fmtVer = v => v && v.length >= 12 ? `${v.slice(6, 8)}-${v.slice(4, 6)}-${v.slice(0, 4)} ${v.slice(8, 10)}:${v.slice(10, 12)}` : v;

function foodsCSV(list) {
  const head = ['id', 'nama', 'kategori', 'porsi', 'porsi_ket', 'sumber', 'catatan', ...NK];
  const rows = [csvLine(head)];
  for (const f of list) rows.push(csvLine([f.id, f.n, f.k, f.p, f.pk, f.s === 'Sendiri' ? 'Label/resep' : f.s, f.note || f.src || '', ...NK.map(k => f.v[k])]));
  return rows.join('\n');
}

$('#view-data').addEventListener('click', async ev => {
  const c = ev.target.closest('[data-cid]'); if (c) { const f = custom.find(x => x.id === c.dataset.cid); if (f) openCustomForm(f); return; }
  const b = ev.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act, stamp = today();
  if (a === 'new-food') openCustomForm();
  else if (a === 'check') checkUpdate(true);
  else if (a === 'db-csv') download(`database-gizi-${stamp}.csv`, foodsCSV(BASE.concat(custom)));
  else if (a === 'my-csv') download(`makanan-saya-${stamp}.csv`, foodsCSV(custom));
  else if (a === 'backup') {
    const logs = {}; for (const p of profiles) logs[p.id] = LS.get('log.' + p.id, {});
    const data = { app: 'kalkulator-gizi', format: 2, dibuat: new Date().toISOString(), db: DBV, profiles, active: activeId, logs, custom, extra, favs, recent };
    download(`cadangan-nutri-calc-${stamp}.json`, JSON.stringify(data), 'application/json');
  } else if (a === 'hist-csv' || a === 'day-csv') {
    const days = Object.keys(LOG).sort();
    if (!days.length) { toast('Belum ada riwayat'); return; }
    const rows = [];
    if (a === 'hist-csv') {
      rows.push(csvLine(['tanggal', 'profil', 'waktu_makan', 'makanan', 'id_makanan', 'sumber', 'gram', ...NK]));
      for (const d of days) for (const e of LOG[d]) { const f = foodOf(e); rows.push(csvLine([d, prof().nama, MEAL_LABEL[e.m] || e.m, f ? f.n : e.n, e.f, f ? f.s : '', e.g, ...NK.map(k => { const v = entryVal(e, k); return v == null ? '' : +v.toFixed(3); })])); }
    } else {
      rows.push(csvLine(['tanggal', 'profil', 'jumlah_item', ...NK]));
      for (const d of days) { const t = dayTotals(d); rows.push(csvLine([d, prof().nama, t.n, ...NK.map(k => +t.sum[k].toFixed(2))])); }
    }
    download(`riwayat-${a === 'hist-csv' ? 'item' : 'harian'}-${prof().nama.replace(/\W+/g, '_')}-${stamp}.csv`, rows.join('\n'));
  }
});
$('#view-data').addEventListener('change', async ev => {
  if (ev.target.id !== 'restore' || !ev.target.files[0]) return;
  try {
    const d = JSON.parse(await ev.target.files[0].text());
    if (d.app !== 'kalkulator-gizi') throw new Error('bukan file cadangan');
    for (const p of d.profiles || []) { const i = profiles.findIndex(x => x.id === p.id); if (i >= 0) profiles[i] = p; else profiles.push(p); }
    for (const pid in d.logs || {}) { const cur = LS.get('log.' + pid, {}); LS.set('log.' + pid, { ...cur, ...d.logs[pid] }); }
    const cm = new Map(custom.map(f => [f.id, f])); for (const f of d.custom || []) cm.set(f.id, f); custom = [...cm.values()]; LS.set('custom', custom);
    extra = { ...extra, ...(d.extra || {}) }; LS.set('extra', extra);
    favs = [...new Set([...(d.favs || []), ...favs])]; LS.set('favs', favs);
    saveProfiles(); indexFoods(); LOG = LS.get(logKey(), {}); render();
    toast('Cadangan dipulihkan');
  } catch (e) { toast('File tidak bisa dibaca: ' + e.message); }
  ev.target.value = '';
});

/* ---------- Pembaruan database ---------- */
async function checkUpdate(manual) {
  try {
    const r = await fetch('data/version.json', { cache: 'no-store' });
    const v = (await r.json()).version;
    if (v && v !== DBV) {
      await loadDB(v);
      toast(`Database diperbarui (${BASE.length.toLocaleString('id-ID')} bahan)`);
      render();
    } else if (manual) toast('Database sudah versi terbaru');
  } catch (e) { if (manual) toast('Tidak bisa memeriksa pembaruan (offline?)'); }
}

async function loadDB(ver) {
  const [fr, ar] = await Promise.all([fetch('data/foods.json?v=' + ver), fetch('data/akg.json?v=' + ver)]);
  const fd = await fr.json(); AKG = await ar.json();
  NUTR = fd.nutrients; NK = NUTR.map(n => n.key); NMAP = Object.fromEntries(NUTR.map(n => [n.key, n]));
  BASE = fd.foods; DBV = fd.version || ver; LS.set('dbv', DBV);
  indexFoods();
}

/* ---------- Mulai ---------- */
$$('.tabs button').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

async function start() {
  $('#view-hari').innerHTML = '<div class="empty">Memuat database…</div>';
  let ver = LS.get('dbv', '');
  try { const r = await fetch('data/version.json', { cache: 'no-store' }); ver = (await r.json()).version || ver; } catch (e) { /* offline: pakai cache */ }
  try { await loadDB(ver || 'x'); }
  catch (e) { $('#view-hari').innerHTML = '<div class="empty">Database gagal dimuat. Periksa koneksi lalu muat ulang halaman.</div>'; return; }
  const old = LS.get('dbv_seen', '');
  if (old && old !== DBV) toast(`Database diperbarui: ${BASE.length.toLocaleString('id-ID')} bahan`);
  LS.set('dbv_seen', DBV);
  render();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { checkUpdate(false); if (tab === 'hari' && curDate < today() && LS.get('lastDay', '') !== today()) { curDate = today(); render(); } LS.set('lastDay', today()); } });
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return;
    toast('Aplikasi diperbarui. Muat ulang untuk versi terbaru.', 5000);
  });
}

start();
})();
