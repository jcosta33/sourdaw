import { audioBufferCache } from '#/modules/AudioEngine/stores';

import { type LibraryRoot, type SampleRecord } from '../../models/LibraryTypes';
import { persistLibraryRoots } from '../../repositories/libraryPersistence/persistLibraryRoots';
import { persistSamples } from '../../repositories/libraryPersistence/persistSamples';
import { addLibraryRoot, addSamples, libraryStore } from '../../stores/libraryStore';
import { buildFolderTree } from '../buildFolderTree';

import { generateFactorySamples } from './generateFactorySamples';
import { FACTORY_LIBRARY_ROOT_ID, FACTORY_SEED_FLAG_KEY, type FactorySample } from './types';

function getCategoryFolder(sample: FactorySample): string {
    const primary = sample.tags[0] ?? sample.category;
    const parts = sample.id.split('-');
    if (parts.length >= 3) {
        return `${sample.category}/${parts[1]}-${parts[2]}`.replaceAll(/[^a-zA-Z0-9/-]/g, '');
    }
    return `${sample.category}/${primary}`;
}

function toSampleRecord(sample: FactorySample): SampleRecord {
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
        analysis: sample.bpm !== undefined ? { bpm: sample.bpm } : undefined,
        tags: [...sample.tags, 'factory'],
        favorite: false,
    };
}

function ensureFactoryRoot(): void {
    const existing = libraryStore.value?.roots.find((r) => r.id === FACTORY_LIBRARY_ROOT_ID);
    if (existing) {
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
        fileCount: 0,
        settings: { recursive: true },
    };
    addLibraryRoot(root);
}

export async function seedFactoryLibrary(ctx: AudioContext): Promise<void> {
    if (typeof localStorage !== 'undefined' && localStorage.getItem(FACTORY_SEED_FLAG_KEY) !== null) {
        return;
    }

    const samples = generateFactorySamples(ctx);
    ensureFactoryRoot();

    const records = samples.map(toSampleRecord);
    for (const sample of samples) {
        audioBufferCache.set(sample.id, sample.buffer);
    }
    addSamples(records);
    buildFolderTree(FACTORY_LIBRARY_ROOT_ID);

    await persistLibraryRoots();
    await persistSamples();

    if (typeof localStorage !== 'undefined') {
        localStorage.setItem(FACTORY_SEED_FLAG_KEY, String(Date.now()));
    }
}
