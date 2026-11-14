import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageRoot, requireGraph } from '../../../dependencyPorts/installed.mjs';

const repository = resolve(process.argv[2]);
const fixtures = dirname(fileURLToPath(import.meta.url));
const installed = requireGraph(repository);
const context = mkdtempSync(join(repository, 'node_modules/.cache-audio-port-types-'));
try {
    mkdirSync(join(context, 'node_modules/@types'), { recursive: true });
    for (const name of ['long', 'seedrandom', 'protobufjs'])
        symlinkSync(installed.root(name), join(context, 'node_modules', name), 'junction');
    mkdirSync(join(context, 'node_modules/@tensorflow'), { recursive: true });
    for (const name of ['tfjs-data', 'tfjs-backend-webgl'])
        symlinkSync(installed.root('@tensorflow/' + name), join(context, 'node_modules/@tensorflow', name), 'junction');
    const core = createRequire(join(installed.root('@tensorflow/tfjs-core'), 'package.json'));
    symlinkSync(packageRoot('@types/seedrandom', core), join(context, 'node_modules/@types/seedrandom'), 'junction');
    const ort = installed.root('onnxruntime-web');
    copyFileSync(join(ort, 'lib/onnxjs/ort-schema/protobuf/onnx.d.ts'), join(context, 'onnx.d.ts'));
    for (const name of [
        'gpu-types.ts',
        'gpu-negative.ts',
        'worker-types.ts',
        'native-types.fixture.ts',
        'public-types.fixture.ts',
        'types.fixture.ts',
    ]) {
        copyFileSync(join(fixtures, name + '.txt'), join(context, name));
    }
    const compiler = join(
        dirname(createRequire(join(repository, 'package.json')).resolve('typescript/package.json')),
        'bin/tsc'
    );
    for (const [lib, files] of [
        [
            'esnext,dom,dom.iterable',
            [
                'gpu-types.ts',
                'gpu-negative.ts',
                'native-types.fixture.ts',
                'public-types.fixture.ts',
                'types.fixture.ts',
            ],
        ],
        ['esnext,webworker', ['worker-types.ts', 'gpu-negative.ts']],
    ]) {
        const result = spawnSync(
            process.execPath,
            [
                compiler,
                '--ignoreConfig',
                '--noEmit',
                '--strict',
                '--skipLibCheck',
                'false',
                '--lib',
                lib,
                '--module',
                'esnext',
                '--moduleResolution',
                'bundler',
                '--esModuleInterop',
                '--types',
                '@webgpu/types',
                ...files.map((name) => join(context, name)),
            ],
            { cwd: context, encoding: 'utf8', timeout: 30_000 }
        );
        assert.equal(result.status, 0, result.stdout + result.stderr);
    }
    console.log('DOM and Worker dependency type contracts passed');
} finally {
    rmSync(context, { recursive: true, force: true });
}
