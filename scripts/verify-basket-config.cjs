const fs = require('node:fs');
const path = require('node:path');
function verifyBasketConfig(config, env = process.env) {
  for (const [name, profile] of Object.entries(config.build ?? {})) {
    const flag = profile.env?.EXPO_PUBLIC_FILE_BASKET_QA;
    if (flag !== 'true' && flag !== 'false') throw new Error(`Basket QA flag must be explicit: ${name}`);
    if (flag === 'true' && (name !== 'basket-qa' || profile.distribution !== 'internal')) throw new Error(`Basket QA is restricted to the internal basket-qa profile: ${name}`);
  }
  const flag = env.EXPO_PUBLIC_FILE_BASKET_QA;
  if (flag !== undefined && flag !== 'false' && flag !== 'true') throw new Error('Invalid Basket QA environment flag');
  if (flag === 'true' && (env.EAS_BUILD_PROFILE !== 'basket-qa' || config.build?.['basket-qa']?.distribution !== 'internal')) throw new Error('Basket QA environment is forbidden outside the internal basket-qa profile');
  const qa = config.build?.['basket-qa'];
  if (qa?.extends) throw new Error('Basket QA cannot inherit another API profile');
  if (qa?.env?.EXPO_PUBLIC_MEDIA_API_URL) throw new Error('Basket QA API must come from explicit staging environment configuration');
  if (qa?.env?.EXPO_PUBLIC_MONETIZATION_ENABLED !== 'false') throw new Error('Basket QA monetization must remain disabled');
  if (env.EAS_BUILD_PROFILE === 'basket-qa') {
    if (flag !== 'true' || env.EXPO_PUBLIC_MONETIZATION_ENABLED !== 'false') throw new Error('Basket QA requires explicit QA=true and monetization=false');
    const staging = stagingUrl(env.EDITIO_STAGING_API_URL);
    const actual = stagingUrl(env.EXPO_PUBLIC_MEDIA_API_URL);
    if (staging !== actual) throw new Error('Basket QA API must exactly match the declared staging API');
    const productionHosts = new Set(['editioapp.com', 'www.editioapp.com', 'api.editioapp.com']);
    for (const name of ['preview', 'production']) {
      const address = config.build?.[name]?.env?.EXPO_PUBLIC_MEDIA_API_URL;
      if (address) productionHosts.add(new URL(address).hostname.toLowerCase());
    }
    if (productionHosts.has(new URL(staging).hostname.toLowerCase())) throw new Error('Production API is forbidden in Basket QA');
  }
}
function stagingUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Basket QA requires an explicit HTTPS staging API URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !url.hostname) throw new Error('Invalid staging API URL');
  return url.toString().replace(/\/$/, '');
}
module.exports = { verifyBasketConfig };
if (require.main === module) {
  verifyBasketConfig(JSON.parse(fs.readFileSync(path.join(__dirname, '../eas.json'), 'utf8')));
  console.log('Basket distribution guard passed');
}
