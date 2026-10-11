const assert = require('node:assert/strict');
const { verifyBasketConfig } = require('./verify-basket-config.cjs');
const eas = require('../eas.json');
let checks = 0;
const accept = (config, env) => { verifyBasketConfig(config, env); checks++; };
const reject = (config, env, pattern) => { assert.throws(() => verifyBasketConfig(config, env), pattern); checks++; };
const staging = 'https://staging-api.example.com';
const qaEnv = { EAS_BUILD_PROFILE: 'basket-qa', EXPO_PUBLIC_FILE_BASKET_QA: 'true', EXPO_PUBLIC_MONETIZATION_ENABLED: 'false', EDITIO_STAGING_API_URL: staging, EXPO_PUBLIC_MEDIA_API_URL: staging };
accept(eas, {});
accept(eas, qaEnv);
for (const profile of ['production', 'preview', undefined]) reject(eas, { ...qaEnv, EAS_BUILD_PROFILE: profile }, /forbidden/);
const leaked = structuredClone(eas); leaked.build.production.env.EXPO_PUBLIC_FILE_BASKET_QA = 'true'; reject(leaked, {}, /restricted/);
const publicQa = structuredClone(eas); publicQa.build['basket-qa'].distribution = 'store'; reject(publicQa, {}, /restricted/);
reject(eas, { EXPO_PUBLIC_FILE_BASKET_QA: 'yes' }, /Invalid/);
for (const key of ['EDITIO_STAGING_API_URL', 'EXPO_PUBLIC_MEDIA_API_URL']) {
  const missing = { ...qaEnv }; delete missing[key]; reject(eas, missing, /requires an explicit/);
}
for (const url of ['https://api.editioapp.com', 'https://api.editioapp.com:8443', 'https://api.editioapp.com/test', 'https://API.EDITIOAPP.COM', 'https://www.editioapp.com']) reject(eas, { ...qaEnv, EDITIO_STAGING_API_URL: url, EXPO_PUBLIC_MEDIA_API_URL: url }, /Production API/);
for (const url of ['http://staging-api.example.com', 'https://user:password@staging-api.example.com', staging + '?token=fake', staging + '#fragment', 'invalid']) reject(eas, { ...qaEnv, EDITIO_STAGING_API_URL: url, EXPO_PUBLIC_MEDIA_API_URL: url }, /staging API URL/);
reject(eas, { ...qaEnv, EXPO_PUBLIC_MEDIA_API_URL: 'https://another.example.com' }, /exactly match/);
reject(eas, { ...qaEnv, EXPO_PUBLIC_MONETIZATION_ENABLED: 'true' }, /monetization=false/);
reject(eas, { ...qaEnv, EXPO_PUBLIC_FILE_BASKET_QA: 'false' }, /QA=true/);
const inherited = structuredClone(eas); inherited.build['basket-qa'].extends = 'preview'; reject(inherited, {}, /cannot inherit/);
const configuredProd = structuredClone(eas); configuredProd.build['basket-qa'].env.EXPO_PUBLIC_MEDIA_API_URL = 'https://api.editioapp.com'; reject(configuredProd, {}, /explicit staging/);
const enabled = structuredClone(eas); enabled.build['basket-qa'].env.EXPO_PUBLIC_MONETIZATION_ENABLED = 'true'; reject(enabled, {}, /remain disabled/);
console.log(`Basket config: ${checks} distribution, staging and override checks passed.`);
