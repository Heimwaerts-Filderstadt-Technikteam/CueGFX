'use strict';
/* Google-Sheets-Anbindung: öffentlich freigegebene oder "im Web veröffentlichte" Tabellen als CSV abrufen */

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function colName(i) {
  let s = '';
  i += 1;
  while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
  return s;
}

function toCsvUrl(input) {
  const url = String(input || '').trim();
  if (!url) throw new Error('Keine Tabellen-URL');
  if (/output=csv|format=csv|\.csv(\?|$)/i.test(url)) return url;
  const m = url.match(/\/spreadsheets\/d\/(e\/)?([a-zA-Z0-9-_]+)/);
  if (!m) {
    if (/^[a-zA-Z0-9-_]{25,}$/.test(url)) return `https://docs.google.com/spreadsheets/d/${url}/export?format=csv`;
    throw new Error('Unbekanntes Tabellen-URL-Format');
  }
  const gid = (url.match(/[#&?]gid=(\d+)/) || [])[1];
  if (m[1]) return `https://docs.google.com/spreadsheets/d/e/${m[2]}/pub?output=csv${gid ? '&gid=' + gid : ''}`;
  return `https://docs.google.com/spreadsheets/d/${m[2]}/export?format=csv${gid ? '&gid=' + gid : ''}`;
}

async function fetchSheet(sheet) {
  const res = await fetch(toCsvUrl(sheet.url), { redirect: 'follow', headers: { 'User-Agent': 'CueGFX' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} – ist die Tabelle für "Jeder mit dem Link" freigegeben?`);
  const text = await res.text();
  if (/^\s*<!DOCTYPE html|<html/i.test(text)) throw new Error('Tabelle ist nicht öffentlich freigegeben (Anmeldeseite erhalten)');
  return tableToValues(parseCsv(text));
}

function tableToValues(rows) {
  const cells = {}, keys = {}, columns = {};
  rows.forEach((r, ri) => r.forEach((v, ci) => { cells[colName(ci) + (ri + 1)] = v; }));
  for (const r of rows) if (r[0] !== undefined && String(r[0]).trim() !== '') keys[String(r[0]).trim()] = r[1] !== undefined ? r[1] : '';
  const header = rows[0] || [];
  header.forEach((h, ci) => {
    const name = String(h || '').trim();
    if (name) columns[name] = rows.slice(1).map((r) => r[ci] !== undefined ? r[ci] : '').filter((v) => v !== '');
  });
  return { cells, keys, columns, rows: rows.length };
}

module.exports = { parseCsv, fetchSheet, toCsvUrl, tableToValues, colName };
