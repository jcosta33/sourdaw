#!/usr/bin/env node
/**
 * `pnpm wasm:verify` — deterministic freshness gate for the generated Rust→WASM
 * artifacts (WB-1). Rebuild-and-diff is not byte-reproducible across machines
 * (wasm-opt is bundled per wasm-pack build and not independently pinnable), so
 * this gate uses the fingerprint manifest written by `gen-wasm-manifest.ts`:
 *
 *  1. Toolchain pin — the manifest records the pinned wasm-pack / wasm-bindgen /
 *     rust / wasm-opt; each crate's `Cargo.toml` must pin the exact wasm-bindgen
 *     version (WB-8).
 *  2. Schema pairing — the `.js` glue and the `_bg.wasm` binary of each package
 *     must share one wasm-bindgen schema id (the #657 / WB-2 drift signature).
 *  3. Source freshness — the crate `src/**` + `Cargo.toml` hash must match the
 *     manifest; a Rust edit merged without regenerating artifacts fails here.
 *  4. Artifact integrity — every committed artifact must match its recorded
 *     hash; a hand-edited or half-regenerated artifact fails here.
 *  5. Stray-binary guard — no `_bg.wasm` may live under the src worklet glue
 *     directory (permanently closes the WB-2 twin).
 *
 * Exit code 0 = clean, 1 = drift (with a per-check report). Runnable locally and
 * by agents as part of verification; no rebuild, no network, no toolchain calls.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { wasmArtifacts, type WasmManifest } from './wasm-artifacts.ts';

const failures: string[] = [];

function fail(message: string): void {
    failures.push(message);
}

function readCargoToml(crateDir: string): string {
    return readFileSync(wasmArtifacts.absolute(join(crateDir, 'Cargo.toml')), 'utf8');
}

function checkToolchain(manifest: WasmManifest): void {
    const pinned = wasmArtifacts.pinnedToolchain;
    const recorded = manifest.toolchain;
    const fields = ['wasmPack', 'wasmBindgen', 'rustToolchain', 'wasmOpt'] as const;
    for (const field of fields) {
        if (recorded[field] !== pinned[field]) {
            fail(`toolchain.${field}: manifest records "${recorded[field]}" but the pin is "${pinned[field]}"`);
        }
    }

    const crateWasmBindgen = /wasm-bindgen\s*=\s*"([^"]+)"/;
    const expected = `=${pinned.wasmBindgen}`;
    for (const spec of wasmArtifacts.packages) {
        const cargoToml = readCargoToml(spec.crateDir);
        const match = crateWasmBindgen.exec(cargoToml);
        if (!match) {
            fail(`${spec.crateDir}/Cargo.toml: no wasm-bindgen dependency declaration found`);
            continue;
        }
        if (match[1] !== expected) {
            fail(
                `${spec.crateDir}/Cargo.toml: wasm-bindgen is "${match[1]}" but must be pinned exactly to "${expected}"`
            );
        }
    }
}

function checkPackages(manifest: WasmManifest): void {
    for (const spec of wasmArtifacts.packages) {
        const recorded = manifest.packages[spec.id];
        if (!recorded) {
            fail(`package "${spec.id}" is missing from the manifest`);
            continue;
        }

        // Schema pairing: every glue/binary must carry the manifest's schema id.
        for (const source of spec.schemaSources) {
            const actual = safeSchema(source);
            if (actual === null) {
                continue;
            }
            if (actual !== recorded.schemaHash) {
                fail(
                    `${source}: wasm-bindgen schema "${actual}" != package "${spec.id}" schema "${recorded.schemaHash}" ` +
                        `(glue/binary drift — regenerate with \`pnpm wasm:${spec.id}\`)`
                );
            }
        }

        // Source freshness: crate edited without regenerating artifacts.
        const currentSourceHash = wasmArtifacts.hashCrateSources(spec.crateDir);
        if (currentSourceHash !== recorded.crateSourceHash) {
            fail(
                `${spec.crateDir}: source hash ${currentSourceHash} != manifest ${recorded.crateSourceHash} — ` +
                    `crate changed without a matching \`pnpm wasm:${spec.id}\` + manifest regeneration`
            );
        }

        // Artifact integrity: hand-edited or half-regenerated committed artifact.
        for (const artifact of spec.artifacts) {
            const expectedHash = recorded.artifacts[artifact];
            if (!expectedHash) {
                fail(`${artifact}: not recorded in the manifest for package "${spec.id}"`);
                continue;
            }
            const actualHash = safeHash(artifact);
            if (actualHash === null) {
                fail(`${artifact}: recorded in the manifest but missing on disk`);
                continue;
            }
            if (actualHash !== expectedHash) {
                fail(`${artifact}: content hash ${actualHash} != manifest ${expectedHash} (artifact drift)`);
            }
        }
    }
}

function checkNoStrayBinaries(): void {
    const glueDir = 'src/modules/AudioEngine/wasm';
    for (const entry of readdirSync(wasmArtifacts.absolute(glueDir))) {
        if (entry.endsWith('_bg.wasm')) {
            fail(
                `${glueDir}/${entry}: no _bg.wasm may be tracked beside the worklet glue — ` +
                    `the binary is served from public/wasm/ (WB-2)`
            );
        }
    }
}

function safeSchema(relPath: string): string | null {
    try {
        return wasmArtifacts.extractSchemaHash(relPath);
    } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
        return null;
    }
}

function safeHash(relPath: string): string | null {
    try {
        return wasmArtifacts.hashFile(relPath);
    } catch {
        return null;
    }
}

function run(): void {
    let manifest: WasmManifest;
    try {
        manifest = wasmArtifacts.readManifest();
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.error(`✗ wasm:verify — cannot read ${wasmArtifacts.manifestPath}: ${detail}`);
        console.error('  Run `pnpm wasm:all` (or `node --experimental-strip-types scripts/gen-wasm-manifest.ts`).');
        process.exit(1);
    }

    checkToolchain(manifest);
    checkPackages(manifest);
    checkNoStrayBinaries();

    if (failures.length > 0) {
        console.error(`✗ wasm:verify — ${failures.length} drift issue(s):`);
        for (const message of failures) {
            console.error(`  • ${message}`);
        }
        console.error('\nRegenerate the affected package(s) with `pnpm wasm:all`, then commit the updated artifacts.');
        process.exit(1);
    }

    console.log(
        `✓ wasm:verify — ${wasmArtifacts.packages.length} packages fresh (schema, source, artifacts, toolchain).`
    );
}

run();
