import { describe, it, expect, vi, beforeEach } from 'vitest';

import { goToNextMarker } from '../goToNextMarker';

import type { getMarkerState } from '#/modules/Arrangement/useCases';
import type { getTransportState, seekPlayhead } from '#/modules/Transport/useCases';

const mocks = vi.hoisted(() => ({
    getMarkerState: vi.fn<typeof getMarkerState>(),
    getTransportState: vi.fn<typeof getTransportState>(),
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
        getTransportState: mocks.getTransportState,
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
        mocks.getTransportState.mockReturnValue({ playheadPosition: 6 } as ReturnType<typeof getTransportState>);

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
        mocks.getTransportState.mockReturnValue({ playheadPosition: 8 } as ReturnType<typeof getTransportState>);

        goToNextMarker();

        expect(mocks.seekPlayhead).not.toHaveBeenCalled();
    });

    it('treats a missing transport snapshot as playhead 0', () => {
        mocks.getMarkerState.mockReturnValue({
            markers: [{ id: 'a', beat: 4, name: 'A', color: 'x' }],
            sections: [],
        });
        mocks.getTransportState.mockReturnValue(null);

        goToNextMarker();

        expect(mocks.seekPlayhead).toHaveBeenCalledWith(4);
    });
});
