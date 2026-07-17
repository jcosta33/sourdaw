import { describe, it, expect, beforeEach } from 'vitest';

import { DEFAULT_TUNER_STATE as MODEL_DEFAULT } from '../../models/TunerState';
import {
    DEFAULT_TUNER_STATE as STORE_DEFAULT,
    tunerStore,
    getTunerState,
    updateTunerTelemetry,
    mergeDeviceState,
} from '../tunerStore';

describe('tunerStore type/const dedup', () => {
    // The store must re-export the canonical definitions from models/TunerState
    // rather than maintaining its own byte-identical copies. A duplicate copy is a
    // distinct object literal, so referential identity is the seam that proves the
    // two paths resolve to one source and cannot silently drift apart.
    it('re-exports the same DEFAULT_TUNER_STATE reference as the model', () => {
        expect(STORE_DEFAULT).toBe(MODEL_DEFAULT);
    });
});

describe('getTunerState', () => {
    beforeEach(() => {
        tunerStore.set({});
    });

    it('returns a stable reference for a device absent from the record', () => {
        // useStoreSelector caches selections by Object.is; a fresh object literal per
        // call would defeat that cache and re-render a mounted panel on every other
        // device's telemetry tick. The fallback identity must be stable across calls.
        expect(getTunerState('absent')).toBe(getTunerState('absent'));
        expect(getTunerState('absent')).toBe(getTunerState('another-absent'));
    });

    it('returns the default field values for an absent device', () => {
        expect(getTunerState('absent')).toEqual(MODEL_DEFAULT);
    });
});

describe('updateTunerTelemetry', () => {
    beforeEach(() => {
        tunerStore.set({});
    });

    it('preserves user-set mode and a4Reference while overwriting telemetry fields', () => {
        // Seed a device whose user preferences differ from the defaults.
        mergeDeviceState('d1', { mode: 'strobe', a4Reference: 432 });

        updateTunerTelemetry('d1', { frequency: 329.6, cents: -4.2, confidence: 0.9, active: true });

        const state = tunerStore.value?.d1;
        // Telemetry fields overwritten.
        expect(state?.frequency).toBe(329.6);
        expect(state?.cents).toBe(-4.2);
        expect(state?.confidence).toBe(0.9);
        expect(state?.active).toBe(true);
        // User preferences preserved across the telemetry tick.
        expect(state?.mode).toBe('strobe');
        expect(state?.a4Reference).toBe(432);
    });

    it('does not disturb other devices in the record', () => {
        mergeDeviceState('d1', { a4Reference: 432 });
        mergeDeviceState('d2', { a4Reference: 444 });

        updateTunerTelemetry('d1', { frequency: 220 });

        expect(tunerStore.value?.d2?.a4Reference).toBe(444);
        expect(tunerStore.value?.d1?.a4Reference).toBe(432);
        expect(tunerStore.value?.d1?.frequency).toBe(220);
    });
});
