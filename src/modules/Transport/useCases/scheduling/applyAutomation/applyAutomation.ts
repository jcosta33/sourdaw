import { automationStore } from '#/modules/Automation/stores';
import { getAutomationValueAtBeat, isRecordingAutomation } from '#/modules/Automation/useCases';
import { trackStore } from '#/modules/Arrangement/stores';

import {
    setTrackGain as engineSetTrackGain,
    setTrackPan as engineSetTrackPan,
    updateDeviceParam,
} from '#/modules/AudioEngine/useCases';

/**
 * Per-parameter exponential slew state for plugin automation.
 *
 * Gain/pan already use Web Audio `setTargetAtTime` and are not slewed here.
 * For Rust/WASM plugin params, the raw `postMessage` path has no audio-thread
 * smoothing, so we apply a single-pole IIR on the main thread before dispatch.
 * This eliminates zipper-noise stepping artefacts and reduces redundant
 * `postMessage` calls when the automation curve is flat.
 *
 * Alpha = 0.4 → ~95% of target reached in ~9 scheduler ticks (~90ms at 100Hz).
 *
 * Keyed as `lane.id -> device.id -> smoothed` to avoid per-tick template
 * literal string allocation (see audit §155.3).
 */
const SLEW_ALPHA = 0.4;
/** Skip dispatch when the smoothed value has moved less than this per tick. */
const SLEW_EPSILON = 5e-5;

/**
 * §155.1 — Coalesce the per-plugin slew map and the scratch track index
 * into a single holder so HMR reloads drop a live reference together
 * (previous bare module-level Maps were independent roots). The scratch
 * track index is rebuilt in place every tick; the slew map persists
 * across ticks and is keyed as lane.id → device.id → smoothed (§155.3).
 */
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

    // Rebuild the track index in place to avoid the O(lanes × tracks)
    // `tracks.find()` scan per tick (§155.2).
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
            engineSetTrackGain(lane.trackId, value);
        } else if (lane.parameterId === 'pan') {
            engineSetTrackPan(lane.trackId, value * 100 - 50);
        } else {
            let laneSlew = automationState.pluginParamSlew.get(lane.id);
            if (!laneSlew) {
                laneSlew = new Map<string, number>();
                automationState.pluginParamSlew.set(lane.id, laneSlew);
            }
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
        }
    }
}