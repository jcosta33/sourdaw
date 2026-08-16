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

    it('publishes the incoming device history on the render that swaps the device, not a tick later', () => {
        vi.useFakeTimers();
        const first = freshDeviceId();
        const second = freshDeviceId();

        try {
            // Two distinct windows to switch between: three samples at -12 for the
            // first device, one at -30 for the second.
            const seedFirst = renderHook(() => useProofLoudnessHistory(first, -12));
            act(() => {
                vi.advanceTimersByTime(PROOF_LOUDNESS_SAMPLE_INTERVAL_MS * 3);
            });
            seedFirst.unmount();
            const seedSecond = renderHook(() => useProofLoudnessHistory(second, -30));
            act(() => {
                vi.advanceTimersByTime(PROOF_LOUDNESS_SAMPLE_INTERVAL_MS);
            });
            seedSecond.unmount();

            const { result, rerender } = renderHook(
                ({ deviceId }: { deviceId: string }) => useProofLoudnessHistory(deviceId, -12),
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
            clearProofLoudnessHistory(first);
            clearProofLoudnessHistory(second);
        }
    });

    it('shows the retained window on the first render after a remount, with no timer advance', () => {
        vi.useFakeTimers();
        const deviceId = freshDeviceId();

        try {
            const first = renderHook(() => useProofLoudnessHistory(deviceId, -12));
            act(() => {
                vi.advanceTimersByTime(PROOF_LOUDNESS_SAMPLE_INTERVAL_MS * 3);
            });
            first.unmount();

            // A desk-level switch (Build <-> Lab) remounts the graph. Starting at
            // no samples blanks the 30-second window for a full interval, which is
            // the exact outcome the module-level buffer exists to prevent.
            const second = renderHook(() => useProofLoudnessHistory(deviceId, -12));

            expect(second.result.current).toEqual([-12, -12, -12]);
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
