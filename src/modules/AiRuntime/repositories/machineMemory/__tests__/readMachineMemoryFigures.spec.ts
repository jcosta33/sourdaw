import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readMachineTotalMemoryBytes } from '../readMachineTotalMemoryBytes';

const { desktopTotalMemoryBytesMock, isDesktopRuntimeMock } = vi.hoisted(() => ({
    desktopTotalMemoryBytesMock: vi.fn<() => Promise<number>>(),
    isDesktopRuntimeMock: vi.fn<() => boolean>(),
}));

vi.mock('#/utils/desktopBridge', () => ({
    desktopTotalMemoryBytes: desktopTotalMemoryBytesMock,
    isDesktopRuntime: isDesktopRuntimeMock,
}));

describe('readMachineTotalMemoryBytes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('has no figure in a plain browser and never asks the bridge', async () => {
        isDesktopRuntimeMock.mockReturnValue(false);

        await expect(readMachineTotalMemoryBytes()).resolves.toBeNull();
        expect(desktopTotalMemoryBytesMock).not.toHaveBeenCalled();
    });

    it('returns the desktop shell figure', async () => {
        isDesktopRuntimeMock.mockReturnValue(true);
        desktopTotalMemoryBytesMock.mockResolvedValue(17_179_869_184);

        await expect(readMachineTotalMemoryBytes()).resolves.toBe(17_179_869_184);
    });

    it('lets a bridge rejection reach the use case that records it', async () => {
        isDesktopRuntimeMock.mockReturnValue(true);
        desktopTotalMemoryBytesMock.mockRejectedValue(new TypeError('refused'));

        await expect(readMachineTotalMemoryBytes()).rejects.toThrow('refused');
    });
});
