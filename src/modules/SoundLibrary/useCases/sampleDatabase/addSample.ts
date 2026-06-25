import { createSampleDatabaseError } from '../../errors/SampleDatabaseError';
import { type SampleEntry } from '../../models/SampleEntry';
import { autoTagSample, generatePathHash, getNextSampleId } from '../../services/sampleTaggingHelpers';
import { sampleDatabaseStore } from '../../stores/sampleDatabaseStore';

/**
 * Required metadata to register a sample. All fields are explicit: callers must
 * supply the real audio metadata rather than relying on silent positional
 * defaults (44100/16/2/0), which previously masked missing decode data.
 */
export type AddSampleInput = {
    path: string;
    name: string;
    format: SampleEntry['format'];
    durationSec: number;
    sampleRate: number;
    bitDepth: number;
    channels: number;
    fileSize: number;
};

export function addSample(input: AddSampleInput): SampleEntry {
    const state = sampleDatabaseStore.value;
    if (!state) {
        throw createSampleDatabaseError('Sample database not initialized');
    }

    const { path, name, format, durationSec, sampleRate, bitDepth, channels, fileSize } = input;
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
