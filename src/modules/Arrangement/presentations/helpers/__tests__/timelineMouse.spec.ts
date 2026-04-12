import { describe, it, expect, beforeEach } from 'vitest';

import { timelineViewStore } from '../../../stores/timelineViewStore';
import { canvasXToBeat, getContentY, valueAtTrackY } from '../timelineMouse';

describe('getContentY', () => {
    it('should map canvas Y to content Y using scroll and ruler offset', () => {
        expect(getContentY(100, 24)).toBe(124);
    });
});

describe('valueAtTrackY', () => {
    it('should return a normalised 0–1 value within the track height', () => {
        expect(valueAtTrackY(50, 0, 100)).toBeCloseTo(0.5);
    });

    it('should clamp outside the track to 0 or 1', () => {
        expect(valueAtTrackY(-10, 0, 100)).toBe(1);
        expect(valueAtTrackY(200, 0, 100)).toBe(0);
    });
});

describe('canvasXToBeat', () => {
    beforeEach(() => {
        timelineViewStore.set({
            scrollX: 24,
            scrollY: 0,
            pixelsPerBeat: 12,
            autoScrollEnabled: true,
        });
    });

    it('should convert canvas X using pixels per beat and scroll', () => {
        expect(canvasXToBeat(0)).toBeCloseTo(2);
    });

    it('should return zero when the timeline view store is empty', () => {
        timelineViewStore.set(null);
        expect(canvasXToBeat(99)).toBe(0);
    });
});
