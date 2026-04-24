import { describe, it, expect, vi, beforeEach } from 'vitest';

import { defaultTransportState } from '#/modules/Transport/models/TransportState';

import { setPlayheadFromClick } from '../setPlayheadFromClick';

const mocks = vi.hoisted(() => ({
    transportStoreValue: null as unknown,
    transportStoreSet: vi.fn(),
    timelineViewValue: null as unknown,
}));

vi.mock('#/modules/Transport/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Transport/stores')>()),
    transportStore: {
        get value() {
            return mocks.transportStoreValue;
        },
        set: mocks.transportStoreSet,
    },
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
        mocks.transportStoreValue = null;
        mocks.transportStoreSet.mockReset();
        mocks.timelineViewValue = null;
    });

    it('does not update transport when transport snapshot is null', () => {
        mocks.timelineViewValue = { pixelsPerBeat: 12, scrollX: 0, scrollY: 0 };
        mocks.transportStoreValue = null;

        setPlayheadFromClick(100);

        expect(mocks.transportStoreSet).not.toHaveBeenCalled();
    });

    it('maps canvas x to playhead beats using timeline view state', () => {
        mocks.timelineViewValue = { pixelsPerBeat: 12, scrollX: 0, scrollY: 0 };
        mocks.transportStoreValue = defaultTransportState;

        setPlayheadFromClick(24);

        expect(mocks.transportStoreSet).toHaveBeenCalledWith(
            expect.objectContaining({ playheadPosition: 2 })
        );
    });
});
