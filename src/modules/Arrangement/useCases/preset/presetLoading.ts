/**
 * Load preset devices into a track.
 */

import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { addDeviceToStrip, updateDeviceParam, removeDeviceFromStrip } from '#/modules/AudioEngine/useCases';
import { compileFaustDSP } from '#/modules/PluginHost/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { clampDeviceParameterValue, isInternalDeviceParameter } from '../../models/DeviceParameterLaw';
import { type SoundPreset, type DevicePreset } from '../../models/SoundPreset';
import { getTrackById } from '../../repositories/track/getTrackById';
import { updateTrack } from '../../repositories/track/updateTrack';
import { getTrackEligibility } from '../../stores/trackEligibility';
import { type Device } from '../../stores/trackStore';
import { writeDeviceToProject } from '../device/addDevice';
import { setDeviceParameter } from '../device/setDeviceParameter/setDeviceParameter';

const INSTRUMENT_TYPES = new Set([
    'synth',
    'builtin-synth',
    'drum-kit',
    'builtin-drum-kit',
    'builtin-drum-machine',
    'fermenter',
    'toaster',
]);

function isInstrumentDevice(type: string): boolean {
    return INSTRUMENT_TYPES.has(type) || type.startsWith('faust-');
}

function attachEffectDevice(trackId: string, dp: DevicePreset): void {
    // `dp.type`, never `dp.name`. `addDevice` resolves by name *or* id and, on
    // a miss, stores the string it was handed as the device type. Factory
    // presets label their effects — `comp('Drum Comp', …)` is
    // `type: 'builtin-compressor'` under a name no catalog plugin carries — so
    // passing the label minted a device typed `Drum Comp`, which no descriptor
    // matches. `TrackNode.addDevice` then bails on it, meaning the effect was
    // silent in playback as well as absent from a render.
    // `attachInstrumentDevice` below already used `dp.type`; this is the same
    // rule, applied on the branch that had drifted from it.
    //
    // The label goes in the same call. Resolving by type otherwise costs it:
    // `addDevice` names what it placed after the catalog plugin it matched, so
    // `Drum Comp` would come back as `Compressor`. `device.name` is what the
    // device chain, the inspector, the automation lane and the modulation
    // matrix render, and it is the preset's to choose — `attachInstrumentDevice`
    // keeps `dp.name` for the same reason. Passing it here keeps the device to
    // a single write instead of adding then renaming.
    const internalParameterValues = Object.fromEntries(
        Object.entries(dp.parameterValues).filter(([paramId]) =>
            isInternalDeviceParameter({ deviceType: dp.type, paramId })
        )
    );
    const added = writeDeviceToProject(trackId, dp.type, dp.name, undefined, undefined, internalParameterValues);
    if (!added) {
        return;
    }

    for (const [paramId, value] of Object.entries(dp.parameterValues)) {
        if (isInternalDeviceParameter({ deviceType: dp.type, paramId })) {
            continue;
        }
        // `setDeviceParameter` already clamps and pushes the clamped value to
        // the engine. The raw `updateDeviceParam` that used to follow it here
        // wrote second and therefore won, handing the DSP the unclamped value
        // the store had just refused.
        setDeviceParameter(added.id, paramId, value);
    }
}

export const loadPresetToTrack = inject({ logger })(({ logger }) => {
    function attachInstrumentDevice(trackId: string, dp: DevicePreset): void {
        // An instrument preset is written straight into the track rather than
        // through `setDeviceParameter`, so nothing upstream has held it to the
        // descriptor. Clamp while the device type is still in hand: without it
        // a preset authored against a wider range lands out of bounds in the
        // store, and the store row is what the project saves and reloads.
        const parameterValues: Record<string, number> = {};
        for (const [paramId, value] of Object.entries(dp.parameterValues)) {
            parameterValues[paramId] = clampDeviceParameterValue({ deviceType: dp.type, paramId, value });
        }

        const device: Device = {
            id: `preset-dev-${crypto.randomUUID()}`,
            name: dp.name,
            type: dp.type,
            bypassed: false,
            parameterValues,
        };
        updateTrack(trackId, (time) => ({ ...time, devices: [...time.devices, device] }));

        if (dp.type.startsWith('faust-')) {
            Promise.resolve()
                .then(() => compileFaustDSP(dp.type))
                .catch((error) => {
                    logger.error(new Error(`Faust compilation failed for ${dp.type}`, { cause: error }));
                    notifyUser(`Failed to compile Faust device: ${dp.name}`, 'error');
                });
        }
        addDeviceToStrip(trackId, device.id, dp.type);

        for (const [paramId, value] of Object.entries(device.parameterValues)) {
            updateDeviceParam(trackId, device.id, paramId, value);
        }
    }

    return function loadPresetToTrack(trackId: string, preset: SoundPreset): boolean {
        const track = getTrackById(trackId);
        if (!track || !getTrackEligibility(track.kind).acceptsDeviceUpdate) {
            return false;
        }

        const deviceIds = track.devices.map((device) => device.id);
        for (const deviceId of deviceIds) {
            removeDeviceFromStrip(trackId, deviceId);
        }
        updateTrack(trackId, (currentTrack) => ({ ...currentTrack, devices: [] }));

        for (const dp of preset.devices) {
            if (isInstrumentDevice(dp.type)) {
                attachInstrumentDevice(trackId, dp);
            } else {
                attachEffectDevice(trackId, dp);
            }
        }

        return true;
    };
});
