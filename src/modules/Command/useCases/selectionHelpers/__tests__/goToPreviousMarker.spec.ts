import { describe, it, expect, vi, beforeEach } from 'vitest';

import { goToPreviousMarker } from '../goToPreviousMarker';

import type { getMarkerState } from '#/modules/Arrangement/useCases';
import type { getTransportStoreValue, seekPlayhead } from '#/modules/Transport/useCases';

const mocks = vi.hoisted(() => ({
    getMarkerState: vi.fn<typeof getMarkerState>(),
    getTransportStoreValue: vi.fn<typeof getTransportStoreValue>(),
    seekPlayhead: vi.fn<typeof seekPlayhead>(),
}));

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => {
    const mod = await importOriginal<typeof import('#/modules/Arrangement/useCases')>();
    return {
        ...mod,
        getMarkerState: mocks.getMarkerState,
    };
});

vi.mock('#/modules/Transport/useCases', async (importOriginal) => {
    const mod = await importOriginal<typeof import('#/modules/Transport/useCases')>();
    return {
        ...mod,
        getTransportStoreValue: mocks.getTransportStoreValue,
        seekPlayhead: mocks.seekPlayhead,
    };
});

describe('goToPreviousMarker', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('does nothing when there are no markers', () => {
        mocks.getMarkerState.mockReturnValue(null);

        goToPreviousMarker();

        expect(mocks.seekPlayhead).not.toHaveBeenCalled();
    });

    it('does nothing when the marker list is empty', () => {
        mocks.getMarkerState.mockReturnValue({ markers: [], sections: [] });

        goToPreviousMarker();

        expect(mocks.seekPlayhead).not.toHaveBeenCalled();
    });

    it('seeks to the latest marker strictly before the playhead', () => {
        mocks.getMarkerState.mockReturnValue({
            markers: [
                { id: 'a', beat: 4, name: 'A', color: 'x' },
                { id: 'b', beat: 12, name: 'B', color: 'x' },
                { id: 'c', beat: 8, name: 'C', color: 'x' },
            ],
            sections: [],
        });
        mocks.getTransportStoreValue.mockReturnValue({ playheadPosition: 10 } as ReturnType<
            typeof getTransportStoreValue
        >);

        goToPreviousMarker();

        expect(mocks.seekPlayhead).toHaveBeenCalledWith(8);
    });

    it('does not seek when every marker is at or after the playhead', () => {
        mocks.getMarkerState.mockReturnValue({
            markers: [
                { id: 'a', beat: 8, name: 'A', color: 'x' },
                { id: 'b', beat: 12, name: 'B', color: 'x' },
            ],
            sections: [],
        });
        mocks.getTransportStoreValue.mockReturnValue({ playheadPosition: 4 } as ReturnType<
            typeof getTransportStoreValue
        >);

        goToPreviousMarker();

        expect(mocks.seekPlayhead).not.toHaveBeenCalled();
    });

    it('treats a missing transport snapshot as playhead 0', () => {
        mocks.getMarkerState.mockReturnValue({
            markers: [{ id: 'a', beat: 4, name: 'A', color: 'x' }],
            sections: [],
        });
        mocks.getTransportStoreValue.mockReturnValue(undefined);

        goToPreviousMarker();

        expect(mocks.seekPlayhead).not.toHaveBeenCalled();
    });
});
