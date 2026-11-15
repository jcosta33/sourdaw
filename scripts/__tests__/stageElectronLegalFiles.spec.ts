import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createAfterExtract, verifyStagedElectronLegalFiles, type AfterPackContext } from '../flipElectronFuses';

import type { ElectronRuntimeContract } from '../electronRuntimeContract';

const roots: string[] = [];

function digest(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function fixture(): { root: string; context: AfterPackContext; contract: ElectronRuntimeContract } {
    const root = mkdtempSync(join(tmpdir(), 'sourdaw-electron-legal-'));
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
            {
                platform: 'linux',
                arch: 'x64',
                archive: 'electron-v1.2.3-linux-x64.zip',
                sha256: digest('linux-archive'),
                noticesSha256: digest('notices'),
            },
            {
                platform: 'linux',
                arch: 'arm64',
                archive: 'electron-v1.2.3-linux-arm64.zip',
                sha256: digest('linux-arm64-archive'),
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
        contract,
        context: {
            appOutDir: join(root, 'out'),
            electronPlatformName: 'darwin',
            arch: 3,
            packager: { appInfo: { productFilename: 'Sourdaw' } },
        },
    };
}

function writePostCleanupFiles(context: AfterPackContext): string {
    const source =
        context.electronPlatformName === 'darwin' || context.electronPlatformName === 'mas'
            ? join(context.appOutDir, 'Electron.app/Contents/Resources')
            : context.appOutDir;
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, 'LICENSE.electron.txt'), 'license');
    writeFileSync(join(source, 'LICENSES.chromium.html'), 'notices');
    return source;
}

afterEach(() => {
    for (const root of roots.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
});

describe('Electron legal-file staging', () => {
    it.each([
        {
            platform: 'darwin',
            arch: 3,
            source: 'Electron.app/Contents/Resources',
            final: 'Sourdaw.app/Contents/Resources',
        },
        { platform: 'win32', arch: 1, source: 'resources', final: 'resources' },
        { platform: 'linux', arch: 1, source: 'resources', final: 'resources' },
        { platform: 'linux', arch: 3, source: 'resources', final: 'resources' },
    ])('stages and verifies post-cleanup files for $platform', async ({ platform, arch, source, final }) => {
        const { context, contract } = fixture();
        const target = { ...context, electronPlatformName: platform, arch };
        writePostCleanupFiles(target);

        await createAfterExtract(contract)(target);

        const legal = join(target.appOutDir, source, 'legal');
        expect(readFileSync(join(legal, 'electron-LICENSE.txt'), 'utf8')).toBe('license');
        expect(readFileSync(join(legal, 'electron-LICENSES.chromium.html'), 'utf8')).toBe('notices');
        if (platform === 'darwin') {
            renameSync(join(target.appOutDir, 'Electron.app'), join(target.appOutDir, 'Sourdaw.app'));
        }
        expect(readFileSync(join(target.appOutDir, final, 'legal/electron-LICENSE.txt'), 'utf8')).toBe('license');
        await expect(verifyStagedElectronLegalFiles(target, contract)).resolves.toBeUndefined();
    });

    it.each(['LICENSE.electron.txt', 'LICENSES.chromium.html'])('rejects altered upstream %s', async (name) => {
        const { context, contract } = fixture();
        const source = writePostCleanupFiles(context);
        writeFileSync(join(source, name), 'different');

        await expect(createAfterExtract(contract)(context)).rejects.toThrow(`${name} does not match Electron 1.2.3`);
    });

    it.each(['LICENSE.electron.txt', 'LICENSES.chromium.html'])('rejects missing upstream %s', async (name) => {
        const { context, contract } = fixture();
        const source = writePostCleanupFiles(context);
        unlinkSync(join(source, name));

        await expect(createAfterExtract(contract)(context)).rejects.toMatchObject({
            code: 'ENOENT',
            path: join(source, name),
        });
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

    it.each([
        { platform: 'darwin', arch: 1 },
        { platform: 'mas', arch: 3 },
        { platform: 'freebsd', arch: 1 },
    ])('rejects unpinned $platform/$arch', async ({ platform, arch }) => {
        const { context, contract } = fixture();
        await expect(
            createAfterExtract(contract)({ ...context, electronPlatformName: platform, arch })
        ).rejects.toThrow(`Electron legal-file contract has no ${platform}/${String(arch)} target`);
    });
});
