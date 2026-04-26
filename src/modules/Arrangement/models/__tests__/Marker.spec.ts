import { describe, expect, it } from 'vitest';

import { createMarker, createSection } from '../Marker';

describe('createMarker', () => {
    it('creates a marker with fixed theme color and incrementing id', () => {
        const alpha = createMarker(4, 'A');
        const buffer = createMarker(8, 'B');
        expect(alpha.beat).toBe(4);
        expect(alpha.name).toBe('A');
        expect(alpha.color).toBe('oklch(0.40 0.07 200)');
        expect(alpha.id).toMatch(/^marker-[a-f0-9]{8}$/i);
        expect(buffer.id).not.toBe(alpha.id);
    });
});

describe('createSection', () => {
    it('creates an arrangement section with beat range and color', () => {
        const state = createSection(0, 16, 'Intro');
        expect(state.startBeat).toBe(0);
        expect(state.endBeat).toBe(16);
        expect(state.name).toBe('Intro');
        expect(state.color).toBe('oklch(0.35 0.06 260)');
        expect(state.id).toMatch(/^section-[a-f0-9]{8}$/i);
    });
});
