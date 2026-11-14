'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
if (!process.env.PACKAGING_REQUIRE_FROM)
    throw new Error('PACKAGING_REQUIRE_FROM must name the integrated lane package.json');
const laneRequire = require('./installed-require.cjs').packageRequire;
const support = process.env.PACKAGING_SOURCE_MAP_SUPPORT_ROOT
    ? require(path.join(process.env.PACKAGING_SOURCE_MAP_SUPPORT_ROOT, 'source-map-support.js'))
    : laneRequire('source-map-support');
const variant = process.argv[2];
if (variant === 'retrieval-error') {
    const error = new Error('expected fixture retrieval failure');
    support.install({
        environment: 'node',
        handleUncaughtExceptions: false,
        overrideRetrieveSourceMap: true,
        retrieveSourceMap() {
            throw error;
        },
    });
    let matched = false;
    try {
        support.mapSourcePosition({
            source: '/virtual/retrieval.js',
            line: 1,
            column: 0,
        });
    } catch (caught) {
        matched = caught === error;
    }
    process.stdout.write('STACK_FIXTURE:' + JSON.stringify({ retrievalFailurePreserved: matched }) + '\n');
    process.exit(matched ? 0 : 1);
}
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'packaging-stack-'));
const generated = path.join(directory, 'generated.js');
const originalName = 'original Ω.ts';
const originalLines = Array.from({ length: 40 }, (_, index) => '// original line ' + (index + 1));
originalLines.push('      throw new Error("fixture failure");');
const baseMap = {
    version: 3,
    file: 'generated.js',
    sourceRoot: 'src',
    sources: [originalName],
    names: ['mappedFixture'],
    mappings: 'AAwCMA',
    sourcesContent: [originalLines.join('\n')],
};
let map = baseMap;
let source = 'function generatedFixture(){throw new Error("fixture failure")} generatedFixture();';
if (variant === 'indexed') {
    map = {
        version: 3,
        sections: [{ offset: { line: 4, column: 2 }, map: baseMap }],
    };
    source = '\n\n\n\n  ' + source;
}
if (variant === 'unmapped') map = { ...baseMap, mappings: ';AAAA' };
if (variant === 'inline')
    source +=
        '\n//# sourceMappingURL=data:application/json;base64,' + Buffer.from(JSON.stringify(map)).toString('base64');
else if (variant !== 'missing') {
    fs.writeFileSync(generated + '.map', JSON.stringify(map));
    source += '\n//# sourceMappingURL=generated.js.map';
}
fs.writeFileSync(generated, source);
support.install({ environment: 'node', handleUncaughtExceptions: false });
let result;
try {
    vm.runInThisContext(source, { filename: generated });
} catch (error) {
    result = {
        stack: error.stack,
        source: support.getErrorSource(error),
        direct: support.mapSourcePosition({
            source: generated,
            line: variant === 'indexed' ? 5 : 1,
            column: variant === 'indexed' ? 2 : 0,
        }),
        generated,
        expectedOriginal: path.join(directory, 'src', originalName),
    };
}
fs.rmSync(directory, { recursive: true, force: true });
if (!result) throw new Error('fixture did not throw');
process.stdout.write('STACK_FIXTURE:' + JSON.stringify(result) + '\n');
