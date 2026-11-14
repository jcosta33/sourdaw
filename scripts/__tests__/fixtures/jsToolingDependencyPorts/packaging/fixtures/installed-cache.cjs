'use strict';
const { createRequire } = require('node:module');
const { dirname, join } = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
if (!process.env.CACHE_REQUIRE_FROM)
    throw new Error('CACHE_REQUIRE_FROM must name the integrated owned lane package.json');
const root = createRequire(process.env.CACHE_REQUIRE_FROM);
const eslint = createRequire(root.resolve('eslint'));
const fileEntry = createRequire(eslint.resolve('file-entry-cache'));
const flat = createRequire(fileEntry.resolve('flat-cache'));
const cacheable = createRequire(flat.resolve('cacheable'));
const memory = createRequire(cacheable.resolve('@cacheable/memory'));
const utils = createRequire(memory.resolve('@cacheable/utils'));
const owner = new Map([
    ['eslint', root],
    ['file-entry-cache', eslint],
    ['flat-cache', fileEntry],
    ['cacheable', flat],
    ['@cacheable/memory', cacheable],
    ['@cacheable/utils', memory],
    ['keyv', memory],
    ['hookified', memory],
    ['hashery', utils],
    ['qified', cacheable],
]);
function load(name) {
    const resolve = owner.get(name);
    if (!resolve) throw new Error('No fixture owner: ' + name);
    return resolve(name);
}
function packageRoot(name) {
    let current = dirname(owner.get(name).resolve(name));
    for (;;) {
        const file = join(current, 'package.json');
        if (fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).name === name) return current;
        const parent = dirname(current);
        if (parent === current) throw new Error('No package root: ' + name);
        current = parent;
    }
}
async function loadFormat(name, format) {
    return format === 'cjs'
        ? load(name)
        : import(
              pathToFileURL(
                  join(
                      packageRoot(name),
                      name === 'hookified'
                          ? 'dist/node/index.js'
                          : name === 'hashery'
                            ? 'dist/node/index.mjs'
                            : 'dist/index.mjs'
                  )
              ).href
          );
}
module.exports = { load, loadFormat, packageRoot, root };
