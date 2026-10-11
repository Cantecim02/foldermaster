const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const assert = require('node:assert/strict');
let checks = 0;
const check = (value, message) => { checks++; assert.ok(value, message); };
function harness(persisted = { token: null, revoked: null }) {
  const requests = []; let failWrite = false; let failRead = false; let failDelete = false;
  let failFenceRead = false; let failFenceWrite = false; let failFenceRemove = false;
  let reply = { user: { id: 'uuid', email: 'test@example.com', username: 'user-test' }, session: { token: 't'.repeat(43), expiresAt: '2099-01-01T00:00:00.000Z' } }; let failure = null;
  let deferredGet = null;
  const axios = { isAxiosError: error => error?.isAxiosError === true };
  for (const method of ['get', 'post', 'delete']) axios[method] = async (...args) => { requests.push([method, ...args]); const capturedFailure = failure; const capturedReply = reply; if (method === 'get' && deferredGet) await deferredGet; if (capturedFailure) throw capturedFailure; return { data: capturedReply, status: method === 'delete' ? 204 : 200 }; };
  const secure = { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only', setItemAsync: async (key, value) => { if (failWrite) throw Error('private store internals'); persisted.token = value; }, getItemAsync: async () => { if (failRead) throw Error('private'); return persisted.token; }, deleteItemAsync: async () => { if (failDelete) throw Error('private'); persisted.token = null; } };
  const storage = {
    getItem: async () => { if (failFenceRead) throw Error('private fence'); return persisted.revoked; },
    setItem: async (key, value) => { if (failFenceWrite) throw Error('private fence'); persisted.revoked = value; },
    removeItem: async () => { if (failFenceRemove) throw Error('private fence'); persisted.revoked = null; }
  };
  const cache = {};
  function load(name) {
    if (cache[name]) return cache[name].exports;
    const mod = { exports: {} }; cache[name] = mod;
    const filename = path.resolve(__dirname, '../src/services', name + '.ts');
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
    const requireMock = id => {
      if (id === 'axios') return axios;
      if (id === 'expo-secure-store') return secure;
      if (id === '@react-native-async-storage/async-storage') return storage;
      if (id === 'react-native') return { Platform: { OS: 'ios' } };
      if (id === './mediaDownloaderApi') return { getApiBaseUrl: () => 'http://unit.invalid' };
      if (id.startsWith('./')) return load(id.slice(2));
      throw Error(`Unexpected account dependency ${id}`);
    };
    vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(requireMock, mod, mod.exports);
    return mod.exports;
  }
  return { load, requests, persisted, set deferredGet(value) { deferredGet = value; }, set failFenceRead(value) { failFenceRead = value; }, set failFenceWrite(value) { failFenceWrite = value; }, set failFenceRemove(value) { failFenceRemove = value; }, get token() { return persisted.token; }, set reply(value) { reply = value; }, set failure(value) { failure = value; }, set failWrite(value) { failWrite = value; }, set failRead(value) { failRead = value; }, set failDelete(value) { failDelete = value; } };
}
const axError = (status, code) => ({ isAxiosError: true, code, response: status ? { status, data: { code, message: 'secret backend detail' } } : undefined, config: { data: 'private password and token' } });
(async () => {
 const h = harness(); const api = h.load('authService'); const errors = h.load('authErrors'); const validation = h.load('accountValidation');
 const valid = { email: 'test@example.com', password: 'SecurePass123', acceptedTerms: true, ageConfirmed: true, minimumAge: 13 };
 check(validation.registrationError(valid) === null, 'No names/date required');
 for (const [patch, code] of [[{ password: 'weak' }, 'AUTH_INVALID_PASSWORD'], [{ firstName: 'A1' }, 'AUTH_INVALID_NAME'], [{ ageConfirmed: false }, 'AGE_REQUIRED'], [{ acceptedTerms: false }, 'TERMS_REQUIRED'], [{ email: 'bad' }, 'AUTH_INVALID_EMAIL'], [{ minimumAge: 0 }, 'REGISTRATION_POLICY_CHANGED']]) check(validation.registrationError({ ...valid, ...patch }) === code, code);
 check(validation.registrationError({ ...valid, firstName: '李', lastName: '' }) === null, 'Unicode optional names');
 check(validation.accountDisplayName({ firstName: null, lastName: '', username: 'user-a', email: valid.email }) === 'user-a', 'Nullable profile uses username');
 check(validation.accountDisplayName({ email: valid.email }) === valid.email, 'Old server profile safely falls back');
 for (const [status, code, expected] of [[400, 'INVALID_REQUEST', 'AUTH_INVALID_FIELDS'], [409, 'ACCOUNT_EXISTS', 'ACCOUNT_EXISTS'], [429, undefined, 'AUTH_RATE_LIMITED'], [500, 'private-code', 'SERVER_ERROR'], [undefined, 'ECONNABORTED', 'TIMEOUT'], [undefined, 'ERR_NETWORK', 'NETWORK_ERROR']]) {
   const normalized = errors.normalizeAuthError(axError(status, code)); check(normalized.code === expected, expected); check(!JSON.stringify(normalized).includes('private'), 'No raw Axios credentials retained');
 }
 check(errors.normalizeAuthError(new Error("ERR_BACKEND_URL_MISSING")).code === "NETWORK_ERROR", "Missing API URL error matches the real service exception");
 const messages = h.load('authMessages');
 for (const lang of ['en','tr','zh','fr','ru','de','es']) for (const code of messages.authMessageCodes) check(messages.authErrorMessage(new errors.AuthApiError(code), lang).length > 5, `${lang}/${code}`);
 const user = await api.registerAccount(valid); check(user.username === 'user-test' && h.token, 'Register securely persists session before returning');
 h.failure = axError(undefined, 'ERR_NETWORK'); await assert.rejects(api.restoreAccountSession(), error => error.code === 'NETWORK_ERROR'); check(h.token, 'Transient restore retains token');
 h.failure = axError(401, 'SESSION_EXPIRED'); check(await api.restoreAccountSession() === null && h.token === null, '401 clears expired token');
 h.failure = null; await api.loginAccount(valid.email, valid.password); h.failure = axError(undefined, 'ERR_NETWORK'); await assert.rejects(api.logoutAccount(), error => error.code === 'NETWORK_ERROR'); check(h.token === null, 'Logout clears device token despite network failure');
 h.failure = null; h.failWrite = true; const before = h.requests.length; await assert.rejects(api.registerAccount(valid), error => error.code === 'SESSION_STORAGE_ERROR'); check(h.requests.slice(before).some(call => call[1].endsWith('/auth/logout')), 'Persistence failure revokes newly issued remote session');
 h.failWrite = false; await api.loginAccount(valid.email, valid.password); h.failRead = true; await assert.rejects(api.restoreAccountSession(), error => error.code === 'SESSION_STORAGE_ERROR'); h.failRead = false;
 await api.loginAccount(valid.email, valid.password); h.failDelete = true; await assert.rejects(api.logoutAccount(), error => error.code === 'SESSION_STORAGE_ERROR'); check(h.token && await api.getAccountSessionToken() === null, 'Failed physical clear blocks the session'); h.failDelete = false;
 h.reply = { user: { id: 'bad', email: valid.email }, session: { token: 'invalid', expiresAt: 'invalid' } }; await assert.rejects(api.loginAccount(valid.email, valid.password), error => error.code === 'AUTH_INVALID_RESPONSE');
 h.failure = axError(404); await assert.rejects(api.getRegistrationPolicy(), error => error.code === 'REGISTRATION_UPDATE_REQUIRED');
 h.failure = null; h.reply = { registrationVersion: 2, minimumAge: 18 }; check((await api.getRegistrationPolicy()).minimumAge === 18, 'Server minimum age is authoritative');
 h.reply = { registrationVersion: 2, minimumAge: 12 }; await assert.rejects(api.getRegistrationPolicy(), error => error.code === 'REGISTRATION_UPDATE_REQUIRED');
 // Confirmed deletion, cleanup, UI state and restart are independent outcomes.
 for (const failFence of [false, true]) {
   const d = harness(); const service = d.load('authService');
   await service.loginAccount(valid.email, valid.password);
   d.failDelete = true; d.failFenceWrite = failFence;
   const result = await service.deleteAccount(valid.password);
   check(result.serverDeleted && result.deviceCleanupPending, 'Server success survives secure deletion failure');
   const before = d.requests.length;
   check(await service.getAccountSessionToken() === null, 'Deleted token suppressed immediately');
   check(await service.restoreAccountSession() === null, 'Deleted session cannot restore');
   check(d.requests.length === before, 'No request sends the stale token');
   if (!failFence) {
     const restarted = harness(d.persisted).load('authService');
     check(await restarted.getAccountSessionToken() === null, 'Revocation fence survives restart');
   }
   const events = [];
   await d.load('accountDeletion').finishDeletedAccount(result, {
     clearUi: () => events.push('signed-out'), onSuccess: () => events.push('deleted'),
     endSession: async () => { events.push('history-cleanup'); throw Error('local storage'); },
     onCleanupPending: () => events.push('cleanup-warning')
   });
   check(events.join(',') === 'signed-out,deleted,history-cleanup,cleanup-warning', 'UI reports deleted before failing local cleanup');
   d.failDelete = false; d.failFenceWrite = false;
   await service.loginAccount(valid.email, valid.password);
   check(await service.getAccountSessionToken() === d.token, 'Explicit successful login permits a new session');
 }
 for (const [failure, code] of [[axError(undefined, 'ERR_NETWORK'), 'ACCOUNT_DELETE_UNCONFIRMED'], [axError(undefined, 'ECONNABORTED'), 'ACCOUNT_DELETE_UNCONFIRMED'], [axError(401, 'INVALID_CREDENTIALS'), 'INVALID_CREDENTIALS']]) {
   const d = harness(); const service = d.load('authService'); await service.loginAccount(valid.email, valid.password); d.failure = failure;
   await assert.rejects(service.deleteAccount(valid.password), error => error.code === code);
   check(await service.getAccountSessionToken() === d.token, 'Unconfirmed deletion does not claim remote success');
 }
 for (const field of ['failRead', 'failFenceRead']) {
   const d = harness(); const service = d.load('authService'); await service.loginAccount(valid.email, valid.password); d[field] = true;
   const before = d.requests.length; await assert.rejects(service.deleteAccount(valid.password), error => error.code === 'SESSION_STORAGE_ERROR');
   check(d.requests.length === before, 'Read failure sends no unauthenticated deletion');
 }
 for (const field of ['failWrite', 'failFenceWrite', 'failFenceRemove']) {
   const d = harness(); const service = d.load('authService'); d[field] = true;
   await assert.rejects(service.loginAccount(valid.email, valid.password), error => error.code === 'SESSION_STORAGE_ERROR');
   check(await service.getAccountSessionToken() === null, 'Failed secure write cannot activate a session');
   check(d.requests.some(call => call[1].endsWith('/auth/logout')), 'Failed persistence revokes the issued server token');
 }
 {
   const d = harness(); const service = d.load('authService'); await service.loginAccount(valid.email, valid.password);
   d.failDelete = true; d.failure = axError(401, 'SESSION_EXPIRED');
   check(await service.restoreAccountSession() === null, 'Remote 401 signs out despite Keychain delete failure');
   check(await harness(d.persisted).load('authService').getAccountSessionToken() === null, '401 tombstone persists');
 }
 check(messages.authErrorMessage(new errors.AuthApiError('REGISTRATION_UPDATE_REQUIRED'), 'tr').includes('güncellenmeli'), 'Old backend has a clear Turkish update notice');
 check(messages.authErrorMessage(new errors.AuthApiError('REGISTRATION_UPDATE_REQUIRED'), 'en').includes('update'), 'Old backend has a clear English update notice');
 {
   const d = harness(); const service = d.load('authService'); await service.loginAccount(valid.email, valid.password);
   let release; d.deferredGet = new Promise(resolve => { release = resolve; });
   const restoring = service.restoreAccountSession(); await new Promise(resolve => setImmediate(resolve));
   await service.deleteAccount(valid.password); release();
   check(await restoring === null, 'An in-flight restore cannot revive a deleted account');
 }
 {
   const d = harness(); const service = d.load('authService'); await service.loginAccount(valid.email, valid.password);
   let release; d.deferredGet = new Promise(resolve => { release = resolve; }); d.failure = axError(401, 'SESSION_EXPIRED');
   const restoring = service.restoreAccountSession(); await new Promise(resolve => setImmediate(resolve));
   d.failure = null; await service.loginAccount(valid.email, valid.password); release(); await restoring;
   check(await service.getAccountSessionToken() === d.token, 'A stale 401 cannot erase a newer login');
 }
 console.log(`Account client: ${checks} validation, localization and session checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
