import { describe, it, expect } from 'vitest';

import {
    TIMELINE_MINIMAP_MIN_HEIGHT,
    TIMELINE_MINIMAP_MAX_HEIGHT,
    TIMELINE_MINIMAP_DEFAULT_HEIGHT,
    normalizeTimelineMinimapHeight,
} from '../timelineMinimapHeight';

describe('normalizeTimelineMinimapHeight', () => {
    it('should return the value unchanged when already in range', () => {
        expect(normalizeTimelineMinimapHeight(80)).toBe(80);
    });

    it('should round fractional values to the nearest integer', () => {
        expect(normalizeTimelineMinimapHeight(79.6)).toBe(80);
        expect(normalizeTimelineMinimapHeight(79.4)).toBe(79);
    });

    it('should clamp values below the minimum up to the minimum', () => {
        expect(normalizeTimelineMinimapHeight(1)).toBe(TIMELINE_MINIMAP_MIN_HEIGHT);
        expect(normalizeTimelineMinimapHeight(0)).toBe(TIMELINE_MINIMAP_MIN_HEIGHT);
    });

    it('should clamp values above the maximum down to the maximum', () => {
        expect(normalizeTimelineMinimapHeight(500)).toBe(TIMELINE_MINIMAP_MAX_HEIGHT);
    });

    it('should fall back to the default height for a non-number value', () => {
        expect(normalizeTimelineMinimapHeight('80')).toBe(TIMELINE_MINIMAP_DEFAULT_HEIGHT);
        expect(normalizeTimelineMinimapHeight(undefined)).toBe(TIMELINE_MINIMAP_DEFAULT_HEIGHT);
        expect(normalizeTimelineMinimapHeight(null)).toBe(TIMELINE_MINIMAP_DEFAULT_HEIGHT);
    });

    it('should fall back to the default height for a non-finite number', () => {
        expect(normalizeTimelineMinimapHeight(Number.NaN)).toBe(TIMELINE_MINIMAP_DEFAULT_HEIGHT);
        expect(normalizeTimelineMinimapHeight(Number.POSITIVE_INFINITY)).toBe(TIMELINE_MINIMAP_DEFAULT_HEIGHT);
    });

    it('should treat the minimum height as the default', () => {
        expect(TIMELINE_MINIMAP_DEFAULT_HEIGHT).toBe(TIMELINE_MINIMAP_MIN_HEIGHT);
    });
});
