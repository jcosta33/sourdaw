import { describe, it, expect, beforeEach } from 'vitest';

import { DEFAULT_PATCH } from '../../models/BacteriaPatch';
import {
    bacteriaStore,
    DEFAULT_BACTERIA_STATE,
    getBacteriaState,
    setBacteriaParam,
    setBacteriaBandParam,
    setBacteriaUiLevel,
    setBacteriaActiveBand,
    setBacteriaActiveModule,
    loadBacteriaPatch,
    updateBacteriaMeters,
    type BacteriaState,
} from '../bacteriaStore';

const DEVICE_A = 'device-a';
const DEVICE_B = 'device-b';

function seed(deviceId: string, overrides: Partial<BacteriaState> = {}): void {
    const instances = bacteriaStore.value ?? {};
    bacteriaStore.set({
        ...instances,
        [deviceId]: { ...DEFAULT_BACTERIA_STATE, patch: { ...DEFAULT_PATCH }, ...overrides },
    });
}

beforeEach(() => {
    bacteriaStore.set({});
});

describe('DEFAULT_BACTERIA_STATE', () => {
    it('seeds meters at silence, six zeroed band levels, and the default patch/module', () => {
        expect(DEFAULT_BACTERIA_STATE).toEqual({
            patch: DEFAULT_PATCH,
            inputDb: -100,
            outputDb: -100,
            bandLevels: [0, 0, 0, 0, 0, 0],
            latency: 0,
            activeBand: 0,
            uiLevel: 1,
            activeModule: 'distortion',
        });
    });
});

describe('getBacteriaState', () => {
    it('returns a default clone for an unknown deviceId', () => {
        expect(getBacteriaState(DEVICE_A)).toEqual(DEFAULT_BACTERIA_STATE);
    });

    it('returns a patch clone so mutating it cannot corrupt DEFAULT_PATCH', () => {
        const state = getBacteriaState(DEVICE_A);
        state.patch.name = 'Mutated';

        expect(DEFAULT_PATCH.name).toBe('Init');
        expect(getBacteriaState(DEVICE_A).patch.name).toBe('Init');
    });

    it('returns the stored state for a known deviceId', () => {
        seed(DEVICE_A, { inputDb: -12, activeModule: 'filter' });

        expect(getBacteriaState(DEVICE_A).inputDb).toBe(-12);
        expect(getBacteriaState(DEVICE_A).activeModule).toBe('filter');
    });

    it('keeps instances isolated by deviceId', () => {
        seed(DEVICE_A, { activeBand: 3 });

        expect(getBacteriaState(DEVICE_B).activeBand).toBe(0);
    });
});

describe('setBacteriaParam', () => {
    it('creates a default instance and writes the field when the deviceId is unknown', () => {
        setBacteriaParam(DEVICE_A, 'mix', 0.25);

        expect(bacteriaStore.value?.[DEVICE_A]?.patch.mix).toBe(0.25);
        expect(bacteriaStore.value?.[DEVICE_A]?.patch.outputGain).toBe(DEFAULT_PATCH.outputGain);
    });

    it('writes a single patch field while leaving the rest of the patch untouched', () => {
        seed(DEVICE_A, { patch: { ...DEFAULT_PATCH, outputGain: 4 } });

        setBacteriaParam(DEVICE_A, 'mix', 0.6);

        expect(bacteriaStore.value?.[DEVICE_A]?.patch.mix).toBe(0.6);
        expect(bacteriaStore.value?.[DEVICE_A]?.patch.outputGain).toBe(4);
    });

    it('leaves the non-patch fields of the state untouched', () => {
        seed(DEVICE_A, { inputDb: -8, activeBand: 2 });

        setBacteriaParam(DEVICE_A, 'bypass', true);

        expect(bacteriaStore.value?.[DEVICE_A]?.inputDb).toBe(-8);
        expect(bacteriaStore.value?.[DEVICE_A]?.activeBand).toBe(2);
    });

    it('does not affect other device instances', () => {
        seed(DEVICE_A, { patch: { ...DEFAULT_PATCH, mix: 0.1 } });
        seed(DEVICE_B, { patch: { ...DEFAULT_PATCH, mix: 0.9 } });

        setBacteriaParam(DEVICE_A, 'mix', 0.5);

        expect(bacteriaStore.value?.[DEVICE_A]?.patch.mix).toBe(0.5);
        expect(bacteriaStore.value?.[DEVICE_B]?.patch.mix).toBe(0.9);
    });
});

describe('setBacteriaBandParam', () => {
    beforeEach(() => {
        seed(DEVICE_A, {
            patch: {
                ...DEFAULT_PATCH,
                bands: DEFAULT_PATCH.bands.map((band) => ({ ...band })),
            },
        });
    });

    it('writes a field on the targeted band while leaving other bands untouched', () => {
        setBacteriaBandParam(DEVICE_A, 1, 'drive', 42);

        expect(bacteriaStore.value?.[DEVICE_A]?.patch.bands[1]?.drive).toBe(42);
        expect(bacteriaStore.value?.[DEVICE_A]?.patch.bands[0]?.drive).toBe(DEFAULT_PATCH.bands[0]?.drive);
        expect(bacteriaStore.value?.[DEVICE_A]?.patch.bands[2]?.drive).toBe(DEFAULT_PATCH.bands[2]?.drive);
    });

    it('accepts a string-valued band field', () => {
        setBacteriaBandParam(DEVICE_A, 0, 'filterMode', 'bandpass');

        expect(bacteriaStore.value?.[DEVICE_A]?.patch.bands[0]?.filterMode).toBe('bandpass');
    });

    it('is a no-op for a band index at the array length (6 bands, index 6)', () => {
        const before = bacteriaStore.value;

        setBacteriaBandParam(DEVICE_A, 6, 'drive', 99);

        expect(bacteriaStore.value).toBe(before);
    });

    it('is a no-op for a negative band index', () => {
        const before = bacteriaStore.value;

        setBacteriaBandParam(DEVICE_A, -1, 'drive', 99);

        expect(bacteriaStore.value).toBe(before);
    });

    it('creates a default instance and writes the band when the deviceId is unknown', () => {
        setBacteriaBandParam(DEVICE_B, 0, 'gain', 6);

        expect(bacteriaStore.value?.[DEVICE_B]?.patch.bands[0]?.gain).toBe(6);
    });
});

describe('setBacteriaUiLevel', () => {
    it('writes the uiLevel field while preserving the rest of the patch', () => {
        seed(DEVICE_A, { patch: { ...DEFAULT_PATCH, name: 'Kept' } });

        setBacteriaUiLevel(DEVICE_A, 4);

        expect(bacteriaStore.value?.[DEVICE_A]?.uiLevel).toBe(4);
        expect(bacteriaStore.value?.[DEVICE_A]?.patch.name).toBe('Kept');
    });

    it('creates a default instance when the deviceId is unknown', () => {
        setBacteriaUiLevel(DEVICE_A, 5);

        expect(bacteriaStore.value?.[DEVICE_A]?.uiLevel).toBe(5);
    });
});

describe('setBacteriaActiveBand', () => {
    it('writes the activeBand index', () => {
        seed(DEVICE_A);

        setBacteriaActiveBand(DEVICE_A, 3);

        expect(bacteriaStore.value?.[DEVICE_A]?.activeBand).toBe(3);
    });

    it('does not bounds-check against the band count (unlike setBacteriaBandParam)', () => {
        seed(DEVICE_A);

        setBacteriaActiveBand(DEVICE_A, 99);

        expect(bacteriaStore.value?.[DEVICE_A]?.activeBand).toBe(99);
    });
});

describe('setBacteriaActiveModule', () => {
    it('writes the activeModule field while preserving the rest of the state', () => {
        seed(DEVICE_A, { uiLevel: 3 });

        setBacteriaActiveModule(DEVICE_A, 'granular');

        expect(bacteriaStore.value?.[DEVICE_A]?.activeModule).toBe('granular');
        expect(bacteriaStore.value?.[DEVICE_A]?.uiLevel).toBe(3);
    });
});

describe('loadBacteriaPatch', () => {
    it('replaces the entire patch while preserving current meter and UI state', () => {
        seed(DEVICE_A, {
            inputDb: -18,
            outputDb: -22,
            bandLevels: [1, 2, 3, 4, 5, 6],
            latency: 128,
            activeBand: 2,
            uiLevel: 3,
            patch: { ...DEFAULT_PATCH, name: 'Old patch' },
        });
        const nextPatch = { ...DEFAULT_PATCH, name: 'Loaded patch', mix: 0.42 };

        loadBacteriaPatch(DEVICE_A, nextPatch);

        expect(bacteriaStore.value?.[DEVICE_A]?.patch).toEqual(nextPatch);
        expect(bacteriaStore.value?.[DEVICE_A]?.inputDb).toBe(-18);
        expect(bacteriaStore.value?.[DEVICE_A]?.outputDb).toBe(-22);
        expect(bacteriaStore.value?.[DEVICE_A]?.bandLevels).toEqual([1, 2, 3, 4, 5, 6]);
        expect(bacteriaStore.value?.[DEVICE_A]?.latency).toBe(128);
        expect(bacteriaStore.value?.[DEVICE_A]?.activeBand).toBe(2);
        expect(bacteriaStore.value?.[DEVICE_A]?.uiLevel).toBe(3);
    });

    it('creates a default instance and sets the patch when the deviceId is unknown', () => {
        const nextPatch = { ...DEFAULT_PATCH, name: 'Fresh load' };

        loadBacteriaPatch(DEVICE_A, nextPatch);

        expect(bacteriaStore.value?.[DEVICE_A]?.patch).toEqual(nextPatch);
    });
});

describe('updateBacteriaMeters', () => {
    it('writes inputDb and outputDb', () => {
        seed(DEVICE_A);

        updateBacteriaMeters(DEVICE_A, -6, -9);

        expect(bacteriaStore.value?.[DEVICE_A]?.inputDb).toBe(-6);
        expect(bacteriaStore.value?.[DEVICE_A]?.outputDb).toBe(-9);
    });

    it('writes bandLevels and latency when provided', () => {
        seed(DEVICE_A);

        updateBacteriaMeters(DEVICE_A, -6, -9, [1, 2, 3, 4, 5, 6], 64);

        expect(bacteriaStore.value?.[DEVICE_A]?.bandLevels).toEqual([1, 2, 3, 4, 5, 6]);
        expect(bacteriaStore.value?.[DEVICE_A]?.latency).toBe(64);
    });

    it('preserves the previous bandLevels and latency when omitted', () => {
        seed(DEVICE_A, { bandLevels: [9, 9, 9, 9, 9, 9], latency: 256 });

        updateBacteriaMeters(DEVICE_A, -3, -4);

        expect(bacteriaStore.value?.[DEVICE_A]?.bandLevels).toEqual([9, 9, 9, 9, 9, 9]);
        expect(bacteriaStore.value?.[DEVICE_A]?.latency).toBe(256);
    });

    it('leaves the patch untouched', () => {
        seed(DEVICE_A, { patch: { ...DEFAULT_PATCH, name: 'Kept patch' } });

        updateBacteriaMeters(DEVICE_A, -1, -2);

        expect(bacteriaStore.value?.[DEVICE_A]?.patch.name).toBe('Kept patch');
    });
});
