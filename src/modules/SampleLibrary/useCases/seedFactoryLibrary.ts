import {
    FACTORY_LIBRARY_ROOT_ID,
    FACTORY_SEED_FLAG_KEY,
    renderFactorySamples,
} from '#/modules/FactorySynthesis/useCases';

import { type LibraryRoot } from '../models/LibraryTypes';
import { persistLibraryRoots } from '../repositories/libraryPersistence/persistLibraryRoots';
import { persistSamples } from '../repositories/libraryPersistence/persistSamples';
import { addLibraryRoot, addSamples, libraryStore, updateLibraryRootStatus } from '../stores/libraryStore';

import { buildFolderTree } from './buildFolderTree';
import { cacheFactoryBuffers } from './factoryLibrary/cacheFactoryBuffers';
import { findFactoryRoot } from './factoryLibrary/findFactoryRoot';
import { toFactorySampleRecord } from './factoryLibrary/toFactorySampleRecord';

function ensureFactoryRoot(fileCount: number): void {
    if (findFactoryRoot()) {
        return;
    }
    const root: LibraryRoot = {
        id: FACTORY_LIBRARY_ROOT_ID,
        name: 'Factory Samples',
        // The factory root is not a real filesystem mount — "browser" is the only
        // provider kind that allows operating without a native path handle, so we
        // use it as a shim. rootRef is left empty; no scanner ever touches it.
        provider: 'browser',
        rootRef: '',
        connectedAt: Date.now(),
        status: 'ready',
        fileCount,
        settings: { recursive: true },
    };
    // Only auto-focus the factory root when nothing else is focused. Seeding
    // runs after restoreLibrary, so unconditionally activating here would re-wipe
    // a restored session's focus back to 'Factory Samples'.
    addLibraryRoot(root, { activate: !libraryStore.value?.activeRootId });
}

function hasSeededFactoryLibrary(): boolean {
    return typeof localStorage !== 'undefined' && localStorage.getItem(FACTORY_SEED_FLAG_KEY) !== null;
}

function markFactoryLibrarySeeded(): void {
    if (typeof localStorage !== 'undefined') {
        localStorage.setItem(FACTORY_SEED_FLAG_KEY, String(Date.now()));
    }
}

/** First launch: create the factory root and its records, then persist them once. */
async function seedFactoryRecords(ctx: AudioContext): Promise<void> {
    const samples = await renderFactorySamples(ctx);
    ensureFactoryRoot(samples.length);
    await cacheFactoryBuffers(samples);

    addSamples(samples.map(toFactorySampleRecord));
    buildFolderTree(FACTORY_LIBRARY_ROOT_ID);
    // A root that already existed (the flag was cleared, not the library) may
    // have been restored offline; its buffers are cached now.
    updateLibraryRootStatus(FACTORY_LIBRARY_ROOT_ID, 'ready', samples.length);

    await persistLibraryRoots();
    await persistSamples();

    markFactoryLibrarySeeded();
}

/**
 * Later launches: restoreLibrary brings the handle-less factory root back
 * offline, but it has no filesystem to lose. Its availability is its records
 * plus PCM that ensureFactorySampleBuffer obtains on demand, so it is ready.
 */
function markRestoredFactoryRootReady(): void {
    const recordCount =
        libraryStore.value?.samples.filter((sample) => sample.libraryRootId === FACTORY_LIBRARY_ROOT_ID).length ?? 0;
    updateLibraryRootStatus(FACTORY_LIBRARY_ROOT_ID, 'ready', recordCount);
}

/**
 * Run after restoreLibrary. The flag records that the library was seeded once:
 * without it, seed it; with it, mark the restored root ready, or leave a root
 * the user disconnected gone.
 */
export async function seedFactoryLibrary(ctx: AudioContext): Promise<void> {
    if (!hasSeededFactoryLibrary()) {
        await seedFactoryRecords(ctx);
        return;
    }
    if (!findFactoryRoot()) {
        return;
    }
    markRestoredFactoryRootReady();
}
