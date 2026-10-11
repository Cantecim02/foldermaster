const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
const part = source.slice(source.indexOf('function getSettingsDocuments('), source.indexOf('const quickActionItems:'));
const code = ts.transpileModule(part, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
const getDocs = vm.runInNewContext(code + '\ngetSettingsDocuments');
const text = doc => doc.sections.flatMap(section => section.body).join(' ');
let checks = 0;
for (const lang of ['tr', 'en', 'zh', 'fr', 'ru', 'de', 'es']) {
  const docs = getDocs(lang);
  const privacy = text(docs.privacy), terms = text(docs.terms);
  if (lang === 'tr') {
    assert.match(privacy, /Ad ve soyad isteğe bağlıdır/); assert.match(privacy, /tam doğum tarihi istenmez/); assert.match(privacy, /otomatik silinmez/); assert.match(terms, /gösterilen minimum yaş/);
  } else {
    assert.match(privacy, /names are optional/); assert.match(privacy, /does not request a full date of birth/); assert.match(privacy, /not automatically erased/); assert.match(terms, /minimum age displayed/);
    // The five other UI languages intentionally retain the existing full English legal fallback.
    assert.equal(JSON.stringify(docs.privacy), JSON.stringify(getDocs('en').privacy));
  }
  checks++;
}
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root,'website/assets/js/translations.js'),'utf8'),context);
for (const lang of ['tr','en']) for (const page of ['privacy','terms']) {
  const html=fs.readFileSync(path.join(root,`website/${page}/index.html`),'utf8');
  const dictionary=context.window.EDITIO_TRANSLATIONS[lang];
  for (const match of html.matchAll(/data-i18n="([^"]+)"/g)) assert.equal(typeof match[1].split('.').reduce((value,key)=>value?.[key],dictionary),'string',lang+'/'+match[1]);
  assert.match(html,/datetime="2026-10-11"/);checks++;
}
assert.match(context.window.EDITIO_TRANSLATIONS.en.privacy.legacyText,/not automatically erased/);
assert.match(context.window.EDITIO_TRANSLATIONS.tr.privacy.ageText,/tam doğum tarihi istenmez/);
console.log(`Account legal: ${checks} app-language and website translation checks passed.`);
