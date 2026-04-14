import { describe, expect, it } from 'vitest';

import { createScratchPadSection } from '../ScratchPadSection';

describe('createScratchPadSection', () => {
    it('creates a scratch section with order and incrementing id', () => {
        const a = createScratchPadSection(0, 4, 'A', '#000', 0);
        const b = createScratchPadSection(4, 8, 'B', '#111', 1);
        expect(a.startBeat).toBe(0);
        expect(a.endBeat).toBe(4);
        expect(a.name).toBe('A');
        expect(a.color).toBe('#000');
        expect(a.order).toBe(0);
        expect(a.id).toMatch(/^scratch-[a-f0-9]{8}$/i);
        expect(b.id).not.toBe(a.id);
    });
});
