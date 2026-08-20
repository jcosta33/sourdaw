import { describe, it, expect, vi, beforeEach } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { type DdspInstrument } from '../../models/BrowserModel';
import { DDSP_INSTRUMENT_CATALOG } from '../../models/DdspInstrumentCatalog';
import { type ModelRegistryState, modelRegistryStore } from '../../stores/modelRegistryStore';
import { downloadDdspInstrument } from '../downloadDdspInstrument';

type DownloadModelRepo = (input: {
    spec: { family: 'ddsp'; modelId: string; url: string; sizeBytes: number; sha256: string };
}) => Promise<void>;

const instrument = DDSP_INSTRUMENT_CATALOG[0]! as Omit<DdspInstrument, 'status' | 'downloadProgress'> & {
    artifactVersion: string;
    artifacts: NonNullable<DdspInstrument['artifacts']>;
};

function registry(): ModelRegistryState {
    return {
        ddspInstruments: [{ ...instrument, status: 'not-downloaded', downloadProgress: 0 }],
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

    it('makes the instrument ready only after each pinned artifact and the ready marker commit', async () => {
        const downloadModelRepo = vi.fn<DownloadModelRepo>().mockResolvedValue(undefined);
        const writeDdspReadyMarker = vi.fn().mockResolvedValue(undefined);

        injectDependencies(downloadDdspInstrument, {
            downloadModelRepo,
            ddspModelStorage: {
                writeDdspReadyMarker,
                deleteDdspInstrumentArtifacts: vi.fn(),
            },
        });

        await downloadDdspInstrument(instrument);

        expect(downloadModelRepo).toHaveBeenCalledTimes(instrument.artifacts.length);
        expect(downloadModelRepo).toHaveBeenLastCalledWith({
            spec: {
                family: 'ddsp',
                modelId: `${instrument.id}/${instrument.artifacts.at(-1)!.path}`,
                url: instrument.artifacts.at(-1)!.url,
                sizeBytes: instrument.artifacts.at(-1)!.sizeBytes,
                sha256: instrument.artifacts.at(-1)!.sha256,
            },
        });
        expect(writeDdspReadyMarker).toHaveBeenCalledWith({
            id: instrument.id,
            version: instrument.artifactVersion,
            artifacts: instrument.artifacts,
        });
        expect(modelRegistryStore.value?.ddspInstruments[0]).toMatchObject({ status: 'ready', downloadProgress: 1 });
    });

    it('cleans all partial artifacts when a download is cancelled or fails before the marker commit', async () => {
        const failure = new DOMException('cancelled', 'AbortError');
        const downloadModelRepo = vi
            .fn<DownloadModelRepo>()
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(failure);
        const deleteDdspInstrumentArtifacts = vi.fn().mockResolvedValue(undefined);

        injectDependencies(downloadDdspInstrument, {
            downloadModelRepo,
            ddspModelStorage: {
                writeDdspReadyMarker: vi.fn(),
                deleteDdspInstrumentArtifacts,
            },
        });

        await expect(downloadDdspInstrument(instrument)).rejects.toThrow('cancelled');

        expect(deleteDdspInstrumentArtifacts).toHaveBeenCalledWith({
            id: instrument.id,
            version: instrument.artifactVersion,
            artifacts: instrument.artifacts,
        });
        expect(modelRegistryStore.value?.ddspInstruments[0]).toMatchObject({ status: 'error', downloadProgress: 0 });
    });
});
