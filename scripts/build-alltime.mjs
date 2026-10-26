// Calcule les moyennes par joueur, par saison, par phase (régulière / playoffs) et par équipe,
// à partir de toutes les saisons disponibles (data/games.json et data/games-AAAA-AA.json).
// Écrit data/alltime.json, utilisé par le classement « All Time » de l'appli.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const STATS = ["pts", "reb", "ast", "stl", "blk", "tpm", "gs"];
const round1 = x => Math.round(x * 10) / 10;

const files = [
  "data/games.json",
  ...readdirSync("data").filter(f => /^games-\d{4}-\d{2}\.json$/.test(f)).map(f => `data/${f}`)
];

const entries = [];
for (const file of files) {
  let j;
  try { j = JSON.parse(readFileSync(file, "utf8")); } catch (e) { console.warn(`${file} ignoré : ${e.message}`); continue; }
  const idx = Object.fromEntries((j.columns || []).map((c, i) => [c, i]));
  const col = { name: idx.joueur, team: idx.equipe, phase: idx.phase, pts: idx.pts, reb: idx.reb, ast: idx.ast,
    stl: idx.stl, blk: idx.blk, tpm: idx.tpm, gs: idx.gmsc };
  const acc = new Map();
  for (const a of j.rows || []) {
    const phase = (col.phase !== undefined && a[col.phase]) || "regular";
    const key = `${phase}|${a[col.name]}|${a[col.team]}`;
    let e = acc.get(key);
    if (!e) {
      e = { phase, name: a[col.name], team: a[col.team], games: 0, sum: Object.fromEntries(STATS.map(k => [k, 0])) };
      acc.set(key, e);
    }
    e.games++;
    for (const k of STATS) e.sum[k] += Number(a[col[k]]) || 0;
  }
  for (const e of acc.values()) {
    entries.push({
      s: j.seasonLabel,
      p: e.phase,
      n: e.name,
      t: e.team,
      g: e.games,
      v: Object.fromEntries(STATS.map(k => [k, round1(e.sum[k] / e.games)]))
    });
  }
}

writeFileSync("data/alltime.json", JSON.stringify({ updated: new Date().toISOString(), entries }) + "\n");
console.log(`${entries.length} lignes joueur-saison écrites dans data/alltime.json (${files.length} fichiers lus).`);
