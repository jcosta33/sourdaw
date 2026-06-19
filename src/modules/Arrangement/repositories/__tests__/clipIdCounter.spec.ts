import { describe, it, expect } from 'vitest';

import { getNextClipId } from '../clipIdCounter';

const UUID_RE = /^clip-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('clipIdCounter', () => {
    it('returns unique clip IDs with a stable prefix', () => {
        const id1 = getNextClipId();
        const id2 = getNextClipId();
        const id3 = getNextClipId();

        // Full 122-bit UUID, not the first 8 hex chars: truncating to 32 bits
        // invited birthday collisions around ~65k clips.
        expect(id1).toMatch(UUID_RE);
        expect(id2).toMatch(UUID_RE);
        expect(id3).toMatch(UUID_RE);

        expect(new Set([id1, id2, id3]).size).toBe(3);
    });
});
