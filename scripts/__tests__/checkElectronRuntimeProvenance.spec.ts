import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { validateElectronRuntimeProvenance, validateElectronSourcesOnline } from '../checkElectronRuntimeProvenance';

import type { ElectronRuntimeContract } from '../electronRuntimeContract';

const roots: string[] = [];

function digest(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function write(root: string, path: string, value: string): void {
    const absolute = join(root, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, value);
}

function noticeText(contract: ElectronRuntimeContract): string {
    return [
        contract.version,
        contract.license,
        contract.revision,
        contract.chromium.version,
        contract.chromium.revision,
        contract.node.version,
        contract.node.revision,
        contract.ffmpeg.revision,
        contract.ffmpeg.license,
        'electron-LICENSE.txt',
        'electron-LICENSES.chromium.html',
        'ELECTRON-SOURCES.json',
    ].join(' ');
}

function upstreamFetch(contract: ElectronRuntimeContract): typeof fetch {
    return async (input) => {
        let url: string;
        if (typeof input === 'string') {
            url = input;
        } else if (input instanceof URL) {
            url = input.href;
        } else {
            url = input.url;
        }
        if (url.startsWith('https://registry.npmjs.org/electron/')) {
            return Response.json({ dist: { integrity: contract.integrity } });
        }
        if (url.endsWith('/SHASUMS256.txt')) {
            return new Response(contract.targets.map((target) => `${target.sha256} *${target.archive}`).join('\n'));
        }
        if (url.includes('raw.githubusercontent.com/electron/electron')) {
            return new Response(`${contract.chromium.version} ${contract.node.version}`);
        }
        if (url.includes('/electron/electron/git/ref/tags/')) {
            return Response.json({
                object: {
                    sha: 'electron-tag',
                    type: 'tag',
                    url: 'https://api.github.com/repos/electron/electron/git/tags/electron-tag',
                },
            });
        }
        if (url.endsWith('/git/tags/electron-tag')) {
            return Response.json({ object: { sha: contract.revision } });
        }
        if (url.includes('/nodejs/node/git/ref/tags/')) {
            return Response.json({
                object: {
                    sha: 'node-tag',
                    type: 'tag',
                    url: 'https://api.github.com/repos/nodejs/node/git/tags/node-tag',
                },
            });
        }
        if (url.endsWith('/git/tags/node-tag')) {
            return Response.json({ object: { sha: contract.node.revision } });
        }
        if (url.includes('/chromium/src/+/') && url.endsWith('/DEPS?format=TEXT')) {
            return new Response(Buffer.from(`'ffmpeg_revision': '${contract.ffmpeg.revision}'`).toString('base64'));
        }
        if (url.includes('/chromium/third_party/ffmpeg/+/')) {
            return new Response(`)]}'\n${JSON.stringify({ commit: contract.ffmpeg.revision })}`);
        }
        if (url.startsWith('https://chromium.googlesource.com/chromium/src/+/refs/tags/')) {
            return new Response(`)]}'\n${JSON.stringify({ commit: contract.chromium.revision })}`);
        }
        return new Response('missing fixture', { status: 404 });
    };
}

function fixture(): { root: string; contract: ElectronRuntimeContract } {
    const root = mkdtempSync(join(tmpdir(), 'sourdaw-electron-provenance-'));
    roots.push(root);
    const contract: ElectronRuntimeContract = {
        schemaVersion: 1,
        package: 'electron',
        version: '1.2.3',
        specifier: '1.2.3',
        integrity: 'sha512-test',
        license: 'MIT',
        repository: 'https://github.com/electron/electron',
        revision: 'a'.repeat(40),
        licenseSha256: digest('license'),
        chromium: {
            version: '4.5.6',
            repository: 'https://chromium.googlesource.com/chromium/src',
            revision: 'b'.repeat(40),
        },
        node: {
            version: 'v7.8.9',
            repository: 'https://github.com/nodejs/node',
            revision: 'c'.repeat(40),
        },
        ffmpeg: {
            repository: 'https://chromium.googlesource.com/chromium/third_party/ffmpeg',
            revision: 'e'.repeat(40),
            license: 'LGPL-2.1-or-later',
        },
        targets: [
            {
                platform: 'darwin',
                arch: 'arm64',
                archive: 'electron-v1.2.3-darwin-arm64.zip',
                sha256: digest('archive'),
                noticesSha256: digest('notices'),
            },
        ],
    };

    write(root, 'package.json', JSON.stringify({ devDependencies: { electron: '1.2.3' } }));
    write(
        root,
        'pnpm-lock.yaml',
        `importers:\n\n  .:\n    devDependencies:\n      electron:\n        specifier: 1.2.3\n        version: 1.2.3\n\npackages:\n\n  electron@1.2.3:\n    resolution: {integrity: sha512-test}\n`
    );
    write(root, 'node_modules/electron/package.json', JSON.stringify({ version: '1.2.3', license: 'MIT' }));
    write(root, 'node_modules/electron/LICENSE', 'license');
    write(
        root,
        'node_modules/electron/checksums.json',
        JSON.stringify({ 'electron-v1.2.3-darwin-arm64.zip': digest('archive') })
    );
    write(root, 'public/legal/ELECTRON-SOURCES.json', JSON.stringify(contract));
    write(root, 'public/legal/THIRD-PARTY-NOTICES.md', noticeText(contract));
    write(
        root,
        'public/legal/RELINKING.md',
        `${contract.ffmpeg.revision} libffmpeg.dylib libffmpeg.so ffmpeg.dll Desktop releases must also include required to rebuild the shipped Electron FFmpeg library`
    );
    write(
        root,
        'electron-builder.yml',
        'afterExtract: ./scripts/flipElectronFuses.ts\nafterPack: ./scripts/flipElectronFuses.ts\n'
    );
    return { root, contract };
}

afterEach(() => {
    for (const root of roots.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
});

describe('Electron runtime provenance', () => {
    it('accepts exact package, source, release, and notice evidence', () => {
        const { root, contract } = fixture();
        expect(validateElectronRuntimeProvenance(root, contract)).toEqual([]);
    });

    it('rejects a self-authorized manifest change', () => {
        const { root, contract } = fixture();
        const manifest = JSON.parse(readFileSync(join(root, 'public/legal/ELECTRON-SOURCES.json'), 'utf8')) as {
            revision: string;
        };
        manifest.revision = 'd'.repeat(40);
        write(root, 'public/legal/ELECTRON-SOURCES.json', JSON.stringify(manifest));

        expect(validateElectronRuntimeProvenance(root, contract)).toContain('Electron source manifest drifted');
    });

    it('rejects duplicate lockfile keys', () => {
        const { root, contract } = fixture();
        write(
            root,
            'pnpm-lock.yaml',
            `importers:\n  .:\n    devDependencies:\n      electron: {specifier: 1.2.3, version: 1.2.3}\n      electron: {specifier: 1.2.3, version: 1.2.3}\npackages:\n  electron@1.2.3:\n    resolution: {integrity: sha512-test}\n`
        );

        expect(validateElectronRuntimeProvenance(root, contract)).toContain('Electron lock resolution drifted');
    });

    it('rejects a release checksum found only in the manifest', () => {
        const { root, contract } = fixture();
        write(root, 'node_modules/electron/checksums.json', '{}');

        expect(validateElectronRuntimeProvenance(root, contract)).toContain(
            'electron-v1.2.3-darwin-arm64.zip: Electron release checksum drifted'
        );
    });

    it('rejects missing user-visible runtime identities', () => {
        const { root, contract } = fixture();
        write(root, 'public/legal/THIRD-PARTY-NOTICES.md', 'Electron');

        expect(validateElectronRuntimeProvenance(root, contract)).toContain('Electron user notices drifted');
    });

    it('rejects a commented-out packaging hook', () => {
        const { root, contract } = fixture();
        write(root, 'electron-builder.yml', '# afterExtract: ./scripts/flipElectronFuses.ts\n');

        expect(validateElectronRuntimeProvenance(root, contract)).toContain(
            'Electron legal-file packaging hook drifted'
        );
    });

    it('rejects a commented-out final-package hook', () => {
        const { root, contract } = fixture();
        write(
            root,
            'electron-builder.yml',
            'afterExtract: ./scripts/flipElectronFuses.ts\n# afterPack: ./scripts/flipElectronFuses.ts\n'
        );

        expect(validateElectronRuntimeProvenance(root, contract)).toContain(
            'Electron final-package verification hook drifted'
        );
    });

    it('validates every source revision against its upstream tag', async () => {
        const { root, contract } = fixture();

        await expect(validateElectronSourcesOnline(root, contract, upstreamFetch(contract))).resolves.toEqual([]);
    });

    it('rejects coordinated local revision tampering', async () => {
        const { root, contract } = fixture();
        const altered = { ...contract, revision: 'd'.repeat(40) };
        write(root, 'public/legal/ELECTRON-SOURCES.json', JSON.stringify(altered));
        write(root, 'public/legal/THIRD-PARTY-NOTICES.md', noticeText(altered));

        await expect(validateElectronSourcesOnline(root, altered, upstreamFetch(contract))).resolves.toContain(
            'Electron source revision drifted'
        );
    });
});
