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
    // several events all sitting at time zero (the seed `set@0`, plus a
    // `linear@0` or `set@0` from the zero-width visible span) — nothing in the
    // stream ever gets past the region start. Events are time-ordered
    // (`compileAutomationEvents` only ever appends at a non-decreasing
    // `relativeStart`/`timeSeconds`), so the last event's own time answers
    // that question for the whole stream: shifting it (or opening a hold in
    // front of it) has no later material to lead into, and instead turns it
    // into a `[0, D]` span that overlaps whatever lane opens at the region
    // start, which the merge then reads as a genuine clash and withholds a
    // lane over (#4684). A stream whose last event is later than zero — a
    // lone event later in the render included, no different from the tail of
    // a multi-event stream — is shifted throughout, on every segment,
    // including its last event, and gets the opening hold when its seed is a
    // time-zero `set`.
    const segments: OfflineAutomationSegment[] = [];
    const seed = events[0]!;
    const reachesPastStart = events.at(-1)!.timeSeconds > 0;
    const shift = reachesPastStart ? compensationDelaySec : 0;
    if (compensationDelaySec > 0 && reachesPastStart && seed.type === 'set' && seed.timeSeconds === 0) {
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
            startFrame: toFrame(previous.timeSeconds + shift, durationSeconds, sampleRate),
            endFrame: toFrame(event.timeSeconds + shift, durationSeconds, sampleRate),
            startValue: previous.value,
            endValue: event.type === 'linear' ? event.value : previous.value,
        });
    }
    const last = events.at(-1)!;
    const lastFrame = toFrame(last.timeSeconds + shift, durationSeconds, sampleRate);
    segments.push({ startFrame: lastFrame, endFrame: lastFrame, startValue: last.value, endValue: last.value });
    return segments;
}
