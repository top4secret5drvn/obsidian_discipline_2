// Bundle without dependencies so Obsidian desktop/mobile load a single main.js.
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const file = path.join(root, 'main.js');
const start = '/* ROADMAPS_BUNDLE_START */';
const end = '/* ROADMAPS_BUNDLE_END */';
const moduleSource = fs.readFileSync(path.join(root, 'roadmaps.js'), 'utf8');
const bundle = `${start}\nconst LifeTrackerRoadmaps = (() => {\nconst module = { exports: {} };\n${moduleSource}\nreturn module.exports;\n})();\n${end}`;
let source = fs.readFileSync(file, 'utf8');
if (source.includes(start)) source = source.slice(0, source.indexOf(start)) + bundle + source.slice(source.indexOf(end) + end.length);
else source = source.replace("const { Plugin, Modal, Notice, debounce } = require('obsidian');", "const { Plugin, Modal, Notice, debounce } = require('obsidian');\n\n" + bundle);
if (process.argv.includes('--check')) {
  if (source !== fs.readFileSync(file, 'utf8')) { console.error('Roadmaps bundle is out of date'); process.exitCode = 1; }
} else fs.writeFileSync(file, source);
