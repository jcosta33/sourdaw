import { describe, expect, it } from 'vitest';

import { MARKER_COLOR_PRESETS, SECTION_COLORS } from '../ColorPalette';
import { createMarker, createSection } from '../Marker';

// UUID v4 body, e.g. `123e4567-e89b-42d3-a456-426614174000` — the full form,
// not the 8-hex-char prefix `crypto.randomUUID().slice(0, 8)` used to produce.
const UUID_BODY = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

describe('createMarker', () => {
    it('creates a marker with fixed theme color and incrementing id', () => {
        const alpha = createMarker(4, 'A');
        const buffer = createMarker(8, 'B');
        expect(alpha.beat).toBe(4);
        expect(alpha.name).toBe('A');
        // F14: the default marker color must come from the shared
        // `ColorPalette.ts` source of truth, not a private duplicated literal.
        expect(alpha.color).toBe(MARKER_COLOR_PRESETS[0]);
        // F9: a truncated 8-hex-char id invites birthday collisions across a
        // long session — the id must carry the full UUID.
        expect(alpha.id).toMatch(new RegExp(`^marker-${UUID_BODY}$`, 'i'));
        expect(buffer.id).not.toBe(alpha.id);
    });
});

describe('createSection', () => {
    it('creates an arrangement section with beat range and color', () => {
        const state = createSection(0, 16, 'Intro');
        expect(state.startBeat).toBe(0);
        expect(state.endBeat).toBe(16);
        expect(state.name).toBe('Intro');
        // F14: the default section color must come from the shared
        // `ColorPalette.ts` source of truth, not a private duplicated literal.
        expect(state.color).toBe(SECTION_COLORS[0]);
        // F9: same truncated-UUID defect as marker ids.
        expect(state.id).toMatch(new RegExp(`^section-${UUID_BODY}$`, 'i'));
    });
});
