import { describe, it, expect, vi, beforeEach } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { type StorageStatus } from '../../models/StorageStatus';
import { modelRegistryStore } from '../../stores/modelRegistryStore';
import { downloadModel } from '../downloadModel';

type DownloadModelRepo = (input: {
    spec: { modelId: string; family: string; url: string; sha256?: string; sizeBytes: number };
    onProgress?: (payload: unknown) => void;
}) => Promise<void>;

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

const storage_status: StorageStatus = {
    usedBytes: 1_200,
    limitBytes: 2 * 1024 * 1024 * 1024,
    persisted: true,
    availableBytes: 5_000,
};

describe('downloadModel', () => {
    beforeEach(() => {
        modelRegistryStore.set({
            ddspInstruments: [],
            kokoroModel: null,
            diffSingerVoicebanks: [],
            vocoder: null,
            storageUsedBytes: 0,
        });
    });

    it('delegates to the download repository with the full spec and refreshes storage usage on success', async () => {
        const download_model_repo = vi.fn<DownloadModelRepo>().mockResolvedValue(undefined);
        const get_storage_status = vi.fn<GetStorageStatus>().mockResolvedValue(storage_status);
        const logger = create_logger_mock();

        injectDependencies(downloadModel, {
            logger,
            downloadModelRepo: download_model_repo,
            getStorageStatus: get_storage_status,
        });

        const on_progress = vi.fn();

        await downloadModel({
            modelId: 'kokoro-82m',
            family: 'kokoro',
            url: 'https://cdn.example.com/kokoro-82m.zip',
            sha256: 'abc123',
            sizeBytes: 82_000_000,
            onProgress: on_progress,
        });

        expect(download_model_repo).toHaveBeenCalledTimes(1);
        expect(download_model_repo).toHaveBeenCalledWith({
            spec: {
                modelId: 'kokoro-82m',
                family: 'kokoro',
                url: 'https://cdn.example.com/kokoro-82m.zip',
                sha256: 'abc123',
                sizeBytes: 82_000_000,
            },
            onProgress: on_progress,
        });
        expect(get_storage_status).toHaveBeenCalledTimes(1);
        expect(modelRegistryStore.value?.storageUsedBytes).toBe(1_200);
    });

    it('omits the optional sha256 from the repo spec when not provided', async () => {
        const download_model_repo = vi.fn<DownloadModelRepo>().mockResolvedValue(undefined);
        const get_storage_status = vi.fn<GetStorageStatus>().mockResolvedValue(storage_status);

        injectDependencies(downloadModel, {
            logger: create_logger_mock(),
            downloadModelRepo: download_model_repo,
            getStorageStatus: get_storage_status,
        });

        await downloadModel({
            modelId: 'kokoro-compact',
            family: 'kokoro',
            url: 'https://cdn.example.com/kokoro-compact.zip',
            sizeBytes: 10_000,
        });

        expect(download_model_repo).toHaveBeenCalledWith({
            spec: {
                modelId: 'kokoro-compact',
                family: 'kokoro',
                url: 'https://cdn.example.com/kokoro-compact.zip',
                sha256: undefined,
                sizeBytes: 10_000,
            },
            onProgress: undefined,
        });
    });

    it('rejects arbitrary DDSP downloads before repository, status, or logging side effects', async () => {
        const download_model_repo = vi.fn<DownloadModelRepo>().mockResolvedValue(undefined);
        const get_storage_status = vi.fn<GetStorageStatus>().mockResolvedValue(storage_status);
        const logger = create_logger_mock();
        const state_before = modelRegistryStore.value;

        injectDependencies(downloadModel, {
            logger,
            downloadModelRepo: download_model_repo,
            getStorageStatus: get_storage_status,
        });

        await expect(
            downloadModel({
                modelId: 'attacker-controlled-model',
                family: 'ddsp',
                url: 'https://attacker.example/arbitrary-checkpoint.bin',
                sizeBytes: 1,
            })
        ).rejects.toThrow(/dedicated DDSP instrument/i);

        expect(download_model_repo).not.toHaveBeenCalled();
        expect(get_storage_status).not.toHaveBeenCalled();
        expect(logger.info).not.toHaveBeenCalled();
        expect(modelRegistryStore.value).toBe(state_before);
    });

    it('propagates a repo failure and does NOT refresh storage usage', async () => {
        const download_error = new Error('network down');
        const download_model_repo = vi.fn<DownloadModelRepo>().mockRejectedValue(download_error);
        const get_storage_status = vi.fn<GetStorageStatus>().mockResolvedValue(storage_status);

        injectDependencies(downloadModel, {
            logger: create_logger_mock(),
            downloadModelRepo: download_model_repo,
            getStorageStatus: get_storage_status,
        });

        await expect(
            downloadModel({
                modelId: 'kokoro-82m',
                family: 'kokoro',
                url: 'https://cdn.example.com/kokoro-82m.zip',
                sizeBytes: 82_000_000,
            })
        ).rejects.toThrow('network down');

        expect(get_storage_status).not.toHaveBeenCalled();
        expect(modelRegistryStore.value?.storageUsedBytes).toBe(0);
    });
});
