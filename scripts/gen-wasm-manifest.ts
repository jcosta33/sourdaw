#!/usr/bin/env node
/**
 * Writes public/wasm/manifest.json — the fingerprint that pairs every committed
 * wasm artifact with its crate source and the pinned generation toolchain.
 *
 * Runs as the final step of `pnpm wasm:all`, immediately after the four
 * `wasm-pack` builds, so the manifest is stamped by the same toolchain that
 * produced the artifacts. `pnpm wasm:verify` later fails if the committed
 * artifacts, the crate sources, or the pins ever diverge from this record.
 *
 * The installed `wasm-pack` is asserted against the pin here: the manifest can
 * only be honestly stamped by the pinned CLI, which bundles the pinned
 * `wasm-opt` and drives the pinned `wasm-bindgen` schema version (WB-8).
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

import { wasmArtifacts } from './wasm-artifacts.ts';

function installedWasmPackVersion(): string {
    const raw = execFileSync('wasm-pack', ['--version'], { encoding: 'utf8' }).trim();
    // `wasm-pack 0.14.0` → `0.14.0`
    const match = /wasm-pack\s+(\S+)/.exec(raw);
    const version = match?.[1];
    if (version === undefined) {
        throw new Error(`Could not parse wasm-pack version from: ${raw}`);
    }
    return version;
}

const pinned = wasmArtifacts.pinnedToolchain;
const installed = installedWasmPackVersion();
if (installed !== pinned.wasmPack) {
    throw new Error(
        `wasm-pack ${installed} is installed but the manifest pin is ${pinned.wasmPack}. ` +
            `Regenerating with a different wasm-pack produces a different schema/binary — ` +
            `install wasm-pack ${pinned.wasmPack} (e.g. cargo binstall wasm-pack@${pinned.wasmPack}) and re-run.`
    );
}

const manifest = wasmArtifacts.buildManifest();
writeFileSync(wasmArtifacts.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`✓ Wrote ${wasmArtifacts.manifestPath} (${Object.keys(manifest.packages).length} packages)`);
