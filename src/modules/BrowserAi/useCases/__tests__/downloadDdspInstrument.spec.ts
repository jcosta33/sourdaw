import { describe, it, expect, vi, beforeEach } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { type DdspInstrument } from '../../models/BrowserModel';
import { DDSP_INSTRUMENT_CATALOG } from '../../models/DdspInstrumentCatalog';
import { type StorageStatus } from '../../models/StorageStatus';
import { type ModelRegistryState, modelRegistryStore } from '../../stores/modelRegistryStore';
import { downloadDdspInstrument } from '../downloadDdspInstrument';

type DownloadModelRepo = (input: {
    spec: { family: 'ddsp'; modelId: string; url: string; sizeBytes: number; sha256: string };
}) => Promise<void>;
type GetStorageStatus = () => Promise<StorageStatus>;

const storageStatus: StorageStatus = {
    usedBytes: 1_024,
    limitBytes: 2 * 1024 * 1024 * 1024,
    persisted: true,
    availableBytes: 10_000,
};

const instrument = DDSP_INSTRUMENT_CATALOG[0]! as Omit<DdspInstrument, 'status' | 'downloadProgress'> & {
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
            const writeDdspReadyMarker = vi.fn().mockResolvedValue(undefined);
            const getStorageStatus = vi.fn<GetStorageStatus>().mockResolvedValue(storageStatus);

            injectDependencies(downloadDdspInstrument, {
                downloadModelRepo,
                ddspModelStorage: {
                    writeDdspReadyMarker,
                    deleteDdspInstrumentArtifacts: vi.fn(),
                    cleanupDdspInstrumentArtifacts: vi.fn(),
                },
                getStorageStatus,
            });

            await downloadDdspInstrument(candidate.id as import('../../models/DdspInstrumentCatalog').DdspInstrumentId);

            expect(downloadModelRepo.mock.calls.map(([input]) => input.spec)).toEqual(
                candidate.artifacts.map((artifact) => ({
                    family: 'ddsp',
                    modelId: `${candidate.id}/${candidate.artifactVersion}/${artifact.path}`,
                    url: artifact.url,
                    sizeBytes: artifact.sizeBytes,
                    sha256: artifact.sha256,
                }))
            );
            expect(writeDdspReadyMarker).toHaveBeenCalledWith({
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
        const cleanupDdspInstrumentArtifacts = vi.fn().mockResolvedValue(undefined);

        injectDependencies(downloadDdspInstrument, {
            downloadModelRepo,
            ddspModelStorage: {
                writeDdspReadyMarker: vi.fn(),
                deleteDdspInstrumentArtifacts: vi.fn(),
                cleanupDdspInstrumentArtifacts,
            },
            getStorageStatus: vi.fn<GetStorageStatus>().mockResolvedValue(storageStatus),
        });

        await expect(
            downloadDdspInstrument(instrument.id as import('../../models/DdspInstrumentCatalog').DdspInstrumentId)
        ).rejects.toThrow('cancelled');

        expect(cleanupDdspInstrumentArtifacts).toHaveBeenCalledWith({
            id: instrument.id,
            version: instrument.artifactVersion,
            artifacts: instrument.artifacts,
        });
        expect(modelRegistryStore.value?.ddspInstruments[0]).toMatchObject({ status: 'error', downloadProgress: 0 });
    });

    it('shares one in-flight download per instrument so overlapping callers cannot clean each other up', async () => {
        let releaseFirstArtifact: (() => void) | undefined;
        const firstArtifact = new Promise<void>((resolve) => {
            releaseFirstArtifact = resolve;
        });
        const downloadModelRepo = vi.fn<DownloadModelRepo>().mockImplementation(async () => {
            await firstArtifact;
        });
        const writeDdspReadyMarker = vi.fn().mockResolvedValue(undefined);

        injectDependencies(downloadDdspInstrument, {
            downloadModelRepo,
            ddspModelStorage: {
                writeDdspReadyMarker,
                deleteDdspInstrumentArtifacts: vi.fn(),
                cleanupDdspInstrumentArtifacts: vi.fn(),
            },
            getStorageStatus: vi.fn<GetStorageStatus>().mockResolvedValue(storageStatus),
        });

        const first = downloadDdspInstrument(
            instrument.id as import('../../models/DdspInstrumentCatalog').DdspInstrumentId
        );
        const second = downloadDdspInstrument(
            instrument.id as import('../../models/DdspInstrumentCatalog').DdspInstrumentId
        );
        expect(second).toBe(first);
        expect(downloadModelRepo).toHaveBeenCalledTimes(1);

        releaseFirstArtifact?.();
        await first;
        expect(downloadModelRepo).toHaveBeenCalledTimes(instrument.artifacts.length);
        expect(writeDdspReadyMarker).toHaveBeenCalledTimes(1);
    });
});
