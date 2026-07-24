import { describe, it, expect, beforeEach, vi } from 'vitest';

import { type AutomationPoint, createAutomationLane } from '../../../models/Automation';
import { automationStore } from '../../../stores/automationStore';
import { flushPendingPoints } from '../flushPendingPoints';
import { activeRecording, pendingPoints } from '../recordingSessionState';

const batchAddMock = vi.hoisted(() => vi.fn());

vi.mock('../../automation/batchAddAutomationPoints', () => ({
    batchAddAutomationPoints: batchAddMock,
}));

// The record-flush thinning tolerance. Kept in sync with the value asserted in
// the fix; a raw gesture whose interior deviates less than this collapses onto
// its endpoints.
const TOLERANCE = 0.01;

/** Linear value on the polyline defined by `points` at an arbitrary beat. */
function reconstruct(points: AutomationPoint[], beat: number): number {
    const first = points[0]!;
    const last = points[points.length - 1]!;
    if (beat <= first.beat) {
        return first.value;
    }
    if (beat >= last.beat) {
        return last.value;
    }
    for (let index = 0; index < points.length - 1; index += 1) {
        const a = points[index]!;
        const b = points[index + 1]!;
        if (beat >= a.beat && beat <= b.beat) {
            const t = (beat - a.beat) / (b.beat - a.beat);
            return a.value + (b.value - a.value) * t;
        }
    }
    return last.value;
}

describe('flushPendingPoints record-gesture thinning (AU-5)', () => {
    beforeEach(() => {
        batchAddMock.mockClear();
        activeRecording.clear();
        pendingPoints.clear();
        automationStore.set({ lanes: [] });
    });

    it('decimates a dense near-collinear ramp to its endpoints while preserving them exactly and bounding deviation', () => {
        const lane = createAutomationLane('t1', 'gain', 'Gain');
        automationStore.set({ lanes: [lane] });

        // 21 raw points along a ramp with sub-tolerance jitter — the full-rate
        // stream a fader ride dumps into the recording buffer today.
        const raw: AutomationPoint[] = [];
        for (let index = 0; index <= 20; index += 1) {
            const jitter = index % 2 === 0 ? 0.001 : -0.001;
            raw.push({ beat: index * 0.1, value: index * 0.05 + jitter, curve: 'linear', tension: 0 });
        }
        pendingPoints.set('t1::gain', [...raw]);
        activeRecording.set('t1::gain', { trackId: 't1', parameterId: 'gain', startBeat: 0, lastValue: 1 });

        flushPendingPoints('t1::gain');

        expect(batchAddMock).toHaveBeenCalledTimes(1);
        const flushed = batchAddMock.mock.calls[0]![1] as AutomationPoint[];

        // Count is decimated well below the raw stream.
        expect(flushed.length).toBeLessThan(raw.length);
        expect(flushed.length).toBeLessThanOrEqual(3);

        // Endpoints are preserved exactly (object shape, value, curve, tension).
        expect(flushed[0]).toEqual(raw[0]);
        expect(flushed[flushed.length - 1]).toEqual(raw[raw.length - 1]);

        // Every raw point stays within tolerance of the thinned polyline.
        let maxDeviation = 0;
        for (const point of raw) {
            maxDeviation = Math.max(maxDeviation, Math.abs(point.value - reconstruct(flushed, point.beat)));
        }
        expect(maxDeviation).toBeLessThan(TOLERANCE);
    });

    it('keeps a genuine peak that exceeds tolerance rather than flattening the gesture', () => {
        const lane = createAutomationLane('t1', 'gain', 'Gain');
        automationStore.set({ lanes: [lane] });

        // A ride that rises to a clear peak and falls — the middle point deviates
        // far more than the tolerance, so thinning must retain it.
        const raw: AutomationPoint[] = [
            { beat: 0, value: 0, curve: 'linear', tension: 0 },
            { beat: 1, value: 0.9, curve: 'linear', tension: 0 },
            { beat: 2, value: 0, curve: 'linear', tension: 0 },
        ];
        pendingPoints.set('t1::gain', [...raw]);
        activeRecording.set('t1::gain', { trackId: 't1', parameterId: 'gain', startBeat: 0, lastValue: 0 });

        flushPendingPoints('t1::gain');

        const flushed = batchAddMock.mock.calls[0]![1] as AutomationPoint[];
        expect(flushed).toEqual(raw);
    });
});
