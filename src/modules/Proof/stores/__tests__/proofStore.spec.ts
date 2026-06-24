import { describe, it, expect, beforeEach } from 'vitest';

import { DEFAULT_PATCH } from '../../models/ProofPatch';
import {
    proofStore,
    getProofState,
    updateProofPatch,
    loadProofPatch,
    setProofAbBypass,
    DEFAULT_PROOF_STATE,
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
        loadProofPatch('dev', { ...DEFAULT_PATCH, limCeiling: -1 });
        updateProofPatch('dev', { limCeiling: -4 });
        expect(getProofState('dev').patch.limCeiling).toBe(-4);
    });

    // ── Fix 4: a granular edit drops the preset identity ──
    it('clears presetId when a patch field is edited', () => {
        loadProofPatch('dev', { ...DEFAULT_PATCH, name: 'Streaming Master', presetId: 'streaming' });
        expect(getProofState('dev').patch.presetId).toBe('streaming');

        updateProofPatch('dev', { limCeiling: -2 });

        expect(getProofState('dev').patch.presetId).toBeUndefined();
        // The display name is untouched — proving name is no longer the identity.
        expect(getProofState('dev').patch.name).toBe('Streaming Master');
    });
});

describe('setProofAbBypass', () => {
    it('toggles the runtime A/B flag without touching the patch', () => {
        loadProofPatch('dev', { ...DEFAULT_PATCH, presetId: 'streaming' });

        setProofAbBypass('dev', true);

        expect(getProofState('dev').abBypass).toBe(true);
        // Runtime-only: the patch (and its preset identity) is unchanged.
        expect(getProofState('dev').patch.presetId).toBe('streaming');
    });
});
