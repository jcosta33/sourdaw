import { describe, it, expect } from 'vitest';

import type { TrackRemovedPayload } from '../TrackRemovedEvent';

describe('TrackRemovedEvent', () => {
    it('exports TrackRemovedPayload type', () => {
        // This is a type-only file, but this test ensures it is importable and parsed correctly.
        const dummy: TrackRemovedPayload = { trackId: '1' };
        expect(dummy.trackId).toBe('1');
    });
});
