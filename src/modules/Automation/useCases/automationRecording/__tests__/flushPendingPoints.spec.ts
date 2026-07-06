import { describe, it, expect, beforeEach, vi } from 'vitest';

import { createAutomationLane } from '../../../models/Automation';
import { automationStore } from '../../../stores/automationStore';
import { flushPendingPoints } from '../flushPendingPoints';
import { activeRecording, pendingPoints } from '../recordingSessionState';

const batchAddMock = vi.hoisted(() => vi.fn());

vi.mock('../../automation/batchAddAutomationPoints', () => ({
    batchAddAutomationPoints: batchAddMock,
}));

describe('flushPendingPoints', () => {
    beforeEach(() => {
        batchAddMock.mockClear();
        activeRecording.clear();
        pendingPoints.clear();
        automationStore.set({ lanes: [] });
    });

    it('should not call batchAdd when pending list is empty', () => {
        activeRecording.set('t1::gain', {
            trackId: 't1',
            parameterId: 'gain',
            startBeat: 0,
            lastValue: null,
        });

        flushPendingPoints('t1::gain');

        expect(batchAddMock).not.toHaveBeenCalled();
    });

    it('should not call batchAdd when the session is missing', () => {
        pendingPoints.set('t1::gain', [{ beat: 1, value: 0.5, curve: 'linear', tension: 0 }]);

        flushPendingPoints('t1::gain');

        expect(batchAddMock).not.toHaveBeenCalled();
        expect(pendingPoints.get('t1::gain')).toEqual([{ beat: 1, value: 0.5, curve: 'linear', tension: 0 }]);
    });

    it('should no-op when no lane exists for the session', () => {
        const point = { beat: 1, value: 0.5, curve: 'linear' as const, tension: 0 };
        pendingPoints.set('t1::gain', [point]);
        activeRecording.set('t1::gain', {
            trackId: 't1',
            parameterId: 'gain',
            startBeat: 0,
            lastValue: null,
        });

        flushPendingPoints('t1::gain');

        expect(batchAddMock).not.toHaveBeenCalled();
        expect(pendingPoints.get('t1::gain')).toEqual([point]);
    });

    it('should flush pending points through batchAdd and clear them when lane exists', () => {
        const lane = createAutomationLane('t1', 'gain', 'Gain');
        automationStore.set({ lanes: [lane] });
        const point = { beat: 1, value: 0.5, curve: 'linear' as const, tension: 0 };
        pendingPoints.set('t1::gain', [point]);
        activeRecording.set('t1::gain', {
            trackId: 't1',
            parameterId: 'gain',
            startBeat: 0,
            lastValue: null,
        });

        flushPendingPoints('t1::gain');

        expect(batchAddMock).toHaveBeenCalledWith(lane.id, [point]);
        expect(pendingPoints.get('t1::gain')).toEqual([]);
    });
});
