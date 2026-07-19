import { afterEach, describe, expect, it } from 'vitest';

import { createTrack } from '../../../models/Track';
import { trackStore } from '../../../stores/trackStore';
import { migrateLegacyFrozenTrackStates } from '../migrateLegacyFrozenTrackStates';

describe('migrateLegacyFrozenTrackStates', () => {
    afterEach(() => {
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
    });

    it('marks legacy frozen inputs stale while preserving versioned frozen inputs', () => {
        const legacy = createTrack({ id: 'legacy', name: 'Legacy', kind: 'audio' });
        legacy.frozen = true;
        legacy.freezeState = { status: 'frozen', sourceContentHash: 'legacy-hash' };
        const current = createTrack({ id: 'current', name: 'Current', kind: 'audio' });
        current.frozen = true;
        current.freezeState = { status: 'frozen', sourceContentHash: 'freeze-v2:current-hash' };
        trackStore.set({ tracks: [legacy, current], selectedTrackId: null, ghostClips: [] });

        migrateLegacyFrozenTrackStates();

        expect(trackStore.value?.tracks.map((track) => track.freezeState.status)).toEqual(['stale', 'frozen']);
        expect(trackStore.value?.tracks[0]?.freezeState.sourceContentHash).toBe('legacy-hash');
    });
});
