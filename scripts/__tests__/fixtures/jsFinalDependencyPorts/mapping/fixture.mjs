// Frozen outputs were captured from the authenticated original generator/beta mapper.
// node generator-fixture.mjs capture baseline.json
// node generator-fixture.mjs compare baseline.json
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const owner = createRequire(process.env.GENERATOR_PACKAGE);
const { parse } = owner('@babel/parser');
const { default: generate } = owner('@babel/generator');
const { decodeRangeMappings } = owner('@jridgewell/sourcemap-codec');
const { TraceMap, originalPositionFor } = owner('@jridgewell/trace-mapping');
const { GenMapping, addMapping, setSourceContent, toEncodedMap } = owner('@jridgewell/gen-mapping');

const [mode, snapshot] = process.argv.slice(2);
assert.ok(['capture', 'compare'].includes(mode) && snapshot);
const source = 'const marker = "🎹"; const value = marker + 1;\n';
const ast = parse(source, { sourceType: 'module', sourceFilename: 'input.js' });
function render(options) {
    const result = generate(ast, { sourceMaps: true, sourceFileName: 'input.js', ...options }, source);
    const map = result.map;
    const decoded = result.decodedMap;
    const raw = result.rawMappings;
    assert.equal(map.sourcesContent[0], source);
    assert.equal(map.sources[0], 'input.js');
    assert.ok(result.code.includes('🎹'));
    const index = result.code.indexOf('value');
    assert.ok(index >= 0);
    const prefix = result.code.slice(0, index).split('\n');
    const position = originalPositionFor(new TraceMap(map), { line: prefix.length, column: prefix.at(-1).length });
    assert.equal(position.source, 'input.js');
    assert.equal(position.line, 1);
    assert.equal(position.column, source.indexOf(options.sourceMapRanges ? 'const value' : 'value'));
    if (map.rangeMappings !== undefined)
        assert.deepEqual(decodeRangeMappings(map.rangeMappings), decoded.rangeMappings);
    return { code: result.code, map, decoded, raw };
}
const plain = render({ sourceMapRanges: false });
const ranges = render({ sourceMapRanges: true, retainLines: true });
// Fail baseline preparation if this fixture does not actually produce a range.
assert.ok(
    ranges.decoded.rangeMappings?.some((line) => line.length > 0),
    'fixture must emit at least one range'
);
const upstream = new GenMapping();
addMapping(upstream, { generated: { line: 1, column: 0 }, source: 'original.js', original: { line: 1, column: 0 } });
addMapping(upstream, {
    generated: { line: 1, column: source.indexOf('value') },
    source: 'original.js',
    original: { line: 1, column: 10 },
});
setSourceContent(upstream, 'original.js', '0123456789value');
const warnings = [];
const originalWarn = console.warn;
let composed;
try {
    console.warn = (message) => warnings.push(String(message));
    const result = generate(
        ast,
        { sourceMaps: true, sourceMapRanges: true, sourceFileName: 'input.js', inputSourceMap: toEncodedMap(upstream) },
        source
    );
    composed = { code: result.code, map: result.map, decoded: result.decodedMap, raw: result.rawMappings };
} finally {
    console.warn = originalWarn;
}
assert.ok(warnings.some((message) => message.includes('disabled source map ranges')));
assert.equal(composed.map.rangeMappings, undefined);
assert.deepEqual(composed.map.sourcesContent, ['0123456789value']);
assert.ok(composed.map.sources.some((name) => name.endsWith('original.js')));
const observed = { plain, ranges, composed, warnings };
if (mode === 'capture') writeFileSync(snapshot, JSON.stringify(observed, null, 2) + '\n');
else assert.deepEqual(JSON.parse(JSON.stringify(observed)), JSON.parse(readFileSync(snapshot, 'utf8')));
// Independent fixed codec witness, including a gap line and index deltas.
assert.deepEqual(decodeRangeMappings('AC;;B'), [[0, 2], [], [1]]);
