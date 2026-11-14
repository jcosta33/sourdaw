import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
const req = createRequire(import.meta.url);
const root = dirname(req.resolve('@tanstack/router-plugin/package.json'));
const pluginRequire = createRequire(root + '/package.json');
const babel = await import(pathToFileURL(pluginRequire.resolve('@babel/core')).href);
const { getUniqueProgramIdentifier } = await import(pathToFileURL(join(root, 'dist/esm/core/utils.js')).href);
let names = [];
babel.transformSync('const anchor = 1; function inner(anchor2) { return anchor2 }; console.log(anchor3);', {
    configFile: false,
    babelrc: false,
    plugins: [
        () => ({
            visitor: {
                Program(path) {
                    names.push(
                        getUniqueProgramIdentifier(path, 'anchor').name,
                        getUniqueProgramIdentifier(path, 'anchor').name,
                        getUniqueProgramIdentifier(path, 'free').name,
                        getUniqueProgramIdentifier(path, 'free').name
                    );
                },
            },
        }),
    ],
});
assert.deepEqual(names, ['anchor4', 'anchor5', 'free', 'free2']);
console.log('PASS shadow, binding, global and successive reservations', JSON.stringify(names));
const trace = (
    await import(
        pathToFileURL(
            pluginRequire.resolve('@jridgewell/trace-mapping', { paths: [pluginRequire.resolve('@babel/core')] })
        ).href
    )
).default;
for (const f of ['dist/esm/core/utils.js', 'dist/cjs/core/utils.cjs']) {
    let text = await readFile(join(root, f), 'utf8');
    let map = JSON.parse(await readFile(join(root, f + '.map'), 'utf8'));
    let idx = text.indexOf('programScope.referencesSet.add(name)');
    assert(idx >= 0);
    let before = text.slice(0, idx),
        line = before.split('\n').length,
        column = before.length - (before.lastIndexOf('\n') + 1);
    let loc = trace.originalPositionFor(new trace.TraceMap(map), { line, column });
    assert.match(loc.source, /src\/core\/utils\.ts$/);
    assert(map.sourcesContent[0].includes('programScope.referencesSet.add(name)'));
    let source = map.sourcesContent[0].split('\n');
    assert(source[loc.line - 1].includes('programScope.referencesSet.add(name)'));
    console.log('PASS composed map', f, JSON.stringify(loc));
}
