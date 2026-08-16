import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
    clearProofLoudnessHistory,
    readProofLoudnessHistory,
    PROOF_LOUDNESS_SAMPLE_INTERVAL_MS,
} from '../../../stores/proofLoudnessHistory';
import { updateProofMeters, type ProofMeterData } from '../../../stores/proofStore';
import { bridges, type ProofAudioBridge } from '../helpers';
import { registerProofDevice } from '../registerProofDevice';
import { unregisterProofDevice } from '../unregisterProofDevice';

function makeBridge(): ProofAudioBridge {
    return {
        setParam: vi.fn(),
        reorderModules: vi.fn(),
        resetIntegrated: vi.fn(),
    };
}

const meterFrame = (outputLufs: number): ProofMeterData => ({
    inputLufs: -20,
    outputLufs,
    outputStLufs: -12,
    integratedLufs: -14,
    truePeakDb: -1,
    lra: 6,
    correlation: 0.9,
    limiterGrDb: 0,
    dynGr: [0, 0, 0, 0],
    tapPeaks: [{ peakL: -6, peakR: -6 }],
    latency: 0,
});

describe('unregisterProofDevice', () => {
    beforeEach(() => {
        bridges.clear();
    });

    afterEach(() => {
        clearProofLoudnessHistory('dev-1');
        vi.useRealTimers();
    });

    it('removes the bridge so later syncs for that device become no-ops', () => {
        const bridge = makeBridge();
        bridges.set('dev-1', bridge);

        unregisterProofDevice('dev-1');

        expect(bridges.has('dev-1')).toBe(false);
    });

    it('is a no-op when the device was never registered', () => {
        expect(() => unregisterProofDevice('missing-device')).not.toThrow();
        expect(bridges.has('missing-device')).toBe(false);
    });

    it('stops the loudness clock, leaving no timer behind the device', () => {
        vi.useFakeTimers();
        updateProofMeters('dev-1', meterFrame(-11));
        registerProofDevice({ deviceId: 'dev-1', bridge: makeBridge() });
        vi.advanceTimersByTime(PROOF_LOUDNESS_SAMPLE_INTERVAL_MS * 3);
        expect(vi.getTimerCount()).toBe(1);

        unregisterProofDevice('dev-1');

        // The clock outlives every graph, so the device going away is the only
        // thing that ends it. A survivor is a leaked 100 ms interval writing into
        // a buffer nothing will ever read, one per device the session opens.
        expect(vi.getTimerCount()).toBe(0);
        vi.advanceTimersByTime(PROOF_LOUDNESS_SAMPLE_INTERVAL_MS * 100);
        expect(readProofLoudnessHistory('dev-1')).toEqual([]);
    });
});
