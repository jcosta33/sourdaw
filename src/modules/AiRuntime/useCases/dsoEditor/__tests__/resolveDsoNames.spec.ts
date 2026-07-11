import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type Dso } from '../../../models/DsoTypes';
import { resolveDsoNames } from '../resolveDsoNames';

const mocks = vi.hoisted(() => ({
    trackStoreValue: { value: null } as { value: unknown },
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: {
        get value() {
            return mocks.trackStoreValue.value;
        },
    },
}));

function trackState(tracks: Array<{ id: string; name: string }>, selectedTrackId: string | null = null) {
    return {
        tracks: tracks.map((t) => ({
            id: t.id,
            name: t.name,
            kind: 'audio',
            clips: [],
            devices: [],
        })),
        selectedTrackId,
    };
}

describe('resolveDsoNames', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.trackStoreValue.value = null;
    });

    // Fix 4: a remove_track referencing a nonexistent track must NOT silently
    // create that track — it returns a resolution error and adds no add_track.
    it('returns a resolution error for a remove_track miss without auto-creating', () => {
        mocks.trackStoreValue.value = trackState([{ id: 'track-1', name: 'Drums' }]);

        const dsos: Dso[] = [{ op: 'remove_track', track_id: 'Ghost Track' }];
        const errors = resolveDsoNames(dsos);

        expect(errors).toHaveLength(1);
        expect(errors[0]!.reason).toMatch(/Could not find track "Ghost Track"/);
        // No add_track was prepended.
        expect(dsos.map((d) => d.op)).toEqual(['remove_track']);
    });

    it('still auto-creates a track for an additive op (add_clip) miss', () => {
        mocks.trackStoreValue.value = trackState([{ id: 'track-1', name: 'Drums' }]);

        const dsos: Dso[] = [
            { op: 'add_clip', track_id: 'New Bass', name: 'Bass', type: 'audio', start_beats: 0, end_beats: 4 },
        ];
        const errors = resolveDsoNames(dsos);

        expect(errors).toEqual([]);
        // An add_track DSO was prepended for the additive op's missing target.
        expect(dsos.map((d) => d.op)).toEqual(['add_track', 'add_clip']);
    });

    it('does not auto-create for mute_track / solo_track / color_track misses', () => {
        mocks.trackStoreValue.value = trackState([{ id: 'track-1', name: 'Drums' }]);

        const dsos: Dso[] = [
            { op: 'mute_track', track_id: 'Nope', muted: true },
            { op: 'solo_track', track_id: 'Nope', soloed: true },
            { op: 'color_track', track_id: 'Nope', color: '#fff' },
        ];
        const errors = resolveDsoNames(dsos);

        expect(errors).toHaveLength(3);
        expect(dsos.every((d) => d.op !== 'add_track')).toBe(true);
    });
});
