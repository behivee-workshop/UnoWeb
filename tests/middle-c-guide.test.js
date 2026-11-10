const assert = require("node:assert/strict");
const fs = require("node:fs");

const sharedJs = fs.readFileSync("app/assets/shared.js", "utf8");
const sharedCss = fs.readFileSync("app/assets/shared.css", "utf8");
const sheetJs = fs.readFileSync("app/sheet/sheet.js", "utf8");
const sheetCss = fs.readFileSync("app/sheet/sheet.css", "utf8");

assert.match(sharedJs, /midi === 60.*middle-c/);
assert.match(sharedCss, /\.roll-key\.middle-c/);
assert.match(sheetJs, /midi === 60.*middle-c-row/);
assert.match(sheetCss, /\.roll-steps\.middle-c-row/);

console.log("Middle C is visibly marked in both piano rolls.");
