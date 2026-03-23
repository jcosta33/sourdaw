import { type SoundPreset, type SoundPresetCategory } from '#/modules/Track/models/SoundPreset';
import { FACTORY_PRESETS, DRUM_KIT_PRESETS } from '#/modules/Track/helpers/factoryPresets';
import { BUILTIN_PLUGINS } from '#/modules/Track/models/DeviceParameter';

let cachedPresets: SoundPreset[] | null = null;
let cachedPlatformKey: string | null = null;

export type GetFactoryPresetsOutput = SoundPreset[];

function currentPlatformKey(): string {
    return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window ? 'native' : 'web';
}

function isPresetCompatible(preset: SoundPreset): boolean {
    const isNative = currentPlatformKey() === 'native';
    return preset.devices.every((d) => {
        const descriptor = BUILTIN_PLUGINS.find((p) => p.id === d.type);
        if (!descriptor) return true; // unknown device types (e.g. faust-*) pass through
        const platform = descriptor.platform ?? 'both';
        if (platform === 'both') return true;
        // Native app runs in WebView with Web Audio — web plugins work there too.
        // Only hide native-only plugins on the web platform.
        if (isNative) return true; // native can run both web and native plugins
        return platform === 'web'; // web can only run web plugins (not native-only)
    });
}

export function getFactoryPresets(): GetFactoryPresetsOutput {
    const key = currentPlatformKey();
    if (!cachedPresets || cachedPlatformKey !== key) {
        cachedPresets = [...FACTORY_PRESETS, ...DRUM_KIT_PRESETS].filter(isPresetCompatible);
        cachedPlatformKey = key;
    }
    return cachedPresets;
}

export type GetPresetsByCategoryInput = SoundPresetCategory;
export type GetPresetsByCategoryOutput = SoundPreset[];

export function getPresetsByCategory(category: GetPresetsByCategoryInput): GetPresetsByCategoryOutput {
    return getFactoryPresets().filter((p) => p.category === category);
}
