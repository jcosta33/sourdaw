import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { crumbsStore, ensureInstance, setMasterGain } from '../crumbsStore';

const DEVICE = 'gain-clamp-test';

function readGain(): number | undefined {
    return crumbsStore.value?.[DEVICE]?.masterGain;
}

describe('setMasterGain', () => {
    beforeEach(() => {
        crumbsStore.set({});
        ensureInstance(DEVICE);
    });

    afterEach(() => {
        crumbsStore.set({});
    });

    // Regression for inventory item #5: the Crumbs Rust engine does
    // `master_gain.set(value)` with no clamp (crates/daw-dsp/src/crumbs/engine.rs),
    // so the store — the single source of truth for every caller — must bound the
    // value to the engine's 0..=2 range before it propagates to the backend.
    it('clamps a value above the max to 2', () => {
        setMasterGain(DEVICE, 2.5);
        expect(readGain()).toBe(2);
    });

    it('clamps a negative value to 0', () => {
        setMasterGain(DEVICE, -1);
        expect(readGain()).toBe(0);
    });

    it('stores an in-range value unchanged', () => {
        setMasterGain(DEVICE, 1.0);
        expect(readGain()).toBe(1.0);
    });
});
