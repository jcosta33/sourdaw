import { describe, it, expect, vi, beforeEach } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { type StorageStatus } from '../../models/StorageStatus';
import { modelRegistryStore } from '../../stores/modelRegistryStore';
import { removeModel } from '../removeModel';

type DeleteModel = (input: { family: string; modelId: string }) => Promise<void>;
type GetStorageStatus = () => Promise<StorageStatus>;

type LoggerMock = {
    info: (message: string) => void;
    warn: (message: string) => void;
    debug: (message: string) => void;
};

function create_logger_mock(): LoggerMock {
    return {
        info: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
    };
}

const empty_storage_status: StorageStatus = {
    usedBytes: 0,
    limitBytes: 2 * 1024 * 1024 * 1024,
    persisted: true,
    availableBytes: 5_000,
};

describe('removeModel', () => {
    beforeEach(() => {
        modelRegistryStore.set({
            ddspInstruments: [
                {
                    id: 'ddsp-violin',
                    name: 'Violin',
                    family: 'ddsp',
                    sizeBytes: 10_000,
                    url: 'https://cdn.example.com/ddsp-violin.zip',
                    license: 'Apache-2.0',
                    attribution: 'DDSP',
                    nativeSampleRate: 16_000,
                    status: 'ready',
                    downloadProgress: 1,
                    instrument: 'violin',
                    frameRate: 250,
                },
            ],
            kokoroModel: null,
            diffSingerVoicebanks: [],
            vocoder: null,
            storageUsedBytes: 82_000_000,
        });
    });

    it('deletes the model from the repo, marks it not-downloaded, and refreshes storage usage', async () => {
        const delete_model = vi.fn<DeleteModel>().mockResolvedValue(undefined);
        const get_storage_status = vi.fn<GetStorageStatus>().mockResolvedValue(empty_storage_status);
        const logger = create_logger_mock();

        injectDependencies(removeModel, {
            logger,
            deleteModel: delete_model,
            getStorageStatus: get_storage_status,
        });

        await removeModel({ modelId: 'ddsp-violin', family: 'ddsp' });

        expect(delete_model).toHaveBeenCalledTimes(1);
        expect(delete_model).toHaveBeenCalledWith({ family: 'ddsp', modelId: 'ddsp-violin' });

        const updated = modelRegistryStore.value?.ddspInstruments.find((instrument) => instrument.id === 'ddsp-violin');
        expect(updated?.status).toBe('not-downloaded');
        expect(updated?.downloadProgress).toBe(0);

        expect(get_storage_status).toHaveBeenCalledTimes(1);
        expect(modelRegistryStore.value?.storageUsedBytes).toBe(0);
    });

    it('leaves unrelated models untouched', async () => {
        modelRegistryStore.update((state) =>
            state
                ? {
                      ...state,
                      kokoroModel: {
                          id: 'kokoro-82m',
                          name: 'Kokoro',
                          family: 'kokoro',
                          sizeBytes: 82_000_000,
                          url: 'https://cdn.example.com/kokoro-82m.zip',
                          license: 'Apache-2.0',
                          attribution: 'Kokoro',
                          nativeSampleRate: 24_000,
                          status: 'ready',
                          downloadProgress: 1,
                          quantization: 'q8',
                      },
                  }
                : state
        );

        const delete_model = vi.fn<DeleteModel>().mockResolvedValue(undefined);
        const get_storage_status = vi.fn<GetStorageStatus>().mockResolvedValue(empty_storage_status);

        injectDependencies(removeModel, {
            logger: create_logger_mock(),
            deleteModel: delete_model,
            getStorageStatus: get_storage_status,
        });

        await removeModel({ modelId: 'ddsp-violin', family: 'ddsp' });

        expect(modelRegistryStore.value?.kokoroModel?.status).toBe('ready');
    });

    it('propagates a repo failure and does NOT update model status or storage usage', async () => {
        const delete_error = new Error('permission denied');
        const delete_model = vi.fn<DeleteModel>().mockRejectedValue(delete_error);
        const get_storage_status = vi.fn<GetStorageStatus>().mockResolvedValue(empty_storage_status);

        injectDependencies(removeModel, {
            logger: create_logger_mock(),
            deleteModel: delete_model,
            getStorageStatus: get_storage_status,
        });

        await expect(removeModel({ modelId: 'ddsp-violin', family: 'ddsp' })).rejects.toThrow('permission denied');

        const untouched = modelRegistryStore.value?.ddspInstruments.find(
            (instrument) => instrument.id === 'ddsp-violin'
        );
        expect(untouched?.status).toBe('ready');
        expect(get_storage_status).not.toHaveBeenCalled();
        expect(modelRegistryStore.value?.storageUsedBytes).toBe(82_000_000);
    });
});
