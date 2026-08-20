import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { type LgplRuntimeContract, validateLgplRuntimeProvenance } from '../checkLgplRuntimeProvenance';

const roots: string[] = [];

function write(root: string, path: string, value: string | Buffer): void {
    const absolute = join(root, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, value);
}

type TestSource = {
    id: string;
    repository: string;
    revision: string;
    version?: string;
    relationship: 'npm-gitHead' | 'embedded-version-match';
    archive: string;
};

type TestComponent = {
    id: string;
    package: string;
    version: string;
    specifier: string;
    integrity: string;
    repository: string;
    revision: string;
    distribution: 'copied-byte-for-byte' | 'vite-bundle';
    packageLicense: string;
    license: string;
    licenseFiles: Record<string, string>;
    packageFiles: Record<string, string>;
    shippedFiles: Record<string, string>;
    sources: TestSource[];
    integration?: { file: string; import: string };
};

function readComponents(root: string): TestComponent[] {
    return (
        JSON.parse(readFileSync(join(root, 'public/legal/SOURCES.json'), 'utf8')) as {
            components: TestComponent[];
        }
    ).components;
}

function fixtureContract(root: string): LgplRuntimeContract {
    return Object.fromEntries(
        readComponents(root).map((component) => [
            component.id,
            {
                package: component.package,
                version: component.version,
                specifier: component.specifier,
                integrity: component.integrity,
                repository: component.repository,
                revision: component.revision,
                distribution: component.distribution,
                packageLicense: component.packageLicense,
                license: component.license,
                licenseFiles: component.licenseFiles,
                packageFiles: component.packageFiles,
                shippedFiles: component.shippedFiles,
                sources: Object.fromEntries(component.sources.map((source) => [source.id, source])),
                integration: component.integration,
            },
        ])
    );
}

function mutateComponent(root: string, mutate: (component: TestComponent) => void): void {
    const path = join(root, 'public/legal/SOURCES.json');
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as { components: TestComponent[] };
    mutate(manifest.components[0]!);
    writeFileSync(path, JSON.stringify(manifest));
}

function fixture(): { root: string; contract: LgplRuntimeContract } {
    const root = mkdtempSync(join(tmpdir(), 'sourdaw-lgpl-'));
    roots.push(root);
    const revision = 'a'.repeat(40);
    const compilerRevision = 'b'.repeat(40);
    const lameRevision = 'c'.repeat(40);
    const archive = `https://github.com/grame-cncm/faustwasm/archive/${revision}.tar.gz`;
    const compilerArchive = `https://github.com/grame-cncm/faust/archive/${compilerRevision}.tar.gz`;
    const lameArchive = `https://github.com/gideonstele/lamejs/archive/${lameRevision}.tar.gz`;
    const digest = 'sha256:8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4';

    write(
        root,
        'package.json',
        JSON.stringify({ dependencies: { '@grame/faustwasm': '1.0.0', '@breezystack/lamejs': '1.2.7' } })
    );
    write(
        root,
        'pnpm-lock.yaml',
        `importers:\n\n  .:\n    dependencies:\n      '@breezystack/lamejs':\n        specifier: 1.2.7\n        version: 1.2.7\n      '@grame/faustwasm':\n        specifier: 1.0.0\n        version: 1.0.0\n\npackages:\n\n  '@breezystack/lamejs@1.2.7':\n    resolution: {integrity: sha512-lame}\n\n  '@grame/faustwasm@1.0.0':\n    resolution: {integrity: sha512-test}\n`
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
    write(
        root,
        'src/modules/AudioRendering/repositories/audioEncoders/mp3Encoder.ts',
        "import { Mp3Encoder } from '@breezystack/lamejs';"
    );
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
                    distribution: 'copied-byte-for-byte',
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
                    distribution: 'vite-bundle',
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

    return { root, contract: fixtureContract(root) };
}

afterEach(() => {
    for (const root of roots.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
});

describe('LGPL runtime provenance', () => {
    it('accepts exact package, source, license, and shipped-file evidence', () => {
        const { root, contract } = fixture();
        expect(validateLgplRuntimeProvenance(root, contract)).toEqual([]);
    });

    it('rejects a shipped binary that no longer matches the package', () => {
        const { root, contract } = fixture();
        write(root, 'public/faust/libfaust-wasm.wasm', 'different 2.0.0');

        expect(validateLgplRuntimeProvenance(root, contract)).toContain(
            'faustwasm: shipped file differs from package: public/faust/libfaust-wasm.wasm'
        );
    });

    it('rejects a source revision omitted from user directions', () => {
        const { root, contract } = fixture();
        write(root, 'public/legal/THIRD-PARTY-NOTICES.md', '1.0.0 LGPL-2.1-or-later');

        expect(validateLgplRuntimeProvenance(root, contract)).toContain(
            `faustwasm: source directions omit ${'a'.repeat(40)}`
        );
    });

    it('rejects deletion of a required license file contract', () => {
        const { root, contract } = fixture();
        mutateComponent(root, (component) => {
            delete component.licenseFiles['public/legal/faustwasm-COPYING.txt'];
        });

        expect(validateLgplRuntimeProvenance(root, contract)).toContain('faustwasm: required license evidence drifted');
    });

    it('rejects redirection of a shipped file mapping', () => {
        const { root, contract } = fixture();
        mutateComponent(root, (component) => {
            component.shippedFiles['public/faust/libfaust-wasm.wasm'] = 'COPYING.txt';
        });

        expect(validateLgplRuntimeProvenance(root, contract)).toContain('faustwasm: shipped file mapping drifted');
    });

    it('rejects duplicate source identities', () => {
        const { root, contract } = fixture();
        mutateComponent(root, (component) => {
            component.sources.push({ ...component.sources[0]! });
        });

        expect(validateLgplRuntimeProvenance(root, contract)).toContain('faustwasm: source IDs must be unique');
    });

    it('rejects an integrity found outside the exact package resolution', () => {
        const { root, contract } = fixture();
        write(
            root,
            'pnpm-lock.yaml',
            `importers:\n\n  .:\n    dependencies:\n      '@grame/faustwasm':\n        specifier: 1.0.0\n        version: 1.0.0\n\npackages:\n\n  '@grame/faustwasm@1.0.0':\n    resolution: {integrity: sha512-wrong}\n\n  'other@1.0.0':\n    resolution: {integrity: sha512-test}\n`
        );

        expect(validateLgplRuntimeProvenance(root, contract)).toContain('faustwasm: lock resolution drifted');
    });

    it('rejects canonical-looking lock entries outside the root importer and packages maps', () => {
        const { root, contract } = fixture();
        write(
            root,
            'pnpm-lock.yaml',
            `importers:\n\n  .:\n    dependencies:\n      '@grame/faustwasm':\n        specifier: 9.0.0\n        version: 9.0.0\n\ndecoys:\n\n  importer:\n    dependencies:\n      '@grame/faustwasm':\n        specifier: 1.0.0\n        version: 1.0.0\n\n  package:\n    '@grame/faustwasm@1.0.0':\n      resolution: {integrity: sha512-test}\n`
        );

        expect(validateLgplRuntimeProvenance(root, contract)).toContain('faustwasm: lock resolution drifted');
    });

    it('rejects duplicate lockfile keys', () => {
        const { root, contract } = fixture();
        write(
            root,
            'pnpm-lock.yaml',
            `importers:\n\n  .:\n    dependencies:\n      '@grame/faustwasm':\n        specifier: 1.0.0\n        version: 1.0.0\n      '@grame/faustwasm':\n        specifier: 1.0.0\n        version: 1.0.0\n\npackages:\n\n  '@grame/faustwasm@1.0.0':\n    resolution: {integrity: sha512-test}\n`
        );

        expect(validateLgplRuntimeProvenance(root, contract)).toContain('faustwasm: lock resolution drifted');
    });

    it('rejects an import name left only as inert text', () => {
        const { root, contract } = fixture();
        write(
            root,
            'src/modules/AudioRendering/repositories/audioEncoders/mp3Encoder.ts',
            "const removedImport = '@breezystack/lamejs';"
        );

        expect(validateLgplRuntimeProvenance(root, contract)).toContain('lamejs: integration import drifted');
    });
});
