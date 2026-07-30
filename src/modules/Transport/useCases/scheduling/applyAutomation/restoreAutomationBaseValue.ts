import { resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';
import {
    clampDeviceParameterValue,
    getEffectiveGain,
    isDeviceParameterAutomatable,
} from '#/modules/Arrangement/useCases';
import {
    scheduleTrackGain,
    scheduleTrackPan,
    updateDeviceParam,
    updateMidiFxParam,
} from '#/modules/AudioEngine/useCases';
import { applyFermenterRuntimeParam } from '#/modules/Fermenter/useCases';
import {
    getDeviceAutomationParameterId,
    resolveDeviceAutomationTargetIndex,
    UNRESOLVED_DEVICE_AUTOMATION_TARGET,
} from '#/utils/automationDeviceTarget';

type RestoreTargetDevice = { id: string; type: string; parameterValues: Record<string, number> };

type RestoreTargetTrack = {
    gain: number;
    pan: number;
    devices: RestoreTargetDevice[];
    midiFx: { id: string; type: string; parameterValues: Record<string, number> }[];
};

export type RestoreAutomationBaseValueInput = {
    lane: { trackId: string; parameterId: string };
    track: RestoreTargetTrack;
    /** Engine time the value should land at — `now + the track's compensation`. */
    landTime: number;
};

/** Same acceptance law as the apply path: a lane that may not drive it may not restore it either. */
function deviceAcceptsAutomationParameter(
    device: { type: string; parameterValues: Record<string, number> },
    id: string
): boolean {
    if (device.parameterValues[id] === undefined) {
        return false;
    }

    return isDeviceParameterAutomatable({ deviceType: device.type, paramId: id });
}

/**
 * Write a lane's target parameter back to its manual (persisted) value.
 *
 * Called once, on the tick a lane stops driving because the track's
 * `automationMode` went to `'off'` or the lane was disabled. Skipping a lane
 * only stops *writing* it; the engine keeps whatever the ride last pushed, so
 * switching a mid-ride lane to 'off' used to strand the parameter wherever the
 * automation left it. Standard 'off' semantics play the static value, which is
 * what this restores.
 *
 * The base is read from the same project truth the UI edits: `track.gain` /
 * `track.pan` for the fader families, and the device's or MIDI-FX's own
 * `parameterValues` entry for everything else. Device eligibility is re-checked
 * exactly as the drive path checks it, so a restore never writes to a device
 * another track owns.
 *
 * gain/pan land as a-rate ramps (`scheduleTrackGain`/`scheduleTrackPan`), so
 * those restores are smooth. Device and MIDI-FX parameters reach their DSP by
 * worklet message and step to the base in one tick — 'off' is a discrete state
 * change, not a glide, and the AutoMatch ramp is the touch-release path.
 */
export function restoreAutomationBaseValue({ lane, track, landTime }: RestoreAutomationBaseValueInput): void {
    if (lane.parameterId === 'gain') {
        // Compose the VCA multiplier exactly as the drive path does, so the
        // restored fader matches what the fader alone would produce.
        scheduleTrackGain(lane.trackId, getEffectiveGain(lane.trackId, track.gain), landTime);
        return;
    }

    if (lane.parameterId === 'pan') {
        // track.pan is already the canonical −50..50 the engine accepts.
        scheduleTrackPan(lane.trackId, track.pan, landTime);
        return;
    }

    const deviceIndex = resolveDeviceAutomationTargetIndex(
        lane.parameterId,
        track.devices,
        deviceAcceptsAutomationParameter
    );

    if (deviceIndex >= 0) {
        const device = track.devices[deviceIndex]!;
        const paramId = getDeviceAutomationParameterId(lane.parameterId);
        if (!paramId) {
            return;
        }
        const targetOwner = resolveEligibleDeviceWriteTarget(device.id);
        if (targetOwner.status !== 'eligible' || targetOwner.trackId !== lane.trackId) {
            return;
        }
        const baseValue = device.parameterValues[paramId];
        if (baseValue === undefined) {
            return;
        }
        if (device.type === 'fermenter') {
            const boundedBaseValue = clampDeviceParameterValue({
                deviceType: device.type,
                paramId,
                value: baseValue,
            });
            applyFermenterRuntimeParam({
                trackId: targetOwner.trackId,
                deviceId: targetOwner.deviceId,
                paramId,
                value: boundedBaseValue,
            });
            return;
        }
        updateDeviceParam(targetOwner.trackId, targetOwner.deviceId, paramId, baseValue);
        return;
    }

    if (deviceIndex === UNRESOLVED_DEVICE_AUTOMATION_TARGET) {
        return;
    }

    for (const fx of track.midiFx) {
        const baseValue = fx.parameterValues[lane.parameterId];
        if (baseValue === undefined) {
            continue;
        }

        // Same acceptance law as the MIDI-FX apply branch: a lane that may not
        // drive the parameter may not restore it either.
        if (isDeviceParameterAutomatable({ deviceType: fx.type, paramId: lane.parameterId })) {
            updateMidiFxParam(lane.trackId, fx.id, lane.parameterId, baseValue);
        }
        return;
    }
}
