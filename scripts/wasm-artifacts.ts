#!/usr/bin/env node
/**
 * Shared fingerprint toolkit for the generated Rust→WASM artifacts.
 *
 * The wasm-bindgen "bindgen format" (schema) is unstable: the generated `.js`
 * glue and the paired `_bg.wasm` binary carry a matching 16-hex schema id and
 * MUST be regenerated together. A hand-committed pair produced from a different
 * crate revision or a different toolchain drifts silently — the class that fired
 * as #657 and left the mismatched `daw_dsp_bg.wasm` twin behind.
 *
 * This module is the single source of truth for:
 *  - which packages / crates / artifacts are fingerprinted,
 *  - the pinned generation toolchain (wasm-pack / wasm-bindgen / rust / wasm-opt),
 *  - hashing crate source and committed artifacts,
 *  - extracting the embedded wasm-bindgen schema id,
 *  - reading and validating the committed manifest.
 *
 * `gen-wasm-manifest.ts` writes the manifest during `pnpm wasm:all`;
 * `verify-wasm-artifacts.ts` (`pnpm wasm:verify`) reads it back and fails on any
 * drift between the committed artifacts, the crate sources, and the pins.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path to the repository root (this file lives in `<root>/scripts`). */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Committed manifest that pairs artifacts ⇄ crate source ⇄ toolchain. */
const manifestPath = join(repoRoot, 'public/wasm/manifest.json');

/**
 * Pinned generation toolchain (WB-8). Every field affects the produced bytes or
 * the wasm-bindgen schema version, so reproducibility requires all of them.
 * `wasm-opt` ships bundled inside the pinned `wasm-pack`, so it is pinned by
 * proxy rather than as a separate PATH binary.
 */
const pinnedToolchain = {
    wasmPack: '0.14.0',
    wasmBindgen: '0.2.126',
    rustToolchain: 'nightly-2026-04-14',
    wasmOpt: 'bundled-by-wasm-pack@0.14.0',
} as const;

export type WasmToolchain = {
    wasmPack: string;
    wasmBindgen: string;
    rustToolchain: string;
    wasmOpt: string;
};

export type WasmPackageSpec = {
    /** Package directory name under `public/wasm/`. */
    id: string;
    /** Crate directory, relative to the repo root. */
    crateDir: string;
    /**
     * Files that embed a wasm-bindgen schema id and must all agree. The glue
     * `.js` and the `_bg.wasm` binary of a coherent build share one id; a
     * mismatch is the #657 drift signature.
     */
    schemaSources: string[];
    /** Committed files fingerprinted for byte integrity, relative to the root. */
    artifacts: string[];
};

export type WasmPackageManifest = {
    crate: string;
    crateSourceHash: string;
    schemaHash: string;
    artifacts: Record<string, string>;
};

export type WasmManifest = {
    comment: string;
    toolchain: WasmToolchain;
    packages: Record<string, WasmPackageManifest>;
};

/**
 * The four wasm packages built by `pnpm wasm:all`. `daw-wasm-decoder` has no
 * worklet glue (built `--no-typescript`, no gen script), so it fingerprints only
 * its served pair.
 */
const wasmPackages: readonly WasmPackageSpec[] = [
    {
        id: 'daw-dsp',
        crateDir: 'crates/daw-dsp',
        schemaSources: [
            'public/wasm/daw-dsp/daw_dsp.js',
            'public/wasm/daw-dsp/daw_dsp_bg.wasm',
            'src/modules/AudioEngine/wasm/daw_dsp.js',
        ],
        artifacts: [
            'public/wasm/daw-dsp/daw_dsp.js',
            'public/wasm/daw-dsp/daw_dsp_bg.wasm',
            'public/wasm/daw-dsp/daw_dsp.d.ts',
            'public/wasm/daw-dsp/daw_dsp_bg.wasm.d.ts',
            'public/wasm/daw-dsp/package.json',
            'src/modules/AudioEngine/wasm/daw_dsp.js',
            'src/modules/AudioEngine/wasm/daw_dsp.d.ts',
        ],
    },
    {
        id: 'proof-chamber',
        crateDir: 'crates/proof-chamber',
        schemaSources: [
            'public/wasm/proof-chamber/proof_chamber.js',
            'public/wasm/proof-chamber/proof_chamber_bg.wasm',
            'src/modules/AudioEngine/wasm/proof_chamber.js',
        ],
        artifacts: [
            'public/wasm/proof-chamber/proof_chamber.js',
            'public/wasm/proof-chamber/proof_chamber_bg.wasm',
            'public/wasm/proof-chamber/proof_chamber.d.ts',
            'public/wasm/proof-chamber/proof_chamber_bg.wasm.d.ts',
            'public/wasm/proof-chamber/package.json',
            'src/modules/AudioEngine/wasm/proof_chamber.js',
            'src/modules/AudioEngine/wasm/proof_chamber.d.ts',
        ],
    },
    {
        id: 'scoring',
        crateDir: 'crates/scoring',
        schemaSources: [
            'public/wasm/scoring/scoring.js',
            'public/wasm/scoring/scoring_bg.wasm',
            'src/modules/AudioEngine/wasm/scoring.js',
        ],
        artifacts: [
            'public/wasm/scoring/scoring.js',
            'public/wasm/scoring/scoring_bg.wasm',
            'public/wasm/scoring/scoring.d.ts',
            'public/wasm/scoring/scoring_bg.wasm.d.ts',
            'public/wasm/scoring/package.json',
            'src/modules/AudioEngine/wasm/scoring.js',
            'src/modules/AudioEngine/wasm/scoring.d.ts',
        ],
    },
    {
        id: 'daw-wasm-decoder',
        crateDir: 'crates/daw-wasm-decoder',
        schemaSources: [
            'public/wasm/daw-wasm-decoder/daw_wasm_decoder.js',
            'public/wasm/daw-wasm-decoder/daw_wasm_decoder_bg.wasm',
        ],
        artifacts: [
            'public/wasm/daw-wasm-decoder/daw_wasm_decoder.js',
            'public/wasm/daw-wasm-decoder/daw_wasm_decoder_bg.wasm',
            'public/wasm/daw-wasm-decoder/package.json',
        ],
    },
];

/** The wasm-bindgen schema id is stamped next to `__wbindgen_throw_`. */
const schemaMarker = /__wbindgen_throw_([0-9a-f]{16})/;

function sha256(bytes: Buffer): string {
    return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function absolute(relPath: string): string {
    return join(repoRoot, relPath);
}

function hashFile(relPath: string): string {
    return sha256(readFileSync(absolute(relPath)));
}

function collectRustSources(dirAbs: string, acc: string[]): void {
    for (const entry of readdirSync(dirAbs)) {
        const entryAbs = join(dirAbs, entry);
        if (statSync(entryAbs).isDirectory()) {
            collectRustSources(entryAbs, acc);
            continue;
        }
        if (entry.endsWith('.rs')) {
            acc.push(entryAbs);
        }
    }
}

/**
 * Hash the files that determine the compiled cdylib: every `.rs` under the
 * crate `src/` tree plus its `Cargo.toml`. Excludes `tests/` and `benches/`,
 * which never reach the wasm output, so a test-only edit does not trip the gate.
 */
function hashCrateSources(crateDir: string): string {
    const files: string[] = [];
    collectRustSources(absolute(join(crateDir, 'src')), files);
    files.push(absolute(join(crateDir, 'Cargo.toml')));
    files.sort();

    const digest = createHash('sha256');
    for (const fileAbs of files) {
        const rel = fileAbs.slice(absolute(crateDir).length + 1);
        digest.update(rel);
        digest.update('\0');
        digest.update(createHash('sha256').update(readFileSync(fileAbs)).digest('hex'));
        digest.update('\n');
    }
    return `sha256:${digest.digest('hex')}`;
}

/** Extract the embedded wasm-bindgen schema id, or throw if the marker is gone. */
function extractSchemaHash(relPath: string): string {
    const text = readFileSync(absolute(relPath)).toString('latin1');
    const match = schemaMarker.exec(text);
    if (!match) {
        throw new Error(`No wasm-bindgen schema marker (__wbindgen_throw_<hash>) found in ${relPath}`);
    }
    return match[1];
}

function buildPackageManifest(spec: WasmPackageSpec): WasmPackageManifest {
    const schemaHashes = new Set(spec.schemaSources.map((file) => extractSchemaHash(file)));
    if (schemaHashes.size !== 1) {
        const detail = spec.schemaSources.map((file) => `${file}=${extractSchemaHash(file)}`).join(', ');
        throw new Error(`Package ${spec.id} has mismatched wasm-bindgen schema ids: ${detail}`);
    }

    const artifacts: Record<string, string> = {};
    for (const artifact of spec.artifacts) {
        artifacts[artifact] = hashFile(artifact);
    }

    return {
        crate: spec.crateDir,
        crateSourceHash: hashCrateSources(spec.crateDir),
        schemaHash: [...schemaHashes][0],
        artifacts,
    };
}

/** Assemble a fresh manifest from the current committed artifacts and sources. */
function buildManifest(): WasmManifest {
    const packages: Record<string, WasmPackageManifest> = {};
    for (const spec of wasmPackages) {
        packages[spec.id] = buildPackageManifest(spec);
    }
    return {
        comment:
            'Generated by scripts/gen-wasm-manifest.ts during `pnpm wasm:all`. ' +
            'Do not edit by hand — run `pnpm wasm:verify` to check drift.',
        toolchain: { ...pinnedToolchain },
        packages,
    };
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`${label} must be a JSON object`);
    }
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
        result[key] = Reflect.get(value, key);
    }
    return result;
}

function requireString(value: unknown, label: string): string {
    if (typeof value !== 'string') {
        throw new Error(`${label} must be a string`);
    }
    return value;
}

function requireStringMap(value: unknown, label: string): Record<string, string> {
    const record = requireObject(value, label);
    const result: Record<string, string> = {};
    for (const key of Object.keys(record)) {
        result[key] = requireString(record[key], `${label}.${key}`);
    }
    return result;
}

function parseToolchain(value: unknown): WasmToolchain {
    const record = requireObject(value, 'toolchain');
    return {
        wasmPack: requireString(record.wasmPack, 'toolchain.wasmPack'),
        wasmBindgen: requireString(record.wasmBindgen, 'toolchain.wasmBindgen'),
        rustToolchain: requireString(record.rustToolchain, 'toolchain.rustToolchain'),
        wasmOpt: requireString(record.wasmOpt, 'toolchain.wasmOpt'),
    };
}

function parsePackageManifest(value: unknown, label: string): WasmPackageManifest {
    const record = requireObject(value, label);
    return {
        crate: requireString(record.crate, `${label}.crate`),
        crateSourceHash: requireString(record.crateSourceHash, `${label}.crateSourceHash`),
        schemaHash: requireString(record.schemaHash, `${label}.schemaHash`),
        artifacts: requireStringMap(record.artifacts, `${label}.artifacts`),
    };
}

/** Read and structurally validate the committed manifest (no unchecked casts). */
function readManifest(): WasmManifest {
    const raw = readFileSync(manifestPath, 'utf8');
    const root = requireObject(JSON.parse(raw), 'manifest');
    const packagesRecord = requireObject(root.packages, 'manifest.packages');
    const packages: Record<string, WasmPackageManifest> = {};
    for (const key of Object.keys(packagesRecord)) {
        packages[key] = parsePackageManifest(packagesRecord[key], `manifest.packages.${key}`);
    }
    return {
        comment: requireString(root.comment, 'manifest.comment'),
        toolchain: parseToolchain(root.toolchain),
        packages,
    };
}

export const wasmArtifacts = {
    repoRoot,
    manifestPath,
    pinnedToolchain,
    packages: wasmPackages,
    absolute,
    hashFile,
    hashCrateSources,
    extractSchemaHash,
    buildManifest,
    readManifest,
};
