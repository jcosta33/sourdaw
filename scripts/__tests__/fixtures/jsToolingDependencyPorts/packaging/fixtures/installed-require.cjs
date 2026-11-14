'use strict';
const { createRequire } = require('node:module');
if (!process.env.PACKAGING_REQUIRE_FROM)
    throw new Error('PACKAGING_REQUIRE_FROM must name the integrated lane package.json');
const rootRequire = createRequire(process.env.PACKAGING_REQUIRE_FROM);
const electronRequire = createRequire(rootRequire.resolve('electron-builder/package.json'));
const appRequire = createRequire(electronRequire.resolve('app-builder-lib/package.json'));
const utilRequire = createRequire(appRequire.resolve('builder-util/package.json'));
function owner(request) {
    if (request === 'electron-builder' || request.startsWith('electron-builder/')) return rootRequire;
    if (request === 'app-builder-lib' || request.startsWith('app-builder-lib/')) return electronRequire;
    if (request === 'builder-util' || request.startsWith('builder-util/')) return appRequire;
    if (request === 'electron-publish' || request.startsWith('electron-publish/')) return appRequire;
    if (request === 'source-map-support' || request.startsWith('source-map-support/')) return utilRequire;
    throw new Error('Fixture requires an explicit package owner for ' + request);
}
function packageRequire(request) {
    return owner(request)(request);
}
packageRequire.resolve = (request) => owner(request).resolve(request);
module.exports = { packageRequire };
