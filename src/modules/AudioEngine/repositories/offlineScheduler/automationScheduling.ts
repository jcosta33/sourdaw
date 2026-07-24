import { getDeviceAutomationParameterId, resolveDeviceAutomationTargetIndex } from '#/utils/automationDeviceTarget';
import { resolveLinkedLane } from '#/utils/automationLaneLink';
import { AUTOMATION_SLEW_ALPHA, AUTOMATION_SLEW_TICK_SECONDS } from '#/utils/automationSlew';

import { type AutomationLane } from '../../models/AutomationViewTypes';
import { beatToSeconds } from '../../services/beatConversion';
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
    compensationDelaySec = 0,
    clipBoundsById?: Map<string, { startBeat: number; endBeat: number }>
): void {
    const projectBeat = projectBeatToSeconds ?? ((beat) => beatToSeconds(beat, defaultTempo, changes));
    const laneById = new Map<string, AutomationLane>();
    for (const lane of lanes) {
        laneById.set(lane.id, lane);
    }
    // AU-2: device/MIDI-FX params carry the live control slew; gain/pan do not.
    const deviceSlew = { alpha: AUTOMATION_SLEW_ALPHA, tickSeconds: AUTOMATION_SLEW_TICK_SECONDS };

    // AU-12: track-level lanes (no clipId) AND clip-scoped lanes both render; a
    // clip lane emits only within its clip span (activeWindowSeconds below).
    const trackLanes = lanes.filter((lane) => lane.trackId === trackId);

    for (const lane of trackLanes) {
        let activeWindowSeconds: { startSeconds: number; endSeconds: number } | undefined;
        if (lane.clipId) {
            const bounds = clipBoundsById?.get(lane.clipId);
            if (!bounds) {
                continue;
            }
            activeWindowSeconds = {
                startSeconds: projectBeat(bounds.startBeat),
                endSeconds: projectBeat(bounds.endBeat),
            };
        }

        // AU-3: follow linked lanes to the authoritative source (cycle-guarded,
        // linkScale accumulated) exactly as the live path does — offline
        // previously read raw `lane.points` and rendered a link-only lane silent.
        // The target (gain/pan/device) stays this lane's; values come from the
        // resolved source.
        const resolved = resolveLinkedLane(lane.id, (id) => laneById.get(id));
        if (!resolved) {
            continue;
        }
        const sourceLane = laneById.get(resolved.sourceLaneId);
        if (!sourceLane || sourceLane.points.length === 0) {
            continue;
        }
        const points =
            resolved.scale === 1
                ? sourceLane.points
                : sourceLane.points.map((point) => ({ ...point, value: point.value * resolved.scale }));

        const windowOptions = activeWindowSeconds ? { activeWindowSeconds } : undefined;

        if (lane.parameterId === 'gain') {
            scheduleAutomationOnParam(
                trackGainNode.gain,
                points,
                durationSeconds,
                defaultTempo,
                changes,
                regionStartSeconds,
                projectBeatToSeconds,
                compensationDelaySec,
                windowOptions
            );
            continue;
        }

        if (lane.parameterId === 'pan') {
            scheduleAutomationOnParam(
                trackPanNode.pan,
                points,
                durationSeconds,
                defaultTempo,
                changes,
                regionStartSeconds,
                projectBeatToSeconds,
                compensationDelaySec,
                windowOptions
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
            const deviceOptions = { slew: deviceSlew, activeWindowSeconds };
            if (binding.kind === 'segments') {
                const segments = compileAutomationSegments(
                    points,
                    durationSeconds,
                    defaultTempo,
                    changes,
                    sampleRate,
                    regionStartSeconds,
                    projectBeatToSeconds,
                    deviceOptions
                );
                binding.apply(segments);
                continue;
            }
            for (const { audioParam, scale, offset } of binding.targets) {
                const targetPoints =
                    scale !== 1 || offset !== 0
                        ? points.map((point) => ({ ...point, value: point.value * scale + offset }))
                        : points;
                scheduleAutomationOnParam(
                    audioParam,
                    targetPoints,
                    durationSeconds,
                    defaultTempo,
                    changes,
                    regionStartSeconds,
                    projectBeatToSeconds,
                    compensationDelaySec,
                    deviceOptions
                );
            }
        }
    }
}
