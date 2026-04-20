import { describe, it, expect } from 'vitest';

import type { TrackAddedPayload } from '../TrackAddedEvent';

describe('TrackAddedEvent', () => {
    it('exports TrackAddedPayload type', () => {
        // This is a type-only file, but this test ensures it is importable and parsed correctly.
        const dummy: TrackAddedPayload = { trackId: '1', name: 'Vocals', kind: 'audio' };
        expect(dummy.trackId).toBe('1');
    });
});
