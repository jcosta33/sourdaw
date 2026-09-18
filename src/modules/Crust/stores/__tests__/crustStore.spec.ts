import { describe, it, expect, beforeEach } from 'vitest';

import { DEFAULT_CRUST_PATCH } from '../../models/CrustPatch';
import {
    crustStore,
    crustMeterStore,
    defaultCrustInstanceState,
    defaultCrustState,
    deleteCrustMeters,
    getCrustMeters,
    getCrustState,
    INITIAL_METERS,
    loadCrustPatch,
    resetCrustMeters,
    setCrustParam,
    setCrustUiLevel,
    updateCrustMeters,
} from '../crustStore';

const A = 'crust-a';
const B = 'crust-b';

describe('crustStore defaults', () => {
    it('seeds the combined read shape with meters at silence and the patch at DEFAULT_CRUST_PATCH', () => {
        expect(defaultCrustState).toEqual({
            patch: DEFAULT_CRUST_PATCH,
            grDb: 0,
            inputDb: -100,
            outputDb: -100,
            lufsIntegrated: -100,
            lufsShortTerm: -100,
            lufsMomentary: -100,
            lra: 0,
            truepeakMax: -100,
            truepeakExceeded: false,
        });
    });

    it('answers reads for an unknown device from the default instance, writing nothing', () => {
        expect(getCrustState('ghost').patch).toEqual(DEFAULT_CRUST_PATCH);
        expect(getCrustMeters('ghost')).toEqual(INITIAL_METERS);
        expect(crustStore.value).toEqual({});
    });
});

describe('setCrustParam', () => {
    beforeEach(() => {
        crustStore.set({});
        crustMeterStore.set({});
    });

    it('writes a single patch field for the addressed device only', () => {
        setCrustParam(A, 'gain', 3);
        setCrustParam(B, 'ceiling', -1.5);

        expect(getCrustState(A).patch.gain).toBe(3);
        expect(getCrustState(A).patch.ceiling).toBe(DEFAULT_CRUST_PATCH.ceiling);
        expect(getCrustState(B).patch.ceiling).toBe(-1.5);
        // Instance isolation is the defect #3672 fixes: B's write must not
        // surface through A's slice.
        expect(getCrustState(B).patch.gain).toBe(DEFAULT_CRUST_PATCH.gain);
    });

    it('preserves the other patch fields of the addressed instance', () => {
        setCrustParam(A, 'gain', 3);
        setCrustParam(A, 'ceiling', -1.5);

        const state = getCrustState(A);
        expect(state.patch.ceiling).toBe(-1.5);
        expect(state.patch.gain).toBe(3);
    });
});

describe('setCrustUiLevel', () => {
    beforeEach(() => {
        crustStore.set({});
        crustMeterStore.set({});
    });

    it('discloses instances independently', () => {
        setCrustParam(A, 'name', 'Kept');
        setCrustUiLevel(A, 5);
        setCrustUiLevel(B, 1);

        expect(getCrustState(A).patch.uiLevel).toBe(5);
        expect(getCrustState(A).patch.name).toBe('Kept');
        expect(getCrustState(B).patch.uiLevel).toBe(1);
    });
});

describe('loadCrustPatch', () => {
    beforeEach(() => {
        crustStore.set({});
        crustMeterStore.set({});
    });

    it('replaces one instance’s patch and leaves the other instance untouched', () => {
        setCrustParam(B, 'name', 'Untouched');
        const nextPatch = { ...DEFAULT_CRUST_PATCH, name: 'Loaded patch', gain: 12 };

        loadCrustPatch(A, nextPatch);

        expect(getCrustState(A).patch).toEqual(nextPatch);
        expect(getCrustState(B).patch.name).toBe('Untouched');
    });
});

describe('updateCrustMeters', () => {
    beforeEach(() => {
        crustStore.set({});
        crustMeterStore.set({});
    });

    it('merges a partial meter patch into the addressed device’s slice only', () => {
        updateCrustMeters(A, { grDb: -3.2, truepeakExceeded: true });

        expect(getCrustMeters(A)).toMatchObject({ grDb: -3.2, truepeakExceeded: true, inputDb: -100 });
        expect(getCrustMeters(B)).toEqual(INITIAL_METERS);
    });

    it('keeps a meter tick off one device from rewriting another device’s snapshot', () => {
        updateCrustMeters(A, { grDb: -12 });
        updateCrustMeters(B, { grDb: -30 });

        const before = crustMeterStore.value?.[A];
        updateCrustMeters(B, { grDb: -31 });

        // Referential identity for the untouched slice is what lets the
        // `useCrustMeters` subscriber for A skip its re-render.
        expect(crustMeterStore.value?.[A]).toBe(before);
        expect(crustMeterStore.value?.[A]?.grDb).toBe(-12);
    });

    it('keeps meters out of the patch store', () => {
        updateCrustMeters(A, { outputDb: -5 });

        expect(Object.hasOwn(crustStore.value?.[A] ?? {}, 'outputDb')).toBe(false);
        expect(getCrustState(A)).toEqual(defaultCrustInstanceState);
    });
});

describe('resetCrustMeters', () => {
    beforeEach(() => {
        crustStore.set({});
        crustMeterStore.set({});
    });

    it('resets one device’s meters to silence while leaving its patch and the other device intact', () => {
        setCrustParam(A, 'name', 'Edited patch');
        updateCrustMeters(A, { grDb: -8, inputDb: -12, truepeakExceeded: true });
        updateCrustMeters(B, { grDb: -4 });

        resetCrustMeters(A);

        expect(getCrustMeters(A)).toEqual(INITIAL_METERS);
        expect(getCrustState(A).patch.name).toBe('Edited patch');
        expect(getCrustMeters(B).grDb).toBe(-4);
    });
});

describe('deleteCrustMeters', () => {
    beforeEach(() => {
        crustStore.set({});
        crustMeterStore.set({});
    });

    it('drops only the destroyed device’s slice; the survivor keeps reading and ticking', () => {
        setCrustParam(A, 'ceiling', -1.5);
        updateCrustMeters(A, { inputDb: -12 });
        updateCrustMeters(B, { inputDb: -30 });

        deleteCrustMeters(B);

        expect(crustMeterStore.value && Object.hasOwn(crustMeterStore.value, B)).toBe(false);
        expect(getCrustMeters(A).inputDb).toBe(-12);
        // Removing one instance must not touch the survivor's patch either.
        expect(getCrustState(A).patch.ceiling).toBe(-1.5);

        // A late frame for the destroyed device re-creates only its own slice.
        updateCrustMeters(B, { inputDb: -30 });
        expect(getCrustMeters(B).inputDb).toBe(-30);
        expect(getCrustMeters(A).inputDb).toBe(-12);
    });
});
