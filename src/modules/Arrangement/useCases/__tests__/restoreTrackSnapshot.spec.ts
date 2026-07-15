import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { normalizeTrack } from '../../models/Track';
import { trackStore } from '../../stores/trackStore';
import { restoreTrackSnapshot } from '../restoreTrackSnapshot';

function reset_track_store(): void {
    trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
}

describe('restoreTrackSnapshot', () => {
    beforeEach(() => {
        reset_track_store();
    });

    afterEach(() => {
        reset_track_store();
    });

    it('normalizes valid tracks, drops malformed rows, and clears a selection for a dropped track', () => {
        restoreTrackSnapshot({
            tracks: [
                'not-a-track',
                { id: 'dropped-track', name: 'Dropped Track', kind: 'not-a-kind' },
                {
                    id: 'valid-track',
                    name: 'Valid Track',
                    kind: 'audio',
                    clips: 'not-an-array',
                    gain: 'not-a-number',
                },
            ],
            selectedTrackId: 'dropped-track',
            ghostClips: [{ id: 'snapshot-ghost' }],
        });

        expect(trackStore.value).toEqual({
            tracks: [normalizeTrack({ id: 'valid-track', name: 'Valid Track', kind: 'audio' })],
            selectedTrackId: null,
        });
    });

    it('keeps a selected track only when it survives normalization', () => {
        restoreTrackSnapshot({
            tracks: [{ id: 'selected-track', name: 'Selected Track', kind: 'midi' }],
            selectedTrackId: 'selected-track',
        });

        expect(trackStore.value).toEqual({
            tracks: [normalizeTrack({ id: 'selected-track', name: 'Selected Track', kind: 'midi' })],
            selectedTrackId: 'selected-track',
        });
    });
});
