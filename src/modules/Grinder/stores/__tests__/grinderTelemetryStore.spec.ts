import { beforeEach, describe, expect, it } from 'vitest';

import {
    DEFAULT_GRINDER_TELEMETRY,
    getGrinderTelemetry,
    grinderTelemetryStore,
    updateGrinderTelemetry,
    type GrinderTelemetry,
} from '../grinderTelemetryStore';

const FULL_TELEMETRY: GrinderTelemetry = {
    inputDb: -12,
    preampDb: -8,
    powerAmpDb: -6,
    outputDb: -3,
    gateOpen: 0.5,
    gateEnvelopeDb: -20,
    sagVoltage: 0.9,
    latency: 128,
    neuralCpuPercent: 42,
    neuralWarmupProgress: 0.75,
};

describe('grinderTelemetryStore', () => {
    const device_id = 'test-device';

    beforeEach(() => {
        grinderTelemetryStore.set({});
    });

    it('should return the shared default telemetry for an unknown device', () => {
        expect(getGrinderTelemetry(device_id)).toBe(DEFAULT_GRINDER_TELEMETRY);
    });

    it('should store a full telemetry frame and read it back', () => {
        updateGrinderTelemetry(device_id, FULL_TELEMETRY);

        expect(getGrinderTelemetry(device_id)).toEqual(FULL_TELEMETRY);
    });

    it('should replace the prior frame with the latest full frame', () => {
        updateGrinderTelemetry(device_id, FULL_TELEMETRY);
        const next: GrinderTelemetry = { ...FULL_TELEMETRY, outputDb: -1, gateOpen: 1 };
        updateGrinderTelemetry(device_id, next);

        expect(getGrinderTelemetry(device_id)).toEqual(next);
    });

    it('should keep separate telemetry per device', () => {
        const other = 'other-device';
        updateGrinderTelemetry(device_id, FULL_TELEMETRY);
        updateGrinderTelemetry(other, { ...FULL_TELEMETRY, inputDb: -1 });

        expect(getGrinderTelemetry(device_id).inputDb).toBe(-12);
        expect(getGrinderTelemetry(other).inputDb).toBe(-1);
    });

    it('should not allow the shared default to be mutated', () => {
        expect(Object.isFrozen(DEFAULT_GRINDER_TELEMETRY)).toBe(true);
    });
});
