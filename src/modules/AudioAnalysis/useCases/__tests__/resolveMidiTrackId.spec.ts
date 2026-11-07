import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getAllTracks: vi.fn() }));
vi.mock('#/modules/Arrangement/useCases', () => ({ getAllTracks: mocks.getAllTracks }));
import { resolveMidiTrackId } from '../resolveMidiTrackId';

describe('resolveMidiTrackId destination plan', () => {
    beforeEach(() => vi.clearAllMocks());

    it('reuses an existing MIDI target without creating an action', () => {
        mocks.getAllTracks.mockReturnValue([{ id: 'midi', kind: 'midi' }]);
        expect(resolveMidiTrackId('midi', 'Unused')).toEqual({ trackId: 'midi', actions: [] });
    });

    it.each(['audio', 'missing'])('plans a prepared MIDI identity for %s without mutating the source', (target) => {
        const tracks = [{ id: 'audio', kind: 'audio' }];
        mocks.getAllTracks.mockReturnValue(tracks);
        const result = resolveMidiTrackId(target, 'Converted MIDI');
        expect(result.trackId).toEqual(expect.any(String));
        expect(result.actions).toEqual([
            { type: 'addTrack', payload: { id: result.trackId, name: 'Converted MIDI', kind: 'midi' } },
        ]);
        expect(tracks).toEqual([{ id: 'audio', kind: 'audio' }]);
        expect(mocks.getAllTracks).toHaveBeenCalledTimes(1);
    });
});
