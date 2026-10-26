// Récupère les feuilles de match ESPN NBA d'une saison et écrit ses données joueurs :
// node scripts/build-games.mjs        → saison en cours, écrit data/games.json (chaque nuit)
// node scripts/build-games.mjs 2025   → saison 2025-26, écrit data/games-2025-26.json (une fois)
// une ligne par joueur et par match. L'appli calcule ensuite MVP, leaders et grosses perfs.
// Lancé chaque nuit par GitHub Actions.
//
// Colonnes de chaque ligne (dans cet ordre) :
// jour (AAAA-MM-JJ, fuseau de New York), joueur, équipe, équipe (court), adversaire (court),
// score de l'équipe, score de l'adversaire, PTS, REB, AST, STL, BLK, 3PT réussis, Game Score

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
const ARG = process.argv[2];   // année de début de la saison passée, ex. 2025
const TZ = "America/New_York";

const COLUMNS = ["jour", "joueur", "equipe", "equipe_court", "adversaire", "score_equipe", "score_adversaire",
  "pts", "reb", "ast", "stl", "blk", "tpm", "gmsc", "couleur", "couleur_alt"];

const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const usDay = date => dayFmt.format(date); // "AAAA-MM-JJ"

function addDaysStr(s, n) {
  const d = new Date(s + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
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

// Saison : débute le 1er octobre de l'année de la saison (ex. 2026-27)
function seasonBounds(now) {
  const y = ARG ? Number(ARG) : (now.getUTCMonth() >= 9 ? now.getUTCFullYear() : now.getUTCFullYear() - 1);
  const label = `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
  return { start: `${y}-10-01`, end: `${y + 1}-06-30`, label, out: ARG ? `data/games-${label}.json` : "data/games.json" };
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
const round1 = x => Math.round(x * 10) / 10;

// Game Score de Hollinger
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

async function rowsOfEvent(id, dayKey) {
  const j = await getJSON(`${BASE}/summary?event=${id}`);
  const comps = j.header?.competitions?.[0]?.competitors ?? [];
  const rows = [];
  for (const team of j.boxscore?.players ?? []) {
    const tid = team.team?.id;
    const me = comps.find(c => c.team?.id === tid);
    const opp = comps.find(c => c.team?.id !== tid);
    const teamName = team.team?.displayName ?? "";
    const teamShort = team.team?.shortDisplayName ?? teamName;
    const oppShort = opp?.team?.shortDisplayName ?? opp?.team?.displayName ?? "";
    const ts = num(me?.score), os = num(opp?.score);
    const block = team.statistics?.[0];
    const names = block?.names ?? [];
    for (const x of block?.athletes ?? []) {
      if (x.didNotPlay || !(x.stats?.length)) continue;
      const st = k => {
        const i = names.indexOf(k);
        return i >= 0 ? x.stats[i] : undefined;
      };
      rows.push([
        dayKey,
        x.athlete?.displayName ?? x.athlete?.shortName ?? "",
        teamName,
        teamShort,
        oppShort,
        ts,
        os,
        num(st("PTS")),
        num(st("REB")),
        num(st("AST")),
        num(st("STL")),
        num(st("BLK")),
        made(st("3PT"))[0],
        round1(gameScore(names, x.stats)),
        team.team?.color ?? me?.team?.color ?? "",
        team.team?.alternateColor ?? me?.team?.alternateColor ?? ""
      ]);
    }
  }
  return rows;
}

async function main() {
  const now = new Date();
  const todayKey = usDay(now);
  const { start, end, label, out: OUT } = seasonBounds(now);
  const last = todayKey < end ? todayKey : end;

  const rows = [];
  const seen = new Set();
  let games = 0, skipped = 0;

  for (let day = start; day <= last; day = addDaysStr(day, 1)) {
    const sb = await getJSON(`${BASE}/scoreboard?dates=${compact(day)}`);
    for (const ev of sb.events ?? []) {
      if (ev.season?.type === 1) continue;                 // présaison exclue
      if (ev.status?.type?.state !== "post") continue;     // matchs terminés seulement
      if (seen.has(ev.id)) continue;
      seen.add(ev.id);
      const dayKey = usDay(new Date(ev.date));
      try {
        rows.push(...await rowsOfEvent(ev.id, dayKey));
        games++;
      } catch (e) {
        skipped++;
        console.warn(`Match ${ev.id} ignoré : ${e.message}`);
      }
    }
  }

  rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const out = {
    updated: now.toISOString(),
    seasonLabel: label,
    matchs: games,
    matchs_ignores: skipped,
    columns: COLUMNS,
    rows
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out) + "\n");
  console.log(`Terminé : ${games} matchs, ${skipped} ignorés, ${rows.length} lignes joueur écrites dans ${OUT}.`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
