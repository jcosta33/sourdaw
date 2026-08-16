import { describe, it, expect, beforeEach } from 'vitest';

import { DEFAULT_PATCH } from '../../models/ProofPatch';
import {
    proofStore,
    getProofState,
    updateProofPatch,
    updateProofMeters,
    loadProofPatch,
    setProofAbBypass,
    DEFAULT_PROOF_STATE,
    type ProofMeterData,
} from '../proofStore';

beforeEach(() => {
    proofStore.set({});
});

describe('getProofState', () => {
    it('returns a default state for an unknown device', () => {
        const state = getProofState('unknown');
        expect(state.uiLevel).toBe(1);
        expect(state.patch.name).toBe(DEFAULT_PATCH.name);
        expect(state.abBypass).toBe(false);
    });

    // ── Fix 8: each fallback gets its own mutable arrays, not a shared reference ──
    it('gives each fallback state an independent tapPeaks array', () => {
        const a = getProofState('device-a');
        const b = getProofState('device-b');

        expect(a.tapPeaks).not.toBe(b.tapPeaks);
        expect(a.tapPeaks[0]).not.toBe(b.tapPeaks[0]);

        // Mutating one fallback must not leak into another or the singleton default.
        a.tapPeaks[0] = { peakL: -3, peakR: -3 };
        expect(b.tapPeaks[0]).toEqual({ peakL: -100, peakR: -100 });
        expect(DEFAULT_PROOF_STATE.tapPeaks[0]).toEqual({ peakL: -100, peakR: -100 });
    });

    it('gives each fallback state an independent dynGr array', () => {
        const a = getProofState('device-a');
        const b = getProofState('device-b');

        expect(a.dynGr).not.toBe(b.dynGr);
        a.dynGr[0] = -6;
        expect(b.dynGr[0]).toBe(0);
        expect(DEFAULT_PROOF_STATE.dynGr[0]).toBe(0);
    });
});

describe('updateProofPatch', () => {
    it('merges the partial patch into the stored patch', () => {
        loadProofPatch({ deviceId: 'dev', patch: { ...DEFAULT_PATCH, limCeiling: -1 } });
        updateProofPatch({ deviceId: 'dev', patch: { limCeiling: -4 } });
        expect(getProofState('dev').patch.limCeiling).toBe(-4);
    });

    // ── Fix 4: a granular edit drops the preset identity ──
    it('clears presetId when a patch field is edited', () => {
        loadProofPatch({
            deviceId: 'dev',
            patch: { ...DEFAULT_PATCH, name: 'Streaming Master', presetId: 'streaming' },
        });
        expect(getProofState('dev').patch.presetId).toBe('streaming');

        updateProofPatch({ deviceId: 'dev', patch: { limCeiling: -2 } });

        expect(getProofState('dev').patch.presetId).toBeUndefined();
        // The display name is untouched — proving name is no longer the identity.
        expect(getProofState('dev').patch.name).toBe('Streaming Master');
    });
});

describe('setProofAbBypass', () => {
    it('toggles the runtime A/B flag without touching the patch', () => {
        loadProofPatch({ deviceId: 'dev', patch: { ...DEFAULT_PATCH, presetId: 'streaming' } });

        setProofAbBypass({ deviceId: 'dev', abBypass: true });

        expect(getProofState('dev').abBypass).toBe(true);
        // Runtime-only: the patch (and its preset identity) is unchanged.
        expect(getProofState('dev').patch.presetId).toBe('streaming');
    });
});

describe('updateProofMeters', () => {
    const meters: ProofMeterData = {
        inputLufs: -12.5,
        outputLufs: -10.2,
        outputStLufs: -9.8,
        integratedLufs: -14.1,
        truePeakDb: -0.3,
        lra: 6.5,
        correlation: 0.8,
        limiterGrDb: -2.1,
        dynGr: [-1, -2, -3, -4],
        tapPeaks: [{ peakL: -6, peakR: -5 }],
        latency: 12,
    };

    it('overwrites every metering field from the pushed data', () => {
        updateProofMeters('dev', meters);

        const state = getProofState('dev');
        expect(state.inputLufs).toBe(-12.5);
        expect(state.outputLufs).toBe(-10.2);
        expect(state.outputStLufs).toBe(-9.8);
        expect(state.integratedLufs).toBe(-14.1);
        expect(state.truePeakDb).toBe(-0.3);
        expect(state.lra).toBe(6.5);
        expect(state.correlation).toBe(0.8);
        expect(state.limiterGrDb).toBe(-2.1);
        expect(state.dynGr).toEqual([-1, -2, -3, -4]);
        expect(state.tapPeaks).toEqual([{ peakL: -6, peakR: -5 }]);
        expect(state.latency).toBe(12);
    });

    it('creates a default-backed state for a device seen for the first time', () => {
        updateProofMeters('brand-new', meters);

        const state = getProofState('brand-new');
        expect(state.patch.name).toBe(DEFAULT_PATCH.name);
        expect(state.inputLufs).toBe(-12.5);
        expect(state.uiLevel).toBe(1);
    });

    it('leaves the patch and unrelated runtime state untouched', () => {
        loadProofPatch({ deviceId: 'dev', patch: { ...DEFAULT_PATCH, limCeiling: -3 } });
        setProofAbBypass({ deviceId: 'dev', abBypass: true });

        updateProofMeters('dev', meters);

        expect(getProofState('dev').patch.limCeiling).toBe(-3);
        expect(getProofState('dev').abBypass).toBe(true);
    });

    it('publishes nothing when a frame repeats the values already stored', () => {
        updateProofMeters('dev', meters);
        const notified: number[] = [];
        const unsubscribe = proofStore.subscribe(() => notified.push(notified.length));

        // A silent master still pushes frames; identical ones are not news, and
        // a fresh identity per frame would wake every subscriber for nothing.
        updateProofMeters('dev', { ...meters, dynGr: [...meters.dynGr], tapPeaks: [{ ...meters.tapPeaks[0]! }] });

        expect(notified).toHaveLength(0);
        unsubscribe();
    });

    it('publishes when any single metering value moves', () => {
        updateProofMeters('dev', meters);
        const notified: number[] = [];
        const unsubscribe = proofStore.subscribe(() => notified.push(notified.length));

        updateProofMeters('dev', { ...meters, correlation: 0.79 });

        expect(notified).toHaveLength(1);
        expect(getProofState('dev').correlation).toBe(0.79);
        unsubscribe();
    });

    it('publishes when a tap peak moves inside the array', () => {
        updateProofMeters('dev', meters);
        const notified: number[] = [];
        const unsubscribe = proofStore.subscribe(() => notified.push(notified.length));

        updateProofMeters('dev', { ...meters, tapPeaks: [{ peakL: -6, peakR: -4 }] });

        expect(notified).toHaveLength(1);
        unsubscribe();
    });
});

describe('proof patch isolation', () => {
    it('gives two devices their own band objects', () => {
        loadProofPatch({ deviceId: 'a', patch: DEFAULT_PATCH });
        loadProofPatch({ deviceId: 'b', patch: DEFAULT_PATCH });

        const a = getProofState('a').patch;
        const b = getProofState('b').patch;

        expect(a.eqBands[0]).not.toBe(b.eqBands[0]);
        expect(a.dynBands[0]).not.toBe(b.dynBands[0]);
        expect(a.excBands[0]).not.toBe(b.excBands[0]);
        expect(a.imgBandWidth).not.toBe(b.imgBandWidth);
        expect(a.chainOrder).not.toBe(b.chainOrder);
    });

    it('keeps a loaded patch off the caller object it was handed', () => {
        const source = { ...DEFAULT_PATCH, eqBands: DEFAULT_PATCH.eqBands.map((band) => ({ ...band })) };
        loadProofPatch({ deviceId: 'a', patch: source });

        expect(getProofState('a').patch.eqBands[0]).not.toBe(source.eqBands[0]);
    });

    it('keeps the shipped defaults out of a device that has never been loaded', () => {
        // A meter frame is enough to materialise a device's state, and that
        // state must not be a view onto the module-level defaults.
        updateProofMeters('fresh', meterFrame());

        const patch = getProofState('fresh').patch;
        expect(patch.eqBands[0]).not.toBe(DEFAULT_PATCH.eqBands[0]);
        expect(patch.dynBands[0]).not.toBe(DEFAULT_PATCH.dynBands[0]);
        expect(patch.excBands[0]).not.toBe(DEFAULT_PATCH.excBands[0]);
        expect(patch).not.toBe(DEFAULT_PROOF_STATE.patch);
        expect(patch.eqBands[0]).not.toBe(DEFAULT_PROOF_STATE.patch.eqBands[0]);
    });
});

function meterFrame(): ProofMeterData {
    return {
        inputLufs: -12,
        outputLufs: -10,
        outputStLufs: -9,
        integratedLufs: -14,
        truePeakDb: -1,
        lra: 5,
        correlation: 1,
        limiterGrDb: 0,
        dynGr: [0, 0, 0, 0],
        tapPeaks: [{ peakL: -6, peakR: -6 }],
        latency: 0,
    };
}
