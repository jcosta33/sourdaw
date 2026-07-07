import { describe, it, expect } from 'vitest';

import { detectTempoFromOnsets } from '../detectTempoFromOnsets';

describe('detectTempoFromOnsets', () => {
    it('should return an empty map when fewer than three onsets are provided', () => {
        const result = detectTempoFromOnsets([0, 0.5]);

        expect(result.points).toEqual([]);
        expect(result.averageBpm).toBe(0);
        expect(result.confidence).toBe(0);
        expect(result.totalBeats).toBe(0);
    });

    it('should return an empty map when every interval is outside the accepted range', () => {
        const onsets = [0, 3, 6, 9];
        const result = detectTempoFromOnsets(onsets);

        expect(result.averageBpm).toBe(0);
        expect(result.points).toEqual([]);
    });

    it('should estimate a confident 120 BPM from steady half-second spacing', () => {
        const period = 0.5;
        const onsets = [0, period, 2 * period, 3 * period, 4 * period];
        const result = detectTempoFromOnsets(onsets);

        expect(result.averageBpm).toBe(120);
        expect(result.points).toHaveLength(4);
        expect(result.points.map((point) => point.bpm)).toEqual([120, 120, 120, 120]);
        expect(result.confidence).toBeGreaterThan(0.99);
        expect(result.totalBeats).toBe(result.points.length);
        expect(result.minBpm).toBe(120);
        expect(result.maxBpm).toBe(120);
    });

    it('should smooth each point with a centered window of up to 5 estimates', () => {
        // Varied gaps -> varied bpm estimates, so a centered moving average actually
        // differs frame to frame. Guards the O(1) windowed running-sum refactor against
        // any drift from the original centered-window (index-2 .. index+2, clamped) mean.
        const gaps = [0.5, 0.6, 0.75, 0.4615, 0.5454, 0.52];
        const onsets: number[] = [0];
        for (const gap of gaps) {
            onsets.push(onsets[onsets.length - 1]! + gap);
        }

        const result = detectTempoFromOnsets(onsets);

        // Reproduce the pre-smoothing pipeline independently.
        const intervals: number[] = [];
        for (let index = 1; index < onsets.length; index++) {
            intervals.push(onsets[index]! - onsets[index - 1]!);
        }
        const bpmEstimates = intervals.filter((gap) => gap > 0.15 && gap < 2.0).map((gap) => 60 / gap);

        expect(result.points).toHaveLength(bpmEstimates.length);

        // Naive O(N^2) reference centered moving average.
        for (let index = 0; index < bpmEstimates.length; index++) {
            const lowIndex = Math.max(0, index - 2);
            const highIndex = Math.min(bpmEstimates.length, index + 3);
            const window = bpmEstimates.slice(lowIndex, highIndex);
            const expectedSmoothed = window.reduce((sum, bpm) => sum + bpm, 0) / window.length;
            expect(result.points[index]!.bpm).toBeCloseTo(Math.round(expectedSmoothed * 10) / 10, 10);
        }
    });
});
