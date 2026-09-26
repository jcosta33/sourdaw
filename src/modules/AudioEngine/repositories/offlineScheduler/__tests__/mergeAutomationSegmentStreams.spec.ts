/**
 * `mergeAutomationSegmentStreams` merges multiple lanes' compiled segment
 * streams on one device parameter into the single stream a "last apply wins"
 * consumer can hold, withholding whichever lanes in a genuinely overlapping
 * cluster lose the tie-break. See that module for the law.
 */

import { describe, expect, it } from 'vitest';

import { type OfflineAutomationSegment } from '../../deviceStrategy/AudioDeviceStrategy';
import { mergeAutomationSegmentStreams, type AutomationSegmentStream } from '../mergeAutomationSegmentStreams';

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

function stream(laneId: string, segments: readonly OfflineAutomationSegment[]): AutomationSegmentStream {
    return { laneId, segments };
}

describe('mergeAutomationSegmentStreams', () => {
    it('holds the earlier stream’s value across the gap to the later stream, in time order', () => {
        const streamA = stream('a', [{ startFrame: 0, endFrame: 10, startValue: 0, endValue: 3 }, terminator(10, 3)]);
        const streamB = stream('b', [{ startFrame: 20, endFrame: 30, startValue: 9, endValue: 9 }, terminator(30, 9)]);

        const result = mergeAutomationSegmentStreams([streamA, streamB]);

        expect(result).toEqual({
            segments: [
                { startFrame: 0, endFrame: 10, startValue: 0, endValue: 3 },
                // The hold replacing A's terminator: A's last value (3) held
                // from A's terminator frame to B's first frame.
                { startFrame: 10, endFrame: 20, startValue: 3, endValue: 3 },
                { startFrame: 20, endFrame: 30, startValue: 9, endValue: 9 },
                terminator(30, 9),
            ],
            withheldLaneIds: [],
        });
        expect(isContiguousAutomationSchedule(result.segments)).toBe(true);
    });

    it('produces the identical merged stream regardless of the input array order, when the streams are disjoint', () => {
        const streamA = stream('a', [{ startFrame: 0, endFrame: 10, startValue: 0, endValue: 3 }, terminator(10, 3)]);
        const streamB = stream('b', [{ startFrame: 20, endFrame: 30, startValue: 9, endValue: 9 }, terminator(30, 9)]);

        const forward = mergeAutomationSegmentStreams([streamA, streamB]);
        const reversed = mergeAutomationSegmentStreams([streamB, streamA]);

        expect(reversed).toEqual(forward);
    });

    it('drops the earlier terminator with no hold when the next stream starts exactly where it ended', () => {
        const streamA = stream('a', [{ startFrame: 0, endFrame: 10, startValue: 0, endValue: 3 }, terminator(10, 3)]);
        const streamB = stream('b', [{ startFrame: 10, endFrame: 20, startValue: 9, endValue: 9 }, terminator(20, 9)]);

        const result = mergeAutomationSegmentStreams([streamA, streamB]);

        expect(result).toEqual({
            segments: [
                { startFrame: 0, endFrame: 10, startValue: 0, endValue: 3 },
                { startFrame: 10, endFrame: 20, startValue: 9, endValue: 9 },
                terminator(20, 9),
            ],
            withheldLaneIds: [],
        });
        expect(isContiguousAutomationSchedule(result.segments)).toBe(true);
    });

    it('applies a single stream unchanged', () => {
        const segments: OfflineAutomationSegment[] = [terminator(0, 3)];

        expect(mergeAutomationSegmentStreams([stream('a', segments)])).toEqual({
            segments,
            withheldLaneIds: [],
        });
    });

    it('sorts a same-frame zero-length terminator stream before a full stream that also starts at frame 0', () => {
        // B is a real stream from frame 0; A is a clip whose window ended
        // exactly at the region start, compiling to nothing but its own
        // terminator at frame 0. Handed in reverse (full stream first), a
        // start-frame-only sort would leave B first and read A's frame-0
        // terminator as starting inside B's span.
        const bSegments: OfflineAutomationSegment[] = [
            { startFrame: 0, endFrame: 40, startValue: 3, endValue: 9 },
            terminator(40, 9),
        ];
        const streamB = stream('b', bSegments);
        const streamA = stream('a', [terminator(0, 3)]);

        const result = mergeAutomationSegmentStreams([streamB, streamA]);

        expect(result).toEqual({ segments: bSegments, withheldLaneIds: [] });
        expect(isContiguousAutomationSchedule(result.segments)).toBe(true);
    });

    it('produces the identical merge when the zero-length stream is already given first', () => {
        const streamA = stream('a', [terminator(0, 3)]);
        const bSegments: OfflineAutomationSegment[] = [
            { startFrame: 0, endFrame: 40, startValue: 3, endValue: 9 },
            terminator(40, 9),
        ];
        const streamB = stream('b', bSegments);

        const result = mergeAutomationSegmentStreams([streamA, streamB]);

        expect(result).toEqual({ segments: bSegments, withheldLaneIds: [] });
    });

    it('drops empty streams before classifying, and reports nothing to apply when every stream is empty', () => {
        expect(mergeAutomationSegmentStreams([stream('a', []), stream('b', [])])).toEqual({
            segments: [],
            withheldLaneIds: [],
        });

        const segments: OfflineAutomationSegment[] = [terminator(0, 3)];
        expect(mergeAutomationSegmentStreams([stream('a', []), stream('b', segments)])).toEqual({
            segments,
            withheldLaneIds: [],
        });
    });

    describe('a genuinely overlapping cluster withholds every lane but the one latest in lane-array order', () => {
        // a[0,225] and b[175,400] overlap (b starts before a's terminator);
        // c[600,800] is disjoint from both. Whichever of a/b sorts later in
        // the caller's own lane array is the one this parameter's merged
        // stream keeps — c is never touched by the clash.
        const aSegments: OfflineAutomationSegment[] = [
            { startFrame: 0, endFrame: 225, startValue: 1, endValue: 1 },
            terminator(225, 1),
        ];
        const bSegments: OfflineAutomationSegment[] = [
            { startFrame: 175, endFrame: 400, startValue: 2, endValue: 2 },
            terminator(400, 2),
        ];
        const cSegments: OfflineAutomationSegment[] = [
            { startFrame: 600, endFrame: 800, startValue: 3, endValue: 3 },
            terminator(800, 3),
        ];

        it('keeps b (latest in array order) and withholds a, when handed a, b, c', () => {
            const result = mergeAutomationSegmentStreams([
                stream('a', aSegments),
                stream('b', bSegments),
                stream('c', cSegments),
            ]);

            expect(result).toEqual({
                segments: [
                    { startFrame: 175, endFrame: 400, startValue: 2, endValue: 2 },
                    // Hold at b's terminator value from b's terminator to c's first frame.
                    { startFrame: 400, endFrame: 600, startValue: 2, endValue: 2 },
                    { startFrame: 600, endFrame: 800, startValue: 3, endValue: 3 },
                    terminator(800, 3),
                ],
                withheldLaneIds: ['a'],
            });
        });

        it('keeps a (latest in array order) and withholds b, when handed b, a, c', () => {
            const result = mergeAutomationSegmentStreams([
                stream('b', bSegments),
                stream('a', aSegments),
                stream('c', cSegments),
            ]);

            expect(result).toEqual({
                segments: [
                    { startFrame: 0, endFrame: 225, startValue: 1, endValue: 1 },
                    // Hold at a's terminator value from a's terminator to c's first frame.
                    { startFrame: 225, endFrame: 600, startValue: 1, endValue: 1 },
                    { startFrame: 600, endFrame: 800, startValue: 3, endValue: 3 },
                    terminator(800, 3),
                ],
                withheldLaneIds: ['b'],
            });
        });
    });

    it('clusters a chain of pairwise overlaps into one group, keeping only the last stream in lane-array order', () => {
        // x[0,100], y[50,150], z[140,300]: x overlaps y, y overlaps z, but x's
        // own span never reaches z's start — only the cluster's running
        // maximum terminator (150, from y) puts z inside the same cluster as
        // x and y. z is latest in lane-array order, so it alone survives.
        const xSegments: OfflineAutomationSegment[] = [
            { startFrame: 0, endFrame: 100, startValue: 5, endValue: 5 },
            terminator(100, 5),
        ];
        const ySegments: OfflineAutomationSegment[] = [
            { startFrame: 50, endFrame: 150, startValue: 6, endValue: 6 },
            terminator(150, 6),
        ];
        const zSegments: OfflineAutomationSegment[] = [
            { startFrame: 140, endFrame: 300, startValue: 7, endValue: 7 },
            terminator(300, 7),
        ];

        const result = mergeAutomationSegmentStreams([
            stream('x', xSegments),
            stream('y', ySegments),
            stream('z', zSegments),
        ]);

        expect(result).toEqual({ segments: zSegments, withheldLaneIds: ['x', 'y'] });
    });

    /**
     * Supplementary to the chain-of-overlaps case above: that fixture's
     * terminators happen to be monotonically increasing in sorted order, so
     * comparing each stream's start frame against only the immediately
     * preceding stream's own terminator (rather than the cluster's running
     * maximum) produces the identical clustering for it — it does not, on
     * its own, discriminate the running-max law from a "previous stream
     * only" law. This fixture does: q is nested entirely inside p (p's
     * terminator, 500, is far later than q's, 20), and r starts, at 300,
     * after q's terminator (20) but still well before p's (500). A
     * "previous only" comparison would check r's start against q's
     * terminator alone, close the cluster before r, and let r survive on
     * its own — the running-max law instead keeps r inside the same
     * cluster as p and q, because the cluster's maximum terminator (500,
     * from p) is still ahead of r's start.
     */
    it('keeps a nested-then-later stream in one cluster with the outer stream that outlasts it', () => {
        const pSegments: OfflineAutomationSegment[] = [
            { startFrame: 0, endFrame: 500, startValue: 1, endValue: 1 },
            terminator(500, 1),
        ];
        const qSegments: OfflineAutomationSegment[] = [
            { startFrame: 10, endFrame: 20, startValue: 2, endValue: 2 },
            terminator(20, 2),
        ];
        const rSegments: OfflineAutomationSegment[] = [
            { startFrame: 300, endFrame: 350, startValue: 3, endValue: 3 },
            terminator(350, 3),
        ];

        const result = mergeAutomationSegmentStreams([
            stream('p', pSegments),
            stream('q', qSegments),
            stream('r', rSegments),
        ]);

        // One cluster of three (p, q, r); r is latest in lane-array order, so
        // it alone survives and both p and q are withheld.
        expect(result).toEqual({ segments: rSegments, withheldLaneIds: ['p', 'q'] });
    });
});
