#!/usr/bin/env node
/**
 * `pnpm wasm:verify` — deterministic freshness gate for the generated Rust→WASM
 * artifacts (WB-1). Rebuild-and-diff is not byte-reproducible across machines
 * (wasm-opt is bundled per wasm-pack build and not independently pinnable), so
 * this gate uses the fingerprint manifest written by `gen-wasm-manifest.ts`:
 *
 *  1. Toolchain pin — wasm-pack / wasm-opt are checked against pinned constants,
 *     wasm-bindgen against the version resolved in `Cargo.lock`, and the rust
 *     channel against `rust-toolchain.toml`; each crate's `Cargo.toml` must pin
 *     wasm-bindgen exactly to the Cargo.lock version (WB-8).
 *  2. Schema pairing — the `.js` glue and the `_bg.wasm` binary of each package
 *     must share one wasm-bindgen schema id (the #657 / WB-2 drift signature).
 *  3. Source freshness — the crate source closure (the crate and its transitive
 *     path-dependency crates, the workspace-root `Cargo.toml`, and the crate's
 *     resolved-dependency Cargo.lock entries) hash must match the manifest; a
 *     Rust or dependency edit merged without regenerating artifacts fails here.
 *  4. Artifact integrity — every committed artifact must match its recorded
 *     hash; a hand-edited or half-regenerated artifact fails here.
 *  5. Stray-binary guard — no `_bg.wasm` may live anywhere under the src worklet
 *     glue tree (permanently closes the WB-2 twin).
 *  6. Declaration provenance — every generated `.d.ts` carries the crate-source
 *     hash it was produced from; a stamp that no longer matches the live crate
 *     hash means the declaration went stale while the crate (and its `.js`/
 *     `.wasm`) regenerated — the WB-4 / #732 blind spot that byte integrity
 *     alone cannot see, since the freshly written manifest records the stale
 *     `.d.ts` hash without complaint. This is a provenance check, not a content
 *     proof: it attests the crate source is unchanged since the `.d.ts` was
 *     generated, not that the file's body matches the bindings (only
 *     regeneration proves that) — a hand-forged stamp over a stale body plus a
 *     rebuilt manifest still passes.
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

    // Constants with no independent in-repo source to verify against.
    if (recorded.wasmPack !== pinned.wasmPack) {
        fail(`toolchain.wasmPack: manifest records "${recorded.wasmPack}" but the pin is "${pinned.wasmPack}"`);
    }
    if (recorded.wasmOpt !== pinned.wasmOpt) {
        fail(`toolchain.wasmOpt: manifest records "${recorded.wasmOpt}" but the pin is "${pinned.wasmOpt}"`);
    }

    // Independent sources: Cargo.lock for wasm-bindgen, rust-toolchain.toml for the channel.
    const lockWasmBindgen = wasmArtifacts.wasmBindgenLockVersion();
    if (recorded.wasmBindgen !== lockWasmBindgen) {
        fail(
            `toolchain.wasmBindgen: manifest records "${recorded.wasmBindgen}" but Cargo.lock resolves "${lockWasmBindgen}"`
        );
    }
    const channel = wasmArtifacts.rustToolchainChannel();
    if (recorded.rustToolchain !== channel) {
        fail(
            `toolchain.rustToolchain: manifest records "${recorded.rustToolchain}" but rust-toolchain.toml pins "${channel}"`
        );
    }

    // Each wasm crate must pin wasm-bindgen exactly to the Cargo.lock version.
    const crateWasmBindgen = /wasm-bindgen\s*=\s*"([^"]+)"/;
    const expected = `=${lockWasmBindgen}`;
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
                        `(glue/binary drift — regenerate with \`pnpm ${spec.buildScript} && pnpm wasm:manifest\`)`
                );
            }
        }

        // Source freshness: crate edited without regenerating artifacts.
        const currentSourceHash = wasmArtifacts.hashCrateClosure(spec.crateDir);
        if (currentSourceHash !== recorded.crateSourceHash) {
            fail(
                `${spec.crateDir}: source hash ${currentSourceHash} != manifest ${recorded.crateSourceHash} — ` +
                    `crate changed — run \`pnpm ${spec.buildScript} && pnpm wasm:manifest\``
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

function checkDeclarations(): void {
    for (const spec of wasmArtifacts.packages) {
        if (!spec.declarations) {
            continue;
        }
        const crateSourceHash = wasmArtifacts.hashCrateClosure(spec.crateDir);
        for (const relPath of [spec.declarations.public, spec.declarations.publicBg, spec.declarations.src]) {
            const stamp = safeDeclarationStamp(relPath);
            if (stamp === null) {
                fail(
                    `${relPath}: no crate-source provenance stamp (missing or unstamped) — ` +
                        `regenerate with \`pnpm ${spec.buildScript} && pnpm wasm:manifest\``
                );
                continue;
            }
            if (stamp !== crateSourceHash) {
                fail(
                    `${relPath}: declaration crate-source stamp ${stamp} != crate ${crateSourceHash} — ` +
                        `the .d.ts is stale for the current ${spec.crateDir} (WB-4 / #732 blind spot); ` +
                        `regenerate with \`pnpm ${spec.buildScript} && pnpm wasm:manifest\``
                );
            }
        }
    }
}

function checkNoStrayBinaries(): void {
    collectStrayBinaries('src/modules/AudioEngine/wasm');
}

function collectStrayBinaries(relDir: string): void {
    for (const entry of readdirSync(wasmArtifacts.absolute(relDir), { withFileTypes: true })) {
        const relPath = `${relDir}/${entry.name}`;
        if (entry.isDirectory()) {
            collectStrayBinaries(relPath);
            continue;
        }
        if (entry.name.endsWith('_bg.wasm')) {
            fail(
                `${relPath}: no _bg.wasm may be tracked under the worklet glue tree — ` +
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

function safeDeclarationStamp(relPath: string): string | null {
    try {
        return wasmArtifacts.extractDeclarationStamp(relPath);
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
        console.error('  Run `pnpm wasm:all` (or `node scripts/gen-wasm-manifest.ts`).');
        process.exit(1);
    }

    checkToolchain(manifest);
    checkPackages(manifest);
    checkDeclarations();
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
        `✓ wasm:verify — ${wasmArtifacts.packages.length} packages fresh (schema, source, artifacts, declarations, toolchain).`
    );
}

run();
