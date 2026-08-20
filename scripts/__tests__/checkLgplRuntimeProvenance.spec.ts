import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

function mutateComponent(
    root: string,
    mutate: (component: { licenseFiles: Record<string, string>; shippedFiles: Record<string, string> }) => void
): void {
    const path = join(root, 'public/legal/SOURCES.json');
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as {
        components: Array<{ licenseFiles: Record<string, string>; shippedFiles: Record<string, string> }>;
    };
    mutate(manifest.components[0]!);
    writeFileSync(path, JSON.stringify(manifest));
}

function fixture(): string {
    const root = mkdtempSync(join(tmpdir(), 'sourdaw-lgpl-'));
    roots.push(root);
    const revision = 'a'.repeat(40);
    const compilerRevision = 'b'.repeat(40);
    const lameRevision = 'c'.repeat(40);
    const archive = `https://example.com/faustwasm/${revision}.tar.gz`;
    const compilerArchive = `https://example.com/faust/${compilerRevision}.tar.gz`;
    const lameArchive = `https://example.com/lamejs/${lameRevision}.tar.gz`;
    const digest = 'sha256:8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4';

    write(
        root,
        'package.json',
        JSON.stringify({ dependencies: { '@grame/faustwasm': '1.0.0', '@breezystack/lamejs': '1.2.7' } })
    );
    write(
        root,
        'pnpm-lock.yaml',
        `'@grame/faustwasm@1.0.0':\n  integrity: sha512-test\n'@breezystack/lamejs@1.2.7':\n  integrity: sha512-lame\n`
    );
    write(
        root,
        'public/legal/THIRD-PARTY-NOTICES.md',
        `1.0.0 LGPL-2.1-or-later ${archive} ${compilerArchive} 1.2.7 LGPL-3.0-only ${lameArchive}`
    );
    write(root, 'public/legal/RELINKING.md', 'replace and rebuild');
    write(root, 'public/legal/faustwasm-COPYING.txt', 'hi');
    write(root, 'public/legal/LGPL-3.0-and-GPL-3.0.txt', 'hi');
    write(root, 'public/legal/lamejs-NOTICE.txt', 'hi');
    write(root, 'public/faust/libfaust-wasm.data', 'hi');
    write(root, 'public/faust/libfaust-wasm.js', 'hi');
    write(root, 'public/faust/libfaust-wasm.wasm', 'compiler 2.0.0');
    write(root, 'electron-builder.yml', 'extraResources:\n  - from: public/legal\n    to: legal\n');
    write(
        root,
        'src/modules/WorkspaceShell/presentations/views/StatusBar.tsx',
        "window.open('/legal/THIRD-PARTY-NOTICES.md', '_blank')"
    );
    write(
        root,
        'node_modules/@grame/faustwasm/package.json',
        JSON.stringify({ version: '1.0.0', license: 'LGPL-3.0' })
    );
    write(root, 'node_modules/@grame/faustwasm/COPYING.txt', 'hi');
    write(root, 'node_modules/@grame/faustwasm/libfaust-wasm/libfaust-wasm.data', 'hi');
    write(root, 'node_modules/@grame/faustwasm/libfaust-wasm/libfaust-wasm.js', 'hi');
    write(root, 'node_modules/@grame/faustwasm/libfaust-wasm/libfaust-wasm.wasm', 'compiler 2.0.0');
    write(
        root,
        'node_modules/@breezystack/lamejs/package.json',
        JSON.stringify({ version: '1.2.7', license: 'LGPL-3.0' })
    );
    write(root, 'node_modules/@breezystack/lamejs/LICENSE', 'hi');
    write(root, 'node_modules/@breezystack/lamejs/dist/lamejs.js', 'hi');
    write(root, 'src/modules/AudioRendering/repositories/audioEncoders/mp3Encoder.ts', '@breezystack/lamejs');
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
                    repository: 'https://github.com/grame-cncm/faustwasm',
                    revision,
                    modifications: 'none',
                    packageLicense: 'LGPL-3.0',
                    license: 'LGPL-2.1-or-later',
                    licenseFiles: { 'public/legal/faustwasm-COPYING.txt': digest },
                    packageFiles: {
                        'COPYING.txt': digest,
                        'libfaust-wasm/libfaust-wasm.data': digest,
                        'libfaust-wasm/libfaust-wasm.js': digest,
                        'libfaust-wasm/libfaust-wasm.wasm':
                            'sha256:f34dd9e8ed3d877aee09faa18ae08a6eb543350518511466fd34b55678faf711',
                    },
                    shippedFiles: {
                        'public/faust/libfaust-wasm.data': 'libfaust-wasm/libfaust-wasm.data',
                        'public/faust/libfaust-wasm.js': 'libfaust-wasm/libfaust-wasm.js',
                        'public/faust/libfaust-wasm.wasm': 'libfaust-wasm/libfaust-wasm.wasm',
                    },
                    sources: [
                        {
                            id: 'faustwasm',
                            repository: 'https://github.com/grame-cncm/faustwasm',
                            revision,
                            relationship: 'npm-gitHead',
                            archive,
                        },
                        {
                            id: 'faust-core',
                            repository: 'https://github.com/grame-cncm/faust',
                            revision: compilerRevision,
                            version: '2.0.0',
                            relationship: 'embedded-version-match',
                            archive: compilerArchive,
                        },
                    ],
                },
                {
                    id: 'lamejs',
                    package: '@breezystack/lamejs',
                    version: '1.2.7',
                    specifier: '1.2.7',
                    integrity: 'sha512-lame',
                    repository: 'https://github.com/gideonstele/lamejs',
                    revision: lameRevision,
                    modifications: 'none',
                    packageLicense: 'LGPL-3.0',
                    license: 'LGPL-3.0-only',
                    licenseFiles: {
                        'public/legal/LGPL-3.0-and-GPL-3.0.txt': digest,
                        'public/legal/lamejs-NOTICE.txt': digest,
                    },
                    packageFiles: { LICENSE: digest, 'dist/lamejs.js': digest },
                    shippedFiles: {},
                    sources: [
                        {
                            id: 'lamejs',
                            repository: 'https://github.com/gideonstele/lamejs',
                            revision: lameRevision,
                            relationship: 'npm-gitHead',
                            archive: lameArchive,
                        },
                    ],
                    integration: {
                        file: 'src/modules/AudioRendering/repositories/audioEncoders/mp3Encoder.ts',
                        import: '@breezystack/lamejs',
                    },
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
        write(root, 'public/faust/libfaust-wasm.wasm', 'different 2.0.0');

        expect(validateLgplRuntimeProvenance(root)).toContain(
            'faustwasm: shipped file differs from package: public/faust/libfaust-wasm.wasm'
        );
    });

    it('rejects a source revision omitted from user directions', () => {
        const root = fixture();
        write(root, 'public/legal/THIRD-PARTY-NOTICES.md', '1.0.0 LGPL-2.1-or-later');

        expect(validateLgplRuntimeProvenance(root)).toContain(`faustwasm: source directions omit ${'a'.repeat(40)}`);
    });

    it('rejects deletion of a required license file contract', () => {
        const root = fixture();
        mutateComponent(root, (component) => {
            delete component.licenseFiles['public/legal/faustwasm-COPYING.txt'];
        });

        expect(validateLgplRuntimeProvenance(root)).toContain('faustwasm: required license files drifted');
    });

    it('rejects redirection of a shipped file mapping', () => {
        const root = fixture();
        mutateComponent(root, (component) => {
            component.shippedFiles['public/faust/libfaust-wasm.wasm'] = 'COPYING.txt';
        });

        expect(validateLgplRuntimeProvenance(root)).toContain('faustwasm: shipped file mapping drifted');
    });
});
