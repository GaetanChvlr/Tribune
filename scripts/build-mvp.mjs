// Calcule les classements MVP (Game Score de Hollinger) à partir des feuilles de match ESPN NBA.
// Lancé chaque nuit par GitHub Actions ; écrit data/mvp.json.
//
// Règles :
// - Game Score = PTS + 0,4×FGM − 0,7×FGA − 0,4×(FTA−FTM) + 0,7×OREB + 0,3×DREB + STL + 0,7×AST + 0,7×BLK − 0,4×PF − TOV
// - Nuit : journée calendaire américaine (New York), 1 match minimum, classé par Game Score.
// - Semaine : lundi → dimanche (New York), moyenne par match, 1 match minimum.
// - Mois et saison : moyenne par match, 3 matchs minimum.
// - Pas de minimum de minutes. Présaison exclue.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
const OUT = "data/mvp.json";
const TZ = "America/New_York";
const TOP_N = 10;

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
        gs: gameScore(names, x.stats)
      });
    }
  }
  return out;
}

// Regroupe les matchs par clé et calcule la moyenne (ou la valeur) ; garde le top 10
function rank(records, minGames) {
  const acc = new Map();
  for (const r of records) {
    const k = r.name + "|" + r.team;
    const e = acc.get(k) ?? { name: r.name, team: r.team, sum: 0, games: 0 };
    e.sum += r.gs;
    e.games += 1;
    acc.set(k, e);
  }
  return [...acc.values()]
    .filter(e => e.games >= minGames)
    .map(e => ({ name: e.name, team: e.team, gmsc: Math.round((e.sum / e.games) * 10) / 10, games: e.games }))
    .sort((a, b) => b.gmsc - a.gmsc)
    .slice(0, TOP_N);
}

function groupBy(list, keyFn) {
  const out = {};
  for (const item of list) {
    const k = keyFn(item);
    (out[k] = out[k] || []).push(item);
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

  const nights = {};
  for (const [k, list] of Object.entries(byDay)) nights[k] = rank(list, 1);
  const weeks = {};
  for (const [k, list] of Object.entries(byWeek)) weeks[k] = rank(list, 1);
  const months = {};
  for (const [k, list] of Object.entries(byMonth)) months[k] = rank(list, 3);
  const season = { [label]: rank(records, 3) };

  const out = {
    updated: now.toISOString(),
    matchs: games,
    matchs_ignores: skipped,
    nights,
    weeks,
    months,
    season
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(`Terminé : ${games} matchs, ${skipped} ignorés, fichier ${OUT} écrit.`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
