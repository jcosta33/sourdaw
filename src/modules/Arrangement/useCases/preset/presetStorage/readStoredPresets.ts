import { type DevicePreset, type SoundPreset, type SoundPresetCategory } from '../../../models/SoundPreset';

import { userPresetStorage } from './helpers';

const sound_preset_categories: readonly string[] = [
    'synth',
    'bass',
    'pad',
    'lead',
    'keys',
    'drums',
    'fx',
    'vocal',
    'guitar',
    'strings',
];
const track_kinds: readonly string[] = ['midi', 'audio'];

type UnknownRecord = {
    readonly [key: string]: unknown;
};

type ReadStoredPresetsOutput = SoundPreset[];

function is_unknown_record(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function is_plain_record(value: unknown): value is UnknownRecord {
    if (!is_unknown_record(value)) {
        return false;
    }

    return Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null;
}

function is_sound_preset_category(value: unknown): value is SoundPresetCategory {
    return typeof value === 'string' && sound_preset_categories.includes(value);
}

function is_track_kind(value: unknown): value is SoundPreset['trackKind'] {
    return typeof value === 'string' && track_kinds.includes(value);
}

function is_string_array(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function is_parameter_values(value: unknown): value is DevicePreset['parameterValues'] {
    return (
        is_plain_record(value) &&
        Object.values(value).every((item) => typeof item === 'number' && Number.isFinite(item))
    );
}

function is_device_preset(value: unknown): value is DevicePreset {
    return (
        is_unknown_record(value) &&
        typeof value.type === 'string' &&
        typeof value.name === 'string' &&
        is_parameter_values(value.parameterValues)
    );
}

function is_device_presets(value: unknown): value is DevicePreset[] {
    return Array.isArray(value) && value.every(is_device_preset);
}

function has_valid_subcategory(value: UnknownRecord): boolean {
    if (!('subcategory' in value)) {
        return true;
    }

    return typeof value.subcategory === 'string';
}

function is_sound_preset(value: unknown): value is SoundPreset {
    return (
        is_unknown_record(value) &&
        typeof value.id === 'string' &&
        typeof value.name === 'string' &&
        is_sound_preset_category(value.category) &&
        has_valid_subcategory(value) &&
        typeof value.description === 'string' &&
        is_track_kind(value.trackKind) &&
        is_device_presets(value.devices) &&
        is_string_array(value.tags) &&
        typeof value.author === 'string' &&
        typeof value.isFactory === 'boolean'
    );
}

function sanitize_stored_presets(value: unknown): SoundPreset[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value.filter(is_sound_preset);
}

export function readStoredPresets(): ReadStoredPresetsOutput {
    const stored_presets: unknown = userPresetStorage.get();
    return sanitize_stored_presets(stored_presets);
}
