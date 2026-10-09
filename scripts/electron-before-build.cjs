// electron-builder hook. The desktop app has no node_modules of its own: the
// server, with the modules it needs, ships next to it as a resource
// (dist/server, see scripts/bundle-server.mjs). Returning false tells
// electron-builder not to collect or rebuild the project's dependencies.
module.exports = async () => false;
