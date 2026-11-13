import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { buildCommand, generationInputsHash } from '../binaryenBuild';

import { readWasmPackageMetadata, validateWasmPackageMetadata } from '../verify-wasm-artifacts';
import { wasmArtifacts, type WasmManifest, type WasmPackageManifest } from '../wasm-artifacts';

// The OS receipt boundary is absent in this fixture, independent of any prior local build.
vi.mock('node:fs', async (importOriginal) => {
    const fs = await importOriginal<typeof import('node:fs')>();
    return {
        ...fs,
        readFileSync: (...args: Parameters<typeof fs.readFileSync>) => {
            if (String(args[0]).includes('/wasm-build-receipts/') && String(args[0]).endsWith('.json')) {
                throw new Error('No helper-issued build receipt in fixture');
            }
            return fs.readFileSync(...args);
        },
    };
});

/**
 * #2053: `crateSourceHash` records what the committed artifacts were built from.
 * Recomputing it for every package on every generator run turns it into a
 * reading of the current crate instead, so a partial rebuild plus
 * `pnpm wasm:manifest` re-stamps untouched packages and freshness rule 3 can
 * never go red for them (the a8db18165 laundering).
 */

const staleSentinel = `sha256:${'0'.repeat(64)}`;

function packageManifest(overrides: Partial<WasmPackageManifest> = {}): WasmPackageManifest {
    return {
        crate: 'crates/example',
        crateSourceHash: staleSentinel,
        schemaHash: '0123456789abcdef',
        artifacts: {
            'public/wasm/example/example.js': 'sha256:aaa',
            'public/wasm/example/example_bg.wasm': 'sha256:bbb',
        },
        ...overrides,
    };
}

/** Records whether the live crate source was consulted at all. */
function liveHashProbe(value = 'sha256:live') {
    const calls: string[] = [];
    return {
        calls,
        hash: () => {
            calls.push('hashCrateClosure');
            return value;
        },
    };
}

describe('resolveCrateSourceProvenance', () => {
    it('preserves the recorded hash and never reads the live crate when the artifacts did not move', () => {
        const previousPackage = packageManifest();
        const probe = liveHashProbe();

        const provenance = wasmArtifacts.resolveCrateSourceProvenance({
            previousPackage,
            currentArtifacts: { ...previousPackage.artifacts },
            declaredRebuilt: false,
            liveCrateSourceHash: probe.hash,
        });

        expect(provenance).toEqual({ crateSourceHash: staleSentinel, refreshed: false });
        // The strongest form of the guarantee: an untouched package's pending
        // source change cannot leak into the manifest, because the generator
        // does not even look at the crate.
        expect(probe.calls).toEqual([]);
    });

    it('refreshes the hash when the artifacts moved — a rebuild wrote something', () => {
        const previousPackage = packageManifest();
        const probe = liveHashProbe();

        const provenance = wasmArtifacts.resolveCrateSourceProvenance({
            previousPackage,
            currentArtifacts: { ...previousPackage.artifacts, 'public/wasm/example/example.js': 'sha256:rebuilt' },
            declaredRebuilt: false,
            liveCrateSourceHash: probe.hash,
        });

        expect(provenance).toEqual({ crateSourceHash: 'sha256:live', refreshed: true });
    });

    it('refreshes the hash when the caller declares the rebuild, covering a byte-identical rebuild', () => {
        const previousPackage = packageManifest();
        const probe = liveHashProbe();

        const provenance = wasmArtifacts.resolveCrateSourceProvenance({
            previousPackage,
            currentArtifacts: { ...previousPackage.artifacts },
            declaredRebuilt: true,
            liveCrateSourceHash: probe.hash,
        });

        expect(provenance).toEqual({ crateSourceHash: 'sha256:live', refreshed: true });
    });

    it('refreshes the hash when the artifact set itself changed, since no comparable record exists', () => {
        const previousPackage = packageManifest();
        const probe = liveHashProbe();

        const provenance = wasmArtifacts.resolveCrateSourceProvenance({
            previousPackage,
            currentArtifacts: { 'public/wasm/example/example.js': 'sha256:aaa' },
            declaredRebuilt: false,
            liveCrateSourceHash: probe.hash,
        });

        expect(provenance.refreshed).toBe(true);
    });

    it('computes the hash for a package with no previous record', () => {
        const probe = liveHashProbe();

        const provenance = wasmArtifacts.resolveCrateSourceProvenance({
            previousPackage: undefined,
            currentArtifacts: {},
            declaredRebuilt: false,
            liveCrateSourceHash: probe.hash,
        });

        expect(provenance).toEqual({ crateSourceHash: 'sha256:live', refreshed: true });
    });
});

describe('parseRebuiltPackageIds', () => {
    const knownIds = wasmArtifacts.packages.map((spec) => spec.id);

    it('declares nothing when no arguments are given', () => {
        expect([...wasmArtifacts.parseRebuiltPackageIds([])]).toEqual([]);
    });

    it('accepts --package in both spellings', () => {
        expect([...wasmArtifacts.parseRebuiltPackageIds(['--package', 'daw-dsp', '--package=scoring'])]).toEqual([
            'daw-dsp',
            'scoring',
        ]);
    });

    it('declares every package for --all', () => {
        expect([...wasmArtifacts.parseRebuiltPackageIds(['--all'])].sort()).toEqual([...knownIds].sort());
    });

    it('rejects an unknown package id rather than silently declaring nothing', () => {
        expect(() => wasmArtifacts.parseRebuiltPackageIds(['--package', 'daw-dps'])).toThrow(/Unknown wasm package id/);
    });

    it('rejects an unrecognised flag', () => {
        expect(() => wasmArtifacts.parseRebuiltPackageIds(['--everything'])).toThrow(/Unrecognised argument/);
    });
});

describe('WASM package metadata', () => {
    it('requires private packages with the Apache-2.0 license', () => {
        expect(
            validateWasmPackageMetadata('public/wasm/example/package.json', { private: true, license: 'MIT' })
        ).toEqual(['public/wasm/example/package.json: internal WASM package must set license: Apache-2.0']);
    });

    it('rejects duplicate package metadata keys', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-wasm-package-metadata-'));
        const path = join(root, 'package.json');
        try {
            writeFileSync(path, '{"private":false,"private":true,"license":"Apache-2.0"}\n');
            expect(() => readWasmPackageMetadata(path)).toThrow(`${path}: duplicate key`);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});

describe('package build scripts', () => {
    it('names a script that actually exists, since every drift message tells the reader to run it', () => {
        const raw = readFileSync(join(wasmArtifacts.repoRoot, 'package.json'), 'utf8');
        const parsed: unknown = JSON.parse(raw);
        const scripts =
            typeof parsed === 'object' && parsed !== null ? (Reflect.get(parsed, 'scripts') as unknown) : undefined;
        const available =
            typeof scripts === 'object' && scripts !== null ? Object.keys(scripts) : ([] as readonly string[]);

        for (const spec of wasmArtifacts.packages) {
            expect(available).toContain(spec.buildScript);
        }
    });
});

describe('buildManifest against the committed repository state', () => {
    const committed = wasmArtifacts.readManifest();

    function withStaleRecord(id: string): WasmManifest {
        const recorded = committed.packages[id];
        if (recorded === undefined) {
            throw new Error(`Package ${id} is missing from the committed manifest`);
        }
        return {
            ...committed,
            packages: { ...committed.packages, [id]: { ...recorded, crateSourceHash: staleSentinel } },
        };
    }

    it('preserves historical build HEAD across later commits when source controls and output are unchanged', () => {
        const spec = wasmArtifacts.packages.find((candidate) => candidate.id === 'scoring');
        const recorded = committed.packages.scoring;
        if (!spec || !recorded) throw new Error('Missing scoring fixture');
        const generation = {
            version: 1 as const,
            packageId: spec.id,
            head: '0'.repeat(40),
            sourceHash: recorded.crateSourceHash,
            inputsHash: generationInputsHash(wasmArtifacts.repoRoot, spec.id),
            command: buildCommand(spec.id),
            artifacts: recorded.artifacts,
            optimizer: {
                host: 'linux-x64',
                release: 'version_133',
                archive: 'binaryen-version_133-x86_64-linux.tar.gz',
                archiveSha256: '2dc9c7813f5375db93d96ead4b78222fcc3e2677bbb832297af4797782a37489',
                executable: 'binaryen-version_133/bin/wasm-opt',
                executableSha256: 'd'.repeat(64),
                version: 'wasm-opt version 133',
            },
        };
        const previous = { ...committed, packages: { ...committed.packages, scoring: { ...recorded, generation } } };
        const { manifest, refreshed } = wasmArtifacts.buildManifest({ previous, rebuilt: new Set() });
        expect(manifest.packages.scoring?.generation).toEqual(generation);
        expect(refreshed).toEqual([]);
    });

    it('reproduces the committed manifest when nothing was rebuilt', () => {
        const { manifest, refreshed, preserved } = wasmArtifacts.buildManifest({
            previous: committed,
            rebuilt: new Set(),
        });

        expect(manifest).toEqual(committed);
        expect(refreshed).toEqual([]);
        expect([...preserved].sort()).toEqual(wasmArtifacts.packages.map((spec) => spec.id).sort());
    });

    /**
     * The acceptance scenario of #2053, staged on the real tree: `daw-wasm-decoder`
     * has a pending crate-source change (modelled by a previous manifest whose
     * recorded hash no longer matches the live crate) while the generator runs
     * because some other package was rebuilt. The decoder's artifacts did not
     * move, so its stale record must survive into the new manifest and keep
     * `pnpm wasm:verify` rule 3 red — the check the decoder has no `.d.ts` stamp
     * to provide.
     */
    it('leaves an unrebuilt package stale instead of laundering its pending source change', () => {
        const previous = withStaleRecord('daw-wasm-decoder');

        const { manifest, preserved } = wasmArtifacts.buildManifest({
            previous,
            rebuilt: new Set(),
        });

        const decoder = manifest.packages['daw-wasm-decoder'];
        expect(decoder?.crateSourceHash).toBe(staleSentinel);
        expect(preserved).toContain('daw-wasm-decoder');

        // What the verifier would then compare — rule 3 fails, which is the point.
        const liveHash = wasmArtifacts.hashCrateClosure('crates/daw-wasm-decoder');
        expect(decoder?.crateSourceHash).not.toBe(liveHash);
    });

    it('refuses a declaration of rebuild without a helper-issued matching success receipt', () => {
        expect(() =>
            wasmArtifacts.buildManifest({
                previous: withStaleRecord('daw-wasm-decoder'),
                rebuilt: new Set(['daw-wasm-decoder']),
            })
        ).toThrow();
    });

    it('refuses changed artifacts without a matching build receipt', () => {
        const recorded = committed.packages['daw-dsp'];
        if (recorded === undefined) {
            throw new Error('Package daw-dsp is missing from the committed manifest');
        }
        const [firstArtifact] = Object.keys(recorded.artifacts);
        if (firstArtifact === undefined) {
            throw new Error('Package daw-dsp records no artifacts');
        }
        const previous: WasmManifest = {
            ...committed,
            packages: {
                ...committed.packages,
                'daw-dsp': {
                    ...recorded,
                    crateSourceHash: staleSentinel,
                    artifacts: { ...recorded.artifacts, [firstArtifact]: 'sha256:not-what-is-on-disk' },
                },
            },
        };

        expect(() => wasmArtifacts.buildManifest({ previous, rebuilt: new Set() })).toThrow();
    });

    it('refuses a first manifest without actual build receipts', () => {
        expect(() => wasmArtifacts.buildManifest({ previous: null, rebuilt: new Set() })).toThrow();
    });
});
