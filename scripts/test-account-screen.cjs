const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const vm = require('node:vm'); const ts = require('typescript');
let checks = 0;
const check = (value, label) => { assert.ok(value, label); checks++; };
const user = { id: 'synthetic-id', email: 'test@example.com', username: 'user-synthetic' };
function harness() {
  let index = 0, states = [], effects = [], pending = [], calls = [], policyFailure = false, authFailure = false;
  const element = (type, props) => ({ type, props: props ?? {} });
  const react = {
    useState: initial => { const i = index++; if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; },
    useRef: initial => { const i = index++; if (!(i in states)) states[i] = { current: initial }; return states[i]; },
    useMemo: fn => { index++; return fn(); },
    useEffect: (fn, deps) => { const i = index++; const previous = effects[i]; if (!previous || deps.some((value, j) => value !== previous.deps[j])) pending.push(() => { previous?.cleanup?.(); effects[i] = { deps, cleanup: fn() }; }); }
  };
  const cache = {};
  const auth = {
    AuthApiError: class extends Error { constructor(code) { super(code); this.code = code; } },
    getRegistrationPolicy: async () => { calls.push('policy'); if (policyFailure) throw new auth.AuthApiError('REGISTRATION_UPDATE_REQUIRED'); return { minimumAge: 18, registrationVersion: 2 }; },
    loginAccount: async (...args) => { calls.push(['login', ...args]); if (authFailure) throw new auth.AuthApiError('INVALID_CREDENTIALS'); return user; },
    registerAccount: async input => { calls.push(['register', input]); return user; },
    logoutAccount: async () => { calls.push('logout'); },
    deleteAccount: async () => ({ serverDeleted: true, deviceCleanupPending: true })
  };
  function load(file) {
    if (cache[file]) return cache[file];
    const filename = path.resolve(__dirname, '..', file);
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const module = { exports: {} };
    const requireMock = id => {
      if (id === 'axios') return { isAxiosError: () => false };
      if (id === 'react') return react;
      if (id === 'react/jsx-runtime') return { jsx: element, jsxs: element, Fragment: 'Fragment' };
      if (id === 'react-native') return { ...Object.fromEntries(['ActivityIndicator','KeyboardAvoidingView','ScrollView','Text','TextInput','TouchableOpacity','View'].map(name => [name,name])),
        Alert: { alert: (...args) => calls.push(['alert', ...args]) }, Keyboard: { dismiss: () => calls.push('keyboard-dismiss') }, findNodeHandle: () => null,
        BackHandler: { addEventListener: (name, fn) => { calls.push(['back-handler',fn]); return { remove() {} }; } }, Platform: { OS: 'ios' }, StyleSheet: { absoluteFillObject: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }, create: s => s } };
      if (id === '@expo/vector-icons') return { Feather: 'Feather' };
      if (id === '../services/authService') return auth;
      if (id === './ui/InstagramGradient') return { InstagramGradient: 'Gradient' };
      if (id.startsWith('.')) { let resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), id)); resolved += fs.existsSync(path.resolve(__dirname,'..',resolved+'.ts')) ? '.ts' : '.tsx'; return load(resolved); }
      throw Error('Unexpected component dependency ' + id);
    };
    vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(requireMock, module, module.exports);
    return cache[file] = module.exports;
  }
  auth.AuthApiError = load('src/services/authErrors.ts').AuthApiError;
  const { AccountScreen } = load('src/components/AccountScreen.tsx');
  const theme = { isDark: false, colors: { surface: '#fff', background: '#fff', surfaceAlt: '#eee', border: '#ddd', primary: '#724bcc', primarySoft: '#f5eeff', text: '#111', muted: '#666', accent: '#b04ea0' } };
  const props = { visible: true, legalOpen: false, isLandscape: false, language: 'en', theme, user: null,
    onUserChange: value => calls.push(['user',value]), onClose: () => calls.push('close'), onOpenLegal: key => calls.push(['legal',key]),
    onLifecycleSuccess: event => calls.push(['lifecycle',event]), onSessionEnd: async reason => calls.push(['session-end',reason]), onOpenHistory: () => calls.push('history') };
  const expand = node => {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(expand);
    if (typeof node.type === 'function') return expand(node.type(node.props));
    return { ...node, props: { ...node.props, children: expand(node.props.children) } };
  };
  const render = () => { index = 0; const node = expand(AccountScreen(props)); const work = pending; pending = []; work.forEach(fn => fn()); return node; };
  const all = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(all) : [node, ...all(node.props.children)];
  const text = node => !node ? '' : typeof node !== 'object' ? String(node) : Array.isArray(node) ? node.map(text).join('') : text(node.props.children);
  const button = (tree, label) => all(tree).filter(n => n.type === 'TouchableOpacity' && text(n) === label).at(-1);
  const input = (tree, placeholder) => all(tree).find(n => n.type === 'TextInput' && n.props.placeholder === placeholder);
  return { props, calls, render, all, text, button, input, set authFailure(v) { authFailure = v; }, set policyFailure(v) { policyFailure = v; } };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
(async () => {
  for (const language of ['en','tr','zh','fr','ru','de','es']) for (const isLandscape of [false,true]) for (const isDark of [false,true]) {
    const h = harness(); h.props.language = language; h.props.isLandscape = isLandscape; h.props.theme.isDark = isDark;
    const tree = h.render(); check(tree.props.testID === 'account-screen' && tree.props.behavior === 'padding', 'Full page keyboard avoidance for ' + language);
    check(h.all(tree).some(n => n.type === 'ScrollView' && n.props.keyboardShouldPersistTaps === 'handled'), 'Form/button scroll together');
    check(h.all(tree).filter(n => n.props.accessibilityRole === 'tab').length === 2, 'Modern accessible auth tabs');
    check(!h.all(tree).some(n => n.type === 'Modal'), 'No centered modal');
  }
  {
    const h = harness(); let tree = h.render();
    h.input(tree,'Email').props.onChangeText('test@example.com'); h.input(tree,'Password').props.onChangeText('SecurePass123'); tree = h.render();
    h.authFailure = true; h.button(tree,'Sign in').props.onPress(); await flush(); tree = h.render();
    check(h.text(tree).includes('incorrect'), 'Sign-in error understandable'); check(!h.calls.includes('close'), 'Failed login stays on form');
    h.authFailure = false; h.button(tree,'Sign in').props.onPress(); await flush();
    check(h.calls.some(c => Array.isArray(c) && c[0] === 'user' && c[1].id === user.id) && h.calls.includes('close'), 'Successful sign-in updates user and returns to caller');
  }
  {
    const h = harness(); let tree = h.render(); h.button(tree,'Create account').props.onPress(); tree = h.render(); await flush(); tree = h.render();
    check(!h.all(tree).some(n => /birth|dob|date of birth/i.test(n.props.placeholder ?? '')), 'No DOB field');
    check(h.input(tree,'First name (optional)') && h.input(tree,'Last name (optional)'), 'Names optional');
    h.input(tree,'Email').props.onChangeText('test@example.com'); h.input(tree,'Password').props.onChangeText('SecurePass123'); h.input(tree,'Repeat password').props.onChangeText('SecurePass123'); tree = h.render();
    for (const checkbox of h.all(tree).filter(n => n.props.accessibilityRole === 'checkbox')) checkbox.props.onPress(); tree = h.render();
    h.button(tree,'Privacy Policy').props.onPress(); h.props.legalOpen = true; tree = h.render();
    check(h.input(tree,'Email').props.value === 'test@example.com' && h.input(tree,'Password').props.value === 'SecurePass123', 'Legal page preserves draft');
    h.props.legalOpen = false; tree = h.render(); h.button(tree,'Create account').props.onPress(); await flush();
    const body = h.calls.find(c => Array.isArray(c) && c[0] === 'register')[1];
    check(body.firstName === '' && body.lastName === '' && body.minimumAge === 18 && body.ageConfirmed && body.acceptedTerms && !('birthDate' in body), 'Registration uses server age and no DOB');
    check(h.calls.some(c => Array.isArray(c) && c[0] === 'lifecycle' && c[1] === 'created'), 'Created lifecycle kept');
    h.props.visible = false; h.render(); h.props.visible = true; tree = h.render(); check(h.input(tree,'Password').props.value === '', 'Passwords cleared when account page closes');
  }
  {
    const h = harness(); h.policyFailure = true; let tree = h.render(); h.button(tree,'Create account').props.onPress(); h.render(); await flush(); tree = h.render();
    check(h.button(tree,'Create account').props.disabled && h.text(tree).includes('update'), 'Old backend policy error disables signup');
  }
  {
    const h = harness(); h.props.user = user; let tree = h.render(); check(h.text(tree).includes(user.username), 'Server username displayed');
    h.button(tree,'Conversion history').props.onPress(); check(h.calls.includes('close') && h.calls.includes('history'), 'History entry preserved');
    h.button(tree,'Delete account').props.onPress(); tree = h.render(); h.input(tree,'Password').props.onChangeText('SecurePass123'); tree = h.render();
    h.button(tree,'Permanently delete').props.onPress(); await flush();
    check(h.calls.some(c => Array.isArray(c) && c[0] === 'user' && c[1] === null), 'Deletion clears account UI');
    check(h.calls.some(c => Array.isArray(c) && c[0] === 'lifecycle' && c[1] === 'deleted') && h.calls.some(c => Array.isArray(c) && c[0] === 'alert'), 'Server deletion success independent of cleanup warning');
  }
  for (const language of ['tr','zh','fr','ru','de','es']) {
    const h = harness(); h.props.language = language; let tree = h.render();
    h.all(tree).find(n => n.props.accessibilityRole === 'tab' && !n.props.accessibilityState.selected).props.onPress(); tree = h.render();
    check(!h.text(tree).includes('Passwords are protected'), 'Registration security notice translated in ' + language);
    h.props.user = user; h.props.monetizationEnabled = true; h.props.onManageSubscription = () => {}; tree = h.render();
    const deletionLabels = { tr: 'Hesabı sil', zh: '删除帐户', fr: 'Supprimer le compte', ru: 'Удалить аккаунт', de: 'Konto löschen', es: 'Eliminar cuenta' };
    h.button(tree, deletionLabels[language]).props.onPress(); tree = h.render();
    check(!h.text(tree).includes('Deleting your Editio account') && !h.text(tree).includes('Enter your password to permanently'), 'Deletion and subscription explanations translated in ' + language);
  }
  const app = fs.readFileSync(path.resolve(__dirname,'../App.tsx'),'utf8');
  const close = app.match(/const closeAccountScreen = \(\) => \{([\s\S]*?)\n  \};/)[1];
  check(!/setActiveTab|setFiles|setJobs|setSelected/.test(close), 'Returning from account preserves tab/files/jobs');
  const legal = app.match(/const openAccountLegalDocument = .*?\{([\s\S]*?)\n  \};/)[1];
  check(!legal.includes('setAccountScreenVisible(false)'), 'Legal flow does not hide/reset account form');
  check(!/accountScreenVisible\s*\?\s*<AccountScreen/.test(app), 'Main app and draft remain mounted');
  console.log(`Account screen: ${checks} component flow, language/theme/layout, legal, deletion and navigation checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
