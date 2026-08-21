import { describe, it, expect, vi, beforeEach } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { type DdspInstrument } from '../../models/BrowserModel';
import { DDSP_INSTRUMENT_CATALOG } from '../../models/DdspInstrumentCatalog';
import { type StorageStatus } from '../../models/StorageStatus';
import { type ModelRegistryState, modelRegistryStore } from '../../stores/modelRegistryStore';
import { downloadDdspInstrument } from '../downloadDdspInstrument';

type DownloadModelRepo = (input: {
    spec: { family: 'ddsp'; modelId: string; url: string; sizeBytes: number; sha256: string };
    signal?: AbortSignal;
}) => Promise<void>;
type GetStorageStatus = () => Promise<StorageStatus>;

const storageStatus: StorageStatus = {
    usedBytes: 1_024,
    limitBytes: 2 * 1024 * 1024 * 1024,
    persisted: true,
    availableBytes: 10_000,
};

const instrument = DDSP_INSTRUMENT_CATALOG[0] as Omit<DdspInstrument, 'status' | 'downloadProgress'> & {
    artifactVersion: string;
    artifacts: NonNullable<DdspInstrument['artifacts']>;
};
const admittedInstruments = DDSP_INSTRUMENT_CATALOG as readonly (Omit<DdspInstrument, 'status' | 'downloadProgress'> & {
    artifactVersion: string;
    artifacts: NonNullable<DdspInstrument['artifacts']>;
})[];

function registry(instruments = admittedInstruments): ModelRegistryState {
    return {
        ddspInstruments: instruments.map((candidate) => ({
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

describe('downloadDdspInstrument', () => {
    beforeEach(() => {
        modelRegistryStore.set(registry());
    });

    it('rejects a forged structural manifest at the catalog-ID boundary', () => {
        expect(() =>
            downloadDdspInstrument({ id: instrument.id, artifacts: [] } as unknown as typeof instrument.id)
        ).toThrow('DDSP instrument is not admitted');
    });

    it.each(admittedInstruments)(
        'delegates every exact %s checkpoint artifact in manifest order and changes only its status',
        async (candidate) => {
            const downloadModelRepo = vi.fn<DownloadModelRepo>().mockResolvedValue(undefined);
            const publishDdspInstrumentGeneration = vi.fn().mockResolvedValue(undefined);
            const getStorageStatus = vi.fn<GetStorageStatus>().mockResolvedValue(storageStatus);

            injectDependencies(downloadDdspInstrument, {
                downloadModelRepo,
                ddspModelStorage: {
                    checkDdspInstrumentReady: vi.fn().mockResolvedValue(false),
                    stageDdspInstrumentGeneration: vi.fn().mockResolvedValue(undefined),
                    publishDdspInstrumentGeneration,
                    cleanupUnpublishedDdspGeneration: vi.fn().mockResolvedValue(undefined),
                },
                withDdspInstrumentLock: async (_id: string, operation: () => Promise<void>) => operation(),
                getStorageStatus,
            });

            await downloadDdspInstrument(candidate.id);

            expect(downloadModelRepo.mock.calls.map(([input]) => input.spec)).toEqual(
                candidate.artifacts.map((artifact) => ({
                    family: 'ddsp',
                    modelId: `${candidate.id}/${candidate.artifactVersion}/${artifact.path}`,
                    url: artifact.url,
                    sizeBytes: artifact.sizeBytes,
                    sha256: artifact.sha256,
                }))
            );
            expect(publishDdspInstrumentGeneration).toHaveBeenCalledWith({
                id: candidate.id,
                version: candidate.artifactVersion,
                artifacts: candidate.artifacts,
            });
            expect(modelRegistryStore.value?.ddspInstruments).toEqual(
                admittedInstruments.map((entry) =>
                    expect.objectContaining({
                        id: entry.id,
                        status: entry.id === candidate.id ? 'ready' : 'not-downloaded',
                        downloadProgress: entry.id === candidate.id ? 1 : 0,
                    })
                )
            );
            expect(getStorageStatus).toHaveBeenCalledTimes(1);
            expect(modelRegistryStore.value?.storageUsedBytes).toBe(storageStatus.usedBytes);
        }
    );

    it('cleans all partial artifacts when a download is cancelled or fails before the marker commit', async () => {
        const failure = new DOMException('cancelled', 'AbortError');
        const downloadModelRepo = vi
            .fn<DownloadModelRepo>()
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(failure);
        const cleanupUnpublishedDdspGeneration = vi.fn().mockResolvedValue(undefined);

        injectDependencies(downloadDdspInstrument, {
            downloadModelRepo,
            ddspModelStorage: {
                checkDdspInstrumentReady: vi.fn().mockResolvedValue(false),
                stageDdspInstrumentGeneration: vi.fn().mockResolvedValue(undefined),
                publishDdspInstrumentGeneration: vi.fn(),
                cleanupUnpublishedDdspGeneration,
            },
            withDdspInstrumentLock: async (_id: string, operation: () => Promise<void>) => operation(),
            getStorageStatus: vi.fn<GetStorageStatus>().mockResolvedValue(storageStatus),
        });

        await expect(downloadDdspInstrument(instrument.id)).rejects.toThrow('cancelled');

        expect(cleanupUnpublishedDdspGeneration).toHaveBeenCalledWith({
            id: instrument.id,
            version: instrument.artifactVersion,
            artifacts: instrument.artifacts,
        });
        expect(modelRegistryStore.value?.ddspInstruments[0]).toMatchObject({ status: 'error', downloadProgress: 0 });
    });

    it('lets an overlapping caller reuse the generation published by the lock holder', async () => {
        let releaseFirstArtifact: (() => void) | undefined;
        const firstArtifact = new Promise<void>((resolve) => {
            releaseFirstArtifact = resolve;
        });
        let tail = Promise.resolve();
        const withDdspInstrumentLock = vi.fn((_id: string, operation: () => Promise<void>) => {
            const result = tail.then(operation, operation);
            tail = result.then(
                () => undefined,
                () => undefined
            );
            return result;
        });
        let ready = false;
        const downloadModelRepo = vi.fn<DownloadModelRepo>().mockImplementation(async () => {
            if (downloadModelRepo.mock.calls.length === 1) {
                await firstArtifact;
            }
        });
        const publishDdspInstrumentGeneration = vi.fn(async () => {
            ready = true;
        });
        const checkDdspInstrumentReady = vi.fn(async () => ready);
        const stageDdspInstrumentGeneration = vi.fn().mockResolvedValue(undefined);

        injectDependencies(downloadDdspInstrument, {
            downloadModelRepo,
            ddspModelStorage: {
                checkDdspInstrumentReady,
                stageDdspInstrumentGeneration,
                publishDdspInstrumentGeneration,
                cleanupUnpublishedDdspGeneration: vi.fn(),
            },
            withDdspInstrumentLock,
            getStorageStatus: vi.fn<GetStorageStatus>().mockResolvedValue(storageStatus),
        });

        const first = downloadDdspInstrument(instrument.id);
        const second = downloadDdspInstrument(instrument.id);
        await vi.waitFor(() => expect(downloadModelRepo).toHaveBeenCalledTimes(1));
        releaseFirstArtifact?.();
        await Promise.all([first, second]);

        expect(checkDdspInstrumentReady).toHaveBeenCalledTimes(2);
        expect(stageDdspInstrumentGeneration).toHaveBeenCalledOnce();
        expect(downloadModelRepo).toHaveBeenCalledTimes(instrument.artifacts.length);
        expect(publishDdspInstrumentGeneration).toHaveBeenCalledOnce();
    });

    it('finishes aborted cleanup before a queued retry publishes and never deletes the replacement', async () => {
        const events: string[] = [];
        let ready = false;
        let releaseCleanup: (() => void) | undefined;
        const cleanupGate = new Promise<void>((resolve) => {
            releaseCleanup = resolve;
        });
        let tail = Promise.resolve();
        const withDdspInstrumentLock = vi.fn((_id: string, operation: () => Promise<void>) => {
            const result = tail.then(operation, operation);
            tail = result.then(
                () => undefined,
                () => undefined
            );
            return result;
        });
        let downloadCall = 0;
        const downloadModelRepo = vi.fn<DownloadModelRepo>(async ({ signal }) => {
            downloadCall += 1;
            if (downloadCall === 1) {
                events.push('a-download');
                await new Promise<void>((_resolve, reject) => {
                    signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
                        once: true,
                    });
                });
                return;
            }
            events.push('b-download');
        });
        const cleanupUnpublishedDdspGeneration = vi.fn(async () => {
            events.push('a-cleanup-start');
            await cleanupGate;
            events.push('a-cleanup-end');
        });
        const publishDdspInstrumentGeneration = vi.fn(async () => {
            ready = true;
            events.push('b-publish');
        });

        injectDependencies(downloadDdspInstrument, {
            downloadModelRepo,
            ddspModelStorage: {
                checkDdspInstrumentReady: vi.fn(async () => ready),
                stageDdspInstrumentGeneration: vi.fn(async () => {
                    events.push(downloadCall === 0 ? 'a-stage' : 'b-stage');
                }),
                publishDdspInstrumentGeneration,
                cleanupUnpublishedDdspGeneration,
            },
            withDdspInstrumentLock,
            getStorageStatus: vi.fn<GetStorageStatus>().mockResolvedValue(storageStatus),
        });

        const controller = new AbortController();
        const first = downloadDdspInstrument(instrument.id, { signal: controller.signal });
        const second = downloadDdspInstrument(instrument.id);
        await vi.waitFor(() => expect(events).toContain('a-download'));
        controller.abort();
        await vi.waitFor(() => expect(events).toContain('a-cleanup-start'));
        expect(events).not.toContain('b-download');

        releaseCleanup?.();
        await expect(first).rejects.toThrow('Aborted');
        await second;

        expect(events).toEqual([
            'a-stage',
            'a-download',
            'a-cleanup-start',
            'a-cleanup-end',
            'b-stage',
            ...instrument.artifacts.map(() => 'b-download'),
            'b-publish',
        ]);
        expect(cleanupUnpublishedDdspGeneration).toHaveBeenCalledOnce();
        expect(publishDdspInstrumentGeneration).toHaveBeenCalledOnce();
        expect(events.slice(events.indexOf('b-publish') + 1)).not.toContain('a-cleanup-end');
    });
});
