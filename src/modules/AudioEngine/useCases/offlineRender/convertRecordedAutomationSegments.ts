/**
 * How a device lane's compiled automation reaches the contract, part two of
 * the recording projection (#3568).
 *
 * A device parameter is not an `AudioParam`: the scheduler hands its lane to
 * the device's own `segments` binding rather than to a recording param, so
 * `convertRecordedAutomationEvents` never sees it. What arrives instead is the
 * segment stream `compileAutomationSegments` produced — the same curve, already
 * carrying the live slew and the declared-type quantisation, frame-addressed
 * and relative to the region start.
 *
 * Only {@link AudioGraphStepWrite} has a meaning at a device parameter
 * ({@link AudioGraphDeviceParameterTarget}), so each segment becomes the value
 * it opens on, stamped where it opens. A segment's own end is never emitted:
 * the next segment opens there and states it, and the last one is the
 * zero-length terminator `compileAutomationSegments` closes every stream with.
 *
 * A value within {@link AUTOMATION_SLEW_EPSILON} of the last step actually
 * emitted is skipped, which is the same gate the live tick path applies before
 * `updateDeviceParam` — a stepped parameter's filter keeps moving long after
 * the delivered value has stopped, and restating it would spend a queue slot
 * per tick on a value the engine is already holding. The comparison is against
 * what was emitted rather than against the previous segment, so a slow drift
 * still lands as one step once it has crossed the threshold in total.
 */

import { AUTOMATION_SLEW_EPSILON } from '#/utils/automationSlew';

import { type AudioGraphStepWrite } from '../../models/AudioGraphBackend';
import { type OfflineAutomationSegment } from '../../repositories/deviceStrategy/AudioDeviceStrategy';

export type ConvertRecordedSegmentsInput = Readonly<{
    segments: readonly OfflineAutomationSegment[];
    /** The frame grid the segments were compiled on. */
    sampleRate: number;
}>;

export function convertRecordedAutomationSegments(input: ConvertRecordedSegmentsInput): readonly AudioGraphStepWrite[] {
    const { segments, sampleRate } = input;
    if (sampleRate <= 0) {
        return [];
    }
    const writes: AudioGraphStepWrite[] = [];
    let lastEmitted: number | null = null;
    for (const segment of segments) {
        if (lastEmitted !== null && Math.abs(segment.startValue - lastEmitted) <= AUTOMATION_SLEW_EPSILON) {
            continue;
        }
        writes.push({ shape: 'step', value: segment.startValue, time: segment.startFrame / sampleRate });
        lastEmitted = segment.startValue;
    }
    return writes;
}
