import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireGraph } from '../../../dependencyPorts/installed.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
const installed = requireGraph(process.argv[2]);
const root = installed.root('onnxruntime-web');
const context = mkdtempSync(join(tmpdir(), 'onnx-native-wire-'));
try {
    copyFileSync(join(root, 'lib/onnxjs/ort-schema/protobuf/onnx.js'), join(context, 'onnx.cjs'));
    mkdirSync(join(context, 'node_modules'));
    symlinkSync(installed.root('protobufjs'), join(context, 'node_modules/protobufjs'), 'junction');
    writeFileSync(join(context, 'package.json'), '{"type":"commonjs"}');
    const capture = join(context, 'wire.json');
    for (const args of [
        ['run-wire.cjs', join(context, 'onnx.cjs'), capture],
        ['compare-wire.mjs', join(directory, 'onnx-publisher-wire.json'), capture],
        ['exports.fixture.mjs', root],
    ]) {
        const run = spawnSync(process.execPath, [join(directory, args[0]), ...args.slice(1)], { encoding: 'utf8' });
        assert.equal(run.status, 0, run.stdout + run.stderr);
    }
    console.log('ONNX contracts passed');
} finally {
    rmSync(context, { recursive: true, force: true });
}
