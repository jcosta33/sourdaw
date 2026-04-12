import { describe, it, expect, vi, beforeEach } from 'vitest';
import { removeTrack } from '../removeTrack';
import { getTrackState } from '../../repositories/track/getTrackState';
import { getTrackById } from '../../repositories/track/getTrackById';
import { setTrackState } from '../../repositories/track/setTrackState';
import { eventBus } from '#/app/registerDependencies';

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
vi.mock('#/app/registerDependencies', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/app/registerDependencies')>();
    return {
        ...actual,
        eventBus: {
            ...actual.eventBus,
            emit: vi.fn(),
        },
    };
});

describe('removeTrack', () => {
    beforeEach(() => {
        vi.mocked(getTrackState).mockReset();
        vi.mocked(getTrackById).mockReset();
        vi.mocked(setTrackState).mockReset();
        vi.mocked(eventBus.emit).mockReset();
    });

    it('should return early when track state is missing', () => {
        vi.mocked(getTrackState).mockReturnValue(null);

        removeTrack('t1');

        expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('should return early when track id is unknown', () => {
        vi.mocked(getTrackState).mockReturnValue({ tracks: [], selectedTrackId: null } as any);
        vi.mocked(getTrackById).mockReturnValue(undefined);

        removeTrack('missing');

        expect(setTrackState).not.toHaveBeenCalled();
        expect(eventBus.emit).not.toHaveBeenCalled();
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
        } as any);
        vi.mocked(getTrackById).mockReturnValue(track as never);

        removeTrack('t1');

        expect(setTrackState).toHaveBeenCalled();
        expect(eventBus.emit).toHaveBeenCalledWith('track.removed', { trackId: 't1' });
    });
});
