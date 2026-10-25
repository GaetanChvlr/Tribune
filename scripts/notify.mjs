// Envoie les notifications Tribune via ntfy.sh (appli ntfy sur iPhone).
// Usage :
//   node scripts/notify.mjs mvp      → « Tableau MVP mis à jour » (après le calcul quotidien)
//   node scripts/notify.mjs finals   → score des matchs terminés (favoris et grosses affiches)
// Le nom du canal ntfy est dans le secret GitHub NTFY_TOPIC (jamais dans le code).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const TOPIC = process.env.NTFY_TOPIC || "";
const MODE = process.argv[2];
const BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
const STANDINGS = "https://site.api.espn.com/apis/v2/sports/basketball/nba/standings";
const CONFIG = "notifications.json";
const STATE = "data/notified.json";
const TZ = "America/New_York";
const APP_URL = "https://gaetanchvlr.github.io/Tribune/";  // ouvert au toucher de la notification

// Abréviations NBA, sur le nom court ESPN (« Spurs », « 76ers »…)
const ABBR = {"Hawks":"ATL","Celtics":"BOS","Nets":"BKN","Hornets":"CHA","Bulls":"CHI","Cavaliers":"CLE","Mavericks":"DAL","Nuggets":"DEN","Pistons":"DET","Warriors":"GSW","Rockets":"HOU","Pacers":"IND","Clippers":"LAC","Lakers":"LAL","Grizzlies":"MEM","Heat":"MIA","Bucks":"MIL","Timberwolves":"MIN","Pelicans":"NOP","Knicks":"NYK","Thunder":"OKC","Magic":"ORL","76ers":"PHI","Suns":"PHX","Trail Blazers":"POR","Kings":"SAC","Spurs":"SAS","Raptors":"TOR","Jazz":"UTA","Wizards":"WAS"};
function ab(name) {
  const s = String(name || "");
  if (ABBR[s]) return ABBR[s];
  const k = Object.keys(ABBR).find(x => s.endsWith(x));
  return k ? ABBR[k] : s;
}

const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const usDay = d => dayFmt.format(d);
const compact = s => s.replaceAll("-", "");
// Les 3 derniers jours (fuseau de New York), pour ne pas rater un match de nuit
function recentDays(n) {
  const out = [];
  for (let i = n; i >= 0; i--) out.push(usDay(new Date(Date.now() - i * 86400000)));
  return out;
}

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

async function send(title, body) {
  if (!TOPIC) {
    console.log("NTFY_TOPIC absent : notification non envoyée :", body);
    return;
  }
  const r = await fetch(`https://ntfy.sh/${encodeURIComponent(TOPIC)}`, {
    method: "POST",
    headers: { Title: title, Tags: "basketball", Click: APP_URL },
    body
  });
  if (!r.ok) throw new Error("ntfy HTTP " + r.status);
  console.log("Envoyé :", body);
}

async function mvp() {
  await send("Tribune", "Tableau MVP mis à jour");
}

async function finals() {
  const cfg = existsSync(CONFIG) ? JSON.parse(readFileSync(CONFIG, "utf8")) : {};
  const favs = new Set((cfg.equipes || []).map(s => String(s).toUpperCase()));

  // Équipes du top 6 de leur conférence (grosses affiches)
  const top = new Set();
  const st = await getJSON(STANDINGS);
  for (const g of st.children || []) {
    for (const en of g.standings?.entries || []) {
      const s = (en.stats || []).find(x => x.name === "playoffSeed");
      const seed = Number(s?.value ?? s?.displayValue);
      if (Number.isFinite(seed) && seed <= 6) top.add(ab(en.team?.shortDisplayName || en.team?.displayName));
    }
  }

  // Premier passage : on enregistre les matchs déjà terminés sans rien envoyer
  const seeded = existsSync(STATE);
  const known = seeded ? JSON.parse(readFileSync(STATE, "utf8")).ids || [] : [];
  const seen = new Set(known);

  const found = [];
  for (const d of recentDays(2)) {
    const sb = await getJSON(`${BASE}/scoreboard?dates=${compact(d)}`);
    for (const ev of sb.events || []) {
      if (ev.season?.type === 1) continue;                 // présaison exclue
      if (ev.status?.type?.state !== "post") continue;     // terminés seulement
      if (seen.has(ev.id)) continue;
      if (found.some(f => f.id === ev.id)) continue;
      found.push(ev);
    }
  }

  const newIds = [];
  for (const ev of found) {
    newIds.push(ev.id);
    if (!seeded) continue;
    const comps = ev.competitions?.[0]?.competitors || [];
    if (comps.length !== 2) continue;
    const info = comps.map(c => ({
      abbr: ab(c.team?.shortDisplayName || c.team?.displayName),
      score: c.score ?? "",
      win: c.winner === true
    }));
    const fav = info.some(t => favs.has(t.abbr));
    const grosse = info.every(t => top.has(t.abbr));
    if (!fav && !grosse) continue;
    const w = info.find(t => t.win) || info[0];
    const l = info.find(t => t !== w);
    const tag = fav ? "favori" : "grosse affiche";
    try {
      await send("Tribune - Final", `${w.abbr} ${w.score} - ${l.score} ${l.abbr} (${tag})`);
    } catch (e) {
      console.error("Échec d'envoi :", e.message);
    }
  }

  if (!seeded || newIds.length) {
    const ids = [...known, ...newIds].slice(-400);
    writeState({ ...readState(), ids });
    console.log(seeded ? `${newIds.length} match(s) terminé(s) traité(s).` : `Initialisation : ${newIds.length} match(s) enregistré(s), aucun envoi.`);
  } else {
    console.log("Aucun nouveau match terminé.");
  }
}

// État des notifications (data/notified.json), partagé entre NBA et F1
function readState() {
  try { return existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {}; } catch (e) { return {}; }
}
function writeState(obj) {
  mkdirSync("data", { recursive: true });
  writeFileSync(STATE, JSON.stringify(obj, null, 2) + "\n");
}

// F1 : une notification à la fin de chaque Grand Prix
async function f1Finals() {
  const st = readState();
  const seeded = Array.isArray(st.f1ids);
  const seen = new Set(st.f1ids || []);
  const j = await getJSON("https://site.api.espn.com/apis/site/v2/sports/racing/f1/scoreboard");
  const found = (j.events || []).filter(ev => ev.status?.type?.state === "post" && !seen.has(ev.id));
  const newIds = [];
  for (const ev of found) {
    newIds.push(ev.id);
    if (!seeded) continue;
    try {
      await send("Tribune - F1", `Découvre les résultats de la course : ${ev.name}`);
    } catch (e) {
      console.error("Échec d'envoi :", e.message);
    }
  }
  if (!seeded || newIds.length) {
    writeState({ ...readState(), f1ids: [...seen, ...newIds].slice(-200) });
  }
}

const run = MODE === "mvp" ? mvp : async () => { await finals(); await f1Finals(); };
run().catch(e => {
  console.error(e);
  process.exit(1);
});
