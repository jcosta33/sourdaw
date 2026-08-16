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
        baseline: '1de2caa08fa1872c33bdcc836dd2152741d9adda',
        surfaces: [
            {
                id: 'runtime',
                kind: 'source',
                retention: 'keep',
                owner: 'OS-01',
                releaseModes: ['source'],
                paths: ['package.json', 'public/**'],
                sourceFiles: ['src/provider.ts'],
                sources: ['git:example/repository'],
                revisions: ['deadbeef'],
                digests: ['sha256:example'],
                licenses: ['Apache-2.0'],
                productSurfaces: ['source distribution'],
                evidence: ['package.json'],
                obligations: ['Preserve attribution.'],
            },
        ],
    };
}

function snapshot(): RepositorySnapshot {
    return {
        releaseFiles: ['package.json', 'public/icon.png'],
        externalSourceFiles: ['src/provider.ts'],
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

    it('rejects a new external source until an owner claims it', () => {
        expect(
            validateReleaseInventory(inventory(), {
                ...snapshot(),
                externalSourceFiles: [...snapshot().externalSourceFiles, 'src/new-provider.ts'],
            })
        ).toContain('external-source files missing from inventory:\n- src/new-provider.ts');
    });

    it('rejects stale source assignments', () => {
        expect(validateReleaseInventory(inventory(), { ...snapshot(), externalSourceFiles: [] })).toContain(
            'stale external-source assignments:\n- src/provider.ts'
        );
    });

    it('rejects unclassified retention', () => {
        const value = inventory();
        value.surfaces[0]!.retention = 'unclassified' as never;

        expect(validateReleaseInventory(value, snapshot())).toContain('runtime: invalid retention class unclassified');
    });

    it('discovers shipped assets and non-HTTP production endpoints', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-release-inventory-'));
        mkdirSync(join(root, 'src'), { recursive: true });
        writeFileSync(join(root, 'src/peer.ts'), "export const server = 'stun:stun.example.net:19302';\n");
        writeFileSync(join(root, 'src/peer.spec.ts'), "export const fixture = 'https://fixture.example.net';\n");
        writeFileSync(join(root, 'sourdaw.png'), 'image');
        writeFileSync(join(root, 'notes.txt'), 'not shipped');

        try {
            expect(
                loadRepositorySnapshot(root, ['notes.txt', 'sourdaw.png', 'src/peer.spec.ts', 'src/peer.ts'])
            ).toEqual({
                releaseFiles: ['sourdaw.png'],
                externalSourceFiles: ['src/peer.ts'],
            });
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
