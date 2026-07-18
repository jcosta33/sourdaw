/**
 * Load preset devices into a track.
 */

import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { addDeviceToStrip, updateDeviceParam, removeDeviceFromStrip } from '#/modules/AudioEngine/useCases';
import { compileFaustDSP } from '#/modules/PluginHost/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { type SoundPreset, type DevicePreset } from '../../models/SoundPreset';
import { getTrackById } from '../../repositories/track/getTrackById';
import { updateTrack } from '../../repositories/track/updateTrack';
import { type Device } from '../../stores/trackStore';
import { addDevice } from '../device/addDevice';
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
    const added = addDevice(trackId, dp.name);
    if (!added) {
        return;
    }
    for (const [paramId, value] of Object.entries(dp.parameterValues)) {
        setDeviceParameter(added.id, paramId, value);
        updateDeviceParam(trackId, added.id, paramId, value);
    }
}

export const loadPresetToTrack = inject({ logger })(({ logger }) => {
    function attachInstrumentDevice(trackId: string, dp: DevicePreset): void {
        const device: Device = {
            id: `preset-dev-${crypto.randomUUID()}`,
            name: dp.name,
            type: dp.type,
            bypassed: false,
            parameterValues: { ...dp.parameterValues },
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

        for (const [paramId, value] of Object.entries(dp.parameterValues)) {
            updateDeviceParam(trackId, device.id, paramId, value);
        }
    }

    return function loadPresetToTrack(trackId: string, preset: SoundPreset): void {
        const track = getTrackById(trackId);
        if (track) {
            const deviceIds = track.devices.map((data) => data.id);
            for (const deviceId of deviceIds) {
                removeDeviceFromStrip(trackId, deviceId);
            }
            updateTrack(trackId, (time) => ({ ...time, devices: [] }));
        }

        for (const dp of preset.devices) {
            if (isInstrumentDevice(dp.type)) {
                attachInstrumentDevice(trackId, dp);
            } else {
                attachEffectDevice(trackId, dp);
            }
        }
    };
});
