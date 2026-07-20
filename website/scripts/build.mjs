import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const sourceDir = path.resolve(scriptsDir, "..");
const outputDir = path.join(sourceDir, "dist");
const publicEntries = [
  "index.html",
  "privacy",
  "terms",
  "support",
  "assets",
  "manifest.webmanifest",
  "robots.txt",
  "sitemap.xml"
];
const monetizationValue = process.env.MONETIZATION_LIVE ?? "false";

if (!/^(true|false)$/.test(monetizationValue)) {
  throw new Error("MONETIZATION_LIVE must be exactly true or false.");
}

const monetizationLive = monetizationValue === "true";

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

for (const entry of publicEntries) {
  await cp(path.join(sourceDir, entry), path.join(outputDir, entry), { recursive: true });
}

function selectMonetizationVariant(source, file) {
  const activeVariant = monetizationLive ? "LIVE" : "SOON";
  const inactiveVariant = monetizationLive ? "SOON" : "LIVE";
  const inactiveBlock = new RegExp(
    `\\s*<!-- MONETIZATION_${inactiveVariant}_START -->[\\s\\S]*?<!-- MONETIZATION_${inactiveVariant}_END -->`,
    "g"
  );
  const activeMarkers = new RegExp(`\\s*<!-- MONETIZATION_${activeVariant}_(?:START|END) -->`, "g");
  const result = source.replace(inactiveBlock, "").replace(activeMarkers, "");
  if (/<!-- MONETIZATION_(?:LIVE|SOON)_(?:START|END) -->/.test(result)) {
    throw new Error(`${file}: unresolved monetization build marker`);
  }
  return result;
}

for (const htmlFile of ["index.html", "privacy/index.html", "terms/index.html", "support/index.html"]) {
  const target = path.join(outputDir, htmlFile);
  const source = await readFile(target, "utf8");
  await writeFile(target, selectMonetizationVariant(source, htmlFile));
}

const configPath = path.join(outputDir, "assets/js/config.js");
const configSource = await readFile(configPath, "utf8");
const renderedConfig = configSource.replace(
  /\/\*__EDITIO_MONETIZATION_LIVE__\*\/\s*false/,
  String(monetizationLive)
);
if (renderedConfig === configSource) {
  throw new Error("assets/js/config.js: monetization build marker not found");
}
await writeFile(configPath, renderedConfig);

const htmlFiles = [
  "index.html",
  "privacy/index.html",
  "terms/index.html",
  "support/index.html"
];

const translationSource = await readFile(path.join(outputDir, "assets/js/translations.js"), "utf8");
const translationContext = { window: {} };
vm.createContext(translationContext);
vm.runInContext(translationSource, translationContext);
const translations = translationContext.window.EDITIO_TRANSLATIONS;

function lookup(object, key) {
  return key.split(".").reduce((value, part) => value && value[part], object);
}

function localTarget(fromFile, reference) {
  const clean = reference.split("#")[0].split("?")[0];
  if (!clean || /^(https?:|mailto:|tel:|data:)/.test(clean)) return null;
  if (clean.startsWith("/")) return path.join(outputDir, clean);
  return path.resolve(path.dirname(path.join(outputDir, fromFile)), clean);
}

async function exists(target) {
  try {
    const details = await stat(target);
    if (details.isDirectory()) await stat(path.join(target, "index.html"));
    return true;
  } catch (_error) {
    return false;
  }
}

const failures = [];
for (const htmlFile of htmlFiles) {
  const source = await readFile(path.join(outputDir, htmlFile), "utf8");
  const references = Array.from(source.matchAll(/(?:href|src)="([^"]+)"/g), (match) => match[1]);
  for (const reference of references) {
    const target = localTarget(htmlFile, reference);
    if (target && !(await exists(target))) failures.push(`${htmlFile}: missing ${reference}`);
  }

  const keys = Array.from(source.matchAll(/data-i18n(?:-aria|-alt)?="([^"]+)"/g), (match) => match[1]);
  for (const key of keys) {
    for (const language of ["tr", "en"]) {
      if (typeof lookup(translations[language], key) !== "string") {
        failures.push(`${htmlFile}: missing ${language} translation for ${key}`);
      }
    }
  }
}

const textOutputs = [
  ...htmlFiles,
  "assets/css/site.css",
  "assets/js/config.js",
  "assets/js/translations.js",
  "assets/js/app.js",
  "manifest.webmanifest",
  "robots.txt",
  "sitemap.xml"
];
for (const file of textOutputs) {
  const source = await readFile(path.join(outputDir, file), "utf8");
  if (/foldermaster/i.test(source)) failures.push(`${file}: legacy brand name found`);
  if (/lorem ipsum/i.test(source)) failures.push(`${file}: placeholder copy found`);
}

const renderedHome = await readFile(path.join(outputDir, "index.html"), "utf8");
const renderedSupport = await readFile(path.join(outputDir, "support/index.html"), "utf8");
if (monetizationLive) {
  if (/pricingSoon|subscriptionSoon/.test(renderedHome + renderedSupport)) {
    failures.push("live website build contains pre-launch subscription copy");
  }
} else if (/freePlanTitle|proPlanTitle|faqNineQ|support\.subscriptionTitle/.test(renderedHome + renderedSupport)) {
  failures.push("pre-launch website build contains live subscription claims");
}

if (failures.length) {
  console.error("Website verification failed:\n" + failures.map((failure) => `- ${failure}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Editio website built and verified: ${outputDir}`);
  console.log(`${htmlFiles.length} routes, ${publicEntries.length} public entries, TR/EN translations validated.`);
  console.log(`MONETIZATION_LIVE=${monetizationLive}`);
}
