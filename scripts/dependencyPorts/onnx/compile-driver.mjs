import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
const capsule = resolve(process.argv[2] ?? '');
if (process.argv.length !== 3) throw new Error('Usage: compile-driver.mjs <private-capsule>');
const requireProducer = createRequire(join(capsule, 'js/package.json'));
const esbuild = requireProducer('esbuild');
if (esbuild.version !== '0.28.2') throw new Error('Wrong actual esbuild producer');
const source = join(capsule, 'js/web/script/build.ts');
const result = esbuild.transformSync(readFileSync(source, 'utf8'), {
    loader: 'ts',
    format: 'cjs',
    target: 'node26',
    sourcemap: false,
    sourcefile: source,
});
writeFileSync(join(capsule, 'js/web/script/build.js'), result.code);
