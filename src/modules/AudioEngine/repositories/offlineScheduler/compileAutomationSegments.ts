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

    const segments: OfflineAutomationSegment[] = [];
    for (let index = 1; index < events.length; index++) {
        const previous = events[index - 1]!;
        const event = events[index]!;
        segments.push({
            startFrame: toFrame(previous.timeSeconds, durationSeconds, sampleRate),
            endFrame: toFrame(event.timeSeconds, durationSeconds, sampleRate),
            startValue: previous.value,
            endValue: event.type === 'linear' ? event.value : previous.value,
        });
    }
    const last = events.at(-1)!;
    const lastFrame = toFrame(last.timeSeconds, durationSeconds, sampleRate);
    segments.push({ startFrame: lastFrame, endFrame: lastFrame, startValue: last.value, endValue: last.value });
    return segments;
}
