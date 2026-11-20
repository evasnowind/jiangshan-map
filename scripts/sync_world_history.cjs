#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const ASSETS = ['css/world_history.css','js/world_history_core.js','js/world_history.js','data/world/history.json'];

function stampedHtml(html, root = ROOT) {
  for (const asset of ASSETS) {
    const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, asset))).digest('hex').slice(0,8);
    const escaped = asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(["'])${escaped}(?:\\?v=[^"']*)?\\1`, 'g');
    let count = 0;
    html = html.replace(pattern, (_, quote) => { count++; return quote + asset + '?v=' + hash + quote; });
    assert.equal(count,1,'Expected one versioned reference for '+asset);
  }
  return html;
}

if (require.main === module) {
  const file=path.join(ROOT,'world.html');
  const before=fs.readFileSync(file,'utf8');
  const after=stampedHtml(before);
  if (process.argv.includes('--check')) {
    assert.equal(before,after,'World-history asset versions are stale; run node scripts/sync_world_history.cjs');
    console.log('✓ World-history asset versions are current.');
  } else {
    if (before !== after) fs.writeFileSync(file,after);
    console.log('✓ World-history asset versions synchronized.');
  }
}
module.exports={stampedHtml,ASSETS};
