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
    const segments: OfflineAutomationSegment[] = [];
    const seed = events[0]!;
    if (compensationDelaySec > 0 && seed.type === 'set' && seed.timeSeconds === 0) {
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
    const lastFrame = toFrame(last.timeSeconds + compensationDelaySec, durationSeconds, sampleRate);
    segments.push({ startFrame: lastFrame, endFrame: lastFrame, startValue: last.value, endValue: last.value });
    return segments;
}
