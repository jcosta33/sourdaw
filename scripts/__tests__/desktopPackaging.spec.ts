import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FuseState, FuseV1Options, FuseVersion, flipFuses, getCurrentFuseWire } from '@electron/fuses';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ELECTRON_RUNTIME_CONTRACT } from '../electronRuntimeContract';
import {
    afterPack,
    createAfterPack,
    REQUIRED_FUSES,
    resolvePackagedResourcesPath,
    type AfterPackContext,
} from '../flipElectronFuses';

vi.mock('@electron/fuses', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@electron/fuses')>()),
    flipFuses: vi.fn(),
    getCurrentFuseWire: vi.fn(),
}));

const roots: string[] = [];
const digest = (value: string): string => createHash('sha256').update(value).digest('hex');

function macho(addon: boolean): Buffer {
    const bytes = Buffer.alloc(256);
    bytes.writeUInt32LE(0xfeedfacf, 0);
    bytes.writeUInt32LE(0x0100000c, 4);
    bytes.writeUInt32LE(addon ? 6 : 2, 12);
    bytes.writeUInt32LE(2, 16);
    bytes.writeUInt32LE(96, 20);
    bytes.writeUInt32LE(0x32, 32);
    bytes.writeUInt32LE(24, 36);
    bytes.writeUInt32LE(1, 40);
    bytes.writeUInt32LE(0x19, 56);
    bytes.writeUInt32LE(72, 60);
    bytes.writeBigUInt64LE(256n, 104);
    return bytes;
}

function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'sourdaw-after-pack-'));
    roots.push(root);
    const context: AfterPackContext = {
        appOutDir: root,
        electronPlatformName: 'darwin',
        arch: 3,
        packager: { appInfo: { productFilename: 'Sourdaw' } },
    };
    const resources = resolvePackagedResourcesPath(context);
    mkdirSync(join(resources, 'legal'), { recursive: true });
    writeFileSync(join(resources, 'sourdaw-native.node'), macho(true));
    writeFileSync(join(resources, 'sourdaw-plugin-scan-helper'), macho(false), { mode: 0o755 });
    writeFileSync(join(resources, 'legal/electron-LICENSE.txt'), 'license');
    writeFileSync(join(resources, 'legal/electron-LICENSES.chromium.html'), 'notices');
    const contract = {
        ...ELECTRON_RUNTIME_CONTRACT,
        licenseSha256: digest('license'),
        targets: ELECTRON_RUNTIME_CONTRACT.targets.map((target) => ({ ...target, noticesSha256: digest('notices') })),
    };
    return { context, resources, hook: createAfterPack(contract) };
}

beforeEach(() => {
    vi.mocked(flipFuses).mockResolvedValue(0);
    const wire = {
        version: FuseVersion.V1 as const,
        ...Object.fromEntries(
            Array.from(REQUIRED_FUSES, ([fuse, enabled]) => [fuse, enabled ? FuseState.ENABLE : FuseState.DISABLE])
        ),
    };
    vi.mocked(getCurrentFuseWire).mockResolvedValue(wire);
});

afterEach(() => {
    vi.clearAllMocks();
    for (const root of roots.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
});

describe('desktop afterPack native admission and hardening', () => {
    for (const artifact of ['sourdaw-native.node', 'sourdaw-plugin-scan-helper']) {
        it(`rejects foreign ${artifact} before fuse mutation`, async () => {
            const { context, resources, hook } = fixture();
            const foreign = macho(artifact.endsWith('.node'));
            foreign.writeUInt32LE(0x01000007, 4);
            writeFileSync(join(resources, artifact), foreign);

            await expect(hook(context)).rejects.toThrow(new RegExp(`${artifact}.*darwin/arm64`));
            expect(flipFuses).not.toHaveBeenCalled();
            expect(getCurrentFuseWire).not.toHaveBeenCalled();
        });
    }

    it('keeps the named electron-builder hook guarded', async () => {
        const { context, resources } = fixture();
        writeFileSync(join(resources, 'sourdaw-native.node'), Buffer.from('wrong target'));
        await expect(afterPack(context)).rejects.toThrow(/sourdaw-native.node.*darwin\/arm64/);
        expect(flipFuses).not.toHaveBeenCalled();
    });

    it('flips and reads back required fuses after matching native and legal bytes', async () => {
        const { context, hook } = fixture();
        await expect(hook(context)).resolves.toBeUndefined();
        const binary = join(context.appOutDir, 'Sourdaw.app');
        expect(flipFuses).toHaveBeenCalledExactlyOnceWith(binary, {
            version: FuseVersion.V1,
            ...Object.fromEntries(REQUIRED_FUSES),
        });
        expect(getCurrentFuseWire).toHaveBeenCalledExactlyOnceWith(binary);
    });

    it('preserves final staged legal-file refusal before fuse mutation', async () => {
        const { context, resources, hook } = fixture();
        writeFileSync(join(resources, 'legal/electron-LICENSES.chromium.html'), 'tampered');
        await expect(hook(context)).rejects.toThrow(
            'electron-LICENSES.chromium.html changed after Electron extraction'
        );
        expect(flipFuses).not.toHaveBeenCalled();
    });

    it('preserves fuse readback refusal', async () => {
        const { context, hook } = fixture();
        vi.mocked(getCurrentFuseWire).mockResolvedValue({
            version: FuseVersion.V1,
            [FuseV1Options.RunAsNode]: FuseState.ENABLE,
        });
        await expect(hook(context)).rejects.toThrow(/Electron fuses were not applied.*RunAsNode/);
    });
});
