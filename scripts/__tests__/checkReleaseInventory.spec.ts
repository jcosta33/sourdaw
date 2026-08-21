import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
    assertGrandBouleReleaseInventory,
    assertGrandBouleWithheldFromWasm,
    audioWorkletReleaseInventoryContract,
    GRAND_BOULE_WASM_BINARY,
    GRAND_BOULE_WASM_TEXT_SURFACES,
    grandBouleReleaseInventoryContract,
    loadRepositorySnapshot,
    OWNER_VISUAL_ASSET_PATHS,
    ownerVisualAssetReleaseInventoryContract,
    REQUIRED_SNAPSHOT_PATHS,
    TRADEMARK_NOTICE_PATH,
    trademarkReleaseInventoryContract,
    type ReleaseInventory,
    type RepositorySnapshot,
    validateReleaseInventory,
    wasmReleaseInventoryContract,
} from '../checkReleaseInventory';

import type { WasmManifest } from '../wasm-artifacts';

const fixtureDigest = 'a'.repeat(64);
const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function wasmWithFunctionExport(name: string): Uint8Array {
    const encodedName = new TextEncoder().encode(name);
    if (encodedName.length >= 128) {
        throw new RangeError('fixture export name must fit in one unsigned LEB128 byte');
    }
    const exportPayload = [1, encodedName.length, ...encodedName, 0, 0];
    return Uint8Array.from([
        0x00,
        0x61,
        0x73,
        0x6d,
        0x01,
        0x00,
        0x00,
        0x00,
        0x01,
        0x04,
        0x01,
        0x60,
        0x00,
        0x00,
        0x03,
        0x02,
        0x01,
        0x00,
        0x07,
        exportPayload.length,
        ...exportPayload,
        0x0a,
        0x04,
        0x01,
        0x02,
        0x00,
        0x0b,
    ]);
}

function writeGrandBouleWasmFixture(root: string, binaryExport = 'allowed_instance_new'): void {
    for (const path of GRAND_BOULE_WASM_TEXT_SURFACES) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), 'export class AllowedInstance {}');
    }
    writeFileSync(join(root, GRAND_BOULE_WASM_BINARY), wasmWithFunctionExport(binaryExport));
}

function inventory(): ReleaseInventory {
    return {
        schemaVersion: 1,
        surfaces: [
            {
                id: 'runtime',
                kind: 'source',
                retention: 'keep',
                owner: 'OS-01',
                releaseModes: ['source'],
                paths: ['public/**', 'src/**', ...REQUIRED_SNAPSHOT_PATHS],
                sources: ['git:example/repository'],
                revisions: ['deadbeef'],
                digests: ['sha256:example'],
                licenses: ['Apache-2.0'],
                productSurfaces: ['source distribution'],
                evidence: ['package.json'],
                obligations: ['Preserve attribution.'],
            },
        ],
        snapshots: REQUIRED_SNAPSHOT_PATHS.map((path) => ({ path, sha256: fixtureDigest })),
        externalReferences: [{ surface: 'runtime', file: 'src/provider.ts', value: 'https://provider.example/v1' }],
        marks: [],
    };
}

function snapshot(): RepositorySnapshot {
    return {
        releaseFiles: [...new Set([...REQUIRED_SNAPSHOT_PATHS, 'public/icon.png', 'src/provider.ts'])],
        externalReferences: [{ file: 'src/provider.ts', value: 'https://provider.example/v1' }],
        fileDigests: Object.fromEntries(REQUIRED_SNAPSHOT_PATHS.map((path) => [path, fixtureDigest])),
        markPaths: {},
    };
}

describe('release inventory', () => {
    it('withholds Grand Boule construction from every distributed daw-dsp WASM surface', () => {
        expect(() => assertGrandBouleWithheldFromWasm(repositoryRoot)).not.toThrow();
    });

    it('rejects a returning Grand Boule construction path in glue, types, or the WASM export table', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-grand-boule-wasm-'));

        try {
            writeGrandBouleWasmFixture(root);
            expect(() => assertGrandBouleWithheldFromWasm(root)).not.toThrow();

            writeFileSync(join(root, GRAND_BOULE_WASM_TEXT_SURFACES[0]), 'export class GrandBouleInstance {}');
            expect(() => assertGrandBouleWithheldFromWasm(root)).toThrow(
                'Grand Boule must not be exposed by distributed daw-dsp WASM surface'
            );

            writeGrandBouleWasmFixture(root, 'grandbouleinstance_new');
            expect(() => assertGrandBouleWithheldFromWasm(root)).toThrow(
                'Grand Boule must not be exposed by distributed daw-dsp WASM binary export grandbouleinstance_new'
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('binds Grand Boule source bytes to its inventory digest', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-grand-boule-provenance-'));
        const grandBoule = join(root, 'crates/daw-dsp/src/grand_boule');
        mkdirSync(grandBoule, { recursive: true });
        writeFileSync(join(grandBoule, 'engine.rs'), 'initial source');
        execFileSync('git', ['init', '--quiet'], { cwd: root });
        execFileSync('git', ['add', 'crates/daw-dsp/src/grand_boule'], { cwd: root });

        try {
            const before = grandBouleReleaseInventoryContract(root);
            expect(before.revisions).toEqual(['current tracked source']);
            expect(before.digests).toEqual([
                expect.stringMatching(/^tree-sha256:[0-9a-f]{64}:crates\/daw-dsp\/src\/grand_boule$/),
            ]);

            writeFileSync(join(grandBoule, 'untracked.rs'), 'untracked source');
            expect(grandBouleReleaseInventoryContract(root).digests).toEqual(before.digests);

            writeFileSync(join(grandBoule, 'engine.rs'), 'changed source');
            expect(grandBouleReleaseInventoryContract(root).digests).not.toEqual(before.digests);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('rejects stale Grand Boule revisions and digests through the Grand Boule assertion', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-grand-boule-assertion-'));
        const grandBoule = join(root, 'crates/daw-dsp/src/grand_boule');
        mkdirSync(grandBoule, { recursive: true });
        writeFileSync(join(grandBoule, 'engine.rs'), 'current source');
        execFileSync('git', ['init', '--quiet'], { cwd: root });
        execFileSync('git', ['add', 'crates/daw-dsp/src/grand_boule'], { cwd: root });

        try {
            const current = grandBouleReleaseInventoryContract(root);
            expect(() =>
                assertGrandBouleReleaseInventory(root, {
                    revisions: ['stale tracked source'],
                    digests: current.digests,
                })
            ).toThrow('Grand Boule release inventory revisions does not match provenance');
            expect(() =>
                assertGrandBouleReleaseInventory(root, {
                    revisions: current.revisions,
                    digests: ['tree-sha256:stale:crates/daw-dsp/src/grand_boule'],
                })
            ).toThrow('Grand Boule release inventory digests does not match provenance');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('binds owner-created visual assets and every derived rendition', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-owner-assets-'));
        mkdirSync(join(root, 'public/logo-parts'), { recursive: true });
        mkdirSync(join(root, 'build/icons/nested'), { recursive: true });
        for (const path of [
            'public/favicon.ico',
            'public/icon-192.png',
            'public/icon-transparent.png',
            'public/icon.png',
            'sourdaw.png',
            'public/logo-parts/p00.png',
            'build/icons/icon.png',
            'build/icons/nested/icon.png',
        ]) {
            writeFileSync(join(root, path), path);
        }

        try {
            const before = ownerVisualAssetReleaseInventoryContract(root);
            expect(before.kind).toBe('owner-created-asset');
            expect(before.paths).toEqual(OWNER_VISUAL_ASSET_PATHS);
            expect(before.sources).toContain('owner attestation: Jose Costa, 2026-08-21');
            expect(before.licenses).toEqual(['owner-created:pending-OS-10-project-license']);

            writeFileSync(join(root, 'build/icons/nested/icon.png'), 'changed');
            expect(ownerVisualAssetReleaseInventoryContract(root).digests).not.toEqual(before.digests);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('binds the shipped trademark notice', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-trademark-notice-'));
        const legal = join(root, 'public/legal');
        mkdirSync(legal, { recursive: true });
        writeFileSync(join(root, TRADEMARK_NOTICE_PATH), 'notice');

        try {
            const before = trademarkReleaseInventoryContract(root);
            expect(TRADEMARK_NOTICE_PATH).toBe('public/legal/TRADEMARKS.md');
            expect(before.licenses).toEqual(['not-applicable:trademark-rights-not-granted']);

            writeFileSync(join(root, TRADEMARK_NOTICE_PATH), 'changed');
            expect(trademarkReleaseInventoryContract(root).digests).not.toEqual(before.digests);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('binds direct worklet source bytes without inventing a generator', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-worklet-provenance-'));
        const worklets = join(root, 'public/audio/worklets');
        mkdirSync(worklets, { recursive: true });
        writeFileSync(join(worklets, 'native-plugin-bridge-processor.js'), 'native');
        writeFileSync(join(worklets, 'sidechain-compressor-processor.js'), 'sidechain');

        try {
            const before = audioWorkletReleaseInventoryContract(root);
            expect(before.kind).toBe('project-source');
            expect(before.revisions).toEqual(['not-applicable:direct-project-source']);

            writeFileSync(join(worklets, 'native-plugin-bridge-processor.js'), 'changed');
            expect(audioWorkletReleaseInventoryContract(root).digests[0]).not.toBe(before.digests[0]);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('binds the WASM manifest to its toolchain and crate closures', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-wasm-provenance-'));
        mkdirSync(join(root, 'public/wasm'), { recursive: true });
        writeFileSync(join(root, 'public/wasm/manifest.json'), '{}');
        const manifest: WasmManifest = {
            comment: 'fixture',
            toolchain: {
                wasmPack: '1',
                wasmBindgen: '2',
                rustToolchain: '3',
                wasmOpt: '4',
            },
            packages: {
                beta: { crate: 'crates/beta', crateSourceHash: 'sha256:beta', schemaHash: 'beta', artifacts: {} },
                alpha: { crate: 'crates/alpha', crateSourceHash: 'sha256:alpha', schemaHash: 'alpha', artifacts: {} },
            },
        };

        try {
            const contract = wasmReleaseInventoryContract(root, manifest);
            expect(contract.sources).toEqual(['crates/alpha/', 'crates/beta/']);
            expect(contract.revisions).toEqual([
                'rust 3',
                'wasm-pack 1',
                'wasm-bindgen 2',
                'wasm-opt 4',
                'alpha sha256:alpha',
                'beta sha256:beta',
            ]);
            expect(contract.digests).toEqual([
                expect.stringMatching(/^sha256:[0-9a-f]{64}:public\/wasm\/manifest\.json$/),
            ]);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('accepts complete classified coverage', () => {
        expect(validateReleaseInventory(inventory(), snapshot())).toEqual([]);
    });

    it('rejects a new release file without a classification', () => {
        expect(
            validateReleaseInventory(inventory(), {
                ...snapshot(),
                releaseFiles: [...snapshot().releaseFiles, 'electron/sidecar/new.bin'],
            })
        ).toContain('unclassified release files:\n- electron/sidecar/new.bin');
    });

    it('rejects a new endpoint in an already-owned file', () => {
        expect(
            validateReleaseInventory(inventory(), {
                ...snapshot(),
                externalReferences: [
                    ...snapshot().externalReferences,
                    { file: 'src/provider.ts', value: 'https://second.example/v1' },
                ],
            })
        ).toContain('external references missing from inventory:\n- src/provider.ts -> https://second.example/v1');
    });

    it('rejects stale endpoint assignments', () => {
        expect(validateReleaseInventory(inventory(), { ...snapshot(), externalReferences: [] })).toContain(
            'stale external-reference assignments:\n- src/provider.ts -> https://provider.example/v1'
        );
    });

    it('rejects endpoint assignments to an unrelated surface', () => {
        const value = inventory();
        value.surfaces.push({ ...value.surfaces[0]!, id: 'docs', paths: ['docs/**'] });
        value.externalReferences[0]!.surface = 'docs';

        expect(validateReleaseInventory(value, snapshot())).toContain(
            'src/provider.ts: docs does not cover the referenced file'
        );
    });

    it('does not let a directory rule swallow a sibling prefix', () => {
        expect(
            validateReleaseInventory(inventory(), {
                ...snapshot(),
                releaseFiles: [...snapshot().releaseFiles, 'publicity/icon.png'],
            })
        ).toContain('unclassified release files:\n- publicity/icon.png');
    });

    it('rejects unclassified retention', () => {
        const value = inventory();
        value.surfaces[0]!.retention = 'unclassified' as never;

        expect(validateReleaseInventory(value, snapshot())).toContain('runtime: invalid retention class unclassified');
    });

    it('rejects removal of a required snapshot', () => {
        const value = inventory();
        value.snapshots = value.snapshots.filter((entry) => entry.path !== 'pnpm-lock.yaml');

        expect(validateReleaseInventory(value, snapshot())).toContain(
            'required snapshots missing from inventory:\n- pnpm-lock.yaml'
        );
    });

    it('rejects snapshots outside the tracked repository', () => {
        const value = inventory();
        value.snapshots.push({ path: 'untracked.lock', sha256: fixtureDigest });

        expect(validateReleaseInventory(value, snapshot())).toContain('untracked.lock: snapshot path must be tracked');
    });

    it('rejects missing required marks and empty mark assignments', () => {
        const value = inventory();
        value.marks = [{ value: 'Neve', paths: [] }];

        expect(validateReleaseInventory(value, snapshot(), ['Roland'])).toEqual(
            expect.arrayContaining([
                'required marks missing from inventory:\n- Roland',
                'Neve: paths must be non-empty',
            ])
        );
    });

    it('requires the trademark notice beside every classified mark path', () => {
        const value = inventory();
        value.surfaces.push({
            ...value.surfaces[0]!,
            id: 'third-party-marks',
            paths: ['src/provider.ts'],
        });
        value.marks = [{ value: 'Roland', paths: ['src/provider.ts'] }];
        const state = snapshot();
        state.markPaths = { Roland: ['src/provider.ts'] };

        expect(validateReleaseInventory(value, state, ['Roland'])).toContain(
            `third-party-marks: required notice missing: ${TRADEMARK_NOTICE_PATH}`
        );
    });

    it('rejects component paths that fall through to a generic surface', () => {
        const value = inventory();
        value.surfaces.push({ ...value.surfaces[0]!, id: 'generic', paths: ['src/**'] });
        value.surfaces[0]!.paths = value.surfaces[0]!.paths.filter((path) => path !== 'src/**');

        expect(validateReleaseInventory(value, snapshot(), [], { runtime: ['src/provider.ts'] })).toContain(
            'runtime: required component paths missing:\n- src/provider.ts'
        );
    });

    it('rejects surface paths that match no tracked file', () => {
        const value = inventory();
        value.surfaces[0]!.paths.push('missing/**');

        expect(validateReleaseInventory(value, snapshot())).toContain('runtime: path is not tracked: missing/**');
    });

    it('discovers shipped assets and non-HTTP production endpoints', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-release-inventory-'));
        mkdirSync(join(root, 'src'), { recursive: true });
        writeFileSync(
            join(root, 'src/peer.ts'),
            "export const server = 'stun:stun.example.net:19302';\nexport const api = 'https:\\/\\/provider.example.net/v1';\nexport const dynamic = `https://api.example.net/files/${name.split('/')}`;\nexport const model = 'Hammond';\n// Never treat substrings as marks.\n"
        );
        writeFileSync(join(root, 'src/peer.spec.ts'), "export const fixture = 'https://fixture.example.net';\n");
        writeFileSync(join(root, 'sourdaw.png'), 'image');
        writeFileSync(join(root, 'notes.txt'), 'not shipped');

        try {
            const result = loadRepositorySnapshot(
                root,
                {
                    snapshots: [{ path: 'notes.txt', sha256: 'unused' }],
                    marks: [
                        { value: 'Hammond', paths: [] },
                        { value: 'Neve', paths: [] },
                    ],
                },
                ['notes.txt', 'sourdaw.png', 'src/peer.spec.ts', 'src/peer.ts']
            );
            expect(result.releaseFiles).toEqual(['notes.txt', 'sourdaw.png', 'src/peer.spec.ts', 'src/peer.ts']);
            expect(result.externalReferences).toEqual([
                {
                    file: 'src/peer.ts',
                    value: 'https://api.example.net/files/${slot}',
                    templateSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
                },
                { file: 'src/peer.ts', value: 'https://provider.example.net/v1' },
                { file: 'src/peer.ts', value: 'stun:stun.example.net:19302' },
            ]);
            expect(result.fileDigests['notes.txt']).toMatch(/^[0-9a-f]{64}$/);
            expect(result.markPaths).toEqual({ Hammond: ['src/peer.ts'], Neve: [] });
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('ignores tracked files deleted from the working tree', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-release-inventory-'));
        mkdirSync(join(root, 'src'), { recursive: true });
        writeFileSync(join(root, 'src/current.ts'), "export const value = 'current';\n");

        try {
            const result = loadRepositorySnapshot(root, { snapshots: [], marks: [] }, [
                'src/current.ts',
                'src/deleted.ts',
            ]);

            expect(result.releaseFiles).toEqual(['src/current.ts']);
            expect(result.externalReferences).toEqual([]);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('scans production endpoints plus case-insensitive public marks', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-release-inventory-'));
        mkdirSync(join(root, 'crates/plugin-host/src'), { recursive: true });
        mkdirSync(join(root, 'public'), { recursive: true });
        mkdirSync(join(root, 'server'), { recursive: true });
        writeFileSync(
            join(root, 'crates/plugin-host/src/descriptor.rs'),
            'static URL: &[u8] = b"https://app.example.net\\0";\n'
        );
        writeFileSync(join(root, 'index.html'), '<title>Roland tools</title>');
        writeFileSync(
            join(root, 'public/runtime.js'),
            "export const api = 'https://public.example.net/v1'; // ROLAND\n"
        );
        writeFileSync(
            join(root, 'server/index.js'),
            "export const api = 'wss://server.example.net/socket';\nnew WebSocket(api);\n"
        );

        try {
            const result = loadRepositorySnapshot(root, { snapshots: [], marks: [{ value: 'Roland', paths: [] }] }, [
                'crates/plugin-host/src/descriptor.rs',
                'index.html',
                'public/runtime.js',
                'server/index.js',
            ]);
            expect(result.externalReferences).toEqual([
                { file: 'crates/plugin-host/src/descriptor.rs', value: 'https://app.example.net' },
                { file: 'public/runtime.js', value: 'https://public.example.net/v1' },
                { file: 'server/index.js', value: 'runtime:WebSocket' },
                { file: 'server/index.js', value: 'wss://server.example.net/socket' },
            ]);
            expect(result.markPaths).toEqual({ Roland: ['index.html', 'public/runtime.js'] });
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('detects template-expression drift', () => {
        const value = inventory();
        value.externalReferences[0]!.templateSha256 = fixtureDigest;
        const changed = snapshot();
        changed.externalReferences[0]!.templateSha256 = 'b'.repeat(64);

        expect(validateReleaseInventory(value, changed)).toEqual(
            expect.arrayContaining([
                expect.stringContaining('external references missing from inventory'),
                expect.stringContaining('stale external-reference assignments'),
            ])
        );
    });
});
