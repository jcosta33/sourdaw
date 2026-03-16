import type { SoundPreset, SoundPresetCategory, DevicePreset } from "../models/SoundPreset";
import type { Device } from "../models/Track";
import { addTrack } from "./addTrack";
import { addDevice, setDeviceParameter } from "./deviceUseCases";
import { trackStore } from "../stores/trackStore";
import { audioEngine } from "#/modules/AudioEngine/repositories/audioEngineInstance";

const USER_PRESETS_KEY = "webdaw-user-presets";

let nextUserPresetId = 1;
let nextPresetDeviceId = 1;

const INSTRUMENT_TYPES = new Set(["synth", "builtin-synth", "drum-kit"]);

const readStoredPresets = (): SoundPreset[] => {
    try {
        const raw = localStorage.getItem(USER_PRESETS_KEY);
        if (!raw) {
            return [];
        }
        return JSON.parse(raw) as SoundPreset[];
    } catch {
        return [];
    }
};

const writeStoredPresets = (presets: SoundPreset[]): void => {
    try {
        localStorage.setItem(USER_PRESETS_KEY, JSON.stringify(presets));
    } catch { /* storage full */ }
};

const attachInstrumentDevice = (trackId: string, dp: DevicePreset): void => {
    const state = trackStore.value;
    if (!state) {
        return;
    }
    const device: Device = {
        id: `preset-dev-${nextPresetDeviceId++}`,
        name: dp.name,
        type: dp.type,
        bypassed: false,
        parameterValues: { ...dp.parameterValues },
    };
    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) =>
            t.id === trackId ? { ...t, devices: [...t.devices, device] } : t,
        ),
    });
};

const attachEffectDevice = (trackId: string, dp: DevicePreset): void => {
    const added = addDevice(trackId, dp.name);
    if (!added) {
        return;
    }
    for (const [paramId, value] of Object.entries(dp.parameterValues)) {
        setDeviceParameter(added.id, paramId, value);
        audioEngine.updateDeviceParam(trackId, added.id, paramId, value);
    }
};

export const getUserPresets = (): SoundPreset[] => {
    return readStoredPresets();
};

export const saveUserPreset = (preset: Omit<SoundPreset, "id" | "isFactory" | "author">): SoundPreset => {
    const stored = readStoredPresets();
    const full: SoundPreset = {
        ...preset,
        id: `user-preset-${Date.now()}-${nextUserPresetId++}`,
        author: "User",
        isFactory: false,
    };
    stored.push(full);
    writeStoredPresets(stored);
    return full;
};

export const deleteUserPreset = (presetId: string): void => {
    const stored = readStoredPresets();
    writeStoredPresets(stored.filter((p) => p.id !== presetId));
};

export const createTrackFromPreset = (preset: SoundPreset): string | null => {
    const track = addTrack({ name: preset.name, kind: preset.trackKind });
    if (!track) {
        return null;
    }
    loadPresetToTrack(track.id, preset);
    return track.id;
};

export const loadPresetToTrack = (trackId: string, preset: SoundPreset): void => {
    for (const dp of preset.devices) {
        if (INSTRUMENT_TYPES.has(dp.type)) {
            attachInstrumentDevice(trackId, dp);
        } else {
            attachEffectDevice(trackId, dp);
        }
    }
};

export type SaveCurrentAsPresetInput = {
    name: string;
    category: SoundPresetCategory;
    description?: string;
    tags?: string[];
    trackKind: "midi" | "audio";
    devices: { type: string; name: string; parameterValues: Record<string, number> }[];
};

export const saveCurrentAsPreset = (input: SaveCurrentAsPresetInput): SoundPreset => {
    return saveUserPreset({
        name: input.name,
        category: input.category,
        description: input.description ?? "",
        tags: input.tags ?? [],
        trackKind: input.trackKind,
        devices: input.devices,
    });
};
