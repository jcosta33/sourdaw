import { describe, expect, it } from 'vitest';

import { createMarker, createSection } from '../Marker';

describe('createMarker', () => {
    it('creates a marker with fixed theme color and incrementing id', () => {
        const a = createMarker(4, 'A');
        const b = createMarker(8, 'B');
        expect(a.beat).toBe(4);
        expect(a.name).toBe('A');
        expect(a.color).toBe('oklch(0.40 0.07 200)');
        expect(a.id).toMatch(/^marker-\d+$/);
        expect(b.id).not.toBe(a.id);
    });
});

describe('createSection', () => {
    it('creates an arrangement section with beat range and color', () => {
        const s = createSection(0, 16, 'Intro');
        expect(s.startBeat).toBe(0);
        expect(s.endBeat).toBe(16);
        expect(s.name).toBe('Intro');
        expect(s.color).toBe('oklch(0.35 0.06 260)');
        expect(s.id).toMatch(/^section-\d+$/);
    });
});
