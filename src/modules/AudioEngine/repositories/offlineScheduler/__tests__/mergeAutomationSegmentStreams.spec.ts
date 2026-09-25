/**
 * `mergeAutomationSegmentStreams` merges multiple lanes' compiled segment
 * streams on one device parameter into the single stream a "last apply wins"
 * consumer can hold — or reports that the lanes overlap, so the caller keeps
 * applying each stream separately. See that module for the law.
 */

import { describe, expect, it } from 'vitest';

import { type OfflineAutomationSegment } from '../../deviceStrategy/AudioDeviceStrategy';
import { mergeAutomationSegmentStreams } from '../mergeAutomationSegmentStreams';

/**
 * `isContiguousAutomationSchedule`'s own law (`engine/ToasterNode.ts`),
 * restated here so every merge this file accepts is checked against it: the
 * first frame is exactly `0`, every frame is a non-negative integer, every
 * segment's `endFrame >= startFrame`, each segment after the first starts
 * exactly where the previous one ended, and every value is finite.
 */
function isContiguousAutomationSchedule(segments: readonly OfflineAutomationSegment[]): boolean {
    if (segments.length === 0 || segments[0]?.startFrame !== 0) {
        return false;
    }
    return segments.every((segment, index) => {
        const previous = segments[index - 1];
        return (
            Number.isInteger(segment.startFrame) &&
            Number.isInteger(segment.endFrame) &&
            segment.startFrame >= 0 &&
            segment.endFrame >= segment.startFrame &&
            (index === 0 || segment.startFrame === previous?.endFrame) &&
            Number.isFinite(segment.startValue) &&
            Number.isFinite(segment.endValue)
        );
    });
}

function terminator(frame: number, value: number): OfflineAutomationSegment {
    return { startFrame: frame, endFrame: frame, startValue: value, endValue: value };
}

describe('mergeAutomationSegmentStreams', () => {
    it('holds the earlier stream’s value across the gap to the later stream, in time order', () => {
        const streamA: OfflineAutomationSegment[] = [
            { startFrame: 0, endFrame: 10, startValue: 0, endValue: 3 },
            terminator(10, 3),
        ];
        const streamB: OfflineAutomationSegment[] = [
            { startFrame: 20, endFrame: 30, startValue: 9, endValue: 9 },
            terminator(30, 9),
        ];

        const result = mergeAutomationSegmentStreams([streamA, streamB]);

        expect(result).toEqual({
            overlapping: false,
            segments: [
                { startFrame: 0, endFrame: 10, startValue: 0, endValue: 3 },
                // The hold replacing A's terminator: A's last value (3) held
                // from A's terminator frame to B's first frame.
                { startFrame: 10, endFrame: 20, startValue: 3, endValue: 3 },
                { startFrame: 20, endFrame: 30, startValue: 9, endValue: 9 },
                terminator(30, 9),
            ],
        });
        expect(isContiguousAutomationSchedule(result.overlapping ? [] : result.segments)).toBe(true);
    });

    it('produces the identical merged stream regardless of the input array order', () => {
        const streamA: OfflineAutomationSegment[] = [
            { startFrame: 0, endFrame: 10, startValue: 0, endValue: 3 },
            terminator(10, 3),
        ];
        const streamB: OfflineAutomationSegment[] = [
            { startFrame: 20, endFrame: 30, startValue: 9, endValue: 9 },
            terminator(30, 9),
        ];

        const forward = mergeAutomationSegmentStreams([streamA, streamB]);
        const reversed = mergeAutomationSegmentStreams([streamB, streamA]);

        expect(reversed).toEqual(forward);
    });

    it('drops the earlier terminator with no hold when the next stream starts exactly where it ended', () => {
        const streamA: OfflineAutomationSegment[] = [
            { startFrame: 0, endFrame: 10, startValue: 0, endValue: 3 },
            terminator(10, 3),
        ];
        const streamB: OfflineAutomationSegment[] = [
            { startFrame: 10, endFrame: 20, startValue: 9, endValue: 9 },
            terminator(20, 9),
        ];

        const result = mergeAutomationSegmentStreams([streamA, streamB]);

        expect(result).toEqual({
            overlapping: false,
            segments: [
                { startFrame: 0, endFrame: 10, startValue: 0, endValue: 3 },
                { startFrame: 10, endFrame: 20, startValue: 9, endValue: 9 },
                terminator(20, 9),
            ],
        });
        expect(isContiguousAutomationSchedule(result.overlapping ? [] : result.segments)).toBe(true);
    });

    it('reports overlapping streams instead of merging when a later stream starts before the earlier terminator', () => {
        const streamA: OfflineAutomationSegment[] = [
            { startFrame: 0, endFrame: 10, startValue: 0, endValue: 3 },
            terminator(10, 3),
        ];
        // B starts at frame 5, inside A's own span (A's terminator is at 10).
        const streamB: OfflineAutomationSegment[] = [
            { startFrame: 5, endFrame: 15, startValue: 9, endValue: 9 },
            terminator(15, 9),
        ];

        expect(mergeAutomationSegmentStreams([streamA, streamB])).toEqual({ overlapping: true });
        // Order-independent: sorting by first frame does not change which pair collides.
        expect(mergeAutomationSegmentStreams([streamB, streamA])).toEqual({ overlapping: true });
    });

    it('applies a single stream unchanged', () => {
        const stream: OfflineAutomationSegment[] = [terminator(0, 3)];

        expect(mergeAutomationSegmentStreams([stream])).toEqual({ overlapping: false, segments: stream });
    });

    it('drops empty streams before classifying, and reports nothing to apply when every stream is empty', () => {
        expect(mergeAutomationSegmentStreams([[], []])).toEqual({ overlapping: false, segments: [] });

        const stream: OfflineAutomationSegment[] = [terminator(0, 3)];
        expect(mergeAutomationSegmentStreams([[], stream])).toEqual({ overlapping: false, segments: stream });
    });
});
