import { type OfflineAutomationSegment } from '../deviceStrategy/AudioDeviceStrategy';

import { type CompiledAutomationEvent } from './compileAutomationEvents';
import { compiledEventsToSegments } from './compiledEventsToSegments';
import {
    mergeAutomationSegmentStreams,
    type AutomationSegmentScope,
    type AutomationSegmentStream,
} from './mergeAutomationSegmentStreams';

/**
 * One lane's compiled event stream on the (device, parameter) pair being
 * merged — the event-bound analogue of `AutomationSegmentStream`.
 */
export type AutomationEventStream = Readonly<{
    laneId: string;
    scope: AutomationSegmentScope;
    events: readonly CompiledAutomationEvent[];
}>;

/**
 * Every lane on the pair resolves into one spliced event stream — nothing is
 * withheld. `withheldLaneIds` stays because the group's caller reports it the
 * same way the segments merge does; under the scope law it is always empty.
 */
export type MergedAutomationEventStreams = Readonly<{
    events: readonly CompiledAutomationEvent[];
    withheldLaneIds: readonly string[];
}>;

/**
 * Rebuild a compiled event timeline from a merged segment stream — the exact
 * inverse of `compiledEventsToSegments` over the same curve. Every value
 * change becomes an event on the frame it happens: a segment whose own opening
 * value differs from what the timeline holds is the compiled stream's `set`
 * (a jump spelled on its frame, where a later insertion wins), a segment that
 * ramps spells one `linear` on its end frame, and a hold spells nothing —
 * Web Audio and the frame-addressed pair both hold their last value. Ramps
 * chain exactly as the source slew grid compiled them, so the rebuilt timeline
 * plays the same piecewise curve the segments do; only redundant same-value
 * rewrites of it are gone.
 */
function mergedSegmentsToEvents(
    segments: readonly OfflineAutomationSegment[],
    sampleRate: number
): CompiledAutomationEvent[] {
    const events: CompiledAutomationEvent[] = [];
    const append = (event: CompiledAutomationEvent): void => {
        const previous = events.at(-1);
        if (
            previous?.type === event.type &&
            previous.timeSeconds === event.timeSeconds &&
            previous.value === event.value
        ) {
            return;
        }
        events.push(event);
    };
    let heldValue: number | undefined;
    for (const segment of segments) {
        if (heldValue === undefined || segment.startValue !== heldValue) {
            append({ type: 'set', timeSeconds: segment.startFrame / sampleRate, value: segment.startValue });
        }
        if (segment.endFrame > segment.startFrame) {
            if (segment.endValue !== segment.startValue) {
                append({ type: 'linear', timeSeconds: segment.endFrame / sampleRate, value: segment.endValue });
            }
        } else if (segment.endValue !== segment.startValue) {
            // A zero-width segment asserts its closing value on its frame — two
            // events that rounded onto one frame leave the later one's value
            // standing there.
            append({ type: 'set', timeSeconds: segment.endFrame / sampleRate, value: segment.endValue });
        }
        heldValue = segment.endValue;
    }
    return events;
}

/**
 * Resolve every lane's compiled event stream on one device parameter into the
 * single spliced stream a one-schedule-per-parameter consumer applies — the
 * event-bound export families (`audioParam` targets, `curveWrite` writes),
 * which used to schedule each overlapping lane independently onto the same
 * target and let the exported curve flip with lane-array insertion order while
 * live played the clip lane.
 *
 * The law is not restated here: each stream converts to the segment domain it
 * shares with the `segments` binding (`compiledEventsToSegments`, at
 * compensation 0 because these families shift at application time), and
 * `mergeAutomationSegmentStreams` resolves the overlap — a clip-scoped lane
 * owns every span its clip window covers (#4736), equal scopes break to the
 * lane latest in the caller's array order — before the winners' material
 * converts back to events. The applied curve for one project is therefore the
 * same curve the segments-bound export plays, span for span.
 */
export function mergeAutomationEventStreams(
    streams: readonly AutomationEventStream[],
    sampleRate: number,
    durationSeconds: number
): MergedAutomationEventStreams {
    if (sampleRate <= 0) {
        return { events: [], withheldLaneIds: [] };
    }
    const segmentStreams: AutomationSegmentStream[] = streams.map((stream) => ({
        laneId: stream.laneId,
        scope: stream.scope,
        segments: compiledEventsToSegments(stream.events, durationSeconds, sampleRate, 0),
    }));
    const merged = mergeAutomationSegmentStreams(segmentStreams);
    return { events: mergedSegmentsToEvents(merged.segments, sampleRate), withheldLaneIds: merged.withheldLaneIds };
}
