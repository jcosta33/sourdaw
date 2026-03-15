import { trackStore } from "../stores/trackStore";
import type { Device } from "../models/Track";

let nextDeviceId = 1;

export const addDevice = (trackId: string, deviceType: string): Device | null => {
    const state = trackStore.value;
    if (!state) return null;

    const device: Device = {
        id: `device-${nextDeviceId++}`,
        name: deviceType,
        type: deviceType,
        bypassed: false,
    };

    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) =>
            t.id === trackId
                ? { ...t, devices: [...t.devices, device] }
                : t,
        ),
    });

    return device;
};

export const removeDevice = (deviceId: string): void => {
    const state = trackStore.value;
    if (!state) return;
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

export const setSend = (trackId: string, busId: string, level: number): void => {
    const state = trackStore.value;
    if (!state) return;
    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) => {
            if (t.id !== trackId) return t;
            const existingIndex = t.sends.findIndex((s) => s.busId === busId);
            const sends = [...t.sends];
            if (existingIndex >= 0) {
                sends[existingIndex] = { busId, level };
            } else {
                sends.push({ busId, level });
            }
            return { ...t, sends };
        }),
    });
};
