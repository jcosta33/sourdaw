import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readMachineMemoryFigures } from '../readMachineMemoryFigures';

const { desktopGpuMemoryBudgetBytesMock, desktopTotalMemoryBytesMock, isDesktopRuntimeMock } = vi.hoisted(() => ({
    desktopGpuMemoryBudgetBytesMock: vi.fn<() => Promise<number | null>>(),
    desktopTotalMemoryBytesMock: vi.fn<() => Promise<number>>(),
    isDesktopRuntimeMock: vi.fn<() => boolean>(),
}));

vi.mock('#/utils/desktopBridge', () => ({
    desktopGpuMemoryBudgetBytes: desktopGpuMemoryBudgetBytesMock,
    desktopTotalMemoryBytes: desktopTotalMemoryBytesMock,
    isDesktopRuntime: isDesktopRuntimeMock,
}));

describe('readMachineMemoryFigures', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('has no figures in a plain browser and never asks the bridge', async () => {
        isDesktopRuntimeMock.mockReturnValue(false);

        await expect(readMachineMemoryFigures()).resolves.toBeNull();
        expect(desktopTotalMemoryBytesMock).not.toHaveBeenCalled();
        expect(desktopGpuMemoryBudgetBytesMock).not.toHaveBeenCalled();
    });

    it('returns the desktop shell total and GPU budget in one read', async () => {
        isDesktopRuntimeMock.mockReturnValue(true);
        desktopTotalMemoryBytesMock.mockResolvedValue(17_179_869_184);
        desktopGpuMemoryBudgetBytesMock.mockResolvedValue(12_713_115_648);

        await expect(readMachineMemoryFigures()).resolves.toEqual({
            totalBytes: 17_179_869_184,
            gpuBudgetBytes: 12_713_115_648,
        });
    });

    it('keeps the total when the shell reports no GPU budget', async () => {
        isDesktopRuntimeMock.mockReturnValue(true);
        desktopTotalMemoryBytesMock.mockResolvedValue(17_179_869_184);
        desktopGpuMemoryBudgetBytesMock.mockResolvedValue(null);

        await expect(readMachineMemoryFigures()).resolves.toEqual({
            totalBytes: 17_179_869_184,
            gpuBudgetBytes: null,
        });
    });

    it('keeps the total when the GPU budget read is refused', async () => {
        isDesktopRuntimeMock.mockReturnValue(true);
        desktopTotalMemoryBytesMock.mockResolvedValue(17_179_869_184);
        desktopGpuMemoryBudgetBytesMock.mockRejectedValue(new TypeError('refused'));

        await expect(readMachineMemoryFigures()).resolves.toEqual({
            totalBytes: 17_179_869_184,
            gpuBudgetBytes: null,
        });
    });

    it('lets a total-memory rejection reach the use case that records it', async () => {
        isDesktopRuntimeMock.mockReturnValue(true);
        desktopTotalMemoryBytesMock.mockRejectedValue(new TypeError('refused'));
        desktopGpuMemoryBudgetBytesMock.mockResolvedValue(null);

        await expect(readMachineMemoryFigures()).rejects.toThrow('refused');
    });
});
