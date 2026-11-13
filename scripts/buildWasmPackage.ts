import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { runVerifiedWasmBuild, wasmGenerationEnvironment } from './binaryenBuild.ts';
import { wasmArtifacts } from './wasm-artifacts.ts';

const id = process.argv[2];
const spec = wasmArtifacts.packages.find((candidate) => candidate.id === id);
if (!spec || process.argv.length !== 3) {
    throw new Error('Usage: buildWasmPackage.ts <WASM package id>');
}
await runVerifiedWasmBuild({
    root: wasmArtifacts.repoRoot,
    packageId: spec.id,
    crateDir: spec.crateDir,
    allowedGeneratedPaths: [...wasmArtifacts.packages.flatMap((pkg) => pkg.artifacts), 'public/wasm/manifest.json'],
    sourceHash: () => wasmArtifacts.hashCrateClosure(spec.crateDir),
    artifacts: () => Object.fromEntries(spec.artifacts.map((path) => [path, wasmArtifacts.hashFile(path)])),
    finalize: () => {
        rmSync(join(wasmArtifacts.repoRoot, 'public', 'wasm', spec.id, '.gitignore'), { force: true });
        execFileSync(process.execPath, ['scripts/markWasmPackageInternal.ts', spec.id], {
            cwd: wasmArtifacts.repoRoot,
            stdio: 'inherit',
            env: wasmGenerationEnvironment(),
        });
        if (spec.id !== 'daw-wasm-decoder') {
            execFileSync(process.execPath, [`scripts/gen-${spec.id}-worklet.ts`], {
                cwd: wasmArtifacts.repoRoot,
                stdio: 'inherit',
                env: wasmGenerationEnvironment(),
            });
        }
    },
});
if (spec.id === 'daw-wasm-decoder') {
    execFileSync(process.execPath, ['scripts/gen-wasm-manifest.ts', '--package', spec.id], {
        cwd: wasmArtifacts.repoRoot,
        stdio: 'inherit',
        env: wasmGenerationEnvironment(),
    });
}
