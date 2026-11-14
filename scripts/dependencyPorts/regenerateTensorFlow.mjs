import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
const [ownedLane, privatePackage, kind] = process.argv.slice(2);
if (!ownedLane || !privatePackage || !['core', 'umbrella'].includes(kind))
    throw new Error('Expected owned lane, private patched package, core|umbrella');
const require = createRequire(join(resolve(ownedLane), 'package.json'));
const { transformSync, version } = require('esbuild');
if (version !== '0.28.2') throw new Error('Expected actual esbuild0.28.2 producer');
const prefix = kind === 'core' ? 'tf-core' : 'tf';
const variants = [
    ['.js', '.min.js'],
    ['.es2017.js', '.es2017.min.js'],
    ['.fesm.js', '.fesm.min.js'],
];
for (const [sourceSuffix, targetSuffix] of variants) {
    const source = join(resolve(privatePackage), 'dist', prefix + sourceSuffix);
    const target = join(resolve(privatePackage), 'dist', prefix + targetSuffix);
    const { code } = transformSync(readFileSync(source, 'utf8'), {
        loader: 'js',
        target: 'es2017',
        minify: true,
        legalComments: 'inline',
        sourcemap: false,
        sourcefile: prefix + sourceSuffix,
    });
    writeFileSync(target, code);
    if (existsSync(target + '.map')) unlinkSync(target + '.map');
}
// Published miniprogram bytes originally equal the generic UMD minified build.
// We preserve that identity; supported acceptance remains Node26 and Chromium.
const mini = join(resolve(privatePackage), 'dist/miniprogram/index.js');
writeFileSync(mini, readFileSync(join(resolve(privatePackage), 'dist', prefix + '.min.js')));
if (existsSync(mini + '.map')) unlinkSync(mini + '.map');
