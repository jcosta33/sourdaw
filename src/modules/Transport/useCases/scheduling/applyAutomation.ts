import { automationStore } from '#/modules/Automation/stores';
import { getAutomationValueAtBeat, isRecordingAutomation } from '#/modules/Automation/useCases';
import { getEffectiveGain } from '#/modules/Arrangement/useCases';
import { trackStore } from '#/modules/Arrangement/stores';
import {
    ensureTrackStrip,
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
 */
const _pluginParamSlew = new Map<string, number>();
const SLEW_ALPHA = 0.4;
/** Skip dispatch when the smoothed value has moved less than this per tick. */
const SLEW_EPSILON = 5e-5;

export function applyVcaGains(): void {
    const tracks = trackStore.value?.tracks;
    if (!tracks) {
        return;
    }
    for (const track of tracks) {
        if (!track.vcaGroupId || track.muted) {
            continue;
        }
        const effective = getEffectiveGain(track.id, track.gain);
        engineSetTrackGain(track.id, effective);
    }
}

export function applyAutomation(currentBeat: number): void {
    const autoState = automationStore.value;
    if (!autoState) {
        return;
    }

    const tracks = trackStore.value?.tracks;

    for (const lane of autoState.lanes) {
        if (lane.points.length === 0) {
            continue;
        }

        const track = tracks?.find((t) => t.id === lane.trackId);
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
            for (const device of track.devices) {
                if (device.parameterValues[lane.parameterId] !== undefined) {
                    const slewKey = `${lane.trackId}:${device.id}:${lane.parameterId}`;
                    const prev = _pluginParamSlew.get(slewKey) ?? value;
                    const smoothed = prev + (value - prev) * SLEW_ALPHA;
                    _pluginParamSlew.set(slewKey, smoothed);
                    if (Math.abs(smoothed - prev) > SLEW_EPSILON) {
                        updateDeviceParam(lane.trackId, device.id, lane.parameterId, smoothed);
                    }
                    break;
                }
            }
        }
    }
}

// Re-export to avoid breaking callers that may import from this path
export { ensureTrackStrip };
