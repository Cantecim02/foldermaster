const { getDefaultConfig } = require('expo/metro-config');
const { verifyBasketConfig } = require('./scripts/verify-basket-config.cjs');
verifyBasketConfig(require('./eas.json'));
const config = getDefaultConfig(__dirname);
// Exclude QA code and its transitive dependencies from ordinary release bundles.
const qa = process.env.EXPO_PUBLIC_FILE_BASKET_QA === 'true';
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === './FileBasketQaPanel' && !context.dev && !qa) {
    return context.resolveRequest(context, './FileBasketQaDisabled', platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};
module.exports = config;
