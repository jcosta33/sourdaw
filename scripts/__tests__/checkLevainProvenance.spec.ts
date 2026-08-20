import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { type LevainProvenance, parseLevainProvenance, validateLevainProvenance } from '../checkLevainProvenance';

function digest(algorithm: 'sha1' | 'sha256', contents: Buffer): string {
    const hash = createHash(algorithm);
    if (algorithm === 'sha1') {
        hash.update(`blob ${String(contents.length)}\0`);
    }
    return hash.update(contents).digest('hex');
}

function fixture(root: string): LevainProvenance {
    const sample = Buffer.from('sample');
    const manifest = Buffer.from('{}');
    mkdirSync(join(root, 'public/samples/levain/violin'), { recursive: true });
    mkdirSync(join(root, 'scripts'), { recursive: true });
    writeFileSync(join(root, 'public/samples/levain/violin/note.wav'), sample);
    writeFileSync(join(root, 'public/samples/levain/violin/manifest.json'), manifest);
    writeFileSync(join(root, 'scripts/download.ts'), '');
    return {
        schemaVersion: 1,
        source: {
            repository: 'https://github.com/sgossner/VSCO-2-CE',
            revision: 'a'.repeat(40),
            tree: 'b'.repeat(40),
            license: 'CC0-1.0',
            licensePath: 'LICENSE',
            licenseBlob: 'c'.repeat(40),
        },
        samples: [
            {
                path: 'public/samples/levain/violin/note.wav',
                sourcePath: 'Strings/Violin/note.wav',
                gitBlob: digest('sha1', sample),
                sha256: digest('sha256', sample),
            },
        ],
        generatedFiles: [
            {
                path: 'public/samples/levain/violin/manifest.json',
                source: 'scripts/download.ts',
                license: 'project-source',
                sha256: digest('sha256', manifest),
            },
        ],
    };
}

describe('Levain provenance', () => {
    it('parses the compact ledger', () => {
        const sample = Buffer.from('sample');
        expect(
            parseLevainProvenance(
                [
                    '#\tschemaVersion\t1',
                    '#\trepository\thttps://github.com/sgossner/VSCO-2-CE',
                    `#\trevision\t${'a'.repeat(40)}`,
                    `#\ttree\t${'b'.repeat(40)}`,
                    '#\tlicense\tCC0-1.0',
                    '#\tlicensePath\tLICENSE',
                    `#\tlicenseBlob\t${'c'.repeat(40)}`,
                    'kind\tpath\tsource\tgitBlob\tsha256\tlicense',
                    `sample\tpublic/samples/levain/violin/note.wav\tStrings/Violin/note.wav\t${digest('sha1', sample)}\t${digest('sha256', sample)}\tCC0-1.0`,
                ].join('\n')
            ).samples
        ).toHaveLength(1);
    });

    it('accepts complete file-level provenance', () => {
        const root = mkdtempSync(join(tmpdir(), 'levain-provenance-'));
        try {
            expect(validateLevainProvenance(root, fixture(root))).toEqual([]);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('rejects payload drift and unproven files', () => {
        const root = mkdtempSync(join(tmpdir(), 'levain-provenance-'));
        try {
            const provenance = fixture(root);
            writeFileSync(join(root, 'public/samples/levain/violin/note.wav'), 'changed');
            writeFileSync(join(root, 'public/samples/levain/violin/extra.wav'), 'extra');
            expect(validateLevainProvenance(root, provenance)).toEqual(
                expect.arrayContaining([
                    expect.stringContaining('unproven Levain files'),
                    expect.stringContaining('upstream blob drifted'),
                    expect.stringContaining('SHA-256 drifted'),
                ])
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
