import { getDeviceAutomationParameterId, resolveDeviceAutomationTargetIndex } from '#/utils/automationDeviceTarget';

import { type AutomationLane } from '../../models/AutomationViewTypes';
import { type AudioDeviceStrategy } from '../deviceStrategy/AudioDeviceStrategy';

import { compileAutomationSegments } from './compileAutomationSegments';
import { scheduleAutomationOnParam } from './scheduleAutomationOnParam';

type AutomationTempoChange = {
    beat: number;
    tempo: number;
};

type ScheduleTrackAutomationDeviceEntry = {
    deviceId: string;
    deviceType: string;
    strategy: Pick<AudioDeviceStrategy, 'resolveOfflineAutomation'>;
};

function acceptsOfflineAutomationParameter(
    candidate: ScheduleTrackAutomationDeviceEntry,
    parameterId: string
): boolean {
    return candidate.strategy.resolveOfflineAutomation(parameterId) !== null;
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
    regionStartSeconds = 0,
    projectBeatToSeconds?: (beat: number) => number,
    sampleRate = 44_100,
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
                regionStartSeconds,
                projectBeatToSeconds,
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
                regionStartSeconds,
                projectBeatToSeconds,
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
            const binding = candidate.strategy.resolveOfflineAutomation(parameterId);
            if (!binding) {
                continue;
            }
            if (binding.kind === 'segments') {
                const segments = compileAutomationSegments(
                    lane.points,
                    durationSeconds,
                    defaultTempo,
                    changes,
                    sampleRate,
                    regionStartSeconds,
                    projectBeatToSeconds
                );
                binding.apply(segments);
                continue;
            }
            for (const { audioParam, scale, offset } of binding.targets) {
                const points =
                    scale !== 1 || offset !== 0
                        ? lane.points.map((point) => ({ ...point, value: point.value * scale + offset }))
                        : lane.points;
                scheduleAutomationOnParam(
                    audioParam,
                    points,
                    durationSeconds,
                    defaultTempo,
                    changes,
                    regionStartSeconds,
                    projectBeatToSeconds,
                    compensationDelaySec
                );
            }
        }
    }
}
