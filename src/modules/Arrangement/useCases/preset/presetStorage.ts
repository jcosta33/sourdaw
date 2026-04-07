import { type SoundPreset } from '../../models/SoundPreset';
import { createLocalStorage } from '#/infra/store/storage/createLocalStorage';

const userPresetStorage = createLocalStorage<SoundPreset[]>('sourdaw-user-presets');

let nextUserPresetId = 1;

function readStoredPresets(): SoundPreset[] {
    return userPresetStorage.get() ?? [];
}

function writeStoredPresets(presets: SoundPreset[]): void {
    userPresetStorage.set(presets);
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

export type SaveCurrentAsPresetInput = {
    name: string;
    category: import('../../models/SoundPreset').SoundPresetCategory;
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
