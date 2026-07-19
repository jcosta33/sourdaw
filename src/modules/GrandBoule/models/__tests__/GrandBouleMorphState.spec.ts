import { describe, it, expect } from 'vitest';

import { BUILTIN_PIANO_MODELS, createDefaultMorphState, findPianoModelById } from '../GrandBouleMorphState';

describe('createDefaultMorphState', () => {
    it('defaults to Steinway D as layer A and Yamaha CFX as layer B, morph disabled', () => {
        const state = createDefaultMorphState();
        expect(state).toEqual({
            modelA: 'steinway-d',
            modelB: 'yamaha-cfx',
            morphPosition: 0.0,
            layerBalance: 0.0,
            enabled: false,
        });
    });

    it('references model ids that exist in BUILTIN_PIANO_MODELS', () => {
        const state = createDefaultMorphState();
        expect(findPianoModelById(state.modelA)).toBeDefined();
        expect(findPianoModelById(state.modelB)).toBeDefined();
    });
});

describe('findPianoModelById', () => {
    it('returns the Steinway D model with its exact physical-modeling parameters', () => {
        expect(findPianoModelById('steinway-d')).toEqual({
            id: 'steinway-d',
            name: 'Steinway Model D',
            hammerHardnessScale: 1.0,
            hammerMassScale: 1.0,
            soundboardBrightness: 0.55,
            sympatheticLevel: 0.5,
            bodyResonance: 0.6,
            toneColor: 0.0,
        });
    });

    it('returns the Bösendorfer Imperial model with its exact dark-toned parameters', () => {
        const model = findPianoModelById('bosendorfer-imperial');
        expect(model?.toneColor).toBe(-0.7);
        expect(model?.hammerMassScale).toBe(1.4);
        expect(model?.hammerHardnessScale).toBe(0.6);
        expect(model?.sympatheticLevel).toBe(0.8);
    });

    it('returns the Yamaha CFX model with its exact bright-toned parameters', () => {
        const model = findPianoModelById('yamaha-cfx');
        expect(model?.toneColor).toBe(0.7);
        expect(model?.hammerHardnessScale).toBe(1.5);
        expect(model?.soundboardBrightness).toBe(0.85);
    });

    it('returns undefined for an unknown model id', () => {
        expect(findPianoModelById('does-not-exist')).toBeUndefined();
    });

    it('returns undefined for an empty string id', () => {
        expect(findPianoModelById('')).toBeUndefined();
    });
});

describe('BUILTIN_PIANO_MODELS', () => {
    it('has exactly 4 built-in models', () => {
        expect(BUILTIN_PIANO_MODELS).toHaveLength(4);
    });

    it('has unique ids for every model', () => {
        const ids = BUILTIN_PIANO_MODELS.map((m) => m.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('every model is resolvable through findPianoModelById by its own id', () => {
        for (const model of BUILTIN_PIANO_MODELS) {
            expect(findPianoModelById(model.id)).toEqual(model);
        }
    });

    it('keeps every toneColor within the documented -1..+1 range', () => {
        for (const model of BUILTIN_PIANO_MODELS) {
            expect(model.toneColor).toBeGreaterThanOrEqual(-1);
            expect(model.toneColor).toBeLessThanOrEqual(1);
        }
    });
});
