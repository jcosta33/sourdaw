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

    it('smooths each point with a centered window of up to 5 estimates (windowed-sum equivalence)', () => {
        // Varied gaps -> varied bpm estimates, so a centered moving average actually
        // differs frame to frame. Guards the O(1) windowed running-sum refactor against
        // any drift from the original centered-window (index-2 .. index+2, clamped) mean.
        const gaps = [0.5, 0.6, 0.75, 0.4615, 0.5454, 0.52];
        const onsets: number[] = [0];
        for (const gap of gaps) {
            onsets.push(onsets[onsets.length - 1]! + gap);
        }

        const result = subject.detectTempoFromOnsets(onsets);

        // Reproduce the pre-smoothing pipeline independently.
        const intervals: number[] = [];
        for (let i = 1; i < onsets.length; i++) {
            intervals.push(onsets[i]! - onsets[i - 1]!);
        }
        const bpmEstimates = intervals.filter((d) => d > 0.15 && d < 2.0).map((d) => 60 / d);

        expect(result.points).toHaveLength(bpmEstimates.length);

        // Naive O(N^2) reference centered moving average.
        for (let i = 0; i < bpmEstimates.length; i++) {
            const lo = Math.max(0, i - 2);
            const hi = Math.min(bpmEstimates.length, i + 3);
            const window = bpmEstimates.slice(lo, hi);
            const expectedSmoothed = window.reduce((a, b) => a + b, 0) / window.length;
            expect(result.points[i]!.bpm).toBeCloseTo(Math.round(expectedSmoothed * 10) / 10, 10);
        }
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
