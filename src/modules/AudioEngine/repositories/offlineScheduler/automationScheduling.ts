import { getDeviceAutomationParameterId, resolveDeviceAutomationTargetIndex } from '#/utils/automationDeviceTarget';

import { type AutomationLane } from '../../models/AutomationViewTypes';
import { resolveDeviceParamTargets } from '../../services/deviceResolution';
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

function acceptsOfflineAutomationParameter(
    candidate: ScheduleTrackAutomationDeviceEntry,
    parameterId: string
): boolean {
    return resolveDeviceParamTargets(candidate.deviceType, parameterId, candidate.node).length > 0;
}

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

        const deviceIndex = resolveDeviceAutomationTargetIndex(
            lane.parameterId,
            deviceEntries,
            acceptsOfflineAutomationParameter
        );
        const parameterId = getDeviceAutomationParameterId(lane.parameterId);
        if (deviceIndex >= 0 && parameterId) {
            const candidate = deviceEntries[deviceIndex]!;
            const targets = resolveDeviceParamTargets(candidate.deviceType, parameterId, candidate.node);
            for (const { audioParam, scale, offset } of targets) {
                const points =
                    scale !== 1 || offset !== 0
                        ? lane.points.map((point) => ({ ...point, value: point.value * scale + offset }))
                        : lane.points;
                scheduleAutomationOnParam(audioParam, points, durationSeconds, defaultTempo, changes);
            }
        }
    }
}
