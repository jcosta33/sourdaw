import { getTrackState, updateTrack, mapAllTracks, getTrackById } from '../repositories/trackRepository';
import { getTransportState } from '#/modules/Transport/useCases/transportQueries';
import { getPlatformPlugins } from './trackQueries';
import { type Device, type AutomationMode } from '../models/Track';
import {
    addDeviceToStrip,
    removeDeviceFromStrip,
    updateDeviceParam,
} from '#/modules/AudioEngine/useCases/deviceControls';
import { setSend as engineSetSend } from '#/modules/AudioEngine/useCases/busControls';
import { recordAutomationValue } from './automationRecording';
import { loadPlugin, unloadPlugin } from '#/modules/AudioEngine/useCases/pluginBridge';

const RECORDING_MODES: ReadonlySet<AutomationMode> = new Set(['write', 'touch', 'latch']);

function nextDeviceIdStr(): string {
    return `device-${crypto.randomUUID().slice(0, 8)}`;
}

export function addDevice(trackId: string, deviceType: string): Device | null {
    const state = getTrackState();
    if (!state) {
        return null;
    }

    const plugin = getPlatformPlugins().find((p) => p.name.toLowerCase() === deviceType.toLowerCase());
    const parameterValues: Record<string, number> = {};
    if (plugin) {
        for (const param of plugin.parameters) {
            parameterValues[param.id] = param.value;
        }
    }

    const device: Device = {
        id: nextDeviceIdStr(),
        name: deviceType,
        type: plugin ? plugin.id : deviceType,
        bypassed: false,
        parameterValues,
    };

    updateTrack(trackId, (t) => ({ ...t, devices: [...t.devices, device] }));

    if (plugin) {
        if (plugin.id.startsWith('faust-')) {
            import('#/modules/AudioEngine/useCases/faustEngine')
                .then(({ compileFaustDSP }) => compileFaustDSP(plugin.id))
                .catch(console.error);
        }
        addDeviceToStrip(trackId, device.id, plugin.id);
        for (const param of plugin.parameters) {
            updateDeviceParam(trackId, device.id, param.id, param.value);
        }
    }

    return device;
}

export function addExternalDevice(trackId: string, pluginId: string, pluginName: string): Device | null {
    const state = getTrackState();
    if (!state) {
        return null;
    }

    const instanceId = `${pluginId}-${String(Date.now())}`;

    const device: Device = {
        id: nextDeviceIdStr(),
        name: pluginName,
        type: 'external-plugin',
        bypassed: false,
        parameterValues: {},
        externalPluginId: pluginId,
        externalInstanceId: instanceId,
    };

    updateTrack(trackId, (t) => ({ ...t, devices: [...t.devices, device] }));

    addDeviceToStrip(trackId, device.id, 'external-plugin', instanceId);
    void loadPlugin(pluginId, instanceId);

    return device;
}

export function removeDevice(deviceId: string): void {
    const state = getTrackState();
    if (!state) {
        return;
    }

    for (const track of state.tracks) {
        const device = track.devices.find((d) => d.id === deviceId);
        if (device) {
            removeDeviceFromStrip(track.id, deviceId);
            if (device.type === 'external-plugin' && device.externalInstanceId) {
                void unloadPlugin(device.externalInstanceId);
            }
            break;
        }
    }

    mapAllTracks((t) => ({ ...t, devices: t.devices.filter((d) => d.id !== deviceId) }));
}

export function bypassDevice(deviceId: string, bypassed: boolean): void {
    const state = getTrackState();
    if (state) {
        for (const track of state.tracks) {
            if (track.devices.some((d) => d.id === deviceId)) {
                // Forward bypass to live engine for native DSP devices
                import('#/modules/AudioEngine/useCases/deviceControls').then(({ updateDeviceBypass }) => {
                    updateDeviceBypass(track.id, deviceId, bypassed);
                }).catch(() => {
                    // Engine bypass forwarding is best-effort
                });
                break;
            }
        }
    }

    mapAllTracks((t) => ({
        ...t,
        devices: t.devices.map((d) => (d.id === deviceId ? { ...d, bypassed } : d)),
    }));
}

export function reorderDevices(trackId: string, fromIndex: number, toIndex: number): void {
    updateTrack(trackId, (t) => {
        const devices = [...t.devices];
        const [moved] = devices.splice(fromIndex, 1);
        if (moved) {
            devices.splice(toIndex, 0, moved);
        }
        return { ...t, devices };
    });
}

export function setDeviceParameter(deviceId: string, paramId: string, value: number): void {
    const state = getTrackState();
    if (!state) {
        return;
    }

    const track = state.tracks.find((t) => t.devices.some((d) => d.id === deviceId));
    if (!track) {
        return;
    }

    // Update audio engine (non-blocking)
    updateDeviceParam(track.id, deviceId, paramId, value);

    // Update only the affected track's store state (not all tracks)
    updateTrack(track.id, (t) => ({
        ...t,
        devices: t.devices.map((d) =>
            d.id === deviceId ? { ...d, parameterValues: { ...d.parameterValues, [paramId]: value } } : d
        ),
    }));

    // Record automation if playing in a recording mode
    const transport = getTransportState();
    if (transport?.isPlaying && RECORDING_MODES.has(track.automationMode)) {
        recordAutomationValue(track.id, `${deviceId}:${paramId}`, value, transport.playheadPosition);
    }
}

export function setSend(trackId: string, busId: string, level: number, preFader = false): void {
    const track = getTrackById(trackId);
    const existingSend = track?.sends.find((s) => s.busId === busId);
    const resolvedPreFader = existingSend ? existingSend.preFader : preFader;

    updateTrack(trackId, (t) => {
        const existingIndex = t.sends.findIndex((s) => s.busId === busId);
        const sends = [...t.sends];
        if (existingIndex >= 0) {
            const existing = sends[existingIndex]!;
            sends[existingIndex] = { busId, level, preFader: existing.preFader };
        } else {
            sends.push({ busId, level, preFader });
        }
        return { ...t, sends };
    });

    engineSetSend(trackId, busId, level, resolvedPreFader);
}

export function toggleSendPreFader(trackId: string, busId: string): void {
    const track = getTrackById(trackId);
    const send = track?.sends.find((s) => s.busId === busId);
    if (!send) {
        return;
    }

    const newPreFader = !send.preFader;

    updateTrack(trackId, (t) => ({
        ...t,
        sends: t.sends.map((s) => (s.busId === busId ? { ...s, preFader: newPreFader } : s)),
    }));

    engineSetSend(trackId, busId, send.level, newPreFader);
}

export function removeSend(trackId: string, busId: string): void {
    updateTrack(trackId, (t) => ({
        ...t,
        sends: t.sends.filter((s) => s.busId !== busId),
    }));
}
