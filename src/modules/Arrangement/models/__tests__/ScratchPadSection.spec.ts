import { describe, expect, it } from 'vitest';

import { createScratchPadSection } from '../ScratchPadSection';

// F9: the full UUID, not the truncated 8-hex-char prefix
// `crypto.randomUUID().slice(0, 8)` this id used to carry — truncating
// invited birthday collisions, per the lesson already documented for clip ids
// in `clipIdCounter.ts`.
const UUID_BODY = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

describe('createScratchPadSection', () => {
    it('creates a scratch section with order and incrementing id', () => {
        const alpha = createScratchPadSection(0, 4, 'A', '#000', 0);
        const buffer = createScratchPadSection(4, 8, 'B', '#111', 1);
        expect(alpha.startBeat).toBe(0);
        expect(alpha.endBeat).toBe(4);
        expect(alpha.name).toBe('A');
        expect(alpha.color).toBe('#000');
        expect(alpha.order).toBe(0);
        expect(alpha.id).toMatch(new RegExp(`^scratch-${UUID_BODY}$`, 'i'));
        expect(buffer.id).not.toBe(alpha.id);
    });
});
