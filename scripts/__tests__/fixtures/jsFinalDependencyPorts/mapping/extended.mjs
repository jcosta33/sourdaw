import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const owner = createRequire(process.env.GENERATOR_PACKAGE);
const { parse } = owner('@babel/parser');
const { default: generate } = owner('@babel/generator');
const sources = { 'a.js': '// first 🎹\nconst alpha = 1;\n', 'b.js': '/* second */\nconst beta = alpha + 2;\n' };
const ast = parse(sources['a.js'], { sourceFilename: 'a.js' });
ast.program.body.push(...parse(sources['b.js'], { sourceFilename: 'b.js' }).program.body);
const orders = [
    ['map', 'decodedMap', 'rawMappings'],
    ['map', 'rawMappings', 'decodedMap'],
    ['decodedMap', 'map', 'rawMappings'],
    ['decodedMap', 'rawMappings', 'map'],
    ['rawMappings', 'map', 'decodedMap'],
    ['rawMappings', 'decodedMap', 'map'],
];
const outputs = [];
for (const order of orders) {
    const result = generate(
        ast,
        { sourceMaps: true, sourceMapRanges: true, sourceRoot: '/src', comments: true },
        sources
    );
    let output = { code: result.code };
    for (const key of [...order, ...order]) {
        const value = JSON.parse(JSON.stringify(result[key]));
        if (key in output) assert.deepEqual(value, output[key]);
        output[key] = value;
    }
    assert.match(output.code, /first 🎹/);
    assert.match(output.code, /second/);
    assert.deepEqual(output.map.sourcesContent, Object.values(sources));
    assert.equal(output.map.sourceRoot, '/src');
    assert.ok(output.decodedMap.rangeMappings?.some((line) => line.length));
    outputs.push(output);
}
for (const item of outputs) assert.deepEqual(item, outputs[0]);
if (process.argv[2] === 'capture') writeFileSync('extended.json', JSON.stringify(outputs[0], null, 2) + '\n');
else assert.deepEqual(outputs[0], JSON.parse(readFileSync(new URL('./extended.json', import.meta.url))));
console.log('six getter orders and repeat, multi-source content, comments, sourceRoot and ranges');
