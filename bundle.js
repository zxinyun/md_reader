const fs = require('fs');
const path = require('path');

const files = [
  'public/file-api.js',
  'public/app/state.js',
  'public/app/ai.js',
  'public/app/md-parser.js',
  'public/app/encoding.js',
  'public/app/db.js',
  'public/app/ui.js',
  'public/app/session.js',
  'public/app/renderers.js',
  'public/app/pdf-viewer.js',
  'public/app/office-viewer.js',
  'public/app/search.js',
  'public/app/export.js',
  'public/app/editor.js',
  'public/app/draw.js',
  'public/app/ebook.js',
  'public/app/app.js'
];

let bundle = '';
for (const f of files) {
  const filePath = path.join(__dirname, f);
  if (!fs.existsSync(filePath)) {
    console.error('Missing:', f);
    process.exit(1);
  }
  bundle += fs.readFileSync(filePath, 'utf-8') + '\n';
}
const out = path.join(__dirname, 'public', 'app.bundle.js');
fs.writeFileSync(out, bundle);
console.log('Bundle written to', out, `(${(bundle.length / 1024).toFixed(1)} KB)`);
