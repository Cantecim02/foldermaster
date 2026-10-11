const fs = require('node:fs');
const path = require('node:path');
const root = process.argv[2];
if (!root) throw new Error('Usage: node scripts/verify-basket-bundle.cjs <production expo export directory>');
const files = [];
function visit(dir) { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const file = path.join(dir, entry.name); if (entry.isDirectory()) visit(file); else if (/\.(hbc|js)$/.test(file)) files.push(file); } }
visit(root);
let normal = false;
for (const file of files) {
  const data = fs.readFileSync(file);
  for (const encoding of ['utf8', 'utf16le']) {
    normal ||= data.includes(Buffer.from('editio.fileBasket.preview.v1', encoding));
    for (const marker of ['FILE_BASKET_QA_ONLY', 'editio.fileBasket.qa.v1', '5 başarılı tur simüle et', 'QaAccessController', '/auth/qa-access', 'qa_tester', 'file_basket_preview']) {
      if (data.includes(Buffer.from(marker, encoding))) throw new Error(`QA code leaked into production bundle: ${file}`);
    }
  }
}
if (!normal) throw new Error('No File Basket production code found; verification would be inconclusive');
console.log(`Production basket bundle: ${files.length} JS/Hermes files checked; normal game present, QA code absent.`);
