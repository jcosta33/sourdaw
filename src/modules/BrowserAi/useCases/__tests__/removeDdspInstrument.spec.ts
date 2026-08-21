import { beforeEach, describe, expect, it, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { DDSP_INSTRUMENT_CATALOG } from '../../models/DdspInstrumentCatalog';
import { type StorageStatus } from '../../models/StorageStatus';
import { type ModelRegistryState, modelRegistryStore } from '../../stores/modelRegistryStore';
import { removeDdspInstrument } from '../removeDdspInstrument';

const instrument = DDSP_INSTRUMENT_CATALOG[0]!;
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

    it('serializes removal, marks the instrument unavailable, and refreshes usage after deletion', async () => {
        const removeDdspInstrumentGenerations = vi.fn().mockResolvedValue(undefined);
        const getStorageStatus = vi.fn().mockResolvedValue(storageStatus);
        const withDdspInstrumentLock = vi.fn(
            (_id: string, _mode: 'exclusive' | 'shared', operation: () => Promise<void>) => operation()
        );
        injectDependencies(removeDdspInstrument, {
            ddspModelStorage: { removeDdspInstrumentGenerations },
            getStorageStatus,
            withDdspInstrumentLock,
        });

        await removeDdspInstrument(instrument.id);

        expect(removeDdspInstrumentGenerations).toHaveBeenCalledWith({ id: instrument.id });
        expect(withDdspInstrumentLock).toHaveBeenCalledWith(instrument.id, 'exclusive', expect.any(Function));
        expect(modelRegistryStore.value?.ddspInstruments[0]).toMatchObject({
            status: 'not-downloaded',
            downloadProgress: 0,
        });
        expect(modelRegistryStore.value?.storageUsedBytes).toBe(storageStatus.usedBytes);
    });

    it('invalidates ready truth even when physical cleanup only partially succeeds', async () => {
        const getStorageStatus = vi.fn().mockResolvedValue(storageStatus);
        injectDependencies(removeDdspInstrument, {
            ddspModelStorage: {
                removeDdspInstrumentGenerations: vi.fn().mockRejectedValue(new Error('OPFS denied')),
            },
            getStorageStatus,
            withDdspInstrumentLock: async (
                _id: string,
                _mode: 'exclusive' | 'shared',
                operation: () => Promise<void>
            ) => operation(),
        });

        await expect(removeDdspInstrument(instrument.id)).rejects.toThrow('OPFS denied');

        expect(modelRegistryStore.value?.ddspInstruments[0]).toMatchObject({
            status: 'not-downloaded',
            downloadProgress: 0,
        });
        expect(getStorageStatus).toHaveBeenCalledOnce();
        expect(modelRegistryStore.value?.storageUsedBytes).toBe(storageStatus.usedBytes);
    });
});
