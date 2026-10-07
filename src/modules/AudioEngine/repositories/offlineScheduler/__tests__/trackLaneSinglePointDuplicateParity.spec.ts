/**
 * #4928 export control: two track-level lanes on one parameter, the later one
 * carrying exactly a single point — the duplicate the add-lane action refuses
 * to create but a CRDT collab merge or legacy/preset data can produce. This
 * pins the export side of the law as the agreement target the live apply
 * mirrors: the single-point lane compiles to a lone zero-length terminator
 * covering no span, so it contributes nothing and the earlier lane's curve is
 * what every export family plays. Live's own half is asserted at the
 * `applyAutomation` seam (Transport `applyAutomation.spec.ts`, #4928).
 */

import { describe, expect, it } from 'vitest';

import { type AutomationPoint } from '../../../models/AutomationViewTypes';
import { type OfflineAutomationSegment } from '../../deviceStrategy/AudioDeviceStrategy';
import { compileAutomationEvents } from '../compileAutomationEvents';
import { compileAutomationSegments } from '../compileAutomationSegments';
import { mergeAutomationEventStreams, type AutomationEventStream } from '../mergeAutomationEventStreams';
import { mergeAutomationSegmentStreams, type AutomationSegmentStream } from '../mergeAutomationSegmentStreams';

const DEFAULT_TEMPO = 120;
const DURATION_SECONDS = 20;
const SAMPLE_RATE = 100;

// The finding's own scratch-spec journal pair (PR #4924 review round 1): a
// track gain ramp and a later track lane holding 0.9.
const RAMP_POINTS: AutomationPoint[] = [
    { beat: 0, value: 0.2, curve: 'linear', tension: 0 },
    { beat: 16, value: 0.6, curve: 'linear', tension: 0 },
];
const HELD_POINTS: AutomationPoint[] = [{ beat: 4, value: 0.9, curve: 'linear', tension: 0 }];

describe('#4928 export control: a later single-point track lane contributes nothing', () => {
    it('compiles the single-point track lane to a lone zero-length terminator', () => {
        // The compile shape the law names, wherever the point itself sits: the
        // seed holds its value at the region start and no segment follows.
        expect(compileAutomationSegments(HELD_POINTS, DURATION_SECONDS, DEFAULT_TEMPO, [], SAMPLE_RATE)).toEqual([
            { startFrame: 0, endFrame: 0, startValue: 0.9, endValue: 0.9 },
        ]);
    });

    it('segments family: the earlier ramp plays whole, in either lane order', () => {
        const ramp = compileAutomationSegments(RAMP_POINTS, DURATION_SECONDS, DEFAULT_TEMPO, [], SAMPLE_RATE);
        const held = compileAutomationSegments(HELD_POINTS, DURATION_SECONDS, DEFAULT_TEMPO, [], SAMPLE_RATE);
        const stream = (laneId: string, segments: readonly OfflineAutomationSegment[]): AutomationSegmentStream => ({
            laneId,
            scope: 'track',
            segments,
        });

        for (const streams of [
            [stream('lane-ramp', ramp), stream('lane-held', held)],
            [stream('lane-held', held), stream('lane-ramp', ramp)],
        ]) {
            expect(mergeAutomationSegmentStreams(streams).segments).toEqual(ramp);
        }
    });

    it('event family: the merged timeline is the earlier ramp and never the held value', () => {
        const stream = (laneId: string, points: AutomationPoint[]): AutomationEventStream => ({
            laneId,
            scope: 'track',
            events: compileAutomationEvents(points, DURATION_SECONDS, DEFAULT_TEMPO, []),
        });

        for (const streams of [
            [stream('lane-ramp', RAMP_POINTS), stream('lane-held', HELD_POINTS)],
            [stream('lane-held', HELD_POINTS), stream('lane-ramp', RAMP_POINTS)],
        ]) {
            // Event times are seconds past the region start: 16 beats at the
            // default 120 BPM land at 8 s.
            expect(mergeAutomationEventStreams(streams, SAMPLE_RATE, DURATION_SECONDS).events).toEqual([
                { type: 'set', timeSeconds: 0, value: 0.2 },
                { type: 'linear', timeSeconds: 8, value: 0.6 },
            ]);
        }
    });
});
