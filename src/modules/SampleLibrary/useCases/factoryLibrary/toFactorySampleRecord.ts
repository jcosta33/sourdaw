import { FACTORY_LIBRARY_ROOT_ID, type renderFactorySamples } from '#/modules/FactorySynthesis/useCases';

import { type SampleAnalysis, type SampleRecord, toBpm } from '../../models/LibraryTypes';

export type FactorySample = Awaited<ReturnType<typeof renderFactorySamples>>[number];

function getCategoryFolder(sample: FactorySample): string {
    const primary = sample.tags[0] ?? sample.category;
    const parts = sample.id.split('-');
    if (parts.length >= 3) {
        return `${sample.category}/${parts[1]}-${parts[2]}`.replaceAll(/[^a-zA-Z0-9/-]/g, '');
    }
    return `${sample.category}/${primary}`;
}

function toFactoryAnalysis(sample: FactorySample): SampleAnalysis | undefined {
    if (sample.bpm === undefined) {
        return undefined;
    }
    const bpm = toBpm(sample.bpm);
    // A factory sample with an absurd declared BPM carries no analysis rather
    // than a junk value (the brand constructor is the only gate to a Bpm).
    return bpm === undefined ? undefined : { bpm };
}

export function toFactorySampleRecord(sample: FactorySample): SampleRecord {
    const folder = getCategoryFolder(sample);
    const relativePath = `${folder}/${sample.name}.factory`;
    return {
        id: sample.id,
        libraryRootId: FACTORY_LIBRARY_ROOT_ID,
        relativePath,
        displayName: sample.name,
        ext: 'factory',
        folder,
        sync: {
            exists: true,
            mtimeMs: 0,
            sizeBytes: sample.buffer.length * sample.buffer.numberOfChannels * 4,
            status: 'analyzed',
        },
        format: {
            durationSec: sample.buffer.duration,
            sampleRate: sample.buffer.sampleRate,
            channels: sample.buffer.numberOfChannels,
            bitDepth: 32,
        },
        analysis: toFactoryAnalysis(sample),
        tags: [...sample.tags, 'factory'],
        favorite: false,
    };
}
