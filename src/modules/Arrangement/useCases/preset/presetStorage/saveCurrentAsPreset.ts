import { type SoundPreset } from '../../../models/SoundPreset';
import { readStoredPresets, writeStoredPresets } from './helpers';

let nextUserPresetId = 1;

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

export type SaveCurrentAsPresetInput = {
    name: string;
    category: import('../../../models/SoundPreset').SoundPresetCategory;
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