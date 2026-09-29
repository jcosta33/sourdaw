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

function stream(
    laneId: string,
    segments: readonly OfflineAutomationSegment[],
    scope: 'clip' | 'track' = 'track'
): AutomationSegmentStream {
    return { laneId, scope, segments };
}

/** A clip-scoped stream carrying the frame its clip window closes on. */
function windowedStream(
    laneId: string,
    segments: readonly OfflineAutomationSegment[],
    windowEndFrame: number
): AutomationSegmentStream {
    return { laneId, scope: 'clip', segments, windowEndFrame };
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

    /**
     * Two equal-scope streams that genuinely overlap resolve per span: the
     * lane later in the caller's array order owns the shared span, the other
     * keeps the spans it holds alone. Nothing is withheld.
     */
    describe('a genuinely overlapping equal-scope cluster splits at the ownership boundary', () => {
        // a[0,225] and b[175,400] overlap (b starts before a's terminator);
        // c[600,800] is disjoint from both.
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

        it('keeps b on the shared span and a before it, when handed a, b, c', () => {
            const result = mergeAutomationSegmentStreams([
                stream('a', aSegments),
                stream('b', bSegments),
                stream('c', cSegments),
            ]);

            expect(result).toEqual({
                segments: [
                    { startFrame: 0, endFrame: 175, startValue: 1, endValue: 1 },
                    // b's material is piecewise at the span boundary 225,
                    // with identical values.
                    { startFrame: 175, endFrame: 225, startValue: 2, endValue: 2 },
                    { startFrame: 225, endFrame: 400, startValue: 2, endValue: 2 },
                    // The hold below replaces the survivor's own terminator.
                    { startFrame: 400, endFrame: 600, startValue: 2, endValue: 2 },
                    { startFrame: 600, endFrame: 800, startValue: 3, endValue: 3 },
                    terminator(800, 3),
                ],
                withheldLaneIds: [],
            });
        });

        it('keeps a on the shared span and b after it, when handed b, a, c', () => {
            const result = mergeAutomationSegmentStreams([
                stream('b', bSegments),
                stream('a', aSegments),
                stream('c', cSegments),
            ]);

            expect(result).toEqual({
                segments: [
                    // a owns up to its terminator (piecewise at the span
                    // boundary 175, identical values) and closes with its own
                    // terminator; b owns the span past it.
                    { startFrame: 0, endFrame: 175, startValue: 1, endValue: 1 },
                    { startFrame: 175, endFrame: 225, startValue: 1, endValue: 1 },
                    terminator(225, 1),
                    { startFrame: 225, endFrame: 400, startValue: 2, endValue: 2 },
                    // The hold replaces the survivor's own terminator.
                    { startFrame: 400, endFrame: 600, startValue: 2, endValue: 2 },
                    { startFrame: 600, endFrame: 800, startValue: 3, endValue: 3 },
                    terminator(800, 3),
                ],
                withheldLaneIds: [],
            });
        });
    });

    it('splits a chain of pairwise overlaps at each ownership boundary, keeping every lane’s spans', () => {
        // x[0,100], y[50,150], z[140,300]: x overlaps y, y overlaps z, but x's
        // own span never reaches z's start — one cluster by the running
        // maximum terminator. Each span is owned by the latest (in array
        // order) stream covering it.
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

        expect(result).toEqual({
            segments: [
                { startFrame: 0, endFrame: 50, startValue: 5, endValue: 5 },
                { startFrame: 50, endFrame: 100, startValue: 6, endValue: 6 },
                { startFrame: 100, endFrame: 140, startValue: 6, endValue: 6 },
                { startFrame: 140, endFrame: 150, startValue: 7, endValue: 7 },
                { startFrame: 150, endFrame: 300, startValue: 7, endValue: 7 },
                terminator(300, 7),
            ],
            withheldLaneIds: [],
        });
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

        // One cluster of three (p, q, r); each span is owned by the latest
        // stream covering it, and p keeps every span nobody else covers —
        // including the one past r's terminator, out to p's own.
        expect(result).toEqual({
            segments: [
                { startFrame: 0, endFrame: 10, startValue: 1, endValue: 1 },
                { startFrame: 10, endFrame: 20, startValue: 2, endValue: 2 },
                terminator(20, 2),
                { startFrame: 20, endFrame: 300, startValue: 1, endValue: 1 },
                { startFrame: 300, endFrame: 350, startValue: 3, endValue: 3 },
                terminator(350, 3),
                { startFrame: 350, endFrame: 500, startValue: 1, endValue: 1 },
                terminator(500, 1),
            ],
            withheldLaneIds: [],
        });
    });

    /**
     * #4736/#4749: overlapping lanes on one device parameter resolve by the
     * scope law, per span — a clip-scoped lane owns every span its clip
     * window covers, a track-level lane owns the rest, and equal scopes
     * break to the lane latest in the caller's array order. No lane is ever
     * withheld wholesale, and a track lane's leading hold (before its first
     * point) and trailing hold are spans like any other, so the outcome no
     * longer depends on which lane comes first in time.
     */
    describe('the scope law: clip scope owns the shared span, per span (#4736, #4749)', () => {
        // Case A from #4749: the clip lane plays first in time (frames 0–40);
        // the track lane's leading hold (value 2, frames 0–80) sits under it
        // and its ride runs 80–240.
        const clipSegments: OfflineAutomationSegment[] = [
            { startFrame: 0, endFrame: 40, startValue: 2, endValue: 9 },
            terminator(40, 9),
        ];
        const trackSegments: OfflineAutomationSegment[] = [
            { startFrame: 0, endFrame: 80, startValue: 2, endValue: 2 },
            { startFrame: 80, endFrame: 240, startValue: 2, endValue: 9 },
            terminator(240, 9),
        ];
        const expectedSplice: OfflineAutomationSegment[] = [
            ...clipSegments,
            { startFrame: 40, endFrame: 80, startValue: 2, endValue: 2 },
            { startFrame: 80, endFrame: 240, startValue: 2, endValue: 9 },
            terminator(240, 9),
        ];

        it('hands the shared span to the clip lane and the rest to the track lane, withholding nothing', () => {
            const result = mergeAutomationSegmentStreams([
                stream('lane-track', trackSegments, 'track'),
                stream('lane-clip', clipSegments, 'clip'),
            ]);

            expect(result.withheldLaneIds).toEqual([]);
            expect(result.segments).toEqual(expectedSplice);
        });

        it('resolves to the identical splice whichever order the caller lists the lanes in', () => {
            const forward = mergeAutomationSegmentStreams([
                stream('lane-track', trackSegments, 'track'),
                stream('lane-clip', clipSegments, 'clip'),
            ]);
            const reversed = mergeAutomationSegmentStreams([
                stream('lane-clip', clipSegments, 'clip'),
                stream('lane-track', trackSegments, 'track'),
            ]);

            expect(reversed).toEqual(forward);
        });

        it('cuts a track lane that ends inside the clip window at the ownership boundary', () => {
            // The clip window opens at 40; the track lane's ride ends at 100,
            // inside it. The clip owns [40, 200] outright.
            const shortTrack: OfflineAutomationSegment[] = [
                { startFrame: 0, endFrame: 40, startValue: 2, endValue: 2 },
                { startFrame: 40, endFrame: 100, startValue: 2, endValue: 5 },
                terminator(100, 5),
            ];
            const longClip: OfflineAutomationSegment[] = [
                { startFrame: 40, endFrame: 200, startValue: 9, endValue: 9 },
                terminator(200, 9),
            ];

            const result = mergeAutomationSegmentStreams([
                stream('lane-track', shortTrack, 'track'),
                stream('lane-clip', longClip, 'clip'),
            ]);

            expect(result.withheldLaneIds).toEqual([]);
            expect(result.segments).toEqual([
                { startFrame: 0, endFrame: 40, startValue: 2, endValue: 2 },
                // The clip lane owns [40, 200] outright; its material is
                // piecewise at the span boundary 100, with identical values.
                { startFrame: 40, endFrame: 100, startValue: 9, endValue: 9 },
                { startFrame: 100, endFrame: 200, startValue: 9, endValue: 9 },
                terminator(200, 9),
            ]);
        });

        it('interpolates a shared-span boundary that falls inside the losing lane’s segment', () => {
            // The clip window opens at 50, mid-hold of the track lane — no
            // segment boundary there. The track keeps [0, 50] and the value
            // handed over at 50 is the value its ramp carries at 50.
            const trackSegments: OfflineAutomationSegment[] = [
                { startFrame: 0, endFrame: 100, startValue: 0, endValue: 10 },
                terminator(100, 10),
            ];
            const clipSegments: OfflineAutomationSegment[] = [
                { startFrame: 50, endFrame: 150, startValue: 7, endValue: 7 },
                terminator(150, 7),
            ];

            const result = mergeAutomationSegmentStreams([
                stream('lane-track', trackSegments, 'track'),
                stream('lane-clip', clipSegments, 'clip'),
            ]);

            expect(result.withheldLaneIds).toEqual([]);
            expect(result.segments).toEqual([
                { startFrame: 0, endFrame: 50, startValue: 0, endValue: 5 },
                // The clip lane owns from 50; its material is piecewise where
                // the span boundaries fall, with identical values.
                { startFrame: 50, endFrame: 100, startValue: 7, endValue: 7 },
                { startFrame: 100, endFrame: 150, startValue: 7, endValue: 7 },
                terminator(150, 7),
            ]);
        });

        it('breaks equal scopes to the lane latest in array order, per span', () => {
            const early: OfflineAutomationSegment[] = [
                { startFrame: 0, endFrame: 100, startValue: 1, endValue: 1 },
                terminator(100, 1),
            ];
            const late: OfflineAutomationSegment[] = [
                { startFrame: 50, endFrame: 150, startValue: 2, endValue: 2 },
                terminator(150, 2),
            ];

            const result = mergeAutomationSegmentStreams([
                stream('early', early, 'track'),
                stream('late', late, 'track'),
            ]);

            expect(result.withheldLaneIds).toEqual([]);
            expect(result.segments).toEqual([
                // `early` owns only the span before `late` opens; `late`'s
                // material is piecewise across the span boundaries, with
                // identical values.
                { startFrame: 0, endFrame: 50, startValue: 1, endValue: 1 },
                { startFrame: 50, endFrame: 100, startValue: 2, endValue: 2 },
                { startFrame: 100, endFrame: 150, startValue: 2, endValue: 2 },
                terminator(150, 2),
            ]);
        });

        it('leaves genuinely disjoint lanes as the hold-spliced whole (case B mirror)', () => {
            const trackSegments: OfflineAutomationSegment[] = [
                { startFrame: 0, endFrame: 40, startValue: 2, endValue: 9 },
                terminator(40, 9),
            ];
            const clipSegments: OfflineAutomationSegment[] = [
                { startFrame: 160, endFrame: 240, startValue: 2, endValue: 9 },
                terminator(240, 9),
            ];

            const result = mergeAutomationSegmentStreams([
                stream('lane-track', trackSegments, 'track'),
                stream('lane-clip', clipSegments, 'clip'),
            ]);

            expect(result.withheldLaneIds).toEqual([]);
            expect(result.segments).toEqual([
                // The track lane's own terminator is replaced by the hold
                // spanning the gap to the clip lane's first frame.
                trackSegments[0],
                { startFrame: 40, endFrame: 160, startValue: 9, endValue: 9 },
                ...clipSegments,
            ]);
        });

        /**
         * The scope window law: a clip stream carries the frame its clip window
         * closes on, and the merge stretches its extent to that frame before
         * resolving — a lane's compiled material ends at its last point (plus
         * slew settle), which is not where its clip does. Track streams carry no
         * window and merge exactly as before.
         */
        describe('a clip stream’s scope window, not its compiled extent, bounds what it owns', () => {
            const coveringTrack = (): AutomationSegmentStream =>
                stream(
                    'lane-track',
                    [{ startFrame: 0, endFrame: 1000, startValue: 3, endValue: 3 }, terminator(1000, 3)],
                    'track'
                );

            it('holds a clip stream’s closing value across the window tail its points never reach', () => {
                const clipStream = windowedStream(
                    'lane-clip',
                    [{ startFrame: 200, endFrame: 400, startValue: 9, endValue: 9 }, terminator(400, 9)],
                    600
                );

                const result = mergeAutomationSegmentStreams([coveringTrack(), clipStream]);

                expect(result.withheldLaneIds).toEqual([]);
                expect(result.segments).toEqual([
                    { startFrame: 0, endFrame: 200, startValue: 3, endValue: 3 },
                    // The clip owns [200, 600]: its material, then the hold
                    // across the tail its points never reach (piecewise at the
                    // material's own end, with identical values).
                    { startFrame: 200, endFrame: 400, startValue: 9, endValue: 9 },
                    { startFrame: 400, endFrame: 600, startValue: 9, endValue: 9 },
                    terminator(600, 9),
                    // The track lane resumes at the window's end.
                    { startFrame: 600, endFrame: 1000, startValue: 3, endValue: 3 },
                    terminator(1000, 3),
                ]);
                expect(isContiguousAutomationSchedule(result.segments)).toBe(true);
            });

            it('resolves the identical splice whichever order the caller lists the lanes in', () => {
                const clipStream = windowedStream(
                    'lane-clip',
                    [{ startFrame: 200, endFrame: 400, startValue: 9, endValue: 9 }, terminator(400, 9)],
                    600
                );

                const forward = mergeAutomationSegmentStreams([coveringTrack(), clipStream]);
                const reversed = mergeAutomationSegmentStreams([clipStream, coveringTrack()]);

                expect(reversed).toEqual(forward);
            });

            it('stretches a lone-terminator clip stream to own its whole window from its single value', () => {
                const clipStream = windowedStream('lane-clip', [terminator(200, 9)], 600);

                const result = mergeAutomationSegmentStreams([coveringTrack(), clipStream]);

                expect(result.withheldLaneIds).toEqual([]);
                expect(result.segments).toEqual([
                    { startFrame: 0, endFrame: 200, startValue: 3, endValue: 3 },
                    { startFrame: 200, endFrame: 600, startValue: 9, endValue: 9 },
                    terminator(600, 9),
                    { startFrame: 600, endFrame: 1000, startValue: 3, endValue: 3 },
                    terminator(1000, 3),
                ]);
                expect(isContiguousAutomationSchedule(result.segments)).toBe(true);
            });

            it('drops an empty clip stream even when it carries a window, so the track lane applies alone', () => {
                const result = mergeAutomationSegmentStreams([windowedStream('lane-clip', [], 600), coveringTrack()]);

                expect(result).toEqual({
                    segments: [{ startFrame: 0, endFrame: 1000, startValue: 3, endValue: 3 }, terminator(1000, 3)],
                    withheldLaneIds: [],
                });
            });
        });
    });
});
