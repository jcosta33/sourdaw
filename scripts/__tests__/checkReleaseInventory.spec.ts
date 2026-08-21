import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    audioWorkletReleaseInventoryContract,
    ddspReleaseInventoryContract,
    DDSP_RELEASE_INVENTORY_CONTRACT,
    DDSP_RELEASE_INVENTORY_PATHS,
    loadRepositorySnapshot,
    REQUIRED_COMPONENT_PATHS,
    REQUIRED_SNAPSHOT_PATHS,
    TFJS_APACHE_LICENSE_PATH,
    TFJS_NOTICE_PATH,
    TRADEMARK_NOTICE_PATH,
    trademarkReleaseInventoryContract,
    type ReleaseInventory,
    type RepositorySnapshot,
    validateReleaseInventory,
    wasmReleaseInventoryContract,
} from '../checkReleaseInventory';

import type { WasmManifest } from '../wasm-artifacts';

const fixtureDigest = 'a'.repeat(64);

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
    it('pins the complete DDSP execution surface without laundering checkpoint weights into Apache', () => {
        expect(REQUIRED_COMPONENT_PATHS['ddsp-models']).toEqual(DDSP_RELEASE_INVENTORY_PATHS);
        expect(DDSP_RELEASE_INVENTORY_CONTRACT.sources[0]).toBe(
            'https://github.com/magenta/magenta-js/blob/0692eb2b79681f062c6b6dd53a0361967f298caa/music/checkpoints/README.md'
        );
        expect(DDSP_RELEASE_INVENTORY_CONTRACT.digests).toHaveLength(12);
        expect(DDSP_RELEASE_INVENTORY_CONTRACT.digests).toContain(
            'sha256:e4f9c5703a80cb874bca35818b22eb86d7f02ade3098974b47c6d248e6e57f0d:3888160:https://storage.googleapis.com/magentadata/js/checkpoints/ddsp/tenor_saxophone/group1-shard1of1.bin'
        );
        expect(DDSP_RELEASE_INVENTORY_CONTRACT.licenses).toContain(
            'unverified:checkpoint-weights-no-license-grant-established'
        );
        expect(DDSP_RELEASE_INVENTORY_CONTRACT.licenses).not.toContain('Apache-2.0:checkpoint-weights');
        expect(DDSP_RELEASE_INVENTORY_PATHS).toEqual(
            expect.arrayContaining([
                'src/modules/Transport/useCases/secondsBetweenBeats.ts',
                'src/modules/Transport/useCases/index.ts',
            ])
        );
    });

    it('rejects an omitted DDSP timing dependency even when generic project source covers it', () => {
        const value = inventory();
        value.surfaces.push({
            ...value.surfaces[0]!,
            id: 'ddsp-models',
            paths: ['src/modules/Transport/useCases/index.ts'],
        });
        const state = snapshot();
        state.releaseFiles.push(
            'src/modules/Transport/useCases/index.ts',
            'src/modules/Transport/useCases/secondsBetweenBeats.ts'
        );

        expect(
            validateReleaseInventory(value, state, [], {
                'ddsp-models': [
                    'src/modules/Transport/useCases/index.ts',
                    'src/modules/Transport/useCases/secondsBetweenBeats.ts',
                ],
            })
        ).toContain(
            'ddsp-models: required component paths missing:\n- src/modules/Transport/useCases/secondsBetweenBeats.ts'
        );
    });

    it('binds the shipped TensorFlow.js attribution and full Apache license bytes', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-tfjs-legal-'));
        const legal = join(root, 'public/legal');
        mkdirSync(legal, { recursive: true });
        writeFileSync(join(root, TFJS_APACHE_LICENSE_PATH), 'full Apache license');
        writeFileSync(join(root, TFJS_NOTICE_PATH), 'TensorFlow.js 4.22.0 notice');

        try {
            const before = ddspReleaseInventoryContract(root);
            expect(before.paths).toEqual(expect.arrayContaining([TFJS_APACHE_LICENSE_PATH, TFJS_NOTICE_PATH]));
            expect(before.sources).toContain(
                'https://github.com/tensorflow/tfjs/blob/e5d5e9371ed1fd0a4df6d7cd0b947d2a820cefd7/LICENSE'
            );
            expect(before.digests).toEqual(
                expect.arrayContaining([
                    expect.stringMatching(new RegExp(`${TFJS_APACHE_LICENSE_PATH}$`, 'u')),
                    expect.stringMatching(new RegExp(`${TFJS_NOTICE_PATH}$`, 'u')),
                ])
            );

            writeFileSync(join(root, TFJS_NOTICE_PATH), 'changed');
            expect(ddspReleaseInventoryContract(root).digests).not.toEqual(before.digests);
            rmSync(join(root, TFJS_APACHE_LICENSE_PATH));
            expect(() => ddspReleaseInventoryContract(root)).toThrow();
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
