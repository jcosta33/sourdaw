import { describe, it, expect, vi, beforeEach } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { type DdspInstrument } from '../../models/BrowserModel';
import { DDSP_INSTRUMENT_CATALOG } from '../../models/DdspInstrumentCatalog';
import { type StorageStatus } from '../../models/StorageStatus';
import { type ModelRegistryState, modelRegistryStore } from '../../stores/modelRegistryStore';
import { removeDdspInstrument } from '../removeDdspInstrument';

const instrument = DDSP_INSTRUMENT_CATALOG[0] as Omit<DdspInstrument, 'status' | 'downloadProgress'> & {
    artifactVersion: string;
    artifacts: NonNullable<DdspInstrument['artifacts']>;
};

const storageStatus: StorageStatus = {
    usedBytes: 12,
    limitBytes: 2 * 1024 * 1024 * 1024,
    persisted: true,
    availableBytes: 10_000,
};

function registry(): ModelRegistryState {
    return {
        ddspInstruments: [{ ...instrument, status: 'ready', downloadProgress: 1 }],
        kokoroModel: null,
        diffSingerVoicebanks: [],
        vocoder: null,
        storageUsedBytes: 1_024,
    };
}

describe('removeDdspInstrument', () => {
    beforeEach(() => {
        modelRegistryStore.set(registry());
    });

    it('only reports not-downloaded and refreshes usage after strict artifact deletion succeeds', async () => {
        const removeDdspInstrumentGenerations = vi.fn().mockResolvedValue(undefined);
        const getStorageStatus = vi.fn().mockResolvedValue(storageStatus);
        injectDependencies(removeDdspInstrument, {
            ddspModelStorage: { removeDdspInstrumentGenerations },
            withDdspInstrumentLock: async (_id: string, operation: () => Promise<void>) => operation(),
            getStorageStatus,
        });

        await removeDdspInstrument(instrument.id);

        expect(removeDdspInstrumentGenerations).toHaveBeenCalledWith({ id: instrument.id });
        expect(modelRegistryStore.value?.ddspInstruments[0]).toMatchObject({
            status: 'not-downloaded',
            downloadProgress: 0,
        });
        expect(getStorageStatus).toHaveBeenCalledTimes(1);
        expect(modelRegistryStore.value?.storageUsedBytes).toBe(storageStatus.usedBytes);
    });

    it('invalidates ready truth and refreshes usage when generation cleanup partially fails', async () => {
        const getStorageStatus = vi.fn().mockResolvedValue(storageStatus);
        injectDependencies(removeDdspInstrument, {
            ddspModelStorage: {
                removeDdspInstrumentGenerations: vi.fn().mockRejectedValue(new Error('OPFS denied')),
            },
            withDdspInstrumentLock: async (_id: string, operation: () => Promise<void>) => operation(),
            getStorageStatus,
        });

        await expect(removeDdspInstrument(instrument.id)).rejects.toThrow('OPFS denied');

        expect(modelRegistryStore.value?.ddspInstruments[0]).toMatchObject({
            status: 'not-downloaded',
            downloadProgress: 0,
        });
        expect(modelRegistryStore.value?.storageUsedBytes).toBe(storageStatus.usedBytes);
        expect(getStorageStatus).toHaveBeenCalledTimes(1);
    });
});
