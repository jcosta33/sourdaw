import { beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '#/infra/logger/appLogger';

import { machineMemoryStore } from '../../../stores/machineMemoryStore';
import { readMachineMemory } from '../readMachineMemory';

const { readMachineTotalMemoryBytesMock } = vi.hoisted(() => ({
    readMachineTotalMemoryBytesMock: vi.fn<() => Promise<number | null>>(),
}));

vi.mock('../../../repositories/machineMemory/readMachineTotalMemoryBytes', () => ({
    readMachineTotalMemoryBytes: readMachineTotalMemoryBytesMock,
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
        readMachineTotalMemoryBytesMock.mockResolvedValue(17_179_869_184);

        await readMachineMemory();

        expect(machineMemoryStore.value).toEqual({ state: 'known', totalBytes: 17_179_869_184 });
    });

    it('records unavailable when there is no figure to read', async () => {
        readMachineTotalMemoryBytesMock.mockResolvedValue(null);

        await readMachineMemory();

        expect(machineMemoryStore.value).toEqual({ state: 'unavailable' });
    });

    it('records unavailable and logs a warning when the bridge rejects, without throwing', async () => {
        readMachineTotalMemoryBytesMock.mockRejectedValue(new TypeError('not a positive integer'));

        await expect(readMachineMemory()).resolves.toBeUndefined();

        expect(machineMemoryStore.value).toEqual({ state: 'unavailable' });
        expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    it('reads once however many callers ask, concurrently or after settling', async () => {
        readMachineTotalMemoryBytesMock.mockResolvedValue(8_000_000_000);

        await Promise.all([readMachineMemory(), readMachineMemory(), readMachineMemory()]);
        await readMachineMemory();

        expect(readMachineTotalMemoryBytesMock).toHaveBeenCalledTimes(1);
    });
});
