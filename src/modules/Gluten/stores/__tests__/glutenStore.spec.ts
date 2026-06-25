import { describe, it, expect, beforeEach } from 'vitest';

import { DEFAULT_PATCH } from '../../models/GlutenPatch';
import {
    DEFAULT_GLUTEN_METERS,
    getGlutenMeters,
    getGlutenState,
    glutenMeterStore,
    glutenStore,
    loadGlutenPatch,
    setGlutenParam,
    setGlutenUiLevel,
    updateGlutenMeters,
} from '../glutenStore';

describe('glutenStore', () => {
    beforeEach(() => {
        glutenStore.set({});
        glutenMeterStore.set({});
    });

    it('should return default state with a cloned patch when the device is unknown', () => {
        const a = getGlutenState('dev-a');
        const b = getGlutenState('dev-b');
        expect(a.patch).not.toBe(b.patch);
        expect(a.patch.threshold).toBe(DEFAULT_PATCH.threshold);
        expect(a.uiLevel).toBe(2);
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

    describe('meter telemetry', () => {
        it('should return default meters for an unknown device', () => {
            expect(getGlutenMeters('unknown')).toEqual(DEFAULT_GLUTEN_METERS);
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
            const m = getGlutenMeters('d1');
            expect(m.grDb).toBe(-4);
            expect(m.inputDb).toBe(-20);
            expect(m.outputDb).toBe(-8);
            expect(m.crest).toBe(1.2);
            expect(m.phaseCorr).toBe(0.99);
            expect(m.latency).toBe(64);
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
            const m = getGlutenMeters('d1');
            expect(m.grDb).toBe(-2);
            expect(m.crest).toBe(2);
            expect(m.phaseCorr).toBe(0.5);
            expect(m.latency).toBe(32);
        });
    });

    describe('fix 1 — meter ticks do not fan out across instances or the patch store', () => {
        it('should leave another device meter slice referentially unchanged on a tick', () => {
            // Seed two devices, then tick only device A. Device B's slice must keep
            // its object identity so a `useGlutenMeters(B)` subscriber re-uses its
            // previous snapshot and React skips B's re-render.
            updateGlutenMeters('a', { grDb: -1, inputDb: -10, outputDb: -5 });
            updateGlutenMeters('b', { grDb: -2, inputDb: -12, outputDb: -6 });
            const bBefore = getGlutenMeters('b');

            updateGlutenMeters('a', { grDb: -3, inputDb: -14, outputDb: -7 });

            expect(getGlutenMeters('b')).toBe(bBefore);
            expect(getGlutenMeters('a').grDb).toBe(-3);
        });

        it('should not touch the patch store when meters tick', () => {
            setGlutenParam('a', 'threshold', -30);
            const patchMapBefore = glutenStore.value;
            const stateBefore = getGlutenState('a');

            updateGlutenMeters('a', { grDb: -9, inputDb: -20, outputDb: -10 });

            // The whole patch map keeps its identity; no patch-store subscriber
            // re-renders on a meter tick.
            expect(glutenStore.value).toBe(patchMapBefore);
            expect(getGlutenState('a')).toBe(stateBefore);
        });
    });
});
