import { describe, expect, it } from 'vitest';

import { createTrack } from '../../../models/Track';
import { migrateLegacyFrozenTrackStates } from '../migrateLegacyFrozenTrackStates';

describe('migrateLegacyFrozenTrackStates', () => {
    it('marks legacy frozen inputs stale while preserving versioned frozen inputs', () => {
        const legacy = createTrack({ id: 'legacy', name: 'Legacy', kind: 'audio' });
        legacy.frozen = true;
        legacy.freezeState = { status: 'frozen', sourceContentHash: 'legacy-hash' };
        const current = createTrack({ id: 'current', name: 'Current', kind: 'audio' });
        current.frozen = true;
        current.freezeState = { status: 'frozen', sourceContentHash: 'freeze-v2:current-hash' };
        const migrated = migrateLegacyFrozenTrackStates([legacy, current]);

        expect(migrated.map((track) => track.freezeState.status)).toEqual(['stale', 'frozen']);
        expect(migrated[0]?.freezeState.sourceContentHash).toBe('legacy-hash');
    });
});
