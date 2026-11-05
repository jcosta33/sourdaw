import { logger } from '#/infra/logger/appLogger';
import {
    cacheAudioBuffer,
    getAudioContext,
    getCachedAudioBuffer,
    prepareCachedAudioBuffersForReplay,
} from '#/modules/AudioEngine/useCases';
import { FACTORY_LIBRARY_ROOT_ID } from '#/modules/FactorySynthesis/useCases';

import { libraryStore } from '../stores/libraryStore';

import { findFactoryRoot } from './factoryLibrary/findFactoryRoot';
import { reloadFactoryLibraryBuffers } from './factoryLibrary/reloadFactoryLibraryBuffers';

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

/**
 * Read the buffer back from the PCM stored when it was cached this session.
 * Pin-neutral, unlike the project-load restore, which replaces the pinned set.
 */
async function restoreStoredBuffer(sampleId: string): Promise<AudioBuffer | null> {
    const release = await prepareCachedAudioBuffersForReplay([sampleId]);
    try {
        return getCachedAudioBuffer({ bufferId: sampleId });
    } finally {
        release();
    }
}

async function renderPackFor(sampleId: string): Promise<AudioBuffer | null> {
    let samples: Awaited<ReturnType<typeof reloadFactoryLibraryBuffers>>;
    try {
        samples = await reloadFactoryLibraryBuffers(getAudioContext());
    } catch (error) {
        logger.error(new Error('Factory library render failed', { cause: error }));
        return null;
    }
    const cached = getCachedAudioBuffer({ bufferId: sampleId });
    if (cached) {
        return cached;
    }
    // The pack outgrows the buffer cache, so caching it in order can evict the
    // very sample asked for; cache that one again so it is resident.
    const rendered = samples.find((sample) => sample.id === sampleId);
    if (!rendered) {
        return null;
    }
    cacheAudioBuffer({ buffer: rendered.buffer, bufferId: sampleId });
    return rendered.buffer;
}

/**
 * Obtain a factory sample's buffer, in order: the resident cache entry, the
 * PCM stored when it was cached, then one render of the pack shared by every
 * concurrent caller. A sample of another root is left to its file path.
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
    const buffer = (await restoreStoredBuffer(sampleId)) ?? (await renderPackFor(sampleId));
    return buffer ? { status: 'resolved', buffer } : { status: 'unavailable' };
}
