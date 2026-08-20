import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { validateLgplRuntimeProvenance } from '../checkLgplRuntimeProvenance';

const roots: string[] = [];

function write(root: string, path: string, value: string | Buffer): void {
    const absolute = join(root, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, value);
}

function fixture(): string {
    const root = mkdtempSync(join(tmpdir(), 'sourdaw-lgpl-'));
    roots.push(root);
    const revision = 'a'.repeat(40);
    const compilerRevision = 'b'.repeat(40);
    const archive = `https://example.com/faustwasm/${revision}.tar.gz`;
    const compilerArchive = `https://example.com/faust/${compilerRevision}.tar.gz`;
    const digest = 'sha256:8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4';

    write(root, 'package.json', JSON.stringify({ dependencies: { '@grame/faustwasm': '1.0.0' } }));
    write(root, 'pnpm-lock.yaml', `'@grame/faustwasm@1.0.0':\n  integrity: sha512-test\n`);
    write(root, 'public/legal/THIRD-PARTY-NOTICES.md', `1.0.0 LGPL-2.1-or-later ${archive} ${compilerArchive}`);
    write(root, 'public/legal/RELINKING.md', 'replace and rebuild');
    write(root, 'public/legal/COPYING.txt', 'hi');
    write(root, 'public/faust/libfaust.wasm', 'compiler 2.0.0');
    write(root, 'node_modules/@grame/faustwasm/package.json', JSON.stringify({ version: '1.0.0', license: 'LGPL' }));
    write(root, 'node_modules/@grame/faustwasm/COPYING.txt', 'hi');
    write(root, 'node_modules/@grame/faustwasm/libfaust.wasm', 'compiler 2.0.0');
    write(
        root,
        'public/legal/SOURCES.json',
        JSON.stringify({
            schemaVersion: 1,
            components: [
                {
                    id: 'faustwasm',
                    package: '@grame/faustwasm',
                    version: '1.0.0',
                    specifier: '1.0.0',
                    integrity: 'sha512-test',
                    repository: 'https://example.com/faustwasm',
                    revision,
                    packageLicense: 'LGPL',
                    license: 'LGPL-2.1-or-later',
                    licenseFiles: { 'public/legal/COPYING.txt': digest },
                    packageFiles: {
                        'COPYING.txt': digest,
                        'libfaust.wasm': 'sha256:f34dd9e8ed3d877aee09faa18ae08a6eb543350518511466fd34b55678faf711',
                    },
                    shippedFiles: { 'public/faust/libfaust.wasm': 'libfaust.wasm' },
                    sources: [
                        { repository: 'https://example.com/faustwasm', revision, archive },
                        {
                            repository: 'https://github.com/grame-cncm/faust',
                            revision: compilerRevision,
                            version: '2.0.0',
                            archive: compilerArchive,
                        },
                    ],
                },
            ],
        })
    );

    return root;
}

afterEach(() => {
    for (const root of roots.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
});

describe('LGPL runtime provenance', () => {
    it('accepts exact package, source, license, and shipped-file evidence', () => {
        const root = fixture();
        expect(validateLgplRuntimeProvenance(root)).toEqual([]);
    });

    it('rejects a shipped binary that no longer matches the package', () => {
        const root = fixture();
        write(root, 'public/faust/libfaust.wasm', 'different 2.0.0');

        expect(validateLgplRuntimeProvenance(root)).toContain(
            'faustwasm: shipped file differs from package: public/faust/libfaust.wasm'
        );
    });

    it('rejects a source revision omitted from user directions', () => {
        const root = fixture();
        write(root, 'public/legal/THIRD-PARTY-NOTICES.md', '1.0.0 LGPL-2.1-or-later');

        expect(validateLgplRuntimeProvenance(root)).toContain(`faustwasm: source directions omit ${'a'.repeat(40)}`);
    });
});
