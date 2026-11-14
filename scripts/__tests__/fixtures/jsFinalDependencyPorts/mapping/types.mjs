import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { installedGraph } from '../../../../dependencyPorts/jsToolingInstalled.mjs';
const graph = installedGraph(process.cwd()),
    root = mkdtempSync(join(process.cwd(), 'node_modules/.cache-mapping-types-'));
try {
    mkdirSync(join(root, 'node_modules/@babel'), { recursive: true });
    mkdirSync(join(root, 'node_modules/@types'), { recursive: true });
    for (const name of ['generator', 'parser'])
        symlinkSync(graph.packageRoot('@babel/' + name), join(root, 'node_modules/@babel', name), 'junction');
    symlinkSync(graph.packageRoot('jsesc'), join(root, 'node_modules/jsesc'), 'junction');
    symlinkSync(graph.packageRoot('@types/jsesc'), join(root, 'node_modules/@types/jsesc'), 'junction');
    writeFileSync(
        join(root, 'positive.mts'),
        `import generate, {type GeneratorOptions,type GeneratorResult}from'@babel/generator';import{parse}from'@babel/parser';import type{Opts}from'jsesc';const escape:Opts={quotes:'backtick',numbers:'hexadecimal',es6:true};const options:GeneratorOptions={sourceMaps:true,sourceMapRanges:true,jsescOption:escape};const result:GeneratorResult=generate(parse('let a=1'),options,'let a=1');const encoded:string|undefined=result.map?.rangeMappings;const decoded:number[][]|undefined=result.decodedMap?.rangeMappings;void[encoded,decoded];`
    );
    writeFileSync(
        join(root, 'negative.mts'),
        `import type{Opts}from'jsesc';const invalid:Opts={quotes:'curly'};void invalid;`
    );
    const args = [
        join(graph.packageRoot('typescript'), 'bin/tsc'),
        '--ignoreConfig',
        '--noEmit',
        '--strict',
        '--skipLibCheck',
        'false',
        '--module',
        'nodenext',
        '--target',
        'esnext',
        '--types',
        'node',
    ];
    for (const [file, status] of [
        ['positive.mts', 0],
        ['negative.mts', 1],
    ]) {
        const r = spawnSync(process.execPath, [...args, file], { cwd: root, encoding: 'utf8', timeout: 30000 });
        assert.ifError(r.error);
        assert.equal(r.status, status, r.stdout + r.stderr);
        if (status) assert.match(r.stdout, /curly.*not assignable/);
    }
    console.log('native mapping declarations accept ranges and reject invalid jsesc options');
} finally {
    rmSync(root, { recursive: true, force: true });
}
