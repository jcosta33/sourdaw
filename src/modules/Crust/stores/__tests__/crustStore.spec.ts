import { describe, it, expect, beforeEach } from 'vitest';

import { DEFAULT_CRUST_PATCH } from '../../models/CrustPatch';
import {
    crustStore,
    defaultCrustState,
    setCrustParam,
    setCrustUiLevel,
    loadCrustPatch,
    updateCrustMeters,
    resetCrustMeters,
} from '../crustStore';

describe('crustStore defaults', () => {
    it('seeds meters at silence and the patch at DEFAULT_CRUST_PATCH', () => {
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
});

describe('setCrustParam', () => {
    beforeEach(() => {
        crustStore.set({ ...defaultCrustState, patch: { ...defaultCrustState.patch, gain: 3 } });
    });

    it('writes a single patch field while leaving the rest of the patch untouched', () => {
        setCrustParam('ceiling', -1.5);

        expect(crustStore.value?.patch.ceiling).toBe(-1.5);
        expect(crustStore.value?.patch.gain).toBe(3);
    });

    it('leaves the meter fields untouched', () => {
        crustStore.set({ ...crustStore.value!, grDb: -6, inputDb: -20 });

        setCrustParam('algorithm', 'aggressive');

        expect(crustStore.value?.grDb).toBe(-6);
        expect(crustStore.value?.inputDb).toBe(-20);
    });

    it('does not throw when Crust state is unavailable', () => {
        crustStore.set(null);

        expect(() => setCrustParam('gain', 9)).not.toThrow();
        expect(crustStore.value).toBeNull();
    });
});

describe('setCrustUiLevel', () => {
    beforeEach(() => {
        crustStore.set({ ...defaultCrustState, patch: { ...defaultCrustState.patch, uiLevel: 2, name: 'Kept' } });
    });

    it('writes the uiLevel field while preserving the rest of the patch', () => {
        setCrustUiLevel(5);

        expect(crustStore.value?.patch.uiLevel).toBe(5);
        expect(crustStore.value?.patch.name).toBe('Kept');
    });

    it('does not throw when Crust state is unavailable', () => {
        crustStore.set(null);

        expect(() => setCrustUiLevel(1)).not.toThrow();
        expect(crustStore.value).toBeNull();
    });
});

describe('loadCrustPatch', () => {
    beforeEach(() => {
        crustStore.set({
            ...defaultCrustState,
            grDb: -4,
            inputDb: -18,
            patch: { ...defaultCrustState.patch, name: 'Old patch' },
        });
    });

    it('replaces the entire patch while preserving current meter values', () => {
        const nextPatch = { ...DEFAULT_CRUST_PATCH, name: 'Loaded patch', gain: 12 };

        loadCrustPatch(nextPatch);

        expect(crustStore.value?.patch).toEqual(nextPatch);
        expect(crustStore.value?.grDb).toBe(-4);
        expect(crustStore.value?.inputDb).toBe(-18);
    });

    it('does not throw when Crust state is unavailable', () => {
        crustStore.set(null);

        expect(() => loadCrustPatch(DEFAULT_CRUST_PATCH)).not.toThrow();
        expect(crustStore.value).toBeNull();
    });
});

describe('updateCrustMeters', () => {
    beforeEach(() => {
        crustStore.set({ ...defaultCrustState, patch: { ...defaultCrustState.patch, name: 'Kept patch' } });
    });

    it('merges a partial meter patch, leaving unmentioned meter fields untouched', () => {
        updateCrustMeters({ grDb: -3.2, truepeakExceeded: true });

        expect(crustStore.value?.grDb).toBe(-3.2);
        expect(crustStore.value?.truepeakExceeded).toBe(true);
        expect(crustStore.value?.inputDb).toBe(-100);
        expect(crustStore.value?.lufsIntegrated).toBe(-100);
    });

    it('leaves the patch untouched', () => {
        updateCrustMeters({ outputDb: -5 });

        expect(crustStore.value?.patch.name).toBe('Kept patch');
    });

    it('does not throw when Crust state is unavailable', () => {
        crustStore.set(null);

        expect(() => updateCrustMeters({ grDb: -1 })).not.toThrow();
        expect(crustStore.value).toBeNull();
    });
});

describe('resetCrustMeters', () => {
    beforeEach(() => {
        crustStore.set({
            ...defaultCrustState,
            patch: { ...defaultCrustState.patch, name: 'Edited patch', gain: 9 },
            grDb: -8,
            inputDb: -12,
            outputDb: -2,
            lufsIntegrated: -9,
            lufsShortTerm: -7,
            lufsMomentary: -6,
            lra: 11,
            truepeakMax: -0.2,
            truepeakExceeded: true,
        });
    });

    it('resets every meter field to silence while preserving the current patch', () => {
        resetCrustMeters();

        expect(crustStore.value).toEqual({
            ...defaultCrustState,
            patch: { ...defaultCrustState.patch, name: 'Edited patch', gain: 9 },
        });
    });

    it('does not throw when Crust state is unavailable', () => {
        crustStore.set(null);

        expect(() => resetCrustMeters()).not.toThrow();
        expect(crustStore.value).toBeNull();
    });
});
