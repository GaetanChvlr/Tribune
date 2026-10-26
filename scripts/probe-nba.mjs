import { writeFileSync } from "node:fs";
const H = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  "Referer": "https://www.nba.com/",
  "Origin": "https://www.nba.com",
  "Accept": "application/json, text/plain, */*",
  "x-nba-stats-origin": "stats",
  "x-nba-stats-token": "true"
};
const out = [];
async function test(label, url) {
  try {
    const r = await fetch(url, { headers: H });
    const t = await r.text();
    let info = "";
    try {
      const j = JSON.parse(t);
      const rs = j.resultSets || (j.resultSet ? [j.resultSet] : []);
      info = rs.map(x => `${x.name}: ${x.rowSet?.length ?? 0} lignes`).join(" | ") || Object.keys(j).join(",");
    } catch (e) { info = "non JSON: " + t.slice(0, 120).replace(/\s+/g, " "); }
    out.push(`${label} HTTP ${r.status} ${info}`);
  } catch (e) { out.push(`${label} ERREUR ${e.message}`); }
}
const seasons = ["1950-51", "1960-61", "1970-71", "1980-81", "1992-93", "1993-94", "2025-26"];
for (const s of seasons) {
  await test(`leaguegamelog joueurs ${s}`, `https://stats.nba.com/stats/leaguegamelog?Counter=0&DateFrom=&DateTo=&Direction=ASC&LeagueID=00&PlayerOrTeam=P&Season=${s}&SeasonType=Regular+Season&Sorter=DATE`);
}
for (const s of ["1950-51", "1992-93", "2025-26"]) {
  await test(`leaguestandings ${s}`, `https://stats.nba.com/stats/leaguestandingsv3?LeagueID=00&Season=${s}&SeasonType=Regular%20Season`);
  await test(`leaguedashplayerstats moyennes ${s}`, `https://stats.nba.com/stats/leaguedashplayerstats?College=&Conference=&Country=&DateFrom=&DateTo=&Division=&DraftPick=&DraftYear=&GameScope=&GameSegment=&Height=&LastNGames=0&LeagueID=00&Location=&MeasureType=Base&Month=0&OpponentTeamID=0&Outcome=&PORound=0&PaceAdjust=N&PerMode=PerGame&Period=0&PlayerExperience=&PlayerPosition=&PlusMinus=N&Rank=N&Season=${s}&SeasonSegment=&SeasonType=Regular+Season&ShotClockRange=&StarterBench=&TeamID=0&TwoWay=0&VsConference=&VsDivision=&Weight=`);
}
await test("boxscore 2025-26 (match récent)", "https://stats.nba.com/stats/boxscoretraditionalv2?GameID=0022500001&StartPeriod=0&EndPeriod=0&StartRange=0&EndRange=0&RangeType=0");
writeFileSync("data/probe-espn.txt", out.join("\n") + "\n");
console.log(out.join("\n"));
