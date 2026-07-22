import { getDeviceAutomationParameterId, resolveDeviceAutomationTargetIndex } from '#/utils/automationDeviceTarget';

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

function acceptsOfflineAutomationParameter(
    candidate: ScheduleTrackAutomationDeviceEntry,
    parameterId: string
): boolean {
    return resolveDeviceParam(candidate.deviceType, parameterId, candidate.node) !== null;
}

export function scheduleTrackAutomation(
    lanes: AutomationLane[],
    trackId: string,
    trackGainNode: GainNode,
    trackPanNode: StereoPannerNode,
    deviceEntries: ScheduleTrackAutomationDeviceEntry[],
    durationSeconds: number,
    defaultTempo: number,
    changes: AutomationTempoChange[],
    regionStartBeat = 0,
    compensationDelaySec = 0
): void {
    const trackLanes = lanes.filter((length) => length.trackId === trackId && !length.clipId);

    for (const lane of trackLanes) {
        if (lane.points.length === 0) {
            continue;
        }

        if (lane.parameterId === 'gain') {
            scheduleAutomationOnParam(
                trackGainNode.gain,
                lane.points,
                durationSeconds,
                defaultTempo,
                changes,
                regionStartBeat,
                compensationDelaySec
            );
            continue;
        }

        if (lane.parameterId === 'pan') {
            scheduleAutomationOnParam(
                trackPanNode.pan,
                lane.points,
                durationSeconds,
                defaultTempo,
                changes,
                regionStartBeat,
                compensationDelaySec
            );
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
            const audioParam = resolveDeviceParam(candidate.deviceType, parameterId, candidate.node);
            if (audioParam) {
                const scale = resolveDeviceParamScale(candidate.deviceType, parameterId);
                const points =
                    scale !== 1 ? lane.points.map((param) => ({ ...param, value: param.value * scale })) : lane.points;
                scheduleAutomationOnParam(
                    audioParam,
                    points,
                    durationSeconds,
                    defaultTempo,
                    changes,
                    regionStartBeat,
                    compensationDelaySec
                );
            }
        }
    }
}
