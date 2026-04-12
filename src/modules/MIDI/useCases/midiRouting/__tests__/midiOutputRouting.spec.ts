import { describe, it, expect, vi, beforeEach } from 'vitest';

const { updateTrack } = vi.hoisted(() => ({
    updateTrack: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    updateTrack,
}));

import { clearMidiOutput } from '../clearMidiOutput';
import { setMidiOutput } from '../setMidiOutput';

describe('midi output routing', () => {
    beforeEach(() => {
        updateTrack.mockClear();
    });

    it('should set midiOutputTrackId via updateTrack', () => {
        setMidiOutput('source', 'dest');
        expect(updateTrack).toHaveBeenCalledWith('source', expect.any(Function));
        const patch = updateTrack.mock.calls[0][1] as (t: { midiOutputTrackId: string | null }) => {
            midiOutputTrackId: string | null;
        };
        expect(patch({ midiOutputTrackId: null }).midiOutputTrackId).toBe('dest');
    });

    it('should clear midiOutputTrackId via updateTrack', () => {
        clearMidiOutput('t1');
        expect(updateTrack).toHaveBeenCalledWith('t1', expect.any(Function));
        const patch = updateTrack.mock.calls[0][1] as (t: { midiOutputTrackId: string | null }) => {
            midiOutputTrackId: string | null;
        };
        expect(patch({ midiOutputTrackId: 'x' }).midiOutputTrackId).toBeNull();
    });
});
