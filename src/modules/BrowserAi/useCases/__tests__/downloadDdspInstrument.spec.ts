import { beforeEach, describe, expect, it, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

const releaseGate = vi.hoisted(() => ({ ddsp: true }));

vi.mock('#/infra/release/modelReleaseAdmission', () => ({ MODEL_RELEASE_ADMISSION: releaseGate }));

import { DDSP_INSTRUMENT_CATALOG, type DdspInstrumentId } from '../../models/DdspInstrumentCatalog';
import { type StorageStatus } from '../../models/StorageStatus';
import { type ModelRegistryState, modelRegistryStore } from '../../stores/modelRegistryStore';
import { downloadDdspInstrument } from '../downloadDdspInstrument';
import { isDdspInstrumentId } from '../isDdspInstrumentId';

type DownloadModelRepo = (input: {
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

    it('refuses withheld DDSP downloads before resolving a catalog entry, acquiring a lock, or touching storage', async () => {
        releaseGate.ddsp = false;
        const downloadModelRepo = vi.fn<DownloadModelRepo>();
        const checkDdspInstrumentReady = vi.fn();
        const stageDdspInstrumentGeneration = vi.fn();
        const withDdspInstrumentLock = vi.fn();
        injectDependencies(downloadDdspInstrument, {
            logger: { warn: vi.fn() },
            downloadModelRepo,
            checkDdspInstrumentReady,
            cleanupUnpublishedDdspGeneration: vi.fn(),
            getStorageStatus: vi.fn(),
            publishDdspInstrumentGeneration: vi.fn(),
            stageDdspInstrumentGeneration,
            withDdspInstrumentLock,
        });

        await expect(downloadDdspInstrument(instrument.id)).rejects.toThrow('DDSP model artifacts are not admitted');

        expect(withDdspInstrumentLock).not.toHaveBeenCalled();
        expect(checkDdspInstrumentReady).not.toHaveBeenCalled();
        expect(stageDdspInstrumentGeneration).not.toHaveBeenCalled();
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
