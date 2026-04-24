import { describe, it, expect } from 'vitest';

import * as subject from '../detectProjectTempo';

describe('detectTempoFromOnsets', () => {
    it('returns an empty map when fewer than three onsets are provided', () => {
        const result = subject.detectTempoFromOnsets([0, 0.5]);

        expect(result.points).toEqual([]);
        expect(result.averageBpm).toBe(0);
        expect(result.confidence).toBe(0);
        expect(result.totalBeats).toBe(0);
    });

    it('returns an empty map when every interval is outside the accepted range', () => {
        const onsets = [0, 3, 6, 9];
        const result = subject.detectTempoFromOnsets(onsets);

        expect(result.averageBpm).toBe(0);
        expect(result.points).toEqual([]);
    });

    it('estimates ~120 BPM from steady half-second spacing', () => {
        const period = 0.5;
        const onsets = [0, period, 2 * period, 3 * period, 4 * period];
        const result = subject.detectTempoFromOnsets(onsets);

        expect(result.averageBpm).toBe(120);
        expect(result.points.length).toBeGreaterThan(0);
        expect(result.totalBeats).toBe(result.points.length);
        expect(result.minBpm).toBeGreaterThan(0);
        expect(result.maxBpm).toBeGreaterThanOrEqual(result.minBpm);
    });
});

describe('detectProjectTempo module exports', () => {
    it('should export applyTempoMap', () => {
        expect(subject.applyTempoMap).toBeDefined();
        const time = typeof subject.applyTempoMap;
        expect(time === 'function' || time === 'object').toBe(true);
    });
    it('should export detectProjectTempo', () => {
        expect(subject.detectProjectTempo).toBeDefined();
        const time = typeof subject.detectProjectTempo;
        expect(time === 'function' || time === 'object').toBe(true);
    });
    it('should export detectTempoFromOnsets', () => {
        expect(subject.detectTempoFromOnsets).toBeDefined();
        const time = typeof subject.detectTempoFromOnsets;
        expect(time === 'function' || time === 'object').toBe(true);
    });
    it('should export estimateOnsetsFromClips', () => {
        expect(subject.estimateOnsetsFromClips).toBeDefined();
        const time = typeof subject.estimateOnsetsFromClips;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
