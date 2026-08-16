import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';

import {
    clearProofLoudnessHistory,
    readProofLoudnessHistory,
    stopProofLoudnessSampler,
    PROOF_LOUDNESS_SAMPLE_INTERVAL_MS,
} from '../../../stores/proofLoudnessHistory';
import { updateProofMeters, type ProofMeterData } from '../../../stores/proofStore';
import { registerProofDevice } from '../../../useCases/proofParamBridge/registerProofDevice';
import { unregisterProofDevice } from '../../../useCases/proofParamBridge/unregisterProofDevice';
import { useProofLoudnessHistory } from '../useProofLoudnessHistory';

let nextDeviceId = 0;
const freshDeviceId = (): string => {
    nextDeviceId++;
    return `loudness-history-device-${nextDeviceId}`;
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

/** Registering the device is what starts its loudness clock. */
const registerSamplingDevice = (deviceId: string): void => {
    registerProofDevice({
        deviceId,
        bridge: { setParam: vi.fn(), reorderModules: vi.fn(), resetIntegrated: vi.fn() },
    });
};

afterEach(() => {
    vi.useRealTimers();
});

describe('useProofLoudnessHistory', () => {
    it('shows the retained window on the first render, with no timer advance', () => {
        vi.useFakeTimers();
        const deviceId = freshDeviceId();

        try {
            updateProofMeters(deviceId, meterFrame(-12));
            registerSamplingDevice(deviceId);
            act(() => {
                vi.advanceTimersByTime(PROOF_LOUDNESS_SAMPLE_INTERVAL_MS * 3);
            });

            // A desk-level switch (Build <-> Lab) mounts the graph fresh. Starting
            // at no samples blanks the 30-second window for a full interval, which
            // is the exact outcome the module-level buffer exists to prevent.
            const { result } = renderHook(() => useProofLoudnessHistory(deviceId));

            expect(result.current).toEqual([-12, -12, -12]);
        } finally {
            unregisterProofDevice(deviceId);
        }
    });

    it('takes no samples of its own — mounting the graph without a registered device records nothing', () => {
        vi.useFakeTimers();
        const deviceId = freshDeviceId();

        try {
            updateProofMeters(deviceId, meterFrame(-12));

            const { result } = renderHook(() => useProofLoudnessHistory(deviceId));
            act(() => {
                vi.advanceTimersByTime(PROOF_LOUDNESS_SAMPLE_INTERVAL_MS * 10);
            });

            // The hook is a reader. Sampling from here is what made the time axis
            // a record of when the graph happened to be on screen.
            expect(result.current).toEqual([]);
            expect(readProofLoudnessHistory(deviceId)).toEqual([]);
        } finally {
            clearProofLoudnessHistory(deviceId);
        }
    });

    it('republishes the window the device clock is filling while the graph is mounted', () => {
        vi.useFakeTimers();
        const deviceId = freshDeviceId();

        try {
            updateProofMeters(deviceId, meterFrame(-12));
            registerSamplingDevice(deviceId);

            const { result } = renderHook(() => useProofLoudnessHistory(deviceId));
            expect(result.current).toEqual([]);

            act(() => {
                vi.advanceTimersByTime(PROOF_LOUDNESS_SAMPLE_INTERVAL_MS);
            });
            expect(result.current).toEqual([-12]);

            updateProofMeters(deviceId, meterFrame(-6));
            act(() => {
                vi.advanceTimersByTime(PROOF_LOUDNESS_SAMPLE_INTERVAL_MS);
            });
            expect(result.current).toEqual([-12, -6]);
        } finally {
            unregisterProofDevice(deviceId);
        }
    });

    it('accrues the elapsed window while the graph is unmounted, so the returning graph has no seam', () => {
        vi.useFakeTimers();
        const deviceId = freshDeviceId();

        try {
            updateProofMeters(deviceId, meterFrame(-12));
            registerSamplingDevice(deviceId);
            act(() => {
                vi.advanceTimersByTime(PROOF_LOUDNESS_SAMPLE_INTERVAL_MS * 3);
            });

            const first = renderHook(() => useProofLoudnessHistory(deviceId));
            expect(first.result.current).toEqual([-12, -12, -12]);
            first.unmount();

            // Five seconds off the graph levels — a trip to the Build desk, or a
            // closed panel. The transport is still running and the loudness has
            // moved; the device keeps sampling because the device is what owns
            // the clock.
            updateProofMeters(deviceId, meterFrame(-30));
            act(() => {
                vi.advanceTimersByTime(5000);
            });

            const second = renderHook(() => useProofLoudnessHistory(deviceId));
            const samples = second.result.current;
            const elapsedSamples = 5000 / PROOF_LOUDNESS_SAMPLE_INTERVAL_MS;

            // The window carries the excursion at full pitch. Dropping those 50
            // slots put the sample before the switch and the sample after it in
            // neighbouring pixels of a graph read as a continuous 30 seconds, so
            // two readings five seconds apart looked adjacent in time.
            expect(samples).toHaveLength(3 + elapsedSamples);
            expect(samples.slice(0, 3)).toEqual([-12, -12, -12]);
            expect(samples.slice(3)).toEqual(Array.from({ length: elapsedSamples }, () => -30));
            second.unmount();
        } finally {
            unregisterProofDevice(deviceId);
        }
    });

    it('publishes the incoming device history on the render that swaps the device, not a tick later', () => {
        vi.useFakeTimers();
        const first = freshDeviceId();
        const second = freshDeviceId();

        try {
            // Two distinct windows to switch between: three samples at -12 for the
            // first device, one at -30 for the second.
            updateProofMeters(first, meterFrame(-12));
            updateProofMeters(second, meterFrame(-30));
            registerSamplingDevice(first);
            act(() => {
                vi.advanceTimersByTime(PROOF_LOUDNESS_SAMPLE_INTERVAL_MS * 3);
            });
            // Freeze the first window so the swap has two windows of different
            // lengths to tell apart.
            stopProofLoudnessSampler(first);
            registerSamplingDevice(second);
            act(() => {
                vi.advanceTimersByTime(PROOF_LOUDNESS_SAMPLE_INTERVAL_MS);
            });

            const { result, rerender } = renderHook(
                ({ deviceId }: { deviceId: string }) => useProofLoudnessHistory(deviceId),
                { initialProps: { deviceId: first } }
            );
            expect(result.current).toEqual([-12, -12, -12]);

            // The panel swaps the device in place rather than remounting, and the
            // graph draws the returned samples under the new device's target and
            // integrated lines. Waiting for the next tick puts one device's
            // loudness under another device's reference for a full interval.
            rerender({ deviceId: second });

            expect(result.current).toEqual([-30]);
        } finally {
            unregisterProofDevice(first);
            unregisterProofDevice(second);
        }
    });

    it('keeps two devices on separate windows', () => {
        vi.useFakeTimers();
        const first = freshDeviceId();
        const second = freshDeviceId();

        try {
            updateProofMeters(first, meterFrame(-12));
            updateProofMeters(second, meterFrame(-20));
            registerSamplingDevice(first);
            act(() => {
                vi.advanceTimersByTime(PROOF_LOUDNESS_SAMPLE_INTERVAL_MS * 2);
            });
            registerSamplingDevice(second);

            const a = renderHook(() => useProofLoudnessHistory(first));
            const b = renderHook(() => useProofLoudnessHistory(second));
            act(() => {
                vi.advanceTimersByTime(PROOF_LOUDNESS_SAMPLE_INTERVAL_MS);
            });

            expect(a.result.current).toEqual([-12, -12, -12]);
            expect(b.result.current).toEqual([-20]);
        } finally {
            unregisterProofDevice(first);
            unregisterProofDevice(second);
        }
    });
});
