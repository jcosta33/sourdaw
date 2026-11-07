import { chmodSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { verifyPackagedNativeArtifacts } from '../verifyPackagedNativeArtifacts';

const roots: string[] = [];
type Target = { platform: string; arch: number; cpu: number };
const targets: Target[] = [
    { platform: 'darwin', arch: 3, cpu: 0x0100000c },
    { platform: 'linux', arch: 1, cpu: 62 },
    { platform: 'linux', arch: 3, cpu: 183 },
    { platform: 'win32', arch: 1, cpu: 0x8664 },
];

// Minimal images contain a real header table and one file-backed segment/section.
// Header layouts follow Mach-O loader.h, the ELF gABI and Microsoft's PE format.
function image(target: Target, addon: boolean): Buffer {
    const bytes = Buffer.alloc(512);
    if (target.platform === 'darwin') {
        bytes.writeUInt32LE(0xfeedfacf, 0);
        bytes.writeUInt32LE(target.cpu, 4);
        bytes.writeUInt32LE(addon ? 6 : 2, 12);
        bytes.writeUInt32LE(2, 16);
        bytes.writeUInt32LE(96, 20);
        bytes.writeUInt32LE(0x32, 32); // LC_BUILD_VERSION, macOS
        bytes.writeUInt32LE(24, 36);
        bytes.writeUInt32LE(1, 40);
        bytes.writeUInt32LE(0x19, 56); // LC_SEGMENT_64
        bytes.writeUInt32LE(72, 60);
        bytes.writeBigUInt64LE(512n, 104);
    } else if (target.platform === 'linux') {
        bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]);
        bytes.writeUInt16LE(3, 16); // ET_DYN: shared object or PIE
        bytes.writeUInt16LE(target.cpu, 18);
        bytes.writeUInt32LE(1, 20);
        bytes.writeBigUInt64LE(addon ? 0n : 0x1000n, 24);
        bytes.writeBigUInt64LE(64n, 32);
        bytes.writeUInt16LE(64, 52);
        bytes.writeUInt16LE(56, 54);
        bytes.writeUInt16LE(1, 56);
        bytes.writeUInt32LE(1, 64); // PT_LOAD
        bytes.writeBigUInt64LE(512n, 96);
    } else {
        bytes.write('MZ');
        bytes.writeUInt32LE(64, 60);
        bytes.write('PE\0\0', 64);
        bytes.writeUInt16LE(target.cpu, 68);
        bytes.writeUInt16LE(1, 70);
        bytes.writeUInt16LE(240, 84);
        bytes.writeUInt16LE(addon ? 0x2022 : 0x22, 86);
        bytes.writeUInt16LE(0x20b, 88); // PE32+
        bytes.writeUInt32LE(0x1000, 104);
        bytes.writeUInt16LE(3, 156); // Windows CUI
        bytes.writeUInt32LE(16, 196);
        bytes.writeUInt32LE(144, 344); // Section raw size / offset
        bytes.writeUInt32LE(368, 348);
    }
    return bytes;
}

function fixture(target: Target): { root: string; addon: string; helper: string } {
    const root = mkdtempSync(join(tmpdir(), 'sourdaw-native-package-'));
    roots.push(root);
    const addon = join(root, 'sourdaw-native.node');
    const helper = join(root, `sourdaw-plugin-scan-helper${target.platform === 'win32' ? '.exe' : ''}`);
    writeFileSync(addon, image(target, true));
    writeFileSync(helper, image(target, false), { mode: 0o755 });
    return { root, addon, helper };
}

function alternateCpu(target: Target): number {
    if (target.platform === 'darwin') {
        return 0x01000007;
    }
    if (target.platform === 'win32') {
        return 0xaa64;
    }
    if (target.cpu === 62) {
        return 183;
    }
    return 62;
}

afterEach(() => {
    for (const root of roots.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
});

describe('packaged native target validation', () => {
    for (const target of targets) {
        const label = `${target.platform}/${target.arch === 3 ? 'arm64' : 'x64'}`;
        it(`accepts matching ${label} addon and helper`, async () => {
            const { root } = fixture(target);
            await expect(verifyPackagedNativeArtifacts(root, target.platform, target.arch)).resolves.toBeUndefined();
        });

        for (const artifact of ['addon', 'helper'] as const) {
            it(`rejects a foreign OS ${artifact} for ${label}`, async () => {
                const files = fixture(target);
                const foreign = targets.find((candidate) => candidate.platform !== target.platform)!;
                writeFileSync(files[artifact], image(foreign, artifact === 'addon'));
                await expect(verifyPackagedNativeArtifacts(files.root, target.platform, target.arch)).rejects.toThrow(
                    new RegExp(
                        `${artifact === 'addon' ? 'sourdaw-native.node' : 'sourdaw-plugin-scan-helper'}.*${label}`
                    )
                );
            });
            it(`rejects a missing ${artifact} for ${label}`, async () => {
                const files = fixture(target);
                unlinkSync(files[artifact]);
                await expect(verifyPackagedNativeArtifacts(files.root, target.platform, target.arch)).rejects.toThrow();
            });
            it(`rejects wrong ${artifact} kind for ${label}`, async () => {
                const files = fixture(target);
                writeFileSync(files[artifact], image(target, artifact !== 'addon'));
                await expect(verifyPackagedNativeArtifacts(files.root, target.platform, target.arch)).rejects.toThrow();
            });
            it(`rejects truncated ${artifact} payload for ${label}`, async () => {
                const files = fixture(target);
                writeFileSync(files[artifact], image(target, artifact === 'addon').subarray(0, 400));
                await expect(verifyPackagedNativeArtifacts(files.root, target.platform, target.arch)).rejects.toThrow();
            });
            it(`rejects wrong ${artifact} CPU for ${label}`, async () => {
                const files = fixture(target);
                const cpu = alternateCpu(target);
                writeFileSync(files[artifact], image({ ...target, cpu }, artifact === 'addon'));
                await expect(verifyPackagedNativeArtifacts(files.root, target.platform, target.arch)).rejects.toThrow();
            });
        }
    }

    it.each([Buffer.alloc(0), Buffer.from('not a native binary'), Buffer.from([0xcf, 0xfa, 0xed, 0xfe])])(
        'rejects unrecognized or truncated headers %#',
        async (bytes) => {
            const { root, addon } = fixture(targets[0]!);
            writeFileSync(addon, bytes);
            await expect(verifyPackagedNativeArtifacts(root, 'darwin', 3)).rejects.toThrow();
        }
    );

    it.each([
        ['darwin', 1],
        ['darwin', 4],
        ['mas', 3],
        ['win32', 3],
        ['linux', 0],
        ['freebsd', 1],
        ['linux', 99],
    ])('rejects unsupported target %s/%s', async (platform, arch) => {
        await expect(verifyPackagedNativeArtifacts('/unused', String(platform), Number(arch))).rejects.toThrow(
            /Unsupported/
        );
    });

    it.skipIf(process.platform === 'win32')('rejects a helper without Unix execute permissions', async () => {
        const { root, helper } = fixture(targets[0]!);
        chmodSync(helper, 0o644);
        await expect(verifyPackagedNativeArtifacts(root, 'darwin', 3)).rejects.toThrow(/executable/);
    });

    it.each([
        ['darwin', (bytes: Buffer) => bytes.writeUInt32LE(0xffffffff, 20)],
        ['linux', (bytes: Buffer) => bytes.writeBigUInt64LE(0xffffffffffffffffn, 32)],
        ['win32', (bytes: Buffer) => bytes.writeUInt32LE(0xffffffff, 60)],
    ])('rejects out-of-file %s header offsets', async (platform, mutate) => {
        const target = targets.find((entry) => entry.platform === platform)!;
        const { root, addon } = fixture(target);
        const bytes = image(target, true);
        mutate(bytes);
        writeFileSync(addon, bytes);
        await expect(verifyPackagedNativeArtifacts(root, target.platform, target.arch)).rejects.toThrow();
    });

    it('rejects a Mach-O image built for iOS', async () => {
        const { root, addon } = fixture(targets[0]!);
        const bytes = image(targets[0]!, true);
        bytes.writeUInt32LE(2, 40);
        writeFileSync(addon, bytes);
        await expect(verifyPackagedNativeArtifacts(root, 'darwin', 3)).rejects.toThrow();
    });

    it('rejects universal Mach-O instead of assuming its first slice matches', async () => {
        const { root, addon } = fixture(targets[0]!);
        const bytes = image(targets[0]!, true);
        bytes.writeUInt32BE(0xcafebabe, 0);
        writeFileSync(addon, bytes);
        await expect(verifyPackagedNativeArtifacts(root, 'darwin', 3)).rejects.toThrow();
    });
});
