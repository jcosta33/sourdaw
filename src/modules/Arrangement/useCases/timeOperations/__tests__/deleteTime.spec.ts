import { describe, it, expect, vi, beforeEach } from 'vitest';

import { deleteTime } from '../deleteTime';
import { setTimeOperationDependencies } from '../timeOperationDependencies';

const mocks = vi.hoisted(() => ({
    getTrackState: vi.fn(),
    setTrackState: vi.fn(),
    markerStoreSet: vi.fn(),
    deleteAutomationTimeRange: vi.fn(),
    deleteTimelineMapsTimeRange: vi.fn(),
}));

vi.mock('../../../repositories/track/getTrackState', () => ({ getTrackState: mocks.getTrackState }));
vi.mock('../../../repositories/track/setTrackState', () => ({ setTrackState: mocks.setTrackState }));
vi.mock('../../../stores/markerStore', () => ({
    markerStore: { value: { markers: [] }, set: mocks.markerStoreSet },
}));
vi.mock('#/modules/Automation/useCases', () => ({
    deleteAutomationTimeRange: mocks.deleteAutomationTimeRange,
}));
vi.mock('#/modules/Transport/useCases', () => ({
    deleteTimelineMapsTimeRange: mocks.deleteTimelineMapsTimeRange,
}));

describe('deleteTime', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setTimeOperationDependencies({
            shiftTimelineMapsAfterBeat: vi.fn(),
            deleteTimelineMapsTimeRange: mocks.deleteTimelineMapsTimeRange,
        });
    });

    it('does nothing with no state', () => {
        mocks.getTrackState.mockReturnValue(null);
        expect(() => deleteTime(0, 4)).not.toThrow();
        expect(mocks.setTrackState).not.toHaveBeenCalled();
        expect(mocks.deleteAutomationTimeRange).not.toHaveBeenCalled();
        expect(mocks.deleteTimelineMapsTimeRange).not.toHaveBeenCalled();
    });

    it('throws before writing when dependencies are not registered', () => {
        mocks.getTrackState.mockReturnValue({ tracks: [], selectedTrackId: null } as never);
        setTimeOperationDependencies(null);

        expect(() => deleteTime(0, 4)).toThrow('Arrangement time operation dependencies are not registered');
        expect(mocks.setTrackState).not.toHaveBeenCalled();
        expect(mocks.markerStoreSet).not.toHaveBeenCalled();
        expect(mocks.deleteAutomationTimeRange).not.toHaveBeenCalled();
        expect(mocks.deleteTimelineMapsTimeRange).not.toHaveBeenCalled();
    });

    it('processes time deletion with empty tracks', () => {
        mocks.getTrackState.mockReturnValue({ tracks: [], selectedTrackId: null } as never);
        expect(() => deleteTime(0, 4)).not.toThrow();
    });

    it('processes time deletion with tracks and clips', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    clips: [
                        { id: 'c1', startBeat: 0, endBeat: 4 },
                        { id: 'c2', startBeat: 4, endBeat: 8 },
                    ],
                },
            ],
            selectedTrackId: 't1',
        } as never);
        deleteTime(2, 6);

        expect(mocks.setTrackState).toHaveBeenCalledWith({
            tracks: [
                {
                    id: 't1',
                    clips: [
                        { id: 'c1', startBeat: 0, endBeat: 2 },
                        { id: 'c2', startBeat: 2, endBeat: 4 },
                    ],
                },
            ],
            selectedTrackId: 't1',
        });
        expect(mocks.deleteAutomationTimeRange).toHaveBeenCalledWith({ startBeat: 2, endBeat: 6 });
        expect(mocks.deleteTimelineMapsTimeRange).toHaveBeenCalledWith({ startBeat: 2, endBeat: 6 });
    });

    it('handles zero-length deletion', () => {
        mocks.getTrackState.mockReturnValue({ tracks: [], selectedTrackId: null } as never);
        deleteTime(4, 4);
        expect(mocks.deleteAutomationTimeRange).toHaveBeenCalledWith({ startBeat: 4, endBeat: 4 });
        expect(mocks.deleteTimelineMapsTimeRange).toHaveBeenCalledWith({ startBeat: 4, endBeat: 4 });
    });
});
