import { writeFileSync } from "node:fs";
const B = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
const get = async u => (await fetch(u)).json();
const out = [];
for (const d of ["19901101", "19921101", "19930301", "19941101", "19701110", "19601110", "19501201"]) {
  const sb = await get(`${B}/scoreboard?dates=${d}`).catch(e => ({ events: [], err: e.message }));
  const evs = sb.events || [];
  out.push(`== ${d} matchs=${evs.length}`);
  if (!evs.length) continue;
  const ev = evs[0];
  const s = await get(`${B}/summary?event=${ev.id}`).catch(e => ({ err: e.message }));
  const teams = s.boxscore?.players || [];
  const ath = teams.flatMap(t => t.statistics?.[0]?.athletes || []);
  out.push(`  event ${ev.id} athletes=${ath.length} avecStats=${ath.filter(a => a.stats?.length).length} didNotPlay=${ath.filter(a => a.didNotPlay).length}`);
  if (ath[0]) out.push(`  exemple: ${JSON.stringify(ath[0]).slice(0, 300)}`);
  out.push(`  statsBlock keys: ${JSON.stringify(Object.keys(teams[0]?.statistics?.[0] || {}))}`);
}
for (const d of ["20160201", "20160215", "20160216", "20170219", "20030209", "19970209", "20130217", "20260215", "20260214", "20260216"]) {
  const sb = await get(`${B}/scoreboard?dates=${d}`).catch(() => ({ events: [] }));
  for (const ev of sb.events || []) out.push(`AS ${d}: type=${ev.season?.type} name=${ev.name} | short=${ev.shortName} | state=${ev.status?.type?.state}`);
}
writeFileSync("data/probe-espn.txt", out.join("\n") + "\n");
console.log(out.join("\n"));
