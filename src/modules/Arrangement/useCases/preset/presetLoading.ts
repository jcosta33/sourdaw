/**
 * Load preset devices into a track.
 */

import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { notifyUser } from '#/helpers/Notification/notifyUser';
import { type SoundPreset, type DevicePreset } from '../../models/SoundPreset';
import { type Device } from '../../models/Track';
import { addTrack } from '../addTrack';
import { addDevice } from '../device/addDevice';
import { setDeviceParameter } from '../device/setDeviceParameter';
import { updateTrack } from '../../repositories/track/updateTrack';
import { getTrackById } from '../../repositories/track/getTrackById';
import { addDeviceToStrip, updateDeviceParam, removeDeviceFromStrip } from '#/modules/AudioEngine/useCases/deviceControls';

const logger = Container.getInstance().get(Logger);

let nextPresetDeviceId = 1;

const INSTRUMENT_TYPES = new Set(['synth', 'builtin-synth', 'drum-kit', 'builtin-drum-kit', 'builtin-drum-machine', 'fermenter', 'toaster']);

function isInstrumentDevice(type: string): boolean {
    return INSTRUMENT_TYPES.has(type) || type.startsWith('faust-');
}

function attachInstrumentDevice(trackId: string, dp: DevicePreset): void {
    const device: Device = {
        id: `preset-dev-${nextPresetDeviceId++}`,
        name: dp.name,
        type: dp.type,
        bypassed: false,
        parameterValues: { ...dp.parameterValues },
    };
    updateTrack(trackId, (t) => ({ ...t, devices: [...t.devices, device] }));

    if (dp.type.startsWith('faust-')) {
        import('#/modules/Plugin/useCases/faustEngine/compilerEngine')
            .then(({ compileFaustDSP }) => compileFaustDSP(dp.type))
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

export function createTrackFromPreset(preset: SoundPreset): string | null {
    const track = addTrack({ name: preset.name, kind: preset.trackKind });
    if (!track) {
        return null;
    }
    loadPresetToTrack(track.id, preset);
    return track.id;
}

export function loadPresetToTrack(trackId: string, preset: SoundPreset): void {
    const track = getTrackById(trackId);
    if (track) {
        const deviceIds = track.devices.map((d) => d.id);
        for (const deviceId of deviceIds) {
            removeDeviceFromStrip(trackId, deviceId);
        }
        updateTrack(trackId, (t) => ({ ...t, devices: [] }));
    }

    for (const dp of preset.devices) {
        if (isInstrumentDevice(dp.type)) {
            attachInstrumentDevice(trackId, dp);
        } else {
            attachEffectDevice(trackId, dp);
        }
    }
}
