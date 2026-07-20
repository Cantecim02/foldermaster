const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const monthlyProductId = "com.cantecim.editio.pro.monthly";
const yearlyProductId = "com.cantecim.editio.pro.yearly";

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

const app = readJson("app.json").expo;
assert.equal(app.ios?.supportsTablet, false, "iPad support must remain disabled");
assert.equal(app.ios?.bundleIdentifier, "com.cantecim.editio");
assert.ok(
  app.plugins.some((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) === "expo-iap"),
  "expo-iap must remain in the Expo plugin list"
);

const project = read("ios/FileConverter.xcodeproj/project.pbxproj");
assert.match(
  project,
  /com\.apple\.InAppPurchase\s*=\s*\{[\s\S]*?enabled\s*=\s*1;/,
  "The iOS target must keep the In-App Purchase capability enabled"
);
const deviceFamilies = [...project.matchAll(/TARGETED_DEVICE_FAMILY = ([^;]+);/g)]
  .map((match) => match[1].replaceAll('"', "").trim());
assert.ok(deviceFamilies.length > 0, "No iOS target device family was found");
assert.ok(deviceFamilies.every((value) => value === "1"), "Only the iPhone device family is allowed");

const infoPlist = read("ios/FileConverter/Info.plist");
assert.ok(
  !infoPlist.includes("UISupportedInterfaceOrientations~ipad"),
  "An iPad-specific orientation key was reintroduced"
);

const monetization = read("src/config/monetization.ts");
assert.match(monetization, /Platform\.OS === ["']ios["']/);
assert.match(monetization, /EXPO_PUBLIC_MONETIZATION_ENABLED/);
assert.match(monetization, /EXPO_PUBLIC_EDITIO_MONTHLY_PRODUCT_ID/);
assert.match(monetization, /EXPO_PUBLIC_EDITIO_YEARLY_PRODUCT_ID/);

const billingHook = read("src/hooks/useEditioBilling.ts");
assert.match(
  billingHook,
  /const enabled = monetizationConfig\.enabled && serverMonetizationEnabled === true/,
  "The paywall must require both the mobile and backend feature flags"
);
assert.match(
  billingHook,
  /if \(!backendEnabled\)[\s\S]*?context: null/,
  "A disabled backend flag must preserve the existing unrestricted flow"
);
assert.match(
  billingHook,
  /await verifyAppleTransaction[\s\S]*?await finishTransaction/,
  "Transactions must be verified by the backend before StoreKit is finished"
);

const clientMetadata = read("src/services/clientMetadata.ts");
for (const header of [
  "x-editio-client-platform",
  "x-editio-client-build",
  "x-editio-billing-version",
  "x-editio-monetization-capable"
]) {
  assert.match(clientMetadata, new RegExp(header), `Missing compatibility header: ${header}`);
}

const eas = readJson("eas.json");
for (const [profileName, profile] of Object.entries(eas.build ?? {})) {
  assert.equal(
    profile.env?.EXPO_PUBLIC_MONETIZATION_ENABLED,
    "false",
    `${profileName} must remain opt-in until App Store products and Sandbox verification are complete`
  );
}

const storeKit = readJson("ios/FileConverter/Supporting/Editio.storekit");
const subscriptions = (storeKit.subscriptionGroups ?? []).flatMap((group) => group.subscriptions ?? []);
assert.deepEqual(
  subscriptions.map((item) => item.productID).sort(),
  [monthlyProductId, yearlyProductId].sort(),
  "The StoreKit configuration must contain only the approved monthly and yearly products"
);
assert.deepEqual(
  subscriptions.map((item) => item.recurringSubscriptionPeriod).sort(),
  ["P1M", "P1Y"],
  "Weekly subscriptions are not allowed"
);

const scheme = read("ios/FileConverter.xcodeproj/xcshareddata/xcschemes/FileConverter.xcscheme");
const launchAction = scheme.match(/<LaunchAction[\s\S]*?<\/LaunchAction>/)?.[0] ?? "";
assert.match(launchAction, /Editio\.storekit/, "Local StoreKit fixtures must remain on the debug Launch action");
assert.doesNotMatch(
  scheme.replace(launchAction, ""),
  /Editio\.storekit/,
  "Local StoreKit fixtures must not be attached to Profile or Archive actions"
);

const rootPackage = readJson("package.json");
const backendPackage = readJson("backend/package.json");
assert.equal(rootPackage.dependencies["expo-iap"], "4.5.2", "expo-iap must stay pinned to the audited API version");
assert.equal(
  backendPackage.dependencies["@apple/app-store-server-library"],
  "3.1.0",
  "Apple's server library must stay pinned to the audited API version"
);

const easIgnore = read(".easignore");
for (const requiredSource of ["src/", "assets/", "ios/"]) {
  assert.ok(!new RegExp(`^${requiredSource.replace("/", "\\/")}$`, "m").test(easIgnore));
}
for (const excludedPath of ["backend", "website", "artifacts", "node_modules"]) {
  assert.match(easIgnore, new RegExp(`^${excludedPath}(?:/|$)`, "m"));
}

console.log("Monetization configuration verification passed.");
