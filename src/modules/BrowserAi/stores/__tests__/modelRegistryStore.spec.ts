import { describe, it, expect, beforeEach } from 'vitest';

import {
    type BrowserModel,
    type DiffSingerVoicebank,
    type DdspInstrument,
    type KokoroModel,
    type ModelFamily,
    type VocoderModel,
} from '../../models/BrowserModel';
import { modelRegistryStore, setStorageUsed, updateModelStatus } from '../modelRegistryStore';

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

    it('patches the linguistic sub-model when its id matches', () => {
        updateModelStatus('alpha-linguistic', { status: 'error' });

        const alpha = modelRegistryStore.value?.diffSingerVoicebanks.find((vb) => vb.id === 'alpha');
        expect(alpha?.models.linguistic.status).toBe('error');
    });

    it('patches the dur sub-model when its id matches', () => {
        updateModelStatus('alpha-dur', { status: 'downloading', downloadProgress: 0.3 });

        const alpha = modelRegistryStore.value?.diffSingerVoicebanks.find((vb) => vb.id === 'alpha');
        expect(alpha?.models.dur.status).toBe('downloading');
        expect(alpha?.models.dur.downloadProgress).toBe(0.3);
    });

    it('patches the acoustic sub-model when its id matches', () => {
        updateModelStatus('beta-acoustic', { status: 'downloading', downloadProgress: 0.8 });

        const beta = modelRegistryStore.value?.diffSingerVoicebanks.find((vb) => vb.id === 'beta');
        expect(beta?.models.acoustic.status).toBe('downloading');
        expect(beta?.models.acoustic.downloadProgress).toBe(0.8);
    });

    it('patches the variance sub-model when its id matches', () => {
        updateModelStatus('beta-variance', { status: 'stale' });

        const beta = modelRegistryStore.value?.diffSingerVoicebanks.find((vb) => vb.id === 'beta');
        expect(beta?.models.variance.status).toBe('stale');
    });
});

describe('updateModelStatus — ddspInstruments', () => {
    beforeEach(() => {
        modelRegistryStore.set({
            ddspInstruments: [makeInstrument('inst-1'), makeInstrument('inst-2')],
            kokoroModel: null,
            diffSingerVoicebanks: [],
            vocoder: null,
            storageUsedBytes: 0,
        });
    });

    it('patches the matching ddsp instrument', () => {
        updateModelStatus('inst-1', { status: 'downloading', downloadProgress: 0.3 });

        const inst = modelRegistryStore.value?.ddspInstruments.find((i) => i.id === 'inst-1');
        expect(inst?.status).toBe('downloading');
        expect(inst?.downloadProgress).toBe(0.3);
    });

    it('leaves non-matching instruments unchanged by reference', () => {
        const before = modelRegistryStore.value?.ddspInstruments.find((i) => i.id === 'inst-2');

        updateModelStatus('inst-1', { status: 'error' });

        const after = modelRegistryStore.value?.ddspInstruments.find((i) => i.id === 'inst-2');
        expect(after).toBe(before);
    });
});

describe('updateModelStatus — kokoroModel and vocoder', () => {
    beforeEach(() => {
        modelRegistryStore.set({
            ddspInstruments: [],
            kokoroModel: makeKokoro('kokoro-1'),
            diffSingerVoicebanks: [],
            vocoder: makeVocoder('voc-1'),
            storageUsedBytes: 0,
        });
    });

    it('patches the kokoro model when its id matches', () => {
        updateModelStatus('kokoro-1', { status: 'downloading', downloadProgress: 0.7 });

        expect(modelRegistryStore.value?.kokoroModel?.status).toBe('downloading');
        expect(modelRegistryStore.value?.kokoroModel?.downloadProgress).toBe(0.7);
    });

    it('patches the vocoder when its id matches', () => {
        updateModelStatus('voc-1', { status: 'downloading', downloadProgress: 0.2 });

        expect(modelRegistryStore.value?.vocoder?.status).toBe('downloading');
        expect(modelRegistryStore.value?.vocoder?.downloadProgress).toBe(0.2);
    });

    it('leaves kokoro and vocoder unchanged when neither id matches', () => {
        const kokoroBefore = modelRegistryStore.value?.kokoroModel;
        const vocoderBefore = modelRegistryStore.value?.vocoder;

        updateModelStatus('nope', { status: 'error' });

        expect(modelRegistryStore.value?.kokoroModel).toBe(kokoroBefore);
        expect(modelRegistryStore.value?.vocoder).toBe(vocoderBefore);
    });
});

describe('setStorageUsed', () => {
    beforeEach(() => {
        modelRegistryStore.set({
            ddspInstruments: [],
            kokoroModel: null,
            diffSingerVoicebanks: [],
            vocoder: null,
            storageUsedBytes: 0,
        });
    });

    it('updates the storageUsedBytes field', () => {
        setStorageUsed(42_000);

        expect(modelRegistryStore.value?.storageUsedBytes).toBe(42_000);
    });

    it('is a no-op when the store has not been initialized', () => {
        modelRegistryStore.clear();

        setStorageUsed(99);

        expect(modelRegistryStore.value).toBeNull();
    });
});

function makeInstrument(id: string): DdspInstrument {
    return {
        id,
        name: id,
        family: 'ddsp',
        instrument: id,
        frameRate: 250,
        sizeBytes: 2000,
        url: `https://example.test/${id}`,
        license: 'Apache-2.0',
        attribution: 'test',
        nativeSampleRate: 44100,
        status: 'ready',
        downloadProgress: 1,
    };
}

function makeKokoro(id: string): KokoroModel {
    return {
        id,
        name: id,
        family: 'kokoro',
        quantization: 'q8',
        sizeBytes: 3000,
        url: `https://example.test/${id}`,
        license: 'Apache-2.0',
        attribution: 'test',
        nativeSampleRate: 44100,
        status: 'ready',
        downloadProgress: 1,
    };
}

function makeVocoder(id: string): VocoderModel {
    return {
        id,
        name: id,
        family: 'diffsinger/vocoder',
        sizeBytes: 4000,
        url: `https://example.test/${id}`,
        license: 'Apache-2.0',
        attribution: 'test',
        nativeSampleRate: 44100,
        status: 'ready',
        downloadProgress: 1,
    };
}
