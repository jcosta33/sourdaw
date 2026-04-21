import { describe, expect, it } from 'vitest';

import { createScratchPadSection } from '../ScratchPadSection';

describe('createScratchPadSection', () => {
    it('creates a scratch section with order and incrementing id', () => {
        const alpha = createScratchPadSection(0, 4, 'A', '#000', 0);
        const buffer = createScratchPadSection(4, 8, 'B', '#111', 1);
        expect(alpha.startBeat).toBe(0);
        expect(alpha.endBeat).toBe(4);
        expect(alpha.name).toBe('A');
        expect(alpha.color).toBe('#000');
        expect(alpha.order).toBe(0);
        expect(alpha.id).toMatch(/^scratch-[a-f0-9]{8}$/i);
        expect(buffer.id).not.toBe(alpha.id);
    });
});
