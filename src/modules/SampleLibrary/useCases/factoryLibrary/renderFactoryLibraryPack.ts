import { FACTORY_LIBRARY_ROOT_ID, renderFactorySamples } from '#/modules/FactorySynthesis/useCases';

import { addSamples, libraryStore, updateLibraryRootStatus } from '../../stores/libraryStore';
import { buildFolderTree } from '../buildFolderTree';

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

async function renderFactoryPack(ctx: AudioContext): Promise<readonly FactorySample[]> {
    if (!findFactoryRoot()) {
        return [];
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
        return [];
    }
    addMissingFactoryRecords(samples);
    updateLibraryRootStatus(FACTORY_LIBRARY_ROOT_ID, 'ready', samples.length);
    return samples;
}

// Every caller that arrives while a render runs joins it.
let pendingRender: Promise<readonly FactorySample[]> | undefined;

/**
 * Render the factory pack again and list any sample the library lacks. Caching
 * is the caller's: Rescan caches the samples with no stored audio, and a
 * sample whose buffer no source holds caches only itself. The root shows
 * scanning meanwhile, ready with its file count after, and offline if the
 * render fails. Resolves with the rendered samples, or none when the factory
 * root is not connected.
 */
export function renderFactoryLibraryPack(ctx: AudioContext): Promise<readonly FactorySample[]> {
    if (pendingRender) {
        return pendingRender;
    }
    const render = renderFactoryPack(ctx).finally(() => {
        pendingRender = undefined;
    });
    pendingRender = render;
    return render;
}
