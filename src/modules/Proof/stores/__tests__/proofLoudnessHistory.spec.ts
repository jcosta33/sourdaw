import { describe, it, expect, afterEach, vi } from 'vitest';

import {
    clearProofLoudnessHistory,
    readProofLoudnessHistory,
    startProofLoudnessSampler,
    stopProofLoudnessSampler,
    PROOF_LOUDNESS_HISTORY_LENGTH,
    PROOF_LOUDNESS_SAMPLE_INTERVAL_MS,
} from '../proofLoudnessHistory';
import { updateProofMeters, type ProofMeterData } from '../proofStore';

let nextDeviceId = 0;
const freshDeviceId = (): string => {
    nextDeviceId++;
    return `loudness-sampler-device-${nextDeviceId}`;
};

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

afterEach(() => {
    vi.useRealTimers();
});

describe('proof loudness sampler', () => {
    it('records one sample per interval, whatever the meter frame rate is', () => {
        vi.useFakeTimers();
        const deviceId = freshDeviceId();

        try {
            updateProofMeters(deviceId, meterFrame(-12));
            startProofLoudnessSampler(deviceId);

            // Ten meter frames inside one interval. The engine pushes ~62 a
            // second; recording each one filled the 30-second window in five.
            for (let frame = 1; frame <= 10; frame++) {
                updateProofMeters(deviceId, meterFrame(-12 - frame));
            }
            expect(readProofLoudnessHistory(deviceId)).toHaveLength(0);

            vi.advanceTimersByTime(PROOF_LOUDNESS_SAMPLE_INTERVAL_MS * 3);

            // Three elapsed intervals, three samples — the count follows the
            // clock and never the ten frames.
            expect(readProofLoudnessHistory(deviceId)).toHaveLength(3);
        } finally {
            clearProofLoudnessHistory(deviceId);
        }
    });

    it('records the momentary reading held at each tick', () => {
        vi.useFakeTimers();
        const deviceId = freshDeviceId();

        try {
            updateProofMeters(deviceId, meterFrame(-12));
            startProofLoudnessSampler(deviceId);

            vi.advanceTimersByTime(PROOF_LOUDNESS_SAMPLE_INTERVAL_MS);
            updateProofMeters(deviceId, meterFrame(-6));
            vi.advanceTimersByTime(PROOF_LOUDNESS_SAMPLE_INTERVAL_MS);

            expect(readProofLoudnessHistory(deviceId)).toEqual([-12, -6]);
        } finally {
            clearProofLoudnessHistory(deviceId);
        }
    });

    it('keeps sampling a held level that the meter sink stops republishing', () => {
        vi.useFakeTimers();
        const deviceId = freshDeviceId();

        try {
            // `updateProofMeters` drops a frame identical to the last one, so a
            // sampler riding the meter path would record nothing through a
            // steady passage. Elapsed time is elapsed time: the graph's axis has
            // to advance whether or not the number moved.
            updateProofMeters(deviceId, meterFrame(-9));
            startProofLoudnessSampler(deviceId);
            for (let frame = 0; frame < 5; frame++) {
                updateProofMeters(deviceId, meterFrame(-9));
                vi.advanceTimersByTime(PROOF_LOUDNESS_SAMPLE_INTERVAL_MS);
            }

            expect(readProofLoudnessHistory(deviceId)).toEqual([-9, -9, -9, -9, -9]);
        } finally {
            clearProofLoudnessHistory(deviceId);
        }
    });

    it('leaves an already-running clock alone when the device re-registers its bridge', () => {
        vi.useFakeTimers();
        const deviceId = freshDeviceId();

        try {
            updateProofMeters(deviceId, meterFrame(-12));
            startProofLoudnessSampler(deviceId);
            vi.advanceTimersByTime(PROOF_LOUDNESS_SAMPLE_INTERVAL_MS * 2);

            // A second start must not install a second interval, or every later
            // tick would record the same reading twice and halve the window.
            startProofLoudnessSampler(deviceId);
            vi.advanceTimersByTime(PROOF_LOUDNESS_SAMPLE_INTERVAL_MS * 2);

            expect(readProofLoudnessHistory(deviceId)).toHaveLength(4);
        } finally {
            clearProofLoudnessHistory(deviceId);
        }
    });

    it('keeps two devices on separate histories', () => {
        vi.useFakeTimers();
        const first = freshDeviceId();
        const second = freshDeviceId();

        try {
            updateProofMeters(first, meterFrame(-12));
            updateProofMeters(second, meterFrame(-20));
            startProofLoudnessSampler(first);
            vi.advanceTimersByTime(PROOF_LOUDNESS_SAMPLE_INTERVAL_MS * 2);
            startProofLoudnessSampler(second);
            vi.advanceTimersByTime(PROOF_LOUDNESS_SAMPLE_INTERVAL_MS);

            expect(readProofLoudnessHistory(first)).toEqual([-12, -12, -12]);
            expect(readProofLoudnessHistory(second)).toEqual([-20]);
        } finally {
            clearProofLoudnessHistory(first);
            clearProofLoudnessHistory(second);
        }
    });

    it('retains only the newest window once the buffer wraps', () => {
        vi.useFakeTimers();
        const deviceId = freshDeviceId();

        try {
            updateProofMeters(deviceId, meterFrame(-30));
            startProofLoudnessSampler(deviceId);
            vi.advanceTimersByTime(PROOF_LOUDNESS_SAMPLE_INTERVAL_MS * PROOF_LOUDNESS_HISTORY_LENGTH);
            updateProofMeters(deviceId, meterFrame(-3));
            vi.advanceTimersByTime(PROOF_LOUDNESS_SAMPLE_INTERVAL_MS);

            const samples = readProofLoudnessHistory(deviceId);
            expect(samples).toHaveLength(PROOF_LOUDNESS_HISTORY_LENGTH);
            expect(samples.at(-1)).toBe(-3);
            expect(samples.at(0)).toBe(-30);
        } finally {
            clearProofLoudnessHistory(deviceId);
        }
    });

    it('stops the clock so no timer outlives the device', () => {
        vi.useFakeTimers();
        const deviceId = freshDeviceId();

        try {
            updateProofMeters(deviceId, meterFrame(-12));
            startProofLoudnessSampler(deviceId);
            vi.advanceTimersByTime(PROOF_LOUDNESS_SAMPLE_INTERVAL_MS * 2);

            stopProofLoudnessSampler(deviceId);

            // The clock is the only thing scheduled here, so a surviving timer
            // is a leak per unregistered device on a 100 ms period.
            expect(vi.getTimerCount()).toBe(0);
            vi.advanceTimersByTime(PROOF_LOUDNESS_SAMPLE_INTERVAL_MS * 50);
            expect(readProofLoudnessHistory(deviceId)).toHaveLength(2);
        } finally {
            clearProofLoudnessHistory(deviceId);
        }
    });

    it('drops the history and the clock together when the device goes away', () => {
        vi.useFakeTimers();
        const deviceId = freshDeviceId();

        try {
            updateProofMeters(deviceId, meterFrame(-12));
            startProofLoudnessSampler(deviceId);
            vi.advanceTimersByTime(PROOF_LOUDNESS_SAMPLE_INTERVAL_MS * 3);

            clearProofLoudnessHistory(deviceId);

            expect(vi.getTimerCount()).toBe(0);
            vi.advanceTimersByTime(PROOF_LOUDNESS_SAMPLE_INTERVAL_MS * 50);
            expect(readProofLoudnessHistory(deviceId)).toEqual([]);
        } finally {
            clearProofLoudnessHistory(deviceId);
        }
    });

    it('is a no-op when stopping a device that never sampled', () => {
        vi.useFakeTimers();
        const deviceId = freshDeviceId();

        expect(() => {
            stopProofLoudnessSampler(deviceId);
        }).not.toThrow();
        expect(vi.getTimerCount()).toBe(0);
    });
});
