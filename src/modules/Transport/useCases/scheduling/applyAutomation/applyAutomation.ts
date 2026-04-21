import { trackStore } from '#/modules/Arrangement/stores';
import {
    setTrackGain as engineSetTrackGain,
    setTrackPan as engineSetTrackPan,
    updateDeviceParam,
    updateMidiFxParam,
} from '#/modules/AudioEngine/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { getAutomationValueAtBeat, isRecordingAutomation } from '#/modules/Automation/useCases';

/**
 * Per-parameter exponential slew state for plugin automation.
 * Alpha = 0.4 → ~95% of target reached in ~9 scheduler ticks (~90ms at 100Hz).
 */
const SLEW_ALPHA = 0.4;
/** Skip dispatch when the smoothed value has moved less than this per tick. */
const SLEW_EPSILON = 5e-5;

const automationState: {
    pluginParamSlew: Map<string, Map<string, number>>;
    trackIndex: Map<string, NonNullable<typeof trackStore.value>['tracks'][number]>;
} = {
    pluginParamSlew: new Map<string, Map<string, number>>(),
    trackIndex: new Map<string, NonNullable<typeof trackStore.value>['tracks'][number]>(),
};

export function applyAutomation(currentBeat: number): void {
    const autoState = automationStore.value;
    if (!autoState) {
        return;
    }

    const tracks = trackStore.value?.tracks;

    automationState.trackIndex.clear();
    if (tracks) {
        for (const t of tracks) {
            automationState.trackIndex.set(t.id, t);
        }
    }

    for (const lane of autoState.lanes) {
        if (lane.points.length === 0) {
            continue;
        }

        const track = automationState.trackIndex.get(lane.trackId);
        if (!track || track.automationMode === 'off') {
            continue;
        }

        if (lane.clipId) {
            const clip = track.clips.find((c) => c.id === lane.clipId);
            if (!clip || currentBeat < clip.startBeat || currentBeat > clip.endBeat) {
                continue;
            }
        }

        if (isRecordingAutomation(lane.trackId, lane.parameterId)) {
            continue;
        }

        const value = getAutomationValueAtBeat(lane.id, currentBeat);
        if (value === null) {
            continue;
        }

        if (lane.parameterId === 'gain') {
            const linearGain = lane.minValue < 0 ? 10 ** (value / 20) : value;
            engineSetTrackGain(lane.trackId, linearGain);
        } else if (lane.parameterId === 'pan') {
            engineSetTrackPan(lane.trackId, value * 100 - 50);
        } else {
            let laneSlew = automationState.pluginParamSlew.get(lane.id);
            if (!laneSlew) {
                laneSlew = new Map<string, number>();
                automationState.pluginParamSlew.set(lane.id, laneSlew);
            }

            // Audio Device Automation
            for (const device of track.devices) {
                if (device.parameterValues[lane.parameterId] !== undefined) {
                    const prev = laneSlew.get(device.id) ?? value;
                    const smoothed = prev + (value - prev) * SLEW_ALPHA;
                    laneSlew.set(device.id, smoothed);
                    if (Math.abs(smoothed - prev) > SLEW_EPSILON) {
                        updateDeviceParam(lane.trackId, device.id, lane.parameterId, smoothed);
                    }
                    break;
                }
            }

            // MIDI FX Automation
            for (const fx of track.midiFx) {
                if (fx.parameterValues[lane.parameterId] !== undefined) {
                    const prev = laneSlew.get(fx.id) ?? value;
                    const smoothed = prev + (value - prev) * SLEW_ALPHA;
                    laneSlew.set(fx.id, smoothed);
                    if (Math.abs(smoothed - prev) > SLEW_EPSILON) {
                        updateMidiFxParam(lane.trackId, fx.id, lane.parameterId, smoothed);
                    }
                    break;
                }
            }
        }
    }
}
