import { describe, it, expect } from 'vitest';

import { getNextClipId } from '../clipIdCounter';

describe('clipIdCounter', () => {
    it('returns unique clip IDs with a stable prefix', () => {
        const id1 = getNextClipId();
        const id2 = getNextClipId();
        const id3 = getNextClipId();

        expect(id1).toMatch(/^clip-[a-f0-9]{8}$/i);
        expect(id2).toMatch(/^clip-[a-f0-9]{8}$/i);
        expect(id3).toMatch(/^clip-[a-f0-9]{8}$/i);

        expect(new Set([id1, id2, id3]).size).toBe(3);
    });
});
