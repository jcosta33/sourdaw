import { getTrackEligibility, resolveEligibleDeviceWriteTarget, trackStore } from '#/modules/Arrangement/stores';
import {
    setTrackGain as engineSetTrackGain,
    setTrackPan as engineSetTrackPan,
    updateDeviceParam,
    updateMidiFxParam,
} from '#/modules/AudioEngine/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { getAutomationValueAtBeat, isRecordingAutomation } from '#/modules/Automation/useCases';
import { setFermenterMappedParam } from '#/modules/Fermenter/useCases';

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
        for (const time of tracks) {
            automationState.trackIndex.set(time.id, time);
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
            const clip = track.clips.find((context) => context.id === lane.clipId);
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

            // Audio Device Automation
            //
            // Device-param lanes carry a `${device.type}:${paramId}` parameterId
            // (built in TimelineEditor/presentations/helpers/automationViewHelpers.ts),
            // but `device.parameterValues` is keyed by the bare paramId
            // (Arrangement/useCases/device/addDevice.ts). Strip the device-type
            // prefix before matching/forwarding, otherwise every device-param
            // lane no-ops.
            for (const device of track.devices) {
                const prefix = `${device.type}:`;
                let paramId = lane.parameterId;
                if (lane.parameterId.startsWith(prefix)) {
                    paramId = lane.parameterId.slice(prefix.length);
                }
                if (device.parameterValues[paramId] === undefined) {
                    continue;
                }
                const targetOwner = resolveEligibleDeviceWriteTarget(device.id);
                if (targetOwner.status !== 'eligible' || targetOwner.trackId !== lane.trackId) {
                    continue;
                }
                if (!laneSlew) {
                    laneSlew = new Map<string, number>();
                    automationState.pluginParamSlew.set(lane.id, laneSlew);
                }

                const prev = laneSlew.get(device.id) ?? value;
                const smoothed = prev + (value - prev) * SLEW_ALPHA;
                laneSlew.set(device.id, smoothed);
                if (Math.abs(smoothed - prev) > SLEW_EPSILON) {
                    if (device.type === 'fermenter') {
                        // Fermenter params use camelCase ids that must be mapped to
                        // their snake_case DSP ids before reaching the WASM node —
                        // the same translation the UI bridge applies. Route through
                        // the public mapped use-case so automation and the UI share
                        // one mapping path instead of hitting Rust's silent no-op arm.
                        setFermenterMappedParam({ deviceId: device.id, paramId, value: smoothed });
                    } else {
                        updateDeviceParam(targetOwner.trackId, targetOwner.deviceId, paramId, smoothed);
                    }
                }
                break;
            }

            // MIDI FX Automation
            if (!getTrackEligibility(track.kind).acceptsDeviceUpdate) {
                continue;
            }
            for (const fx of track.midiFx) {
                if (fx.parameterValues[lane.parameterId] !== undefined) {
                    if (!laneSlew) {
                        laneSlew = new Map<string, number>();
                        automationState.pluginParamSlew.set(lane.id, laneSlew);
                    }
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
