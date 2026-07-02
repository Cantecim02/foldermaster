const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// pdfjs/canvas packages publish optional native builds for many platforms.
// Metro's fallback watcher can try to watch missing optional package folders on
// Windows, so keep non-Windows @napi-rs canvas builds out of the file map.
config.resolver.blockList = [/node_modules[\\/]@napi-rs[\\/]canvas-(?!win32-x64-msvc).*/];

module.exports = config;
