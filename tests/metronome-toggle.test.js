const assert = require("node:assert/strict");
const fs = require("node:fs");

const sharedJs = fs.readFileSync("app/assets/shared.js", "utf8");

assert.match(sharedJs, /metronome: '/);
assert.match(sharedJs, /iconSvg\('metronome'\)/);
assert.match(sharedJs, /Stop metronome/);
for (const app of ["live", "sheet", "loop", "voltage"]) {
  assert.match(fs.readFileSync(`app/${app}/index.html`, "utf8"), /id="metroPlay"/);
}

console.log("Every app exposes the shared metronome toggle in its BPM controls.");
