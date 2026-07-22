import { type AutomationLane } from '../../models/AutomationViewTypes';
import { resolveDeviceParam, resolveDeviceParamScale } from '../../services/deviceResolution';
import { type OfflineDeviceNode } from '../devices/types';

import { scheduleAutomationOnParam } from './scheduleAutomationOnParam';

type AutomationTempoChange = {
    beat: number;
    tempo: number;
};

type ScheduleTrackAutomationDeviceEntry = {
    deviceId: string;
    deviceType: string;
    node: OfflineDeviceNode;
};

export function scheduleTrackAutomation(
    lanes: AutomationLane[],
    trackId: string,
    trackGainNode: GainNode,
    trackPanNode: StereoPannerNode,
    deviceEntries: ScheduleTrackAutomationDeviceEntry[],
    durationSeconds: number,
    defaultTempo: number,
    changes: AutomationTempoChange[]
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
