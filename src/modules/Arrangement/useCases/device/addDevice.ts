import { getTrackState, updateTrack } from '../../repositories/track';
import { getPlatformPlugins } from '../trackQueries';
import { type Device } from '../../models/Track';
import {
    addDeviceToStrip,
    updateDeviceParam,
} from '#/modules/AudioEngine/useCases/deviceControls';

function nextDeviceIdStr(): string {
    return `device-${crypto.randomUUID().slice(0, 8)}`;
}

export function addDevice(trackId: string, deviceType: string): Device | null {
    const state = getTrackState();
    if (!state) {
        return null;
    }

    // Search by name first, then by ID — callers may pass either
    const plugin = getPlatformPlugins().find(
        (p) => p.name.toLowerCase() === deviceType.toLowerCase() || p.id === deviceType
    );
    const parameterValues: Record<string, number> = {};
    if (plugin) {
        for (const param of plugin.parameters) {
            parameterValues[param.id] = param.value;
        }
    }

    const device: Device = {
        id: nextDeviceIdStr(),
        name: plugin ? plugin.name : deviceType,
        type: plugin ? plugin.id : deviceType,
        bypassed: false,
        parameterValues,
    };

    updateTrack(trackId, (t) => ({ ...t, devices: [...t.devices, device] }));

    if (plugin) {
        if (plugin.id.startsWith('faust-')) {
            import('#/modules/Plugin/useCases/faustEngine/compilerEngine')
                .then(({ compileFaustDSP }) => compileFaustDSP(plugin.id))
                .catch(() => {
                    // Faust compilation is best-effort — device falls back to passthrough
                });
        }
        addDeviceToStrip(trackId, device.id, plugin.id);
        for (const param of plugin.parameters) {
            updateDeviceParam(trackId, device.id, param.id, param.value);
        }
    }

    return device;
}
