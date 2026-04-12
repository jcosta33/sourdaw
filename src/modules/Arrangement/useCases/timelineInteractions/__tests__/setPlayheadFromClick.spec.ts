import { describe, it, expect, vi, beforeEach } from 'vitest';
import { defaultTransportState } from '#/modules/Transport/models/TransportState';
import { setPlayheadFromClick } from '../setPlayheadFromClick';

const mockGetTransportState = vi.fn();
const mockUpdateTransportState = vi.fn();
vi.mock('#/modules/Transport/useCases', () => ({
    getTransportState: () => mockGetTransportState(),
    updateTransportState: (...args: any[]) => mockUpdateTransportState(...args)
}));

let mockTimelineViewValue: any = null;
vi.mock('../../../stores/timelineViewStore', () => ({
    timelineViewStore: { get value() { return mockTimelineViewValue; } }
}));

describe('setPlayheadFromClick', () => {
    beforeEach(() => {
        mockGetTransportState.mockReset();
        mockUpdateTransportState.mockReset();
        mockTimelineViewValue = null;
    });

    it('does not update transport when transport snapshot is null', () => {
        mockTimelineViewValue = { pixelsPerBeat: 12, scrollX: 0, scrollY: 0 };
        mockGetTransportState.mockReturnValue(null);

        setPlayheadFromClick(100);

        expect(mockUpdateTransportState).not.toHaveBeenCalled();
    });

    it('maps canvas x to playhead beats using timeline view state', () => {
        mockTimelineViewValue = { pixelsPerBeat: 12, scrollX: 0, scrollY: 0 };
        mockGetTransportState.mockReturnValue(defaultTransportState);

        setPlayheadFromClick(24);

        expect(mockUpdateTransportState).toHaveBeenCalledWith({ playheadPosition: 2 });
    });
});
