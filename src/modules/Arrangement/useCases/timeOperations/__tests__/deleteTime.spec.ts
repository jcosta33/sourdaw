import { describe, it, expect, vi, beforeEach } from 'vitest';

import { deleteTime } from '../deleteTime';

const mocks = vi.hoisted(() => ({
    getTrackState: vi.fn(),
    setTrackState: vi.fn(),
}));

vi.mock('../../../repositories/track/getTrackState', () => ({ getTrackState: mocks.getTrackState }));
vi.mock('../../../repositories/track/setTrackState', () => ({ setTrackState: mocks.setTrackState }));
vi.mock('../../../stores/markerStore', () => ({ markerStore: { value: { markers: [] }, set: vi.fn() } }));
vi.mock('#/modules/Automation/stores', () => ({ automationStore: { value: { lanes: [] }, set: vi.fn() } }));
vi.mock('#/modules/Transport/stores', () => ({
    tempoMapStore: { value: { changes: [] }, set: vi.fn() },
    timeSignatureMapStore: { value: { changes: [] }, set: vi.fn() },
}));

describe('deleteTime', () => {
    beforeEach(() => vi.clearAllMocks());

    it('does nothing with no state', () => {
        mocks.getTrackState.mockReturnValue(null);
        expect(() => deleteTime(0, 4)).not.toThrow();
        expect(mocks.setTrackState).not.toHaveBeenCalled();
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
        expect(() => deleteTime(2, 6)).not.toThrow();
    });

    it('handles zero-length deletion', () => {
        mocks.getTrackState.mockReturnValue({ tracks: [], selectedTrackId: null } as never);
        expect(() => deleteTime(4, 4)).not.toThrow();
    });
});
