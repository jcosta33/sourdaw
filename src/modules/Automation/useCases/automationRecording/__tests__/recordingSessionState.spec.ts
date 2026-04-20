import { describe, it, expect, beforeEach, vi } from 'vitest';

import { createAutomationLane } from '../../../models/Automation';
import { automationStore } from '../../../stores/automationStore';
import {
    makeKey,
    findLaneId,
    clearPointsInRange,
    flushPendingPoints,
    activeRecording,
    pendingPoints,
    RECORDING_MODES,
} from '../recordingSessionState';

const batchAddMock = vi.hoisted(() => vi.fn());

vi.mock('../../automation/batchAddAutomationPoints', () => ({
    batchAddAutomationPoints: batchAddMock,
}));

describe('recordingSessionState', () => {
    beforeEach(() => {
        batchAddMock.mockClear();
        activeRecording.clear();
        pendingPoints.clear();
        automationStore.set({ lanes: [] });
    });

    describe('makeKey', () => {
        it('should join track and parameter with double colon', () => {
            expect(makeKey('t1', 'gain')).toBe('t1::gain');
        });
    });

    describe('RECORDING_MODES', () => {
        it('should include write, touch, and latch', () => {
            expect(RECORDING_MODES.has('write')).toBe(true);
            expect(RECORDING_MODES.has('touch')).toBe(true);
            expect(RECORDING_MODES.has('latch')).toBe(true);
            expect(RECORDING_MODES.has('read')).toBe(false);
        });
    });

    describe('findLaneId', () => {
        it('should return null when automation store is not initialized', () => {
            automationStore.set(null);
            expect(findLaneId('t1', 'gain')).toBeNull();
        });

        it('should return lane id when track and parameter match', () => {
            const lane = createAutomationLane('t1', 'gain', 'Gain');
            automationStore.set({ lanes: [lane] });
            expect(findLaneId('t1', 'gain')).toBe(lane.id);
        });

        it('should return null when no lane matches', () => {
            automationStore.set({ lanes: [createAutomationLane('t1', 'gain', 'Gain')] });
            expect(findLaneId('t2', 'gain')).toBeNull();
        });
    });

    describe('clearPointsInRange', () => {
        it('should do nothing when store is null', () => {
            automationStore.set(null);
            clearPointsInRange('lane-1', 0, 4);
            expect(automationStore.value).toBeNull();
        });

        it('should remove points whose beat falls inside [fromBeat, toBeat]', () => {
            const lane = createAutomationLane('t1', 'gain', 'Gain');
            lane.points = [
                { beat: 0, value: 0, curve: 'linear', tension: 0 },
                { beat: 2, value: 0.5, curve: 'linear', tension: 0 },
                { beat: 8, value: 1, curve: 'linear', tension: 0 },
            ];
            automationStore.set({ lanes: [lane] });
            clearPointsInRange(lane.id, 1, 4);
            const updated = automationStore.value?.lanes[0];
            expect(updated?.points.map((p) => p.beat)).toEqual([0, 8]);
        });
    });

    describe('flushPendingPoints', () => {
        it('should not call batchAdd when pending list is empty', () => {
            const key = makeKey('t1', 'gain');
            activeRecording.set(key, {
                trackId: 't1',
                parameterId: 'gain',
                startBeat: 0,
                lastValue: null,
            });
            flushPendingPoints(key);
            expect(batchAddMock).not.toHaveBeenCalled();
        });

        it('should flush pending points through batchAdd when lane exists', () => {
            const lane = createAutomationLane('t1', 'gain', 'Gain');
            automationStore.set({ lanes: [lane] });
            const key = makeKey('t1', 'gain');
            const point = { beat: 1, value: 0.5, curve: 'linear' as const, tension: 0 };
            pendingPoints.set(key, [point]);
            activeRecording.set(key, {
                trackId: 't1',
                parameterId: 'gain',
                startBeat: 0,
                lastValue: null,
            });
            flushPendingPoints(key);
            expect(batchAddMock).toHaveBeenCalledWith(lane.id, [point]);
            expect(pendingPoints.get(key)).toEqual([]);
        });
    });
});
