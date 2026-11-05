import { FACTORY_LIBRARY_ROOT_ID, renderFactorySamples } from '#/modules/FactorySynthesis/useCases';

import { addSamples, libraryStore, updateLibraryRootStatus } from '../../stores/libraryStore';
import { buildFolderTree } from '../buildFolderTree';

import { cacheFactoryBuffers } from './cacheFactoryBuffers';
import { findFactoryRoot } from './findFactoryRoot';
import { type FactorySample, toFactorySampleRecord } from './toFactorySampleRecord';

/**
 * List the rendered samples the restored library has no record for, such as
 * ones a later release added. In-memory only: the next launch derives them
 * again from the same render.
 */
function addMissingFactoryRecords(samples: readonly FactorySample[]): void {
    const knownIds = new Set(libraryStore.value?.samples.map((sample) => sample.id));
    const missing = samples.filter((sample) => !knownIds.has(sample.id));
    if (missing.length === 0) {
        return;
    }
    addSamples(missing.map(toFactorySampleRecord));
    buildFolderTree(FACTORY_LIBRARY_ROOT_ID);
}

async function reloadFactoryBuffers(ctx: AudioContext): Promise<void> {
    if (!findFactoryRoot()) {
        return;
    }
    updateLibraryRootStatus(FACTORY_LIBRARY_ROOT_ID, 'scanning');
    let samples: FactorySample[];
    try {
        samples = await renderFactorySamples(ctx);
    } catch (error) {
        updateLibraryRootStatus(FACTORY_LIBRARY_ROOT_ID, 'offline');
        throw error;
    }
    // The user may have disconnected the root while it rendered.
    if (!findFactoryRoot()) {
        return;
    }
    await cacheFactoryBuffers(samples);
    addMissingFactoryRecords(samples);
    updateLibraryRootStatus(FACTORY_LIBRARY_ROOT_ID, 'ready', samples.length);
}

// A rescan pressed while the launch reload renders joins that render.
let pendingReload: Promise<void> | undefined;

/**
 * Factory buffers are synthesised, not stored with the library, so
 * restoreLibrary brings the factory root back offline and without them. Render
 * and cache them again: the root shows scanning meanwhile, ready with its file
 * count after, and offline if the render fails.
 */
export function reloadFactoryLibraryBuffers(ctx: AudioContext): Promise<void> {
    if (pendingReload) {
        return pendingReload;
    }
    const reload = reloadFactoryBuffers(ctx).finally(() => {
        pendingReload = undefined;
    });
    pendingReload = reload;
    return reload;
}
