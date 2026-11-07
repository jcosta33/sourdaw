import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getAllTracks: vi.fn() }));
vi.mock('#/modules/Arrangement/useCases', () => ({ getAllTracks: mocks.getAllTracks }));
import { resolveMidiTrackId } from '../resolveMidiTrackId';

describe('resolveMidiTrackId plans without dispatch or post-dispatch store reads', () => {
    it('reuses an existing MIDI track', () => {
        mocks.getAllTracks.mockReturnValue([{ id: 'track-1', kind: 'midi' }]);
        expect(resolveMidiTrackId('track-1', 'Converted')).toEqual({ trackId: 'track-1', actions: [] });
    });
    it.each(['audio', 'missing'])('pins a new MIDI identity for a %s destination', (kind) => {
        mocks.getAllTracks.mockClear().mockReturnValue(kind === 'audio' ? [{ id: 'track-1', kind }] : []);
        const plan = resolveMidiTrackId('track-1', 'Converted');
        expect(plan.actions).toEqual([
            { type: 'addTrack', payload: { id: plan.trackId, name: 'Converted', kind: 'midi' } },
        ]);
        expect(mocks.getAllTracks).toHaveBeenCalledOnce();
    });
});
