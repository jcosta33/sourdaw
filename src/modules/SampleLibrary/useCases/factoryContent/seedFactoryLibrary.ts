import { cacheAudioBuffer } from '#/modules/AudioEngine/useCases';

import { type LibraryRoot, type SampleAnalysis, type SampleRecord, toBpm } from '../../models/LibraryTypes';
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

function toFactoryAnalysis(sample: FactorySample): SampleAnalysis | undefined {
    if (sample.bpm === undefined) {
        return undefined;
    }
    const bpm = toBpm(sample.bpm);
    // A factory sample with an absurd declared BPM carries no analysis rather
    // than a junk value (the brand constructor is the only gate to a Bpm).
    return bpm === undefined ? undefined : { bpm };
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
        analysis: toFactoryAnalysis(sample),
        tags: [...sample.tags, 'factory'],
        favorite: false,
    };
}

function ensureFactoryRoot(): void {
    const state = libraryStore.value;
    const existing = state?.roots.find((r) => r.id === FACTORY_LIBRARY_ROOT_ID);
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
    // Only auto-focus the factory root when nothing else is focused. Seeding
    // runs after restoreLibrary, so unconditionally activating here would re-wipe
    // a restored session's focus back to 'Factory Samples'.
    addLibraryRoot(root, { activate: !state?.activeRootId });
}

/** Yield to the event loop so the main thread can paint between seed phases. */
function yieldToEventLoop(): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, 0);
    });
}

export async function seedFactoryLibrary(ctx: AudioContext): Promise<void> {
    if (typeof localStorage !== 'undefined' && localStorage.getItem(FACTORY_SEED_FLAG_KEY) !== null) {
        return;
    }

    const samples = generateFactorySamples(ctx);
    ensureFactoryRoot();

    const records = samples.map(toSampleRecord);

    // Register the synthesised buffers in chunks, yielding to the event loop
    // between chunks so the first-launch seed does not hold the main thread in
    // one unbroken stretch while hundreds of buffers are cached.
    const CHUNK = 16;
    for (let i = 0; i < samples.length; i += CHUNK) {
        const end = Math.min(i + CHUNK, samples.length);
        for (let j = i; j < end; j++) {
            cacheAudioBuffer({ buffer: samples[j]!.buffer, bufferId: samples[j]!.id });
        }
        if (end < samples.length) {
            await yieldToEventLoop();
        }
    }

    addSamples(records);
    buildFolderTree(FACTORY_LIBRARY_ROOT_ID);

    await persistLibraryRoots();
    await persistSamples();

    if (typeof localStorage !== 'undefined') {
        localStorage.setItem(FACTORY_SEED_FLAG_KEY, String(Date.now()));
    }
}
