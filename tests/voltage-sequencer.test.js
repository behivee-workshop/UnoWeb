const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("app/voltage/index.html", "utf8");
const js = fs.readFileSync("app/voltage/voltage.js", "utf8");

assert.match(html, /id="rootNote"/);
assert.match(js, /length:16/);
assert.match(js, /rootMidi - 12/);
assert.match(js, /rootMidi \+ 12/);
assert.match(js, /step\.muted/);
assert.match(js, /currentStep/);

console.log("Voltage has 16 pitch steps, octave bounds, mutes, and a current-step light.");
