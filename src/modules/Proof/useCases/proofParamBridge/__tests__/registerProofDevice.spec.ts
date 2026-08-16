import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
    clearProofLoudnessHistory,
    readProofLoudnessHistory,
    PROOF_LOUDNESS_SAMPLE_INTERVAL_MS,
} from '../../../stores/proofLoudnessHistory';
import { updateProofMeters, type ProofMeterData } from '../../../stores/proofStore';
import { bridges, type ProofAudioBridge } from '../helpers';
import { registerProofDevice } from '../registerProofDevice';

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

describe('registerProofDevice', () => {
    beforeEach(() => {
        bridges.clear();
    });

    afterEach(() => {
        clearProofLoudnessHistory('dev-1');
        vi.useRealTimers();
    });

    it('registers a bridge so the device can be resolved from the registry', () => {
        const bridge = makeBridge();
        registerProofDevice({ deviceId: 'dev-1', bridge });
        expect(bridges.get('dev-1')).toBe(bridge);
    });

    it('replaces an existing registration for the same device id', () => {
        const first = makeBridge();
        const second = makeBridge();
        registerProofDevice({ deviceId: 'dev-1', bridge: first });
        registerProofDevice({ deviceId: 'dev-1', bridge: second });
        expect(bridges.get('dev-1')).toBe(second);
    });

    it('starts the loudness clock, so the history accrues with no graph on screen', () => {
        vi.useFakeTimers();
        updateProofMeters('dev-1', meterFrame(-11));

        registerProofDevice({ deviceId: 'dev-1', bridge: makeBridge() });
        vi.advanceTimersByTime(PROOF_LOUDNESS_SAMPLE_INTERVAL_MS * 4);

        // Nothing from the Proof panel is mounted here. The window has to be a
        // real 30 seconds of the device's output, not a record of the time a
        // graph component spent on screen.
        expect(readProofLoudnessHistory('dev-1')).toEqual([-11, -11, -11, -11]);
    });

    it('does not restart the clock when the same device re-registers its bridge', () => {
        vi.useFakeTimers();
        updateProofMeters('dev-1', meterFrame(-11));

        registerProofDevice({ deviceId: 'dev-1', bridge: makeBridge() });
        vi.advanceTimersByTime(PROOF_LOUDNESS_SAMPLE_INTERVAL_MS * 2);
        registerProofDevice({ deviceId: 'dev-1', bridge: makeBridge() });
        vi.advanceTimersByTime(PROOF_LOUDNESS_SAMPLE_INTERVAL_MS * 2);

        // A second clock would record every later tick twice and halve the
        // window's real duration.
        expect(readProofLoudnessHistory('dev-1')).toHaveLength(4);
        expect(vi.getTimerCount()).toBe(1);
    });
});
