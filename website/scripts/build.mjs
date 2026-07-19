import { cp, mkdir, readFile, rm, stat } from "node:fs/promises";
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

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

for (const entry of publicEntries) {
  await cp(path.join(sourceDir, entry), path.join(outputDir, entry), { recursive: true });
}

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

if (failures.length) {
  console.error("Website verification failed:\n" + failures.map((failure) => `- ${failure}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Editio website built and verified: ${outputDir}`);
  console.log(`${htmlFiles.length} routes, ${publicEntries.length} public entries, TR/EN translations validated.`);
}
