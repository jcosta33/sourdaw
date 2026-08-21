import { describe, it, expect, vi, beforeEach } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { type DdspInstrument } from '../../models/BrowserModel';
import { DDSP_INSTRUMENT_CATALOG } from '../../models/DdspInstrumentCatalog';
import { type StorageStatus } from '../../models/StorageStatus';
import { type ModelRegistryState, modelRegistryStore } from '../../stores/modelRegistryStore';
import { removeDdspInstrument } from '../removeDdspInstrument';

const instrument = DDSP_INSTRUMENT_CATALOG[0]! as Omit<DdspInstrument, 'status' | 'downloadProgress'> & {
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
        const deleteDdspInstrumentArtifacts = vi.fn().mockResolvedValue(undefined);
        const getStorageStatus = vi.fn().mockResolvedValue(storageStatus);
        injectDependencies(removeDdspInstrument, {
            ddspModelStorage: { deleteDdspInstrumentArtifacts },
            getStorageStatus,
        });

        await removeDdspInstrument(instrument);

        expect(modelRegistryStore.value?.ddspInstruments[0]).toMatchObject({
            status: 'not-downloaded',
            downloadProgress: 0,
        });
        expect(getStorageStatus).toHaveBeenCalledTimes(1);
        expect(modelRegistryStore.value?.storageUsedBytes).toBe(storageStatus.usedBytes);
    });

    it('keeps persisted-ready truth and storage usage when user removal cannot delete OPFS artifacts', async () => {
        const getStorageStatus = vi.fn().mockResolvedValue(storageStatus);
        injectDependencies(removeDdspInstrument, {
            ddspModelStorage: { deleteDdspInstrumentArtifacts: vi.fn().mockRejectedValue(new Error('OPFS denied')) },
            getStorageStatus,
        });

        await expect(removeDdspInstrument(instrument)).rejects.toThrow('OPFS denied');

        expect(modelRegistryStore.value?.ddspInstruments[0]).toMatchObject({ status: 'ready', downloadProgress: 1 });
        expect(modelRegistryStore.value?.storageUsedBytes).toBe(1_024);
        expect(getStorageStatus).not.toHaveBeenCalled();
    });
});
