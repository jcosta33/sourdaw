import { beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '#/infra/logger/appLogger';

import { machineMemoryStore } from '../../../stores/machineMemoryStore';
import { readMachineMemory } from '../readMachineMemory';

const { readMachineMemoryFiguresMock } = vi.hoisted(() => ({
    readMachineMemoryFiguresMock: vi.fn<() => Promise<{ totalBytes: number; gpuBudgetBytes: number | null } | null>>(),
}));

vi.mock('../../../repositories/machineMemory/readMachineMemoryFigures', () => ({
    readMachineMemoryFigures: readMachineMemoryFiguresMock,
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

describe('readMachineMemory', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        machineMemoryStore.set({ state: 'unread' });
    });

    it('records the figure the repository reports', async () => {
        readMachineMemoryFiguresMock.mockResolvedValue({ totalBytes: 17_179_869_184, gpuBudgetBytes: 12_713_115_648 });

        await readMachineMemory();

        expect(machineMemoryStore.value).toEqual({
            state: 'known',
            totalBytes: 17_179_869_184,
            gpuBudgetBytes: 12_713_115_648,
        });
    });

    it('records a known total with an unknown GPU budget', async () => {
        readMachineMemoryFiguresMock.mockResolvedValue({ totalBytes: 17_179_869_184, gpuBudgetBytes: null });

        await readMachineMemory();

        expect(machineMemoryStore.value).toEqual({ state: 'known', totalBytes: 17_179_869_184, gpuBudgetBytes: null });
    });

    it('records unavailable when there is no figure to read', async () => {
        readMachineMemoryFiguresMock.mockResolvedValue(null);

        await readMachineMemory();

        expect(machineMemoryStore.value).toEqual({ state: 'unavailable' });
    });

    it('records unavailable and logs a warning when the bridge rejects, without throwing', async () => {
        readMachineMemoryFiguresMock.mockRejectedValue(new TypeError('not a positive integer'));

        await expect(readMachineMemory()).resolves.toBeUndefined();

        expect(machineMemoryStore.value).toEqual({ state: 'unavailable' });
        expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    it('reads once however many callers ask, concurrently or after settling', async () => {
        readMachineMemoryFiguresMock.mockResolvedValue({ totalBytes: 8_000_000_000, gpuBudgetBytes: null });

        await Promise.all([readMachineMemory(), readMachineMemory(), readMachineMemory()]);
        await readMachineMemory();

        expect(readMachineMemoryFiguresMock).toHaveBeenCalledTimes(1);
    });
});
