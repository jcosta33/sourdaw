import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { setPlayheadFromClick } from '../setPlayheadFromClick';

type TimelineViewStateMock = {
    pixelsPerBeat: number;
    scrollX: number;
    scrollY: number;
};

type SetPlayheadFromClickMocks = {
    seekPlayhead: Mock<(beat: number) => void>;
    timelineViewValue: TimelineViewStateMock | null;
};

const mocks = vi.hoisted<SetPlayheadFromClickMocks>(() => ({
    seekPlayhead: vi.fn(),
    timelineViewValue: null,
}));

vi.mock('#/modules/Transport/useCases', () => ({
    seekPlayhead: mocks.seekPlayhead,
}));

vi.mock('../../../stores/timelineViewStore', () => ({
    timelineViewStore: {
        get value() {
            return mocks.timelineViewValue;
        },
    },
}));

describe('setPlayheadFromClick', () => {
    beforeEach(() => {
        mocks.seekPlayhead.mockReset();
        mocks.timelineViewValue = null;
    });

    it('should not seek when timeline view state is missing', () => {
        setPlayheadFromClick(100);

        expect(mocks.seekPlayhead).not.toHaveBeenCalled();
    });

    it('should map canvas x to playhead beats using timeline view state', () => {
        mocks.timelineViewValue = { pixelsPerBeat: 12, scrollX: 6, scrollY: 0 };

        setPlayheadFromClick(18);

        expect(mocks.seekPlayhead).toHaveBeenCalledWith(2);
    });

    it('should clamp negative playhead beats to zero', () => {
        mocks.timelineViewValue = { pixelsPerBeat: 12, scrollX: 0, scrollY: 0 };

        setPlayheadFromClick(-24);

        expect(mocks.seekPlayhead).toHaveBeenCalledWith(0);
    });
});
