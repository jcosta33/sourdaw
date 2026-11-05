import { logger } from '#/infra/logger/appLogger';
import {
    cacheAudioBuffer,
    getAudioContext,
    getCachedAudioBuffer,
    restoreUnpinnedAudioBuffersFromIdb,
} from '#/modules/AudioEngine/useCases';
import { FACTORY_LIBRARY_ROOT_ID } from '#/modules/FactorySynthesis/useCases';

import { libraryStore } from '../stores/libraryStore';

import { findFactoryRoot } from './factoryLibrary/findFactoryRoot';
import { renderFactoryLibraryPack } from './factoryLibrary/renderFactoryLibraryPack';

type EnsureFactorySampleBufferInput = {
    sampleId: string;
};

type EnsureFactorySampleBufferResult =
    { status: 'resolved'; buffer: AudioBuffer } | { status: 'unavailable' } | { status: 'not-factory' };

function isFactorySample(sampleId: string): boolean {
    return (
        libraryStore.value?.samples.some(
            (sample) => sample.id === sampleId && sample.libraryRootId === FACTORY_LIBRARY_ROOT_ID
        ) ?? false
    );
}

type StoredBufferRead = { status: 'restored'; buffer: AudioBuffer } | { status: 'absent' } | { status: 'unreadable' };

/**
 * Read the buffer back from the PCM stored for it, this session or an earlier
 * one, without pinning it. Only a sample storage holds nothing for is absent:
 * stored audio that cannot be read now is still the sample's audio.
 */
async function readStoredBuffer(sampleId: string): Promise<StoredBufferRead> {
    const { absentIds, release } = await restoreUnpinnedAudioBuffersFromIdb({ bufferIds: [sampleId] });
    try {
        const buffer = getCachedAudioBuffer({ bufferId: sampleId });
        if (buffer) {
            return { status: 'restored', buffer };
        }
        return absentIds.includes(sampleId) ? { status: 'absent' } : { status: 'unreadable' };
    } finally {
        release();
    }
}

/**
 * The last resort, for a sample storage holds no audio for: render the pack,
 * shared by every concurrent caller, and cache this sample alone. Every other
 * sample is left as it is, since a saved project may play its stored audio.
 */
async function renderSampleBuffer(sampleId: string): Promise<AudioBuffer | null> {
    let samples: Awaited<ReturnType<typeof renderFactoryLibraryPack>>;
    try {
        samples = await renderFactoryLibraryPack(getAudioContext());
    } catch (error) {
        logger.error(new Error('Factory library render failed', { cause: error }));
        return null;
    }
    // A root disconnected during the render leaves its samples unavailable.
    if (!findFactoryRoot()) {
        return null;
    }
    // A concurrent caller for the same sample may have cached it already.
    const cached = getCachedAudioBuffer({ bufferId: sampleId });
    if (cached) {
        return cached;
    }
    const rendered = samples.find((sample) => sample.id === sampleId);
    if (!rendered) {
        return null;
    }
    cacheAudioBuffer({ buffer: rendered.buffer, bufferId: sampleId });
    return rendered.buffer;
}

/**
 * Obtain a factory sample's buffer, in order: the resident cache entry, the
 * PCM stored for it in this or an earlier launch, then, only when storage
 * holds none, one render of the pack shared by every concurrent caller. A
 * sample of another root is left to its file path.
 */
export async function ensureFactorySampleBuffer({
    sampleId,
}: EnsureFactorySampleBufferInput): Promise<EnsureFactorySampleBufferResult> {
    const resident = getCachedAudioBuffer({ bufferId: sampleId });
    if (resident) {
        return { status: 'resolved', buffer: resident };
    }
    if (!isFactorySample(sampleId)) {
        return { status: 'not-factory' };
    }
    if (!findFactoryRoot()) {
        return { status: 'unavailable' };
    }
    const stored = await readStoredBuffer(sampleId);
    if (stored.status === 'restored') {
        return { status: 'resolved', buffer: stored.buffer };
    }
    if (stored.status === 'unreadable') {
        return { status: 'unavailable' };
    }
    const buffer = await renderSampleBuffer(sampleId);
    return buffer ? { status: 'resolved', buffer } : { status: 'unavailable' };
}
