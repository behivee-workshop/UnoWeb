const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("app/live/index.html", "utf8");
const css = fs.readFileSync("app/live/live.css", "utf8");
const js = fs.readFileSync("app/live/live.js", "utf8");

assert.match(html, /class="chord-card" id="chordCard"/);
assert.match(css, /\.chord-card\s*\{[\s\S]*?position:\s*fixed/);
assert.match(css, /\.chord-card\s*\{[\s\S]*?width:\s*min\(280px, calc\(100vw - 28px\)\)/);
assert.match(css, /\.chord-card\s*\{[\s\S]*?min-height:\s*126px/);
assert.match(css, /\.chord-card \.value\s*\{[\s\S]*?overflow-wrap:\s*anywhere/);
assert.match(js, /function updateChordCardPosition\(/);
assert.match(js, /viewerRollScroll\.addEventListener\("scroll", updateChordCardPosition\)/);
assert.match(js, /window\.addEventListener\("scroll", updateChordCardPosition\)/);

assert.match(html, /class="stage-idle" id="stageIdle"/);
assert.match(css, /\.stage-idle\s*\{[\s\S]*?position:\s*fixed/);
assert.match(js, /function updateStageIdlePosition\(/);
assert.match(js, /viewerRollScroll\.addEventListener\("scroll", updateStageIdlePosition\)/);
assert.match(js, /const MIDDLE_C = 60/);
assert.match(js, /const middleCY = yForMidi\(MIDDLE_C\)/);

console.log("Live floating overlays stay anchored to the visible roll.");
