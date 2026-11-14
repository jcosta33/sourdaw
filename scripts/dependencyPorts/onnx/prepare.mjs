import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, symlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageRoot, requireGraph } from '../installed.mjs';

const [repository, destination] = process.argv.slice(2);
if (!repository || !destination || process.argv.length !== 4)
    throw new Error('Usage: prepare.mjs <installed-repository> <new-private-reproduction-root>');
const reproduction = resolve(destination);
const capsule = join(reproduction, 'onnx-protobuf-runtime/capsule');
if (existsSync(reproduction)) throw new Error('Refusing an existing capsule');
const directory = dirname(fileURLToPath(import.meta.url));
const installed = requireGraph(repository);
const web = installed.root('onnxruntime-web');
const requireWeb = createRequire(join(web, 'package.json'));
const pins = JSON.parse(readFileSync(join(directory, 'protobuf-port-inputs.json'), 'utf8'));
function copyPackage(source, target) {
    cpSync(source, target, {
        recursive: true,
        filter: (path) => !relative(source, path).split(sep).includes('node_modules') && !path.endsWith('.wasm'),
    });
}
mkdirSync(join(capsule, 'js'), { recursive: true });
copyPackage(web, join(capsule, 'js/web'));
copyPackage(packageRoot('onnxruntime-common', requireWeb), join(capsule, 'js/common'));
for (const name of ['package.json', 'tsconfig.json', 'tsconfig.tools.json'])
    cpSync(join(directory, name), join(capsule, 'js', name));
mkdirSync(join(capsule, 'js/web/script'), { recursive: true });
cpSync(join(directory, 'build.ts.txt'), join(capsule, 'js/web/script/build.ts'));
cpSync(join(directory, 'protobuf-port-inputs.json'), join(capsule, 'js/web/script/protobuf-port-inputs.json'));
const modules = join(capsule, 'js/web/node_modules');
mkdirSync(modules, { recursive: true });
for (const name of ['protobufjs', 'long']) {
    const source = packageRoot(name, requireWeb);
    assert.equal(JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')).version, pins[name].version);
    for (const input of pins[name].files) {
        assert.equal(
            createHash('sha256')
                .update(readFileSync(join(source, input.path)))
                .digest('hex'),
            input.sha256,
            `${name}/${input.path}`
        );
    }
    // A symlink to protobuf resolves Long outside the capsule and changes int64 encoding.
    if (name === 'protobufjs') copyPackage(source, join(modules, name));
    else {
        const target = join(reproduction, 'onnx-protobuf-ports/sources/long@5.3.2');
        copyPackage(source, target);
        symlinkSync(target, join(modules, name), 'junction');
    }
}
for (const name of ['flatbuffers', 'guid-typescript', 'platform']) {
    const source = packageRoot(name, requireWeb);
    const version = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')).version;
    const expected = { flatbuffers: '25.9.23', 'guid-typescript': '1.0.9', platform: '1.3.6' };
    assert.equal(version, expected[name]);
    const target = join(
        reproduction,
        'onnx-protobuf-runtime/project/node_modules/.pnpm',
        `${name}@${version}`,
        'node_modules',
        name
    );
    copyPackage(source, target);
    symlinkSync(target, join(modules, name), 'junction');
}
symlinkSync(join(capsule, 'js/common'), join(modules, 'onnxruntime-common'), 'junction');
console.log(`Prepared authenticated private ONNX producer capsule: ${capsule}`);
