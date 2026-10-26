// Calcule les moyennes par joueur, par saison, par phase (régulière / playoffs) et par équipe,
// à partir de toutes les saisons disponibles (data/games.json et data/games-AAAA-AA.json).
// Et les grosses perfs : les meilleures performances d'un seul match, par catégorie et par phase.
// Écrit data/alltime.json, utilisé par le classement « All Time » de l'appli.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const STATS = ["pts", "reb", "ast", "stl", "blk", "tpm", "gs"];
const round1 = x => Math.round(x * 10) / 10;
const PERF_TOP = 50;    // grosses perfs gardées par catégorie et par phase
const best = { regular: {}, playoffs: {} };
function offer(phase, key, rec) {
  const arr = (best[phase][key] ||= []);
  arr.push(rec);
  if (arr.length > PERF_TOP * 4) { arr.sort((x, y) => y.v - x.v); arr.length = PERF_TOP; }
}

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
  const cols = { day: idx.jour, opp: idx.adversaire, ts: idx.score_equipe, os: idx.score_adversaire };
  for (const a of j.rows || []) {
    const phase = (col.phase !== undefined && a[col.phase]) || "regular";
    if (phase === "regular" || phase === "playoffs") {
      for (const k of STATS) {
        offer(phase, k, { v: Number(a[col[k]]) || 0, s: j.seasonLabel, n: a[col.name], t: a[col.team],
          o: a[cols.opp], ts: a[cols.ts], os: a[cols.os], d: a[cols.day] });
      }
    }
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

const perfs = {};
for (const phase of ["regular", "playoffs"]) {
  perfs[phase] = {};
  for (const k of STATS) {
    perfs[phase][k] = (best[phase][k] || []).sort((x, y) => y.v - x.v).slice(0, PERF_TOP);
  }
}

writeFileSync("data/alltime.json", JSON.stringify({ updated: new Date().toISOString(), entries, perfs }) + "\n");
console.log(`${entries.length} lignes joueur-saison et grosses perfs écrites dans data/alltime.json (${files.length} fichiers lus).`);
