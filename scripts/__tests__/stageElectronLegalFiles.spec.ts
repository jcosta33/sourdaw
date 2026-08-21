import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    createAfterExtract,
    stageElectronLegalFiles,
    verifyStagedElectronLegalFiles,
    type AfterPackContext,
} from '../flipElectronFuses';

import type { ElectronRuntimeContract } from '../electronRuntimeContract';

const roots: string[] = [];

function digest(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function fixture(): { root: string; source: string; context: AfterPackContext; contract: ElectronRuntimeContract } {
    const root = mkdtempSync(join(tmpdir(), 'sourdaw-electron-legal-'));
    roots.push(root);
    const source = join(root, 'electron-dist');
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, 'LICENSE'), 'license');
    writeFileSync(join(source, 'LICENSES.chromium.html'), 'notices');
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
            {
                platform: 'win32',
                arch: 'x64',
                archive: 'electron-v1.2.3-win32-x64.zip',
                sha256: digest('windows-archive'),
                noticesSha256: digest('notices'),
            },
        ],
    };
    return {
        root,
        source,
        contract,
        context: {
            appOutDir: join(root, 'out'),
            electronPlatformName: 'darwin',
            arch: 3,
            packager: { appInfo: { productFilename: 'Sourdaw' } },
        },
    };
}

afterEach(() => {
    for (const root of roots.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
});

describe('Electron legal-file staging', () => {
    it("accepts electron-builder's one-argument afterExtract call", async () => {
        const { root, source, context, contract } = fixture();
        mkdirSync(context.appOutDir, { recursive: true });
        for (const name of ['LICENSE', 'LICENSES.chromium.html']) {
            writeFileSync(join(context.appOutDir, name), readFileSync(join(source, name)));
        }

        await createAfterExtract(contract)(context);

        const legal = join(root, 'out/Electron.app/Contents/Resources/legal');
        expect(readFileSync(join(legal, 'electron-LICENSE.txt'), 'utf8')).toBe('license');
        expect(readFileSync(join(legal, 'electron-LICENSES.chromium.html'), 'utf8')).toBe('notices');
    });

    it('rejects altered upstream legal bytes', async () => {
        const { source, context, contract } = fixture();
        writeFileSync(join(source, 'LICENSES.chromium.html'), 'different');

        await expect(stageElectronLegalFiles(context, source, contract)).rejects.toThrow(
            'LICENSES.chromium.html does not match Electron 1.2.3'
        );
    });

    it("reads electron-builder's renamed Windows license", async () => {
        const { root, source, context, contract } = fixture();
        writeFileSync(join(source, 'LICENSE.electron.txt'), 'license');
        const windows = { ...context, electronPlatformName: 'win32', arch: 1 };
        await stageElectronLegalFiles(windows, source, contract);

        const legal = join(root, 'out/resources/legal');
        expect(readFileSync(join(legal, 'electron-LICENSE.txt'), 'utf8')).toBe('license');
        expect(readFileSync(join(legal, 'electron-LICENSES.chromium.html'), 'utf8')).toBe('notices');
    });

    it('rejects legal files changed after extraction', async () => {
        const { root, context, contract } = fixture();
        const legal = join(root, 'out/Sourdaw.app/Contents/Resources/legal');
        mkdirSync(legal, { recursive: true });
        writeFileSync(join(legal, 'electron-LICENSE.txt'), 'license');
        writeFileSync(join(legal, 'electron-LICENSES.chromium.html'), 'different');

        await expect(verifyStagedElectronLegalFiles(context, contract)).rejects.toThrow(
            'electron-LICENSES.chromium.html changed after Electron extraction'
        );
    });

    it('rejects an unpinned package target', async () => {
        const { source, context, contract } = fixture();

        await expect(stageElectronLegalFiles({ ...context, arch: 1 }, source, contract)).rejects.toThrow(
            'Electron legal-file contract has no darwin/1 target'
        );
    });
});
