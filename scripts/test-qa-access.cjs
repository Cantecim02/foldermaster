const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const vm = require('node:vm'); const ts = require('typescript');
let checks = 0;
const check = (value, label) => { assert.ok(value, label); checks++; };
const mock = { token: 'synthetic-token', api: 'https://stage.example.com', flag: 'true', calls: [], response: null, failure: false };
function load(file) {
  const filename = path.resolve(__dirname, '..', file + '.ts');
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  const request = async (...args) => { mock.calls.push(args); if (mock.failure) throw Error('unreachable'); return { data: mock.response }; };
  vm.runInThisContext(`(function(require,module,exports,process){${code}\n})`, { filename })(id => {
    if (id === 'axios') return { get: request, post: request };
    if (id === './authService') return { getAccountSessionToken: async () => mock.token };
    if (id === './mediaDownloaderApi') return { getApiBaseUrl: () => mock.api };
    if (id.startsWith('./')) return load(path.posix.join(path.posix.dirname(file), id));
    throw Error('Unexpected dependency: ' + id);
  }, module, module.exports, { env: { EXPO_PUBLIC_FILE_BASKET_QA: mock.flag } });
  return module.exports;
}
(async () => {
  const { QaAccessController } = load('src/services/qaAccessController');
  const { ProgressLane } = load('src/game/progressLane');
  const { qaFiveWins, qaNewRound, qaReset, qaStorageKey } = load('src/game/fileBasketQa');
  const { emptyProgress } = load('src/game/fileBasketRules');
  const valid = { userId: 'user-id', qaTester: true, environment: 'staging', scope: 'file_basket_preview', leaseMs: 1500 };
  let clock = 1000, response = valid, failure = false, effects = 0, events = [];
  const access = new QaAccessController('user-id', async () => { if (failure) throw Error('offline'); return response; }, allowed => events.push(allowed), () => clock);
  check(!access.allowed, 'No implicit permission before contacting server');
  check(!await access.run('reset', () => effects++), 'Anonymous/cached profile cannot run QA');
  for (const patch of [{ qaTester: false }, { userId: 'different-user' }, { environment: 'production' }, { scope: 'billing' }, { leaseMs: 60000 }]) {
    response = { ...valid, ...patch }; check(!await access.verify(), 'Only scoped live server permission grants tools');
  }
  response = valid; check(await access.verify() && access.allowed, 'Authorized staging account opens tools');
  check(await access.run('reset', () => effects++) && effects === 1, 'Every mutation freshly rechecks');
  response = { ...valid, qaTester: false }; check(!await access.run('reset', () => effects++), 'Revocation denies next action');
  check(!access.allowed && events.at(-1) === false && effects === 1, 'Revocation hides tools without mutation');
  response = valid; await access.verify(); failure = true; check(!await access.run('shot', () => effects++), 'Timeout/offline is closed');
  failure = false; await access.verify(); clock += 1500; access.expire(); check(!access.allowed, 'Silently lost connection expires');
  for (const transition of ['logout', 'account-delete', 'background', 'user-switch']) {
    clock++; await access.verify(); access.invalidate(); check(!access.allowed, transition + ' synchronously closes tools');
  }
  let release;
  const stale = new QaAccessController('user-id', () => new Promise(resolve => { release = resolve; }), () => {}, () => clock);
  const verifying = stale.verify(); stale.dispose(); release(valid); check(!await verifying && !stale.allowed, 'Late response cannot reopen logged-out/unmounted tools');
  check(!await stale.verify(), 'Disposed guard cannot be reused by a stale callback');
  {
    let complete; const busy = new QaAccessController('user-id', async action => action ? new Promise(resolve => { complete = resolve; }) : valid, () => {}, () => clock);
    await busy.verify(); const action = busy.run('reset', () => effects++); busy.invalidate(); complete(valid);
    check(!await action && effects === 1, 'Revocation/logout while an action check waits prevents its callback');
  }
  {
    let complete; const delayed = new QaAccessController('user-id', () => new Promise(resolve => { complete = resolve; }), () => {}, () => clock);
    const action = delayed.verify(); clock += 1500; complete(valid);
    check(!await action && !delayed.allowed, 'Slow server response cannot grant an already expired lease');
  }
  const normalKey = 'editio.fileBasket.preview.v1';
  const lane = new ProgressLane(normalKey); const normal = { ...emptyProgress(), points: 2, previewCredits: 5 };
  const storage = new Map([[normalKey, JSON.stringify(normal)]]);
  lane.select(qaStorageKey); const captured = lane.capture();
  let qa = qaReset(); qa = qaFiveWins(qa, 123456789); qa = qaNewRound(qa);
  lane.select(normalKey); storage.set(captured.key, JSON.stringify(qa));
  check(!captured.current(), 'Pending QA read/write invalidated by return/revocation');
  check(storage.get(normalKey) === JSON.stringify(normal), 'Delayed QA save leaves normal points/credits untouched');
  check(storage.get(qaStorageKey) === JSON.stringify(qa) && qa.previewCredits === 1, 'Only QA key receives test results');
  check(!('billing' in qa) && !('conversionBalance' in qa), 'Local test progress carries no real entitlement');
  const old = lane.capture(); lane.select(qaStorageKey); lane.select(normalKey); check(!old.current(), 'Repeated switches cannot revive a stale operation');
  mock.response = valid; let service = load('src/services/qaAccessService');
  check((await service.checkQaAccess('five_wins')).qaTester, 'Scoped action uses authenticated server');
  check(mock.calls.at(-1)[0].endsWith('/auth/qa-access') && mock.calls.at(-1)[1].action === 'five_wins', 'No conversion/quota mutation endpoint');
  for (const api of ['https://api.editioapp.com', 'https://api.editioapp.com:8443', 'http://stage.example.com', 'https://name:secret@stage.example.com']) {
    mock.api = api; const before = mock.calls.length; await assert.rejects(service.checkQaAccess()); check(mock.calls.length === before, 'Production or unsafe address sends no token');
  }
  mock.api = 'https://stage.example.com'; mock.flag = 'false'; service = load('src/services/qaAccessService');
  await assert.rejects(service.checkQaAccess()); check(true, 'Ordinary app build cannot enable tools by account permission');
  mock.flag = 'true'; mock.token = null; service = load('src/services/qaAccessService');
  await assert.rejects(service.checkQaAccess()); check(true, 'Logged-out account cannot authenticate tools');
  console.log(`QA access: ${checks} live authorization, revocation, expiry, staging and storage race checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
