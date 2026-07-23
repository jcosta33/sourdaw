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
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path to the repository root (this file lives in `<root>/scripts`). */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Committed manifest that pairs artifacts ⇄ crate source ⇄ toolchain. */
const manifestPath = join(repoRoot, 'public/wasm/manifest.json');

/**
 * Constants for the toolchain parts with no independent in-repo source to verify
 * against: the `wasm-pack` CLI version and the `wasm-opt` (binaryen) it bundles.
 * `wasm-bindgen` is read live from `Cargo.lock` and the rust toolchain from
 * `rust-toolchain.toml`, so those are not hard-coded here (WB-8).
 */
const pinnedToolchain = {
    wasmPack: '0.14.0',
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

/** Matches a Cargo `path = "..."` dependency (any dependency section). */
const pathDepPattern = /path\s*=\s*"([^"]+)"/g;

/**
 * Repo-relative crate directories in `crateDir`'s transitive path-dependency
 * closure, including `crateDir` itself. Only workspace path deps are walked;
 * registry deps are pinned by Cargo.lock and covered separately.
 */
function pathDepClosure(crateDir: string): string[] {
    const seen = new Set<string>();
    const queue: string[] = [crateDir];
    while (queue.length > 0) {
        const current = queue.shift();
        if (current === undefined || seen.has(current)) {
            continue;
        }
        seen.add(current);
        const cargoToml = readFileSync(absolute(join(current, 'Cargo.toml')), 'utf8');
        for (const match of cargoToml.matchAll(pathDepPattern)) {
            queue.push(relative(repoRoot, resolve(absolute(current), match[1])));
        }
    }
    return [...seen].sort();
}

/**
 * Hash every input that determines the compiled cdylib for `crateDir`: the crate
 * and its transitive path-dependency closure (each dep's `src/**` + `Cargo.toml`),
 * plus the workspace-root `Cargo.toml` (`[profile.*]` affects emitted bytes) and
 * `Cargo.lock` (pins every resolved dependency version). `tests/`/`benches/` are
 * excluded — they never reach the cdylib.
 */
function hashCrateClosure(crateDir: string): string {
    const files: string[] = [];
    for (const dir of pathDepClosure(crateDir)) {
        collectRustSources(absolute(join(dir, 'src')), files);
        files.push(absolute(join(dir, 'Cargo.toml')));
    }
    files.push(absolute('Cargo.toml'));
    files.push(absolute('Cargo.lock'));
    files.sort();

    const digest = createHash('sha256');
    for (const fileAbs of files) {
        digest.update(relative(repoRoot, fileAbs));
        digest.update('\0');
        digest.update(createHash('sha256').update(readFileSync(fileAbs)).digest('hex'));
        digest.update('\n');
    }
    return `sha256:${digest.digest('hex')}`;
}

/** The exact `wasm-bindgen` version resolved in Cargo.lock — an independent source. */
function wasmBindgenLockVersion(): string {
    const lock = readFileSync(absolute('Cargo.lock'), 'utf8');
    const match = /\nname = "wasm-bindgen"\nversion = "([^"]+)"/.exec(lock);
    if (!match) {
        throw new Error('Could not find the wasm-bindgen version in Cargo.lock');
    }
    return match[1];
}

/** The rust toolchain channel pinned in rust-toolchain.toml — an independent source. */
function rustToolchainChannel(): string {
    const toml = readFileSync(absolute('rust-toolchain.toml'), 'utf8');
    const match = /channel\s*=\s*"([^"]+)"/.exec(toml);
    if (!match) {
        throw new Error('Could not find the channel in rust-toolchain.toml');
    }
    return match[1];
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
        crateSourceHash: hashCrateClosure(spec.crateDir),
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
        toolchain: {
            wasmPack: pinnedToolchain.wasmPack,
            wasmBindgen: wasmBindgenLockVersion(),
            rustToolchain: rustToolchainChannel(),
            wasmOpt: pinnedToolchain.wasmOpt,
        },
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
    hashCrateClosure,
    pathDepClosure,
    extractSchemaHash,
    wasmBindgenLockVersion,
    rustToolchainChannel,
    buildManifest,
    readManifest,
};
