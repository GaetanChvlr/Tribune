// Calcule les classements MVP (Game Score de Hollinger) et les leaders statistiques
// à partir des feuilles de match ESPN NBA. Lancé chaque nuit par GitHub Actions ;
// écrit data/mvp.json et data/stats.json.
//
// Règles :
// - Game Score = PTS + 0,4×FGM − 0,7×FGA − 0,4×(FTA−FTM) + 0,7×OREB + 0,3×DREB + STL + 0,7×AST + 0,7×BLK − 0,4×PF − TOV
// - Nuit : journée calendaire américaine (New York), 1 match minimum.
// - Semaine : lundi → dimanche (New York), moyenne par match, 1 match minimum.
// - Mois et saison : moyenne par match, 3 matchs minimum.
// - Pas de minimum de minutes. Présaison exclue. Top 10 pour le MVP, top 5 pour les stats.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
const OUT_MVP = "data/mvp.json";
const OUT_STATS = "data/stats.json";
const OUT_PERFS = "data/perfs.json";
const TZ = "America/New_York";
const TOP_MVP = 10;
const TOP_STATS = 5;

const CATS = [
  { key: "pts", label: "Points" },
  { key: "reb", label: "Rebonds" },
  { key: "ast", label: "Passes" },
  { key: "stl", label: "Interceptions" },
  { key: "blk", label: "Contres" },
  { key: "tpm", label: "3 points réussis" }
];

const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const usDay = date => dayFmt.format(date); // "AAAA-MM-JJ"

function addDaysStr(s, n) {
  const d = new Date(s + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function weekStart(s) {
  const d = new Date(s + "T12:00:00Z");
  const dow = (d.getUTCDay() + 6) % 7; // 0 = lundi
  return addDaysStr(s, -dow);
}
const compact = s => s.replaceAll("-", "");

async function getJSON(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } catch (e) {
      if (attempt === 3) throw e;
      await new Promise(res => setTimeout(res, 2000 * attempt));
    }
  }
}

// Saison en cours : débute le 1er octobre de l'année de la saison (ex. 2026-27)
function seasonBounds(now) {
  const y = now.getUTCMonth() >= 9 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return { start: `${y}-10-01`, label: `${y}-${String((y + 1) % 100).padStart(2, "0")}` };
}

// "5-12" -> [5, 12]
function made(s) {
  const [m, a] = String(s ?? "").split("-").map(x => parseInt(x, 10));
  return [Number.isFinite(m) ? m : 0, Number.isFinite(a) ? a : 0];
}
const num = v => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
};

function gameScore(names, stats) {
  const g = k => {
    const i = names.indexOf(k);
    return i >= 0 ? stats[i] : undefined;
  };
  const [fgm, fga] = made(g("FG"));
  const [ftm, fta] = made(g("FT"));
  const turnovers = num(g(names.includes("TO") ? "TO" : "TOV"));
  return num(g("PTS")) + 0.4 * fgm - 0.7 * fga - 0.4 * (fta - ftm)
    + 0.7 * num(g("OREB")) + 0.3 * num(g("DREB")) + num(g("STL"))
    + 0.7 * num(g("AST")) + 0.7 * num(g("BLK")) - 0.4 * num(g("PF")) - turnovers;
}

function totalsOf(names, stats) {
  const g = k => {
    const i = names.indexOf(k);
    return i >= 0 ? stats[i] : undefined;
  };
  return {
    pts: num(g("PTS")),
    reb: num(g("REB")),
    ast: num(g("AST")),
    stl: num(g("STL")),
    blk: num(g("BLK")),
    tpm: made(g("3PT"))[0]
  };
}

async function recordsOfEvent(id, dayKey) {
  const j = await getJSON(`${BASE}/summary?event=${id}`);
  const out = [];
  for (const team of j.boxscore?.players ?? []) {
    const block = team.statistics?.[0];
    const names = block?.names ?? [];
    const teamName = team.team?.displayName ?? "";
    for (const x of block?.athletes ?? []) {
      if (x.didNotPlay || !(x.stats?.length)) continue;
      out.push({
        name: x.athlete?.displayName ?? x.athlete?.shortName ?? "",
        team: teamName,
        day: dayKey,
        gs: gameScore(names, x.stats),
        ...totalsOf(names, x.stats)
      });
    }
  }
  return out;
}

// Regroupe les matchs par joueur et calcule la moyenne du champ demandé ; garde le top N
function rank(records, minGames, field, topN) {
  const acc = new Map();
  for (const r of records) {
    const k = r.name + "|" + r.team;
    const e = acc.get(k) ?? { name: r.name, team: r.team, sum: 0, games: 0 };
    e.sum += r[field];
    e.games += 1;
    acc.set(k, e);
  }
  return [...acc.values()]
    .filter(e => e.games >= minGames)
    .map(e => ({ name: e.name, team: e.team, value: Math.round((e.sum / e.games) * 10) / 10, games: e.games }))
    .sort((a, b) => b.value - a.value)
    .slice(0, topN);
}

function groupBy(list, keyFn) {
  const out = {};
  for (const item of list) {
    const k = keyFn(item);
    (out[k] = out[k] || []).push(item);
  }
  return out;
}

// Pour une période donnée : un classement par catégorie statistique
function statsBuckets(groups, minGames) {
  const out = {};
  for (const [k, list] of Object.entries(groups)) {
    out[k] = {};
    for (const c of CATS) out[k][c.key] = rank(list, minGames, c.key, TOP_STATS);
  }
  return out;
}

// Grosses perfs : meilleures performances d'un seul match, par catégorie
function perfBuckets(groups) {
  const out = {};
  for (const [k, list] of Object.entries(groups)) {
    out[k] = {};
    for (const c of CATS) {
      out[k][c.key] = [...list]
        .sort((a, b) => b[c.key] - a[c.key])
        .slice(0, TOP_STATS)
        .map(r => ({ name: r.name, team: r.team, value: r[c.key], day: r.day }));
    }
  }
  return out;
}

async function main() {
  const now = new Date();
  const todayKey = usDay(now);
  const { start, label } = seasonBounds(now);

  const records = [];
  const seenEvents = new Set();
  let games = 0, skipped = 0;

  for (let day = start; day <= todayKey; day = addDaysStr(day, 1)) {
    const sb = await getJSON(`${BASE}/scoreboard?dates=${compact(day)}`);
    for (const ev of sb.events ?? []) {
      if (ev.season?.type === 1) continue;                 // présaison exclue
      if (ev.status?.type?.state !== "post") continue;     // matchs terminés seulement
      if (seenEvents.has(ev.id)) continue;
      seenEvents.add(ev.id);
      const dayKey = usDay(new Date(ev.date));
      try {
        records.push(...await recordsOfEvent(ev.id, dayKey));
        games++;
      } catch (e) {
        skipped++;
        console.warn(`Match ${ev.id} ignoré : ${e.message}`);
      }
    }
  }

  const byDay = groupBy(records, r => r.day);
  const byWeek = groupBy(records, r => weekStart(r.day));
  const byMonth = groupBy(records, r => r.day.slice(0, 7));

  // MVP : Game Score moyen
  const mvpBuckets = (groups, minGames) => {
    const out = {};
    for (const [k, list] of Object.entries(groups)) {
      out[k] = rank(list, minGames, "gs", TOP_MVP).map(p => ({ name: p.name, team: p.team, gmsc: p.value, games: p.games }));
    }
    return out;
  };

  const mvp = {
    updated: now.toISOString(),
    matchs: games,
    matchs_ignores: skipped,
    nights: mvpBuckets(byDay, 1),
    weeks: mvpBuckets(byWeek, 1),
    months: mvpBuckets(byMonth, 3),
    season: mvpBuckets({ [label]: records }, 3)
  };

  const stats = {
    updated: now.toISOString(),
    categories: CATS,
    nights: statsBuckets(byDay, 1),
    weeks: statsBuckets(byWeek, 1),
    months: statsBuckets(byMonth, 3),
    season: statsBuckets({ [label]: records }, 3)
  };

  const perfs = {
    updated: now.toISOString(),
    categories: CATS,
    nights: perfBuckets(byDay),
    weeks: perfBuckets(byWeek),
    months: perfBuckets(byMonth),
    season: perfBuckets({ [label]: records })
  };

  mkdirSync(dirname(OUT_MVP), { recursive: true });
  writeFileSync(OUT_MVP, JSON.stringify(mvp, null, 2) + "\n");
  writeFileSync(OUT_STATS, JSON.stringify(stats, null, 2) + "\n");
  writeFileSync(OUT_PERFS, JSON.stringify(perfs, null, 2) + "\n");
  console.log(`Terminé : ${games} matchs, ${skipped} ignorés. Fichiers ${OUT_MVP}, ${OUT_STATS} et ${OUT_PERFS} écrits.`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
