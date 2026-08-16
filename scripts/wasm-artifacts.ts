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
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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

/**
 * The generated TypeScript declaration files of a package. A `.d.ts` embeds no
 * wasm-bindgen schema id, so schema pairing cannot tie it to the build it
 * describes — the WB-4 / #732 blind spot. Each declaration therefore carries a
 * crate-source-provenance stamp (prepended at generation, see `stampDeclaration`)
 * that `pnpm wasm:verify` asserts against the live crate hash, so a `.d.ts` left
 * stale while the crate (and its `.js`/`.wasm`) regenerated fails even though
 * every byte hash is self-consistent in the freshly written manifest.
 */
export type WasmDeclarationFiles = {
    /** The public served API-surface declaration (wasm-pack output). */
    public: string;
    /** The public raw-export declaration paired with `_bg.wasm` (wasm-pack output). */
    publicBg: string;
    /** The worklet-tree mirror, copied from `public` by the gen script. */
    src: string;
};

export type WasmPackageSpec = {
    /** Package directory name under `public/wasm/`. */
    id: string;
    /** Crate directory, relative to the repo root. */
    crateDir: string;
    /**
     * The `package.json` script that rebuilds this package. It is not derivable
     * from `id` (`daw-dsp` builds via `wasm:dsp`, `daw-wasm-decoder` via
     * `wasm:decoder`), and every drift message tells the reader to run it — a
     * guessed name sends them to a script that does not exist.
     */
    buildScript: string;
    /**
     * Files that embed a wasm-bindgen schema id and must all agree. The glue
     * `.js` and the `_bg.wasm` binary of a coherent build share one id; a
     * mismatch is the #657 drift signature.
     */
    schemaSources: string[];
    /** Committed files fingerprinted for byte integrity, relative to the root. */
    artifacts: string[];
    /**
     * Generated `.d.ts` files carrying a crate-source-provenance stamp, or
     * `undefined` for packages with no declarations (`daw-wasm-decoder`).
     */
    declarations?: WasmDeclarationFiles;
};

export type WasmPackageManifest = {
    crate: string;
    crateSourceHash: string;
    schemaHash: string;
    artifacts: Record<string, string>;
};

/**
 * What the generator is allowed to treat as freshly built.
 *
 * `crateSourceHash` is a *record of what the committed artifacts were built
 * from*, not a reading of the current crate. Recomputing it for every package on
 * every run turns it into the latter: a partial rebuild followed by
 * `pnpm wasm:manifest` re-stamps untouched packages with a source hash their
 * artifacts were never built from, and freshness rule 3 can no longer go red
 * (#2053; the incident is commit a8db18165).
 */
export type WasmManifestOptions = {
    /** The manifest as committed before this run, or `null` when none exists. */
    previous: WasmManifest | null;
    /**
     * Package ids the caller asserts were just rebuilt. Only needed when a
     * rebuild emitted byte-identical artifacts — otherwise the byte comparison
     * against `previous` detects the rebuild on its own.
     */
    rebuilt: ReadonlySet<string>;
};

/** The provenance decision for one package, and why it was reached. */
export type CrateSourceProvenance = {
    crateSourceHash: string;
    /** True when the hash was re-derived from the live crate source. */
    refreshed: boolean;
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
 *
 * That absence matters for provenance. A stamped `.d.ts` moves bytes on every
 * crate-source change, so "the artifacts moved" is a complete rebuild signal for
 * the other three. The decoder has no stamp, so a source edit that compiles to
 * identical bytes leaves no signal — which is why `pnpm wasm:decoder` declares
 * itself to the generator with `--package daw-wasm-decoder`.
 */
const wasmPackages: readonly WasmPackageSpec[] = [
    {
        id: 'daw-dsp',
        crateDir: 'crates/daw-dsp',
        buildScript: 'wasm:dsp',
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
        declarations: {
            public: 'public/wasm/daw-dsp/daw_dsp.d.ts',
            publicBg: 'public/wasm/daw-dsp/daw_dsp_bg.wasm.d.ts',
            src: 'src/modules/AudioEngine/wasm/daw_dsp.d.ts',
        },
    },
    {
        id: 'proof-chamber',
        crateDir: 'crates/proof-chamber',
        buildScript: 'wasm:proof-chamber',
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
        declarations: {
            public: 'public/wasm/proof-chamber/proof_chamber.d.ts',
            publicBg: 'public/wasm/proof-chamber/proof_chamber_bg.wasm.d.ts',
            src: 'src/modules/AudioEngine/wasm/proof_chamber.d.ts',
        },
    },
    {
        id: 'scoring',
        crateDir: 'crates/scoring',
        buildScript: 'wasm:scoring',
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
        declarations: {
            public: 'public/wasm/scoring/scoring.d.ts',
            publicBg: 'public/wasm/scoring/scoring_bg.wasm.d.ts',
            src: 'src/modules/AudioEngine/wasm/scoring.d.ts',
        },
    },
    {
        id: 'daw-wasm-decoder',
        crateDir: 'crates/daw-wasm-decoder',
        buildScript: 'wasm:decoder',
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
 * The first capture group of a match that has already succeeded.
 *
 * Every pattern in this file declares exactly one group, so a match always
 * carries it — but the index signature is optional, and the alternative at
 * seven call sites is a non-null assertion that would hide a pattern edited to
 * drop its group. `subject` names what was being read so that mistake fails
 * loudly instead of producing `undefined` downstream.
 */
function firstCapture(match: RegExpMatchArray, subject: string): string {
    const captured = match[1];
    if (captured === undefined) {
        throw new Error(`Pattern for ${subject} matched without its capture group`);
    }
    return captured;
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
            const depPath = firstCapture(match, `a path dependency in ${current}/Cargo.toml`);
            queue.push(relative(repoRoot, resolve(absolute(current), depPath)));
        }
    }
    return [...seen].sort();
}

/** A single [[package]] entry resolved in Cargo.lock. */
type LockPackage = {
    name: string;
    version: string;
    source: string;
    checksum: string;
    dependencies: string[];
};

/** The `[package] name` declared in a crate's Cargo.toml. */
function readCrateName(crateDir: string): string {
    const cargoToml = readFileSync(absolute(join(crateDir, 'Cargo.toml')), 'utf8');
    const match = /(?:^|\n)name = "([^"]+)"/.exec(cargoToml);
    if (!match) {
        throw new Error(`No [package] name found in ${crateDir}/Cargo.toml`);
    }
    return firstCapture(match, `the [package] name in ${crateDir}/Cargo.toml`);
}

/** Parse Cargo.lock's [[package]] graph, indexed by crate name (a name may have several versions). */
function parseCargoLock(): Map<string, LockPackage[]> {
    const text = readFileSync(absolute('Cargo.lock'), 'utf8');
    const byName = new Map<string, LockPackage[]>();
    for (const block of text.split('[[package]]').slice(1)) {
        const name = /(?:^|\n)name = "([^"]+)"/.exec(block)?.[1];
        const version = /(?:^|\n)version = "([^"]+)"/.exec(block)?.[1];
        if (name === undefined || version === undefined) {
            continue;
        }
        const dependencies: string[] = [];
        const depsBlock = /(?:^|\n)dependencies = \[([^\]]*)\]/.exec(block);
        for (const dep of (depsBlock?.[1] ?? '').matchAll(/"([^"]+)"/g)) {
            const value = dep[1];
            if (value !== undefined) {
                dependencies.push(value);
            }
        }
        const pkg: LockPackage = {
            name,
            version,
            source: /(?:^|\n)source = "([^"]+)"/.exec(block)?.[1] ?? '',
            checksum: /(?:^|\n)checksum = "([^"]+)"/.exec(block)?.[1] ?? '',
            dependencies,
        };
        const list = byName.get(name) ?? [];
        list.push(pkg);
        byName.set(name, list);
    }
    return byName;
}

/** Resolve a Cargo.lock dependency string (`"name"` | `"name version"` | `"name version (source)"`). */
function resolveLockDep(byName: Map<string, LockPackage[]>, depString: string): LockPackage | undefined {
    const parts = depString.split(' ');
    const name = parts[0] ?? '';
    const version = parts[1];
    const candidates = byName.get(name);
    if (candidates === undefined || candidates.length === 0) {
        return undefined;
    }
    if (version === undefined) {
        return candidates[0];
    }
    return candidates.find((candidate) => candidate.version === version) ?? candidates[0];
}

/**
 * Fingerprint only the Cargo.lock entries in `crateName`'s resolved dependency
 * closure — the crate plus every package transitively reachable through the lock
 * `dependencies` graph. A locked version/checksum change to a dependency this
 * crate actually builds against trips it; a bump confined to an unrelated crate
 * (`src-tauri`, `daw-engine`, …) that shares the one workspace lock does not.
 */
function lockClosureFingerprint(crateName: string): string {
    const byName = parseCargoLock();
    const seen = new Set<string>();
    const closure: LockPackage[] = [];
    const queue: string[] = [crateName];
    while (queue.length > 0) {
        const depString = queue.shift();
        if (depString === undefined) {
            continue;
        }
        const pkg = resolveLockDep(byName, depString);
        if (pkg === undefined) {
            continue;
        }
        const key = `${pkg.name} ${pkg.version}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        closure.push(pkg);
        for (const dep of pkg.dependencies) {
            queue.push(dep);
        }
    }
    closure.sort((left, right) => {
        const leftKey = `${left.name} ${left.version}`;
        const rightKey = `${right.name} ${right.version}`;
        if (leftKey < rightKey) {
            return -1;
        }
        if (leftKey > rightKey) {
            return 1;
        }
        return 0;
    });

    const digest = createHash('sha256');
    for (const pkg of closure) {
        digest.update(`${pkg.name}\0${pkg.version}\0${pkg.source}\0${pkg.checksum}\0${pkg.dependencies.join(',')}\n`);
    }
    return digest.digest('hex');
}

/**
 * Hash every input that determines the compiled cdylib for `crateDir`: the crate
 * and its transitive workspace path-dependency closure (each dep's `src/**` +
 * `Cargo.toml`), the workspace-root `Cargo.toml` (`[profile.*]` affects emitted
 * bytes), each crate's optional build script, and the Cargo.lock entries in the
 * resolved dependency closure (the registry + path deps it actually builds
 * against — not the whole lock).
 * `tests/`/`benches/` are excluded — they never reach the cdylib.
 */
function hashCrateClosure(crateDir: string): string {
    const files: string[] = [];
    for (const dir of pathDepClosure(crateDir)) {
        collectRustSources(absolute(join(dir, 'src')), files);
        files.push(absolute(join(dir, 'Cargo.toml')));
        const buildScript = absolute(join(dir, 'build.rs'));
        if (existsSync(buildScript)) {
            files.push(buildScript);
        }
    }
    files.push(absolute('Cargo.toml'));
    files.sort();

    const digest = createHash('sha256');
    for (const fileAbs of files) {
        digest.update(relative(repoRoot, fileAbs));
        digest.update('\0');
        digest.update(createHash('sha256').update(readFileSync(fileAbs)).digest('hex'));
        digest.update('\n');
    }
    digest.update('Cargo.lock closure\0');
    digest.update(lockClosureFingerprint(readCrateName(crateDir)));
    digest.update('\n');
    return `sha256:${digest.digest('hex')}`;
}

/** The exact `wasm-bindgen` version resolved in Cargo.lock — an independent source. */
function wasmBindgenLockVersion(): string {
    const lock = readFileSync(absolute('Cargo.lock'), 'utf8');
    const match = /\nname = "wasm-bindgen"\nversion = "([^"]+)"/.exec(lock);
    if (!match) {
        throw new Error('Could not find the wasm-bindgen version in Cargo.lock');
    }
    return firstCapture(match, 'the wasm-bindgen version in Cargo.lock');
}

/** The rust toolchain channel pinned in rust-toolchain.toml — an independent source. */
function rustToolchainChannel(): string {
    const toml = readFileSync(absolute('rust-toolchain.toml'), 'utf8');
    const match = /channel\s*=\s*"([^"]+)"/.exec(toml);
    if (!match) {
        throw new Error('Could not find the channel in rust-toolchain.toml');
    }
    return firstCapture(match, 'the channel in rust-toolchain.toml');
}

/** Extract the embedded wasm-bindgen schema id, or throw if the marker is gone. */
function extractSchemaHash(relPath: string): string {
    const text = readFileSync(absolute(relPath)).toString('latin1');
    const match = schemaMarker.exec(text);
    if (!match) {
        throw new Error(`No wasm-bindgen schema marker (__wbindgen_throw_<hash>) found in ${relPath}`);
    }
    return firstCapture(match, `the wasm-bindgen schema marker in ${relPath}`);
}

/**
 * A generated `.d.ts` carries no wasm-bindgen schema id, so it cannot join the
 * schema-pairing check. Instead every declaration is prepended at generation
 * with the crate-source hash it was produced from; `pnpm wasm:verify` re-derives
 * the live crate hash and rejects any stamp that no longer matches, so a `.d.ts`
 * left stale while the crate and its `.js`/`.wasm` regenerated carries an old
 * stamp and fails, even though the freshly written manifest records its (stale)
 * byte hash without complaint. Scope: this is a *provenance* check, not a content
 * proof — the stamp attests the crate source is unchanged since this file was
 * generated; it does NOT prove the body matches the current bindings (only
 * regeneration does), so a hand-forged stamp over a stale body plus a rebuilt
 * manifest still passes clean.
 */
const declarationStampPrefix = '// @wasm-bindgen-dts crate-source: ';
const declarationStampMarker = /^\/\/ @wasm-bindgen-dts crate-source: (sha256:[0-9a-f]{64})\n/;

/** Prepend (replacing any prior stamp) the crate-source provenance line. */
function stampDeclaration(relPath: string, crateSourceHash: string): void {
    const abs = absolute(relPath);
    const body = readFileSync(abs, 'utf8').replace(declarationStampMarker, '');
    writeFileSync(abs, `${declarationStampPrefix}${crateSourceHash}\n${body}`, 'utf8');
}

/** Read back the stamped crate-source hash, or null when the stamp is absent. */
function extractDeclarationStamp(relPath: string): string | null {
    const match = declarationStampMarker.exec(readFileSync(absolute(relPath), 'utf8'));
    if (!match) {
        return null;
    }
    return firstCapture(match, `the declaration stamp in ${relPath}`);
}

/** Look up a package spec by id, or throw for an unknown id. */
function packageSpec(id: string): WasmPackageSpec {
    const spec = wasmPackages.find((candidate) => candidate.id === id);
    if (!spec) {
        throw new Error(`Unknown wasm package id: ${id}`);
    }
    return spec;
}

/**
 * Mirror the wasm-pack `.d.ts` into the worklet tree and stamp every generated
 * declaration of the package with the current crate-source hash. Each
 * `gen-*-worklet.ts` calls this after writing the worklet `.js`, so the compiled
 * TypeScript contract always tracks the crate it was generated from (WB-4).
 */
function regenerateDeclarations(id: string): void {
    const spec = packageSpec(id);
    if (!spec.declarations) {
        return;
    }
    const { public: publicDts, publicBg, src } = spec.declarations;
    writeFileSync(absolute(src), readFileSync(absolute(publicDts), 'utf8'), 'utf8');
    const crateSourceHash = hashCrateClosure(spec.crateDir);
    for (const relPath of [publicDts, publicBg, src]) {
        stampDeclaration(relPath, crateSourceHash);
    }
}

/** Byte-for-byte equality of two recorded artifact hash maps (same keys, same hashes). */
function artifactRecordsAgree(recorded: Record<string, string>, current: Record<string, string>): boolean {
    const recordedKeys = Object.keys(recorded).sort();
    const currentKeys = Object.keys(current).sort();
    if (recordedKeys.length !== currentKeys.length) {
        return false;
    }
    return recordedKeys.every((key, index) => currentKeys[index] === key && recorded[key] === current[key]);
}

/**
 * Decide the `crateSourceHash` a package carries in the manifest about to be
 * written — the anti-laundering rule of #2053.
 *
 * The hash is re-derived from the live crate source only when this run has
 * evidence that the package was actually rebuilt:
 *  - the caller named it (`--package <id>` / `--all`), which covers a rebuild
 *    that happened to emit byte-identical artifacts, or
 *  - its committed artifacts no longer match what the previous manifest
 *    recorded — the build wrote something, or
 *  - there is no previous record to preserve (new package, or first manifest).
 *
 * Otherwise the previous hash is preserved untouched, and `liveCrateSourceHash`
 * is never even consulted: an untouched package cannot absorb a source change it
 * was not built from, so `pnpm wasm:verify` rule 3 stays red until that package
 * is genuinely rebuilt.
 */
function resolveCrateSourceProvenance(input: {
    previousPackage: WasmPackageManifest | undefined;
    currentArtifacts: Record<string, string>;
    declaredRebuilt: boolean;
    liveCrateSourceHash: () => string;
}): CrateSourceProvenance {
    const { previousPackage, currentArtifacts, declaredRebuilt, liveCrateSourceHash } = input;
    if (previousPackage === undefined || declaredRebuilt) {
        return { crateSourceHash: liveCrateSourceHash(), refreshed: true };
    }
    if (!artifactRecordsAgree(previousPackage.artifacts, currentArtifacts)) {
        return { crateSourceHash: liveCrateSourceHash(), refreshed: true };
    }
    return { crateSourceHash: previousPackage.crateSourceHash, refreshed: false };
}

function buildPackageManifest(
    spec: WasmPackageSpec,
    options: WasmManifestOptions
): { manifest: WasmPackageManifest; refreshed: boolean } {
    const schemaHashes = new Set(spec.schemaSources.map((file) => extractSchemaHash(file)));
    const [schemaHash] = [...schemaHashes];
    if (schemaHashes.size !== 1 || schemaHash === undefined) {
        const detail = spec.schemaSources.map((file) => `${file}=${extractSchemaHash(file)}`).join(', ');
        throw new Error(`Package ${spec.id} has mismatched wasm-bindgen schema ids: ${detail}`);
    }

    const artifacts: Record<string, string> = {};
    for (const artifact of spec.artifacts) {
        artifacts[artifact] = hashFile(artifact);
    }

    const provenance = resolveCrateSourceProvenance({
        previousPackage: options.previous?.packages[spec.id],
        currentArtifacts: artifacts,
        declaredRebuilt: options.rebuilt.has(spec.id),
        liveCrateSourceHash: () => hashCrateClosure(spec.crateDir),
    });

    return {
        manifest: {
            crate: spec.crateDir,
            crateSourceHash: provenance.crateSourceHash,
            schemaHash,
            artifacts,
        },
        refreshed: provenance.refreshed,
    };
}

/** A written manifest plus which packages had their crate-source provenance re-derived. */
export type WasmManifestBuild = {
    manifest: WasmManifest;
    /** Ids whose `crateSourceHash` was re-derived from the live crate source. */
    refreshed: readonly string[];
    /** Ids whose recorded `crateSourceHash` was carried over untouched. */
    preserved: readonly string[];
};

/**
 * Assemble the manifest from the current committed artifacts, preserving the
 * recorded crate-source provenance of every package this run did not rebuild.
 */
function buildManifest(options: WasmManifestOptions): WasmManifestBuild {
    const packages: Record<string, WasmPackageManifest> = {};
    const refreshed: string[] = [];
    const preserved: string[] = [];
    for (const spec of wasmPackages) {
        const built = buildPackageManifest(spec, options);
        packages[spec.id] = built.manifest;
        (built.refreshed ? refreshed : preserved).push(spec.id);
    }
    const manifest: WasmManifest = {
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
    return { manifest, refreshed, preserved };
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
        throw new TypeError(`${label} must be a string`);
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

/**
 * The committed manifest, or `null` when there is none to preserve provenance
 * from. A manifest that exists but cannot be parsed is an error, not an absence:
 * silently treating it as missing would recompute every `crateSourceHash` and
 * reintroduce the laundering this module exists to prevent.
 */
function readPreviousManifest(): WasmManifest | null {
    if (!existsSync(manifestPath)) {
        return null;
    }
    return readManifest();
}

/**
 * Package ids the caller declares were just rebuilt, parsed from the generator's
 * CLI arguments: `--all`, `--package <id>`, or `--package=<id>`. An unknown id or
 * flag throws — a typo must not silently degrade into "nothing was rebuilt".
 */
function parseRebuiltPackageIds(argv: readonly string[]): ReadonlySet<string> {
    const known = new Set(wasmPackages.map((spec) => spec.id));
    const rebuilt = new Set<string>();
    const remaining = [...argv];
    while (remaining.length > 0) {
        const argument = remaining.shift();
        if (argument === undefined) {
            continue;
        }
        if (argument === '--all') {
            for (const id of known) {
                rebuilt.add(id);
            }
            continue;
        }
        const inline = /^--package=(.+)$/.exec(argument);
        let id: string | undefined;
        if (inline) {
            id = firstCapture(inline, 'the --package argument');
        } else if (argument === '--package') {
            id = remaining.shift();
        }
        if (id === undefined) {
            throw new Error(
                `Unrecognised argument "${argument}". Usage: gen-wasm-manifest.ts [--all] [--package <id>]…, ` +
                    `where <id> is one of: ${[...known].join(', ')}.`
            );
        }
        if (!known.has(id)) {
            throw new Error(`Unknown wasm package id "${id}". Known ids: ${[...known].join(', ')}.`);
        }
        rebuilt.add(id);
    }
    return rebuilt;
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
    readPreviousManifest,
    parseRebuiltPackageIds,
    resolveCrateSourceProvenance,
    extractDeclarationStamp,
    regenerateDeclarations,
};
