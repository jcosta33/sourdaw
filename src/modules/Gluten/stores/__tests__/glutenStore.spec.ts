import { describe, it, expect, beforeEach } from 'vitest';

import { DEFAULT_PATCH } from '../../models/GlutenPatch';
import {
    getGlutenState,
    glutenStore,
    loadGlutenPatch,
    setGlutenParam,
    setGlutenUiLevel,
    updateGlutenMeters,
} from '../glutenStore';

describe('glutenStore', () => {
    beforeEach(() => {
        glutenStore.set({});
    });

    it('should return default state with a cloned patch when the device is unknown', () => {
        const a = getGlutenState('dev-a');
        const b = getGlutenState('dev-b');
        expect(a.patch).not.toBe(b.patch);
        expect(a.patch.threshold).toBe(DEFAULT_PATCH.threshold);
        expect(a.uiLevel).toBe(2);
        expect(a.grDb).toBe(0);
    });

    it('should merge a single patch field via setGlutenParam', () => {
        setGlutenParam('d1', 'threshold', -24);
        expect(getGlutenState('d1').patch.threshold).toBe(-24);
        expect(getGlutenState('d1').patch.ratio).toBe(DEFAULT_PATCH.ratio);
    });

    it('should set ui level', () => {
        setGlutenUiLevel('d1', 5);
        expect(getGlutenState('d1').uiLevel).toBe(5);
    });

    it('should replace the full patch via loadGlutenPatch', () => {
        const next = { ...DEFAULT_PATCH, name: 'Imported' };
        loadGlutenPatch('d1', next);
        expect(getGlutenState('d1').patch.name).toBe('Imported');
    });

    it('should update meter telemetry fields', () => {
        updateGlutenMeters('d1', {
            grDb: -4,
            inputDb: -20,
            outputDb: -8,
            crest: 1.2,
            phaseCorr: 0.99,
            latency: 64,
        });
        const s = getGlutenState('d1');
        expect(s.grDb).toBe(-4);
        expect(s.inputDb).toBe(-20);
        expect(s.outputDb).toBe(-8);
        expect(s.crest).toBe(1.2);
        expect(s.phaseCorr).toBe(0.99);
        expect(s.latency).toBe(64);
    });

    it('should preserve prior crest, phaseCorr, and latency when omitted', () => {
        updateGlutenMeters('d1', {
            grDb: -1,
            inputDb: -10,
            outputDb: -10,
            crest: 2,
            phaseCorr: 0.5,
            latency: 32,
        });
        updateGlutenMeters('d1', { grDb: -2, inputDb: -11, outputDb: -11 });
        const s = getGlutenState('d1');
        expect(s.grDb).toBe(-2);
        expect(s.crest).toBe(2);
        expect(s.phaseCorr).toBe(0.5);
        expect(s.latency).toBe(32);
    });
});
