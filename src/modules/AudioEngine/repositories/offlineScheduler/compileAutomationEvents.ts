import { type AutomationPoint } from '../../models/AutomationViewTypes';
import { beatToSeconds } from '../../services/beatConversion';

type AutomationTempoChange = {
    beat: number;
    tempo: number;
};

export type CompiledAutomationEvent = {
    type: 'set' | 'linear';
    timeSeconds: number;
    value: number;
};

const AUTOMATION_SAMPLE_INTERVAL_SEC = 0.01;

function interpolateValue(
    first: AutomationPoint,
    second: AutomationPoint,
    time: number,
    firstTime: number,
    secondTime: number
): number {
    if (first.curve === 'step' || secondTime <= firstTime) {
        return first.value;
    }
    const fraction = Math.min(1, Math.max(0, (time - firstTime) / (secondTime - firstTime)));
    const shapedFraction = first.curve === 'exponential' ? fraction * fraction : fraction;
    return first.value + (second.value - first.value) * shapedFraction;
}

function appendEvent(events: CompiledAutomationEvent[], event: CompiledAutomationEvent): void {
    const previous = events.at(-1);
    if (previous?.type === event.type && previous.timeSeconds === event.timeSeconds && previous.value === event.value) {
        return;
    }
    events.push(event);
}

export function compileAutomationEvents(
    points: AutomationPoint[],
    durationSeconds: number,
    defaultTempo: number,
    changes: AutomationTempoChange[],
    regionStartSeconds = 0
): CompiledAutomationEvent[] {
    if (points.length === 0 || durationSeconds < 0) {
        return [];
    }

    const timed = [...points]
        .sort((alpha, beta) => alpha.beat - beta.beat)
        .map((point) => ({ point, time: beatToSeconds(point.beat, defaultTempo, changes) }));
    const regionEndSeconds = regionStartSeconds + durationSeconds;
    let initialValue = timed[0]!.point.value;

    for (let index = 0; index < timed.length - 1; index++) {
        const current = timed[index]!;
        const next = timed[index + 1]!;
        if (regionStartSeconds >= next.time) {
            initialValue = next.point.value;
            continue;
        }
        if (regionStartSeconds >= current.time) {
            initialValue = interpolateValue(current.point, next.point, regionStartSeconds, current.time, next.time);
        }
        break;
    }

    const events: CompiledAutomationEvent[] = [{ type: 'set', timeSeconds: 0, value: initialValue }];
    for (let index = 0; index < timed.length - 1; index++) {
        const current = timed[index]!;
        const next = timed[index + 1]!;
        if (next.time < regionStartSeconds) {
            continue;
        }
        if (current.time > regionEndSeconds) {
            break;
        }

        const visibleStart = Math.max(current.time, regionStartSeconds);
        const visibleEnd = Math.min(next.time, regionEndSeconds);
        if (visibleEnd < visibleStart) {
            continue;
        }
        const relativeStart = visibleStart - regionStartSeconds;
        const startValue = interpolateValue(current.point, next.point, visibleStart, current.time, next.time);
        appendEvent(events, { type: 'set', timeSeconds: relativeStart, value: startValue });

        if (current.point.curve === 'step') {
            if (next.time <= regionEndSeconds) {
                appendEvent(events, {
                    type: 'set',
                    timeSeconds: next.time - regionStartSeconds,
                    value: next.point.value,
                });
            }
            continue;
        }

        const steps =
            current.point.curve === 'exponential'
                ? Math.max(1, Math.ceil((visibleEnd - visibleStart) / AUTOMATION_SAMPLE_INTERVAL_SEC))
                : 1;
        for (let step = 1; step <= steps; step++) {
            const time = visibleStart + ((visibleEnd - visibleStart) * step) / steps;
            appendEvent(events, {
                type: 'linear',
                timeSeconds: time - regionStartSeconds,
                value: interpolateValue(current.point, next.point, time, current.time, next.time),
            });
        }
    }
    return events;
}
