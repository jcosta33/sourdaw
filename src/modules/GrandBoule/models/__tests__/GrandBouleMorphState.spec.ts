import { describe, it, expect } from 'vitest';

import { BUILTIN_PIANO_MODELS, createDefaultMorphState, findPianoModelById } from '../GrandBouleMorphState';

describe('createDefaultMorphState', () => {
    it('defaults to neutral product voicings with morph disabled', () => {
        const state = createDefaultMorphState();
        expect(state).toEqual({
            modelA: 'balanced-grand',
            modelB: 'clear-grand',
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
    it('returns the balanced voicing with its exact product parameters', () => {
        expect(findPianoModelById('balanced-grand')).toEqual({
            id: 'balanced-grand',
            name: 'Balanced Grand',
            hammerHardnessScale: 0.92,
            hammerMassScale: 1.08,
            soundboardBrightness: 0.48,
            sympatheticLevel: 0.58,
            bodyResonance: 0.52,
            toneColor: -0.08,
        });
    });

    it('returns the mellow voicing with its exact dark-toned parameters', () => {
        const model = findPianoModelById('mellow-grand');
        expect(model?.toneColor).toBe(-0.58);
        expect(model?.hammerMassScale).toBe(1.25);
        expect(model?.hammerHardnessScale).toBe(0.72);
        expect(model?.sympatheticLevel).toBe(0.74);
    });

    it('returns the clear voicing with its exact bright-toned parameters', () => {
        const model = findPianoModelById('clear-grand');
        expect(model?.toneColor).toBe(0.56);
        expect(model?.hammerHardnessScale).toBe(1.34);
        expect(model?.soundboardBrightness).toBe(0.78);
    });

    it('returns undefined for an unknown model id', () => {
        expect(findPianoModelById('does-not-exist')).toBeUndefined();
    });

    it('rejects removed branded aliases', () => {
        expect(findPianoModelById('steinway-d')).toBeUndefined();
        expect(findPianoModelById('bosendorfer-imperial')).toBeUndefined();
        expect(findPianoModelById('yamaha-cfx')).toBeUndefined();
        expect(findPianoModelById('fazioli-f308')).toBeUndefined();
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
