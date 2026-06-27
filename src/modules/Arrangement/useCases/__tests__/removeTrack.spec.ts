import { describe, it, expect, vi, beforeEach } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { getTrackById } from '../../repositories/track/getTrackById';
import { getTrackState } from '../../repositories/track/getTrackState';
import { setTrackState } from '../../repositories/track/setTrackState';
import { removeTrack } from '../removeTrack';

vi.mock('../../repositories/track/getTrackState', () => ({
    getTrackState: vi.fn(),
}));
vi.mock('../../repositories/track/getTrackById', () => ({
    getTrackById: vi.fn(),
}));
vi.mock('../../repositories/track/setTrackState', () => ({
    setTrackState: vi.fn(),
}));
vi.mock('#/modules/Automation/stores/automationStore', () => ({
    automationStore: {
        value: { lanes: [] },
        set: vi.fn(),
    },
}));
vi.mock('#/modules/MIDI/stores/midiStore', () => ({
    midiStore: {
        value: {
            notesByClipId: {},
            ccByClipId: {},
            pitchBendByClipId: {},
        },
        set: vi.fn(),
    },
}));
vi.mock('../../stores/takeLaneStore', () => ({
    takeLaneStore: {
        value: { lanes: [] },
        set: vi.fn(),
    },
}));

const mockEventBus = {
    emit: vi.fn(),
};

describe('removeTrack', () => {
    beforeEach(() => {
        injectDependencies(removeTrack, { eventBus: mockEventBus });
        vi.mocked(getTrackState).mockReset();
        vi.mocked(getTrackById).mockReset();
        vi.mocked(setTrackState).mockReset();
        mockEventBus.emit.mockReset();
    });

    it('should return early when track state is missing', () => {
        vi.mocked(getTrackState).mockReturnValue(null);

        removeTrack('t1');

        expect(mockEventBus.emit).not.toHaveBeenCalled();
    });

    it('should return early when track id is unknown', () => {
        vi.mocked(getTrackState).mockReturnValue({ tracks: [], selectedTrackId: null } as unknown as ReturnType<
            typeof getTrackState
        >);
        vi.mocked(getTrackById).mockReturnValue(undefined);

        removeTrack('missing');

        expect(setTrackState).not.toHaveBeenCalled();
        expect(mockEventBus.emit).not.toHaveBeenCalled();
    });

    it('should remove track, clean related state, and emit track.removed', () => {
        const track = {
            id: 't1',
            name: 'One',
            kind: 'audio' as const,
            clips: [{ id: 'c1' }],
        };
        vi.mocked(getTrackState).mockReturnValue({
            tracks: [track as never],
            selectedTrackId: 't1',
        } as unknown as ReturnType<typeof getTrackState>);
        vi.mocked(getTrackById).mockReturnValue(track as never);

        removeTrack('t1');

        expect(setTrackState).toHaveBeenCalled();
        expect(mockEventBus.emit).toHaveBeenCalledWith('track.removed', { trackId: 't1' });
    });
});
