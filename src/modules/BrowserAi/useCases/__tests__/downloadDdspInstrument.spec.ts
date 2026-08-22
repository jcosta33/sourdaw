import { beforeEach, describe, expect, it, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

const releaseGate = vi.hoisted(() => ({ ddsp: true }));

vi.mock('#/infra/release/modelReleaseAdmission', () => ({ MODEL_RELEASE_ADMISSION: releaseGate }));

import { DDSP_INSTRUMENT_CATALOG, type DdspInstrumentId } from '../../models/DdspInstrumentCatalog';
import { type ModelDownloadProgressPayload } from '../../models/ModelDownloadProgress';
import { type StorageStatus } from '../../models/StorageStatus';
import { type ModelRegistryState, modelRegistryStore } from '../../stores/modelRegistryStore';
import { downloadDdspInstrument } from '../downloadDdspInstrument';
import { isDdspInstrumentId } from '../isDdspInstrumentId';

type DownloadModelRepo = (input: {
    onProgress?: (payload: ModelDownloadProgressPayload) => void;
    signal?: AbortSignal;
    spec: {
        family: 'ddsp';
        modelId: string;
        redirectPolicy: 'reject';
        sha256: string;
        sizeBytes: number;
        url: string;
    };
}) => Promise<void>;

const storageStatus: StorageStatus = {
    usedBytes: 1_024,
    limitBytes: 2 * 1024 * 1024 * 1024,
    persisted: true,
    availableBytes: 10_000,
};
const instrument = DDSP_INSTRUMENT_CATALOG[0]!;

function registry(): ModelRegistryState {
    return {
        ddspInstruments: DDSP_INSTRUMENT_CATALOG.map((candidate) => ({
            ...candidate,
            status: 'not-downloaded',
            downloadProgress: 0,
        })),
        kokoroModel: null,
        diffSingerVoicebanks: [],
        vocoder: null,
        storageUsedBytes: 0,
    };
}

function passThroughLock(_id: string, _mode: 'exclusive' | 'shared', operation: () => Promise<void>): Promise<void> {
    return operation();
}

describe('downloadDdspInstrument', () => {
    beforeEach(() => {
        releaseGate.ddsp = true;
        modelRegistryStore.set(registry());
    });

    it('should refuse withheld DDSP downloads before resolving a catalog entry, acquiring a lock, or touching storage', async () => {
        releaseGate.ddsp = false;
        const cleanupUnpublishedDdspGeneration = vi.fn();
        const downloadModelRepo = vi.fn<DownloadModelRepo>();
        const checkDdspInstrumentReady = vi.fn();
        const getStorageStatus = vi.fn();
        const publishDdspInstrumentGeneration = vi.fn();
        const stageDdspInstrumentGeneration = vi.fn();
        const withDdspInstrumentLock = vi.fn();
        injectDependencies(downloadDdspInstrument, {
            logger: { warn: vi.fn() },
            downloadModelRepo,
            checkDdspInstrumentReady,
            cleanupUnpublishedDdspGeneration,
            getStorageStatus,
            publishDdspInstrumentGeneration,
            stageDdspInstrumentGeneration,
            withDdspInstrumentLock,
        });

        await expect(downloadDdspInstrument(instrument.id)).rejects.toThrow('DDSP model artifacts are not admitted');

        expect(withDdspInstrumentLock).not.toHaveBeenCalled();
        expect(checkDdspInstrumentReady).not.toHaveBeenCalled();
        expect(cleanupUnpublishedDdspGeneration).not.toHaveBeenCalled();
        expect(stageDdspInstrumentGeneration).not.toHaveBeenCalled();
        expect(publishDdspInstrumentGeneration).not.toHaveBeenCalled();
        expect(getStorageStatus).not.toHaveBeenCalled();
        expect(downloadModelRepo).not.toHaveBeenCalled();
    });

    it.each(DDSP_INSTRUMENT_CATALOG)(
        'downloads every exact pinned artifact for %s and publishes only that instrument',
        async (candidate) => {
            const downloadModelRepo = vi.fn<DownloadModelRepo>().mockResolvedValue(undefined);
            const publishDdspInstrumentGeneration = vi.fn().mockResolvedValue(undefined);
            const getStorageStatus = vi.fn().mockResolvedValue(storageStatus);
            injectDependencies(downloadDdspInstrument, {
                logger: { warn: vi.fn() },
                downloadModelRepo,
                checkDdspInstrumentReady: vi.fn().mockResolvedValue(false),
                cleanupUnpublishedDdspGeneration: vi.fn().mockResolvedValue(undefined),
                getStorageStatus,
                publishDdspInstrumentGeneration,
                stageDdspInstrumentGeneration: vi.fn().mockResolvedValue(undefined),
                withDdspInstrumentLock: passThroughLock,
            });

            await downloadDdspInstrument(candidate.id);

            expect(downloadModelRepo.mock.calls.map(([input]) => input.spec)).toEqual(
                candidate.artifacts.map((artifact) => ({
                    family: 'ddsp',
                    modelId: `${candidate.id}/${candidate.artifactVersion}/${artifact.path}`,
                    redirectPolicy: 'reject',
                    sha256: artifact.sha256,
                    sizeBytes: artifact.sizeBytes,
                    url: artifact.url,
                }))
            );
            expect(publishDdspInstrumentGeneration).toHaveBeenCalledWith({
                id: candidate.id,
                version: candidate.artifactVersion,
                artifacts: candidate.artifacts,
            });
            expect(modelRegistryStore.value?.ddspInstruments).toEqual(
                DDSP_INSTRUMENT_CATALOG.map((entry) =>
                    expect.objectContaining({
                        id: entry.id,
                        status: entry.id === candidate.id ? 'ready' : 'not-downloaded',
                        downloadProgress: entry.id === candidate.id ? 1 : 0,
                    })
                )
            );
            expect(modelRegistryStore.value?.storageUsedBytes).toBe(storageStatus.usedBytes);
        }
    );

    it('reports monotonic byte-weighted progress across unequal artifacts and retry stage events', async () => {
        const total_bytes = instrument.artifacts.reduce((total, artifact) => total + artifact.sizeBytes, 0);
        const observed_progress: number[] = [];
        const downloadModelRepo = vi.fn<DownloadModelRepo>().mockImplementation(async ({ onProgress, spec }) => {
            if (downloadModelRepo.mock.calls.length === 1) {
                const events: Array<Pick<ModelDownloadProgressPayload, 'bytesDownloaded' | 'stage'>> = [
                    { bytesDownloaded: spec.sizeBytes / 2, stage: 'downloading' },
                    { bytesDownloaded: spec.sizeBytes / 4, stage: 'downloading' },
                    { bytesDownloaded: spec.sizeBytes * 2, stage: 'verifying' },
                    { bytesDownloaded: -1, stage: 'downloading' },
                ];
                for (const { bytesDownloaded, stage } of events) {
                    onProgress?.({
                        modelId: spec.modelId,
                        bytesDownloaded,
                        totalBytes: spec.sizeBytes,
                        progress: bytesDownloaded / spec.sizeBytes,
                        stage,
                    });
                    observed_progress.push(
                        modelRegistryStore.value?.ddspInstruments.find((entry) => entry.id === instrument.id)
                            ?.downloadProgress ?? -1
                    );
                }
            }
        });
        injectDependencies(downloadDdspInstrument, {
            logger: { warn: vi.fn() },
            downloadModelRepo,
            checkDdspInstrumentReady: vi.fn().mockResolvedValue(false),
            cleanupUnpublishedDdspGeneration: vi.fn(),
            getStorageStatus: vi.fn().mockResolvedValue(storageStatus),
            publishDdspInstrumentGeneration: vi.fn().mockResolvedValue(undefined),
            stageDdspInstrumentGeneration: vi.fn().mockResolvedValue(undefined),
            withDdspInstrumentLock: passThroughLock,
        });

        await downloadDdspInstrument(instrument.id);

        expect(observed_progress[0]).toBeCloseTo(instrument.artifacts[0]!.sizeBytes / 2 / total_bytes);
        expect(observed_progress).not.toContain(1 / instrument.artifacts.length);
        expect(observed_progress).toEqual([...observed_progress].sort((left, right) => left - right));
        expect(observed_progress.every((progress) => progress >= 0 && progress <= 0.99)).toBe(true);
    });

    it('stays below 100 percent until the verified generation is published', async () => {
        let finish_publish = (): void => undefined;
        const publish_pending = new Promise<void>((resolve) => {
            finish_publish = resolve;
        });
        const downloadModelRepo = vi.fn<DownloadModelRepo>().mockImplementation(async ({ onProgress, spec }) => {
            onProgress?.({
                modelId: spec.modelId,
                bytesDownloaded: spec.sizeBytes,
                totalBytes: spec.sizeBytes,
                progress: 1,
                stage: 'complete',
            });
        });
        const publishDdspInstrumentGeneration = vi.fn(() => publish_pending);
        injectDependencies(downloadDdspInstrument, {
            logger: { warn: vi.fn() },
            downloadModelRepo,
            checkDdspInstrumentReady: vi.fn().mockResolvedValue(false),
            cleanupUnpublishedDdspGeneration: vi.fn(),
            getStorageStatus: vi.fn().mockResolvedValue(storageStatus),
            publishDdspInstrumentGeneration,
            stageDdspInstrumentGeneration: vi.fn().mockResolvedValue(undefined),
            withDdspInstrumentLock: passThroughLock,
        });

        const download = downloadDdspInstrument(instrument.id);
        await vi.waitFor(() => expect(publishDdspInstrumentGeneration).toHaveBeenCalledOnce());

        const pending = modelRegistryStore.value?.ddspInstruments.find((entry) => entry.id === instrument.id);
        expect(pending).toMatchObject({ status: 'downloading', downloadProgress: 0.99 });
        expect(Math.round((pending?.downloadProgress ?? 1) * 100)).toBe(99);

        finish_publish();
        await download;

        expect(modelRegistryStore.value?.ddspInstruments.find((entry) => entry.id === instrument.id)).toMatchObject({
            status: 'ready',
            downloadProgress: 1,
        });
    });

    it('cleans a staged partial generation and leaves the registry error state on cancellation', async () => {
        const cancelled = new DOMException('cancelled', 'AbortError');
        const cleanupUnpublishedDdspGeneration = vi.fn().mockResolvedValue(undefined);
        injectDependencies(downloadDdspInstrument, {
            logger: { warn: vi.fn() },
            downloadModelRepo: vi
                .fn<DownloadModelRepo>()
                .mockResolvedValueOnce(undefined)
                .mockRejectedValueOnce(cancelled),
            checkDdspInstrumentReady: vi.fn().mockResolvedValue(false),
            cleanupUnpublishedDdspGeneration,
            getStorageStatus: vi.fn().mockResolvedValue(storageStatus),
            publishDdspInstrumentGeneration: vi.fn(),
            stageDdspInstrumentGeneration: vi.fn().mockResolvedValue(undefined),
            withDdspInstrumentLock: passThroughLock,
        });

        await expect(downloadDdspInstrument(instrument.id)).rejects.toThrow('cancelled');

        expect(cleanupUnpublishedDdspGeneration).toHaveBeenCalledWith({
            id: instrument.id,
            version: instrument.artifactVersion,
            artifacts: instrument.artifacts,
        });
        expect(modelRegistryStore.value?.ddspInstruments[0]).toMatchObject({ status: 'error', downloadProgress: 0 });
    });

    it('lets a queued caller reuse the complete generation published by the lock holder', async () => {
        let unblockDownload = (): void => undefined;
        const firstArtifact = new Promise<void>((resolve) => {
            unblockDownload = resolve;
        });
        let lockTail = Promise.resolve();
        const withDdspInstrumentLock = vi.fn(
            (_id: string, _mode: 'exclusive' | 'shared', operation: () => Promise<void>) => {
                const result = lockTail.then(operation, operation);
                lockTail = result.then(
                    () => undefined,
                    () => undefined
                );
                return result;
            }
        );
        let ready = false;
        const downloadModelRepo = vi.fn<DownloadModelRepo>().mockImplementation(async () => {
            if (downloadModelRepo.mock.calls.length === 1) {
                await firstArtifact;
            }
        });
        const stageDdspInstrumentGeneration = vi.fn().mockResolvedValue(undefined);
        const publishDdspInstrumentGeneration = vi.fn(async () => {
            ready = true;
        });
        injectDependencies(downloadDdspInstrument, {
            logger: { warn: vi.fn() },
            downloadModelRepo,
            checkDdspInstrumentReady: vi.fn(async () => ready),
            cleanupUnpublishedDdspGeneration: vi.fn(),
            getStorageStatus: vi.fn().mockResolvedValue(storageStatus),
            publishDdspInstrumentGeneration,
            stageDdspInstrumentGeneration,
            withDdspInstrumentLock,
        });

        const first = downloadDdspInstrument(instrument.id);
        const second = downloadDdspInstrument(instrument.id);
        await vi.waitFor(() => expect(downloadModelRepo).toHaveBeenCalledTimes(1));
        unblockDownload();
        await Promise.all([first, second]);

        expect(downloadModelRepo).toHaveBeenCalledTimes(instrument.artifacts.length);
        expect(stageDdspInstrumentGeneration).toHaveBeenCalledOnce();
        expect(publishDdspInstrumentGeneration).toHaveBeenCalledOnce();
    });

    it('accepts only catalog identifiers at the public use-case boundary', () => {
        const forgedId: string = 'ddsp-forged';
        expect(isDdspInstrumentId(instrument.id)).toBe(true);
        expect(isDdspInstrumentId('ddsp-forged')).toBe(false);
        expect(() => downloadDdspInstrument(forgedId as DdspInstrumentId)).toThrow('DDSP instrument is not admitted');
    });
});
