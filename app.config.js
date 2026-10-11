const { verifyBasketConfig } = require('./scripts/verify-basket-config.cjs');
const eas = require('./eas.json');
module.exports = ({ config }) => {
  verifyBasketConfig(eas);
  return config;
};
