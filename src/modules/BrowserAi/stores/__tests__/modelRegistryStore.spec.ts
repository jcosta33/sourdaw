import { describe, it, expect, beforeEach } from 'vitest';

import { type BrowserModel, type DiffSingerVoicebank, type ModelFamily } from '../../models/BrowserModel';
import { modelRegistryStore, updateModelStatus } from '../modelRegistryStore';

function makeSubModel(id: string, family: ModelFamily): BrowserModel {
    return {
        id,
        name: id,
        family,
        sizeBytes: 1000,
        url: `https://example.test/${id}`,
        license: 'Apache-2.0',
        attribution: 'test',
        nativeSampleRate: 44100,
        status: 'ready',
        downloadProgress: 1,
    };
}

function makeVoicebank(id: string): DiffSingerVoicebank {
    return {
        id,
        name: id,
        language: 'en',
        license: 'Apache-2.0',
        attribution: 'test',
        totalSizeBytes: 5000,
        status: 'ready',
        downloadProgress: 1,
        models: {
            linguistic: makeSubModel(`${id}-linguistic`, 'diffsinger-linguistic'),
            dur: makeSubModel(`${id}-dur`, 'diffsinger-dur'),
            pitch: makeSubModel(`${id}-pitch`, 'diffsinger-pitch'),
            variance: makeSubModel(`${id}-variance`, 'diffsinger-variance'),
            acoustic: makeSubModel(`${id}-acoustic`, 'diffsinger-acoustic'),
        },
    };
}

describe('updateModelStatus', () => {
    beforeEach(() => {
        modelRegistryStore.set({
            ddspInstruments: [],
            kokoroModel: null,
            diffSingerVoicebanks: [makeVoicebank('alpha'), makeVoicebank('beta')],
            vocoder: null,
            storageUsedBytes: 0,
        });
    });

    it('patches the matching sub-model in the targeted voicebank', () => {
        updateModelStatus('alpha-pitch', { status: 'downloading', downloadProgress: 0.5 });

        const alpha = modelRegistryStore.value?.diffSingerVoicebanks.find((vb) => vb.id === 'alpha');
        expect(alpha?.models.pitch.status).toBe('downloading');
        expect(alpha?.models.pitch.downloadProgress).toBe(0.5);
    });

    it('leaves sibling sub-models inside the targeted voicebank unchanged', () => {
        const before = modelRegistryStore.value?.diffSingerVoicebanks.find((vb) => vb.id === 'alpha');
        const linguisticBefore = before?.models.linguistic;

        updateModelStatus('alpha-pitch', { status: 'downloading', downloadProgress: 0.5 });

        const after = modelRegistryStore.value?.diffSingerVoicebanks.find((vb) => vb.id === 'alpha');
        // The unrelated sub-model keeps its identity even within a patched voicebank.
        expect(after?.models.linguistic).toBe(linguisticBefore);
        expect(after?.models.dur).toBe(before?.models.dur);
    });

    it('does NOT rebuild a voicebank that contains no matching model (referential identity preserved)', () => {
        const betaBefore = modelRegistryStore.value?.diffSingerVoicebanks.find((vb) => vb.id === 'beta');

        // Patch targets a model that lives only in voicebank "alpha".
        updateModelStatus('alpha-pitch', { status: 'downloading', downloadProgress: 0.5 });

        const betaAfter = modelRegistryStore.value?.diffSingerVoicebanks.find((vb) => vb.id === 'beta');
        // This is the regression guard for the N×M store-churn fix: the untouched
        // voicebank object — and its models sub-tree — must be the exact same reference.
        expect(betaAfter).toBe(betaBefore);
        expect(betaAfter?.models).toBe(betaBefore?.models);
    });

    it('does not mutate any model when the id matches nothing', () => {
        const alphaBefore = modelRegistryStore.value?.diffSingerVoicebanks.find((vb) => vb.id === 'alpha');
        const betaBefore = modelRegistryStore.value?.diffSingerVoicebanks.find((vb) => vb.id === 'beta');

        updateModelStatus('does-not-exist', { status: 'error' });

        const alphaAfter = modelRegistryStore.value?.diffSingerVoicebanks.find((vb) => vb.id === 'alpha');
        const betaAfter = modelRegistryStore.value?.diffSingerVoicebanks.find((vb) => vb.id === 'beta');
        expect(alphaAfter).toBe(alphaBefore);
        expect(betaAfter).toBe(betaBefore);
    });

    it('is a no-op when the store has not been initialized', () => {
        modelRegistryStore.clear();

        updateModelStatus('alpha-pitch', { status: 'downloading', downloadProgress: 0.5 });

        expect(modelRegistryStore.value).toBeNull();
    });
});
