import { describe, it, expect, vi, beforeEach } from 'vitest';
import { glueClips } from '../glueClips';
import type { getTrackState as originalGetTrackState } from '../../../repositories/track/getTrackState';
import type { updateTrack as originalUpdateTrack } from '../../../repositories/track/updateTrack';

const mocks = vi.hoisted(() => ({
    getTrackState: vi.fn<typeof originalGetTrackState>(),
    updateTrack: vi.fn<typeof originalUpdateTrack>(),
    getNextClipId: vi.fn(() => 'merged-clip'),
}));

vi.mock('../../../repositories/track/getTrackState', () => ({ getTrackState: mocks.getTrackState }));
vi.mock('../../../repositories/track/updateTrack', () => ({ updateTrack: mocks.updateTrack }));
vi.mock('../../../repositories/clipIdCounter', () => ({ getNextClipId: mocks.getNextClipId }));
vi.mock('#/infra/logger/appLogger', () => ({ logger: { warn: vi.fn(), log: vi.fn(), error: vi.fn() } }));
vi.mock('#/modules/MIDI/stores', () => ({ midiStore: { value: null, set: vi.fn() } }));

describe('glueClips', () => {
    beforeEach(() => vi.clearAllMocks());

    it('does nothing with no state', () => {
        mocks.getTrackState.mockReturnValue(null);
        glueClips(['a', 'b']);
        expect(mocks.updateTrack).not.toHaveBeenCalled();
    });

    it('does nothing with less than 2 clips', () => {
        mocks.getTrackState.mockReturnValue({ tracks: [], selectedTrackId: null } as never);
        glueClips(['a']);
        expect(mocks.updateTrack).not.toHaveBeenCalled();
    });

    it('does nothing with empty clip list', () => {
        mocks.getTrackState.mockReturnValue({ tracks: [], selectedTrackId: null } as never);
        glueClips([]);
        expect(mocks.updateTrack).not.toHaveBeenCalled();
    });

    it('rejects clips spanning multiple tracks', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [
                { id: 't1', clips: [{ id: 'a', startBeat: 0, endBeat: 4 }] },
                { id: 't2', clips: [{ id: 'b', startBeat: 0, endBeat: 4 }] },
            ],
            selectedTrackId: 't1',
        } as never);
        glueClips(['a', 'b']);
        expect(mocks.updateTrack).not.toHaveBeenCalled();
    });

    it('merges clips within a single track', () => {
        const track = {
            id: 't1',
            name: 'Track 1',
            clips: [
                { id: 'a', startBeat: 0, endBeat: 4, name: 'Clip A', color: 'cyan' },
                { id: 'b', startBeat: 4, endBeat: 8, name: 'Clip B', color: 'cyan' },
            ],
        };
        mocks.getTrackState.mockReturnValue({ tracks: [track], selectedTrackId: 't1' } as never);
        glueClips(['a', 'b']);
        expect(mocks.updateTrack).toHaveBeenCalledTimes(1);
        const [track_id, updater] = mocks.updateTrack.mock.calls[0]!;
        expect(track_id).toBe('t1');
    });
});
