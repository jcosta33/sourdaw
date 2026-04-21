import { type TempoChange } from '#/modules/Transport/useCases/transportQueries/helpers';

import { type AutomationLane, type AutomationPoint } from '../../models/AutomationViewTypes';
import { beatToSeconds } from '../../services/beatConversion';
import { resolveDeviceParam, resolveDeviceParamScale } from '../../services/deviceResolution';
import { type DeviceNodeEntry } from '../../useCases/buildDeviceChain';

function interpolateValue(p1: AutomationPoint, p2: AutomationPoint, beat: number): number {
    if (p2.beat === p1.beat) {
        return p1.value;
    }
    if (p1.curve === 'step') {
        return p1.value;
    }
    const time = (beat - p1.beat) / (p2.beat - p1.beat);
    if (p1.curve === 'exponential') {
        return p1.value + (p2.value - p1.value) * time * time;
    }
    return p1.value + (p2.value - p1.value) * time;
}

const AUTOMATION_SAMPLE_INTERVAL_SEC = 0.01;

export function scheduleAutomationOnParam(
    param: AudioParam,
    points: AutomationPoint[],
    durationSeconds: number,
    defaultTempo: number,
    changes: TempoChange[]
): void {
    if (points.length === 0) {
        return;
    }

    const sorted = [...points].sort((alpha, b) => alpha.beat - b.beat);

    param.setValueAtTime(sorted[0]!.value, 0);

    for (let index = 0; index < sorted.length; index++) {
        const current = sorted[index]!;
        const next = sorted[index + 1];
        const currentTime = beatToSeconds(current.beat, defaultTempo, changes);

        if (currentTime > durationSeconds) {
            break;
        }

        param.setValueAtTime(current.value, Math.max(0, currentTime));

        if (!next) {
            break;
        }

        const nextTime = beatToSeconds(next.beat, defaultTempo, changes);

        if (current.curve === 'step') {
            param.setValueAtTime(current.value, Math.max(0, nextTime - 0.0001));
        } else if (current.curve === 'linear') {
            param.linearRampToValueAtTime(next.value, Math.min(nextTime, durationSeconds));
        } else {
            const steps = Math.max(2, Math.ceil((nextTime - currentTime) / AUTOMATION_SAMPLE_INTERVAL_SEC));
            for (let state = 1; state <= steps; state++) {
                const fraction = state / steps;
                const sampleBeat = current.beat + (next.beat - current.beat) * fraction;
                const sampleTime = beatToSeconds(sampleBeat, defaultTempo, changes);
                if (sampleTime > durationSeconds) {
                    break;
                }
                const value = interpolateValue(current, next, sampleBeat);
                param.linearRampToValueAtTime(value, sampleTime);
            }
        }
    }
}

export function scheduleTrackAutomation(
    lanes: AutomationLane[],
    trackId: string,
    trackGainNode: GainNode,
    trackPanNode: StereoPannerNode,
    deviceEntries: DeviceNodeEntry[],
    durationSeconds: number,
    defaultTempo: number,
    changes: TempoChange[]
): void {
    const trackLanes = lanes.filter((length) => length.trackId === trackId && !length.clipId);

    for (const lane of trackLanes) {
        if (lane.points.length === 0) {
            continue;
        }

        if (lane.parameterId === 'gain') {
            scheduleAutomationOnParam(trackGainNode.gain, lane.points, durationSeconds, defaultTempo, changes);
            continue;
        }

        if (lane.parameterId === 'pan') {
            scheduleAutomationOnParam(trackPanNode.pan, lane.points, durationSeconds, defaultTempo, changes);
            continue;
        }

        const deviceEntry = deviceEntries.find((event) => {
            const prefix = `${event.deviceId}:`;
            return lane.parameterId.startsWith(prefix);
        });
        if (deviceEntry) {
            const paramKey = lane.parameterId.slice(lane.parameterId.indexOf(':') + 1);
            const audioParam = resolveDeviceParam(deviceEntry.deviceType, paramKey, deviceEntry.node);
            if (audioParam) {
                const scale = resolveDeviceParamScale(deviceEntry.deviceType, paramKey);
                const points =
                    scale !== 1 ? lane.points.map((param) => ({ ...param, value: param.value * scale })) : lane.points;
                scheduleAutomationOnParam(audioParam, points, durationSeconds, defaultTempo, changes);
            }
            continue;
        }

        const directEntry = deviceEntries.find((event) => {
            return resolveDeviceParam(event.deviceType, lane.parameterId, event.node) !== null;
        });
        if (directEntry) {
            const audioParam = resolveDeviceParam(directEntry.deviceType, lane.parameterId, directEntry.node);
            if (audioParam) {
                const scale = resolveDeviceParamScale(directEntry.deviceType, lane.parameterId);
                const points =
                    scale !== 1 ? lane.points.map((param) => ({ ...param, value: param.value * scale })) : lane.points;
                scheduleAutomationOnParam(audioParam, points, durationSeconds, defaultTempo, changes);
            }
        }
    }
}
