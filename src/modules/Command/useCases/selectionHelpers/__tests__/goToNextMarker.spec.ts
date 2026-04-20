import { describe, it, expect, vi, beforeEach } from 'vitest';

import { goToNextMarker } from '../goToNextMarker';

const mocks = vi.hoisted(() => ({
    getMarkerState: vi.fn(),
    getTransportStoreValue: vi.fn(),
    seekPlayhead: vi.fn(),
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

describe('goToNextMarker', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('does nothing when there are no markers', () => {
        mocks.getMarkerState.mockReturnValue(null);

        goToNextMarker();

        expect(mocks.seekPlayhead).not.toHaveBeenCalled();
    });

    it('does nothing when the marker list is empty', () => {
        mocks.getMarkerState.mockReturnValue({ markers: [], sections: [] });

        goToNextMarker();

        expect(mocks.seekPlayhead).not.toHaveBeenCalled();
    });

    it('seeks to the earliest marker strictly after the playhead', () => {
        mocks.getMarkerState.mockReturnValue({
            markers: [
                { id: 'a', beat: 12, name: 'B', color: 'x' },
                { id: 'b', beat: 4, name: 'A', color: 'x' },
                { id: 'c', beat: 8, name: 'C', color: 'x' },
            ],
            sections: [],
        });
        mocks.getTransportStoreValue.mockReturnValue({ playheadPosition: 6 } as any);

        goToNextMarker();

        expect(mocks.seekPlayhead).toHaveBeenCalledWith(8);
    });

    it('does not seek when every marker is at or before the playhead', () => {
        mocks.getMarkerState.mockReturnValue({
            markers: [
                { id: 'a', beat: 2, name: 'A', color: 'x' },
                { id: 'b', beat: 4, name: 'B', color: 'x' },
            ],
            sections: [],
        });
        mocks.getTransportStoreValue.mockReturnValue({ playheadPosition: 8 } as any);

        goToNextMarker();

        expect(mocks.seekPlayhead).not.toHaveBeenCalled();
    });

    it('treats a missing transport snapshot as playhead 0', () => {
        mocks.getMarkerState.mockReturnValue({
            markers: [{ id: 'a', beat: 4, name: 'A', color: 'x' }],
            sections: [],
        });
        mocks.getTransportStoreValue.mockReturnValue(undefined);

        goToNextMarker();

        expect(mocks.seekPlayhead).toHaveBeenCalledWith(4);
    });
});
