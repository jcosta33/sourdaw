import { createSampleDatabaseError } from '#/modules/SoundLibrary/errors/SampleDatabaseError';
import { sampleDatabaseStore } from '#/modules/SoundLibrary/stores/sampleDatabaseStore';
import { type SampleEntry } from '#/modules/SoundLibrary/models/SampleEntry';
import {
    autoTagSample,
    generatePathHash,
    getNextSampleId,
} from '#/modules/SoundLibrary/services/sampleTaggingHelpers';

export function addSample(
    path: string,
    name: string,
    format: SampleEntry['format'],
    durationSec: number,
    sampleRate: number = 44100,
    bitDepth: number = 16,
    channels: number = 2,
    fileSize: number = 0
): SampleEntry {
    const state = sampleDatabaseStore.value;
    if (!state) {
        throw createSampleDatabaseError('Sample database not initialized');
    }

    const { tags } = autoTagSample(name, path);

    const sample: SampleEntry = {
        id: getNextSampleId(),
        path,
        name,
        format,
        durationSec,
        sampleRate,
        bitDepth,
        channels,
        fileSize,
        bpm: null,
        key: null,
        tags,
        rating: 0,
        favorite: false,
        color: null,
        fingerprint: generatePathHash(name, path),
        addedAt: new Date().toISOString(),
        lastUsedAt: null,
        useCount: 0,
    };

    sampleDatabaseStore.set({
        ...state,
        samples: [...state.samples, sample],
    });

    return sample;
}
