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

    it('should only report not-downloaded and refresh usage after strict artifact deletion succeeds', async () => {
        const removeDdspInstrumentGenerations = vi.fn().mockResolvedValue(undefined);
        const getStorageStatus = vi.fn().mockResolvedValue(storageStatus);
        const releaseDdspSession = vi.fn().mockResolvedValue(undefined);
        const events: string[] = [];
        releaseDdspSession.mockImplementation(async () => {
            events.push('release-session');
        });
        removeDdspInstrumentGenerations.mockImplementation(async () => {
            events.push('invalidate-and-delete');
        });
        const withDdspInstrumentLock = vi.fn(
            (_id: string, _mode: 'shared' | 'exclusive', operation: () => Promise<void>) => operation()
        );
        injectDependencies(removeDdspInstrument, {
            ddspModelStorage: { removeDdspInstrumentGenerations },
            inferenceWorkerBridge: { releaseDdspSession },
            withDdspInstrumentLock,
            getStorageStatus,
        });

        await removeDdspInstrument(instrument.id);

        expect(removeDdspInstrumentGenerations).toHaveBeenCalledWith({ id: instrument.id });
        expect(releaseDdspSession).toHaveBeenCalledWith(`${instrument.id}:${instrument.artifactVersion}`);
        expect(events).toEqual(['release-session', 'invalidate-and-delete']);
        expect(withDdspInstrumentLock).toHaveBeenCalledWith(instrument.id, 'exclusive', expect.any(Function));
        expect(modelRegistryStore.value?.ddspInstruments[0]).toMatchObject({
            status: 'not-downloaded',
            downloadProgress: 0,
        });
        expect(getStorageStatus).toHaveBeenCalledTimes(1);
        expect(modelRegistryStore.value?.storageUsedBytes).toBe(storageStatus.usedBytes);
    });

    it('should invalidate ready truth and refresh usage when generation cleanup partially fails', async () => {
        const getStorageStatus = vi.fn().mockResolvedValue(storageStatus);
        injectDependencies(removeDdspInstrument, {
            ddspModelStorage: {
                removeDdspInstrumentGenerations: vi.fn().mockRejectedValue(new Error('OPFS denied')),
            },
            inferenceWorkerBridge: { releaseDdspSession: vi.fn().mockResolvedValue(undefined) },
            withDdspInstrumentLock: async (
                _id: string,
                _mode: 'shared' | 'exclusive',
                operation: () => Promise<void>
            ) => operation(),
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

    it('should not invalidate storage when session release fails', async () => {
        const removeDdspInstrumentGenerations = vi.fn();
        injectDependencies(removeDdspInstrument, {
            ddspModelStorage: { removeDdspInstrumentGenerations },
            inferenceWorkerBridge: {
                releaseDdspSession: vi.fn().mockRejectedValue(new Error('worker release failed')),
            },
            withDdspInstrumentLock: async (
                _id: string,
                _mode: 'shared' | 'exclusive',
                operation: () => Promise<void>
            ) => operation(),
            getStorageStatus: vi.fn().mockResolvedValue(storageStatus),
        });

        await expect(removeDdspInstrument(instrument.id)).rejects.toThrow('worker release failed');

        expect(removeDdspInstrumentGenerations).not.toHaveBeenCalled();
        expect(modelRegistryStore.value?.ddspInstruments[0]).toMatchObject({ status: 'ready' });
    });
});
