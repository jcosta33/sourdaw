import { type AutomationPoint } from '../../models/AutomationViewTypes';
import { type OfflineAutomationSegment } from '../deviceStrategy/AudioDeviceStrategy';

import { compileAutomationEvents, type CompileAutomationEventsOptions } from './compileAutomationEvents';

type AutomationTempoChange = { beat: number; tempo: number };

function toFrame(seconds: number, durationSeconds: number, sampleRate: number): number {
    return Math.round(Math.min(durationSeconds, Math.max(0, seconds)) * sampleRate);
}

export function compileAutomationSegments(
    points: AutomationPoint[],
    durationSeconds: number,
    defaultTempo: number,
    changes: AutomationTempoChange[],
    sampleRate: number,
    regionStartSeconds = 0,
    projectBeatToSeconds?: (beat: number) => number,
    compensationDelaySec = 0,
    options?: CompileAutomationEventsOptions
): OfflineAutomationSegment[] {
    if (sampleRate <= 0) {
        return [];
    }
    const events = compileAutomationEvents(
        points,
        durationSeconds,
        defaultTempo,
        changes,
        regionStartSeconds,
        projectBeatToSeconds,
        options
    );
    if (events.length === 0) {
        return [];
    }

    // Clip scheduling shifts audio by the track's latency compensation
    // (M-038); a device parameter bound to a `segments` stream must land on
    // that same shifted clock or its worklet steps before the audio it
    // shapes. The shift is applied in seconds, on the compiled events, before
    // the seconds→frames conversion below, so rounding happens exactly once.
    // The region-start seed re-anchors at frame 0 — the same re-anchoring
    // `scheduleAutomationOnParam` (:40-41) and the curve-write branch in
    // `automationScheduling.ts` (`scheduleCurveWritePoints`) apply to theirs —
    // so the device does not sit on its stale base value for the first
    // `compensationDelaySec` of the render.
    //
    // A lane whose window closes exactly at the region start compiles to
    // exactly one event sitting at time zero — nothing follows the seed.
    // That lone zero-length terminator is what `mergeAutomationSegmentStreams`
    // documents and relies on sitting at frame 0: shifting it (or opening a
    // hold in front of it) has no later material to lead into, and instead
    // turns it into a `[0, D]` span that overlaps whatever lane opens at the
    // region start, which the merge then reads as a genuine clash and
    // withholds a lane over (#4684). A lone seed has no window to shift into
    // only when it sits at time zero; a lone event later in the render — no
    // different from the tail of a multi-event stream — is shifted like
    // every other event below.
    const segments: OfflineAutomationSegment[] = [];
    const seed = events[0]!;
    const hasLaterEvent = events.length > 1;
    if (compensationDelaySec > 0 && hasLaterEvent && seed.type === 'set' && seed.timeSeconds === 0) {
        segments.push({
            startFrame: 0,
            endFrame: toFrame(seed.timeSeconds + compensationDelaySec, durationSeconds, sampleRate),
            startValue: seed.value,
            endValue: seed.value,
        });
    }

    for (let index = 1; index < events.length; index++) {
        const previous = events[index - 1]!;
        const event = events[index]!;
        segments.push({
            startFrame: toFrame(previous.timeSeconds + compensationDelaySec, durationSeconds, sampleRate),
            endFrame: toFrame(event.timeSeconds + compensationDelaySec, durationSeconds, sampleRate),
            startValue: previous.value,
            endValue: event.type === 'linear' ? event.value : previous.value,
        });
    }
    const last = events.at(-1)!;
    const shiftLast = hasLaterEvent || last.timeSeconds > 0;
    const lastFrame = toFrame(
        shiftLast ? last.timeSeconds + compensationDelaySec : last.timeSeconds,
        durationSeconds,
        sampleRate
    );
    segments.push({ startFrame: lastFrame, endFrame: lastFrame, startValue: last.value, endValue: last.value });
    return segments;
}
