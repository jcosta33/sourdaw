import { type SoundPreset, type SoundPresetCategory, type DevicePreset } from '../models/SoundPreset';
import { type Device } from '../models/Track';
import { addTrack } from './addTrack';
import { addDevice, setDeviceParameter } from './deviceUseCases';
import { updateTrack, getTrackById } from '../repositories/trackRepository';
import { updateDeviceParam, removeDeviceFromStrip } from '#/modules/AudioEngine/useCases/deviceControls';
import { LocalStorageStorage } from '#/helpers/Store/Storage/LocalStorageStorage';

const userPresetStorage = new LocalStorageStorage<SoundPreset[]>('webdaw-user-presets');

let nextUserPresetId = 1;
let nextPresetDeviceId = 1;

const INSTRUMENT_TYPES = new Set(['synth', 'builtin-synth', 'drum-kit']);

function readStoredPresets(): SoundPreset[] {
    return userPresetStorage.get() ?? [];
}

function writeStoredPresets(presets: SoundPreset[]): void {
    userPresetStorage.set(presets);
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

export function getUserPresets(): SoundPreset[] {
    return readStoredPresets();
}

export function saveUserPreset(preset: Omit<SoundPreset, 'id' | 'isFactory' | 'author'>): SoundPreset {
    const stored = readStoredPresets();
    const full: SoundPreset = {
        ...preset,
        id: `user-preset-${Date.now()}-${nextUserPresetId++}`,
        author: 'User',
        isFactory: false,
    };
    stored.push(full);
    writeStoredPresets(stored);
    return full;
}

export function deleteUserPreset(presetId: string): void {
    const stored = readStoredPresets();
    writeStoredPresets(stored.filter((p) => p.id !== presetId));
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
    // Clear all existing devices on the track first
    const track = getTrackById(trackId);
    if (track) {
        const deviceIds = track.devices.map((d) => d.id);
        for (const deviceId of deviceIds) {
            removeDeviceFromStrip(trackId, deviceId);
        }
        updateTrack(trackId, (t) => ({ ...t, devices: [] }));
    }

    // Apply preset devices
    for (const dp of preset.devices) {
        if (INSTRUMENT_TYPES.has(dp.type)) {
            attachInstrumentDevice(trackId, dp);
        } else {
            attachEffectDevice(trackId, dp);
        }
    }
}

export type SaveCurrentAsPresetInput = {
    name: string;
    category: SoundPresetCategory;
    description?: string;
    tags?: string[];
    trackKind: 'midi' | 'audio';
    devices: { type: string; name: string; parameterValues: Record<string, number> }[];
};

export function saveCurrentAsPreset(input: SaveCurrentAsPresetInput): SoundPreset {
    return saveUserPreset({
        name: input.name,
        category: input.category,
        description: input.description ?? '',
        tags: input.tags ?? [],
        trackKind: input.trackKind,
        devices: input.devices,
    });
}
