import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';

import { clearProofLoudnessHistory, PROOF_LOUDNESS_SAMPLE_INTERVAL_MS } from '../../../stores/proofLoudnessHistory';
import { useProofLoudnessHistory } from '../useProofLoudnessHistory';

let nextDeviceId = 0;
const freshDeviceId = (): string => {
    nextDeviceId++;
    return `loudness-history-device-${nextDeviceId}`;
};

afterEach(() => {
    vi.useRealTimers();
});

describe('useProofLoudnessHistory', () => {
    it('records one sample per interval, not one per meter frame', () => {
        vi.useFakeTimers();
        const deviceId = freshDeviceId();

        try {
            const { result, rerender } = renderHook(
                ({ momentaryLufs }: { momentaryLufs: number }) => useProofLoudnessHistory(deviceId, momentaryLufs),
                { initialProps: { momentaryLufs: -12 } }
            );

            // Ten meter frames inside one interval. The engine pushes ~62 a
            // second; recording each one filled the 30-second window in five.
            for (let frame = 1; frame <= 10; frame++) {
                rerender({ momentaryLufs: -12 - frame });
            }
            expect(result.current).toHaveLength(0);

            act(() => {
                vi.advanceTimersByTime(PROOF_LOUDNESS_SAMPLE_INTERVAL_MS * 3);
            });

            // Three elapsed intervals, three samples — the count follows the
            // clock, and never the ten frames or the ten renders.
            expect(result.current).toHaveLength(3);
        } finally {
            clearProofLoudnessHistory(deviceId);
        }
    });

    it('records the latest reading at each tick', () => {
        vi.useFakeTimers();
        const deviceId = freshDeviceId();

        try {
            const { result, rerender } = renderHook(
                ({ momentaryLufs }: { momentaryLufs: number }) => useProofLoudnessHistory(deviceId, momentaryLufs),
                { initialProps: { momentaryLufs: -12 } }
            );

            act(() => {
                vi.advanceTimersByTime(PROOF_LOUDNESS_SAMPLE_INTERVAL_MS);
            });
            rerender({ momentaryLufs: -6 });
            act(() => {
                vi.advanceTimersByTime(PROOF_LOUDNESS_SAMPLE_INTERVAL_MS);
            });

            expect(result.current).toEqual([-12, -6]);
        } finally {
            clearProofLoudnessHistory(deviceId);
        }
    });

    it('keeps a device history across an unmount and drops it when the device goes', () => {
        vi.useFakeTimers();
        const deviceId = freshDeviceId();

        try {
            const first = renderHook(() => useProofLoudnessHistory(deviceId, -12));
            act(() => {
                vi.advanceTimersByTime(PROOF_LOUDNESS_SAMPLE_INTERVAL_MS * 3);
            });
            first.unmount();

            // Switching desk level unmounts the graph; the accumulated window is
            // the user's 30 seconds of context and must survive coming back.
            const second = renderHook(() => useProofLoudnessHistory(deviceId, -12));
            act(() => {
                vi.advanceTimersByTime(PROOF_LOUDNESS_SAMPLE_INTERVAL_MS);
            });
            expect(second.result.current).toHaveLength(4);
            second.unmount();

            // Losing the device is what ends the history.
            clearProofLoudnessHistory(deviceId);
            const third = renderHook(() => useProofLoudnessHistory(deviceId, -12));
            act(() => {
                vi.advanceTimersByTime(PROOF_LOUDNESS_SAMPLE_INTERVAL_MS * 2);
            });
            expect(third.result.current).toHaveLength(2);
        } finally {
            clearProofLoudnessHistory(deviceId);
        }
    });

    it('keeps two devices on separate histories', () => {
        vi.useFakeTimers();
        const first = freshDeviceId();
        const second = freshDeviceId();

        try {
            const a = renderHook(() => useProofLoudnessHistory(first, -12));
            act(() => {
                vi.advanceTimersByTime(PROOF_LOUDNESS_SAMPLE_INTERVAL_MS * 2);
            });
            const b = renderHook(() => useProofLoudnessHistory(second, -20));
            act(() => {
                vi.advanceTimersByTime(PROOF_LOUDNESS_SAMPLE_INTERVAL_MS);
            });

            expect(a.result.current).toEqual([-12, -12, -12]);
            expect(b.result.current).toEqual([-20]);
        } finally {
            clearProofLoudnessHistory(first);
            clearProofLoudnessHistory(second);
        }
    });

    it('stops sampling once the graph is gone', () => {
        vi.useFakeTimers();
        const deviceId = freshDeviceId();

        try {
            const { unmount } = renderHook(() => useProofLoudnessHistory(deviceId, -12));
            act(() => {
                vi.advanceTimersByTime(PROOF_LOUDNESS_SAMPLE_INTERVAL_MS * 2);
            });
            unmount();

            act(() => {
                vi.advanceTimersByTime(PROOF_LOUDNESS_SAMPLE_INTERVAL_MS * 50);
            });

            const reopened = renderHook(() => useProofLoudnessHistory(deviceId, -12));
            act(() => {
                vi.advanceTimersByTime(PROOF_LOUDNESS_SAMPLE_INTERVAL_MS);
            });
            expect(reopened.result.current).toHaveLength(3);
        } finally {
            clearProofLoudnessHistory(deviceId);
        }
    });
});
