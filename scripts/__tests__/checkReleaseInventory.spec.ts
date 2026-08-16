import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    loadRepositorySnapshot,
    type ReleaseInventory,
    type RepositorySnapshot,
    validateReleaseInventory,
} from '../checkReleaseInventory';

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
                paths: ['package.json', 'public/**', 'src/**'],
                sources: ['git:example/repository'],
                revisions: ['deadbeef'],
                digests: ['sha256:example'],
                licenses: ['Apache-2.0'],
                productSurfaces: ['source distribution'],
                evidence: ['package.json'],
                obligations: ['Preserve attribution.'],
            },
        ],
        snapshots: [],
        externalReferences: [{ surface: 'runtime', file: 'src/provider.ts', value: 'https://provider.example/v1' }],
        marks: [],
    };
}

function snapshot(): RepositorySnapshot {
    return {
        releaseFiles: ['package.json', 'public/icon.png'],
        externalReferences: [{ file: 'src/provider.ts', value: 'https://provider.example/v1' }],
        fileDigests: {},
        markPaths: {},
    };
}

describe('release inventory', () => {
    it('accepts complete classified coverage', () => {
        expect(validateReleaseInventory(inventory(), snapshot())).toEqual([]);
    });

    it('rejects a new release file without a classification', () => {
        expect(
            validateReleaseInventory(inventory(), {
                ...snapshot(),
                releaseFiles: [...snapshot().releaseFiles, 'src-tauri/sidecar/new.bin'],
            })
        ).toContain('unclassified release files:\n- src-tauri/sidecar/new.bin');
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

    it('discovers shipped assets and non-HTTP production endpoints', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-release-inventory-'));
        mkdirSync(join(root, 'src'), { recursive: true });
        writeFileSync(
            join(root, 'src/peer.ts'),
            "export const server = 'stun:stun.example.net:19302';\nexport const api = 'https:\\/\\/provider.example.net/v1';\nexport const model = 'Hammond';\n// Never treat substrings as marks.\n"
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
                { file: 'src/peer.ts', value: 'https://provider.example.net/v1' },
                { file: 'src/peer.ts', value: 'stun:stun.example.net:19302' },
            ]);
            expect(result.fileDigests['notes.txt']).toMatch(/^[0-9a-f]{64}$/);
            expect(result.markPaths).toEqual({ Hammond: ['src/peer.ts'], Neve: [] });
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
