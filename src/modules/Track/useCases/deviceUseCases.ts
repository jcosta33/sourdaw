import { trackStore } from "../stores/trackStore";
import { transportStore } from "#/modules/Transport/stores/transportStore";
import { BUILTIN_PLUGINS } from "../models/DeviceParameter";
import type { Device, AutomationMode } from "../models/Track";
import { audioEngine } from "#/modules/AudioEngine/repositories/audioEngineInstance";
import { recordAutomationValue } from "./automationRecording";

const RECORDING_MODES: ReadonlySet<AutomationMode> = new Set(["write", "touch", "latch"]);

let nextDeviceId = 1;

export const addDevice = (trackId: string, deviceType: string): Device | null => {
    const state = trackStore.value;
    if (!state) return null;

    const plugin = BUILTIN_PLUGINS.find((p) => p.name === deviceType);
    const parameterValues: Record<string, number> = {};
    if (plugin) {
        for (const param of plugin.parameters) {
            parameterValues[param.id] = param.value;
        }
    }

    const device: Device = {
        id: `device-${nextDeviceId++}`,
        name: deviceType,
        type: deviceType,
        bypassed: false,
        parameterValues,
    };

    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) =>
            t.id === trackId
                ? { ...t, devices: [...t.devices, device] }
                : t,
        ),
    });

    if (plugin) {
        audioEngine.addDeviceToStrip(trackId, device.id, plugin.id);
        for (const param of plugin.parameters) {
            audioEngine.updateDeviceParam(trackId, device.id, param.id, param.value);
        }
    }

    return device;
};

export const removeDevice = (deviceId: string): void => {
    const state = trackStore.value;
    if (!state) return;

    for (const track of state.tracks) {
        if (track.devices.some((d) => d.id === deviceId)) {
            audioEngine.removeDeviceFromStrip(track.id, deviceId);
            break;
        }
    }

    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) => ({
            ...t,
            devices: t.devices.filter((d) => d.id !== deviceId),
        })),
    });
};

export const bypassDevice = (deviceId: string, bypassed: boolean): void => {
    const state = trackStore.value;
    if (!state) return;
    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) => ({
            ...t,
            devices: t.devices.map((d) =>
                d.id === deviceId ? { ...d, bypassed } : d,
            ),
        })),
    });
};

export const reorderDevices = (trackId: string, fromIndex: number, toIndex: number): void => {
    const state = trackStore.value;
    if (!state) return;

    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) => {
            if (t.id !== trackId) return t;
            const devices = [...t.devices];
            const [moved] = devices.splice(fromIndex, 1);
            if (moved) devices.splice(toIndex, 0, moved);
            return { ...t, devices };
        }),
    });
};

export const setDeviceParameter = (deviceId: string, paramId: string, value: number): void => {
    const state = trackStore.value;
    if (!state) return;

    for (const track of state.tracks) {
        if (track.devices.some((d) => d.id === deviceId)) {
            audioEngine.updateDeviceParam(track.id, deviceId, paramId, value);
            break;
        }
    }

    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) => ({
            ...t,
            devices: t.devices.map((d) =>
                d.id === deviceId
                    ? { ...d, parameterValues: { ...d.parameterValues, [paramId]: value } }
                    : d,
            ),
        })),
    });

    const transport = transportStore.value;
    if (transport?.isPlaying) {
        const track = state.tracks.find((t) => t.devices.some((d) => d.id === deviceId));
        if (track && RECORDING_MODES.has(track.automationMode)) {
            recordAutomationValue(track.id, `${deviceId}:${paramId}`, value, transport.playheadPosition);
        }
    }
};

export const setSend = (trackId: string, busId: string, level: number, preFader = false): void => {
    const state = trackStore.value;
    if (!state) {
        return;
    }

    const track = state.tracks.find((t) => t.id === trackId);
    const existingSend = track?.sends.find((s) => s.busId === busId);
    const resolvedPreFader = existingSend ? existingSend.preFader : preFader;

    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) => {
            if (t.id !== trackId) {
                return t;
            }
            const existingIndex = t.sends.findIndex((s) => s.busId === busId);
            const sends = [...t.sends];
            if (existingIndex >= 0) {
                const existing = sends[existingIndex]!;
                sends[existingIndex] = { busId, level, preFader: existing.preFader };
            } else {
                sends.push({ busId, level, preFader });
            }
            return { ...t, sends };
        }),
    });

    audioEngine.setSend(trackId, busId, level, resolvedPreFader);
};

export const toggleSendPreFader = (trackId: string, busId: string): void => {
    const state = trackStore.value;
    if (!state) {
        return;
    }

    const track = state.tracks.find((t) => t.id === trackId);
    const send = track?.sends.find((s) => s.busId === busId);
    if (!send) {
        return;
    }

    const newPreFader = !send.preFader;

    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) => {
            if (t.id !== trackId) {
                return t;
            }
            return {
                ...t,
                sends: t.sends.map((s) =>
                    s.busId === busId ? { ...s, preFader: newPreFader } : s,
                ),
            };
        }),
    });

    audioEngine.setSend(trackId, busId, send.level, newPreFader);
};

export const removeSend = (trackId: string, busId: string): void => {
    const state = trackStore.value;
    if (!state) {
        return;
    }
    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) => {
            if (t.id !== trackId) {
                return t;
            }
            return { ...t, sends: t.sends.filter((s) => s.busId !== busId) };
        }),
    });
};
