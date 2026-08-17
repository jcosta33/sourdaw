import { getFermenterFactoryPresets } from '#/modules/Fermenter/useCases';
import { isTauri } from '#/utils/tauriRuntime';

import { BUILTIN_PLUGINS } from '../models/DeviceParameter';
import { type SoundPreset } from '../models/SoundPreset';
import { FACTORY_PRESETS } from '../repositories/presets/factoryPresets';

export type GetFactoryPresetsOutput = SoundPreset[];

type PresetCacheEntry = {
    presets: SoundPreset[];
    platformKey: string;
};

// Cached behind a single nullable entry so the presets array and the
// platform key it was filtered for move as one — the previous shape
// kept them in two separate `let` bindings, which left a brief window
// where they could disagree.
let cachedEntry: PresetCacheEntry | null = null;

function currentPlatformKey(): string {
    return isTauri() ? 'native' : 'web';
}

function isPresetCompatible(preset: SoundPreset): boolean {
    const isNative = currentPlatformKey() === 'native';
    return preset.devices.every((data) => {
        const descriptor = BUILTIN_PLUGINS.find((param) => param.id === data.type);
        if (!descriptor) {
            return true; // unknown device types (e.g. faust-*) pass through
        }
        const platform = descriptor.platform ?? 'both';
        if (platform === 'both') {
            return true;
        }
        // Native app runs in WebView with Web Audio — web plugins work there too.
        // Only hide native-only plugins on the web platform.
        if (isNative) {
            return true; // native can run both web and native plugins
        }
        return platform === 'web'; // web can only run web plugins (not native-only)
    });
}

export function getFactoryPresets(): GetFactoryPresetsOutput {
    const key = currentPlatformKey();
    if (!cachedEntry || cachedEntry.platformKey !== key) {
        cachedEntry = {
            // FACTORY_PRESETS already contains the drum-kit presets; spreading
            // them again here doubled the four factory-drumkit-* entries — and
            // their ids — in the preset browser (audit M-020).
            presets: [...FACTORY_PRESETS, ...getFermenterFactoryPresets()].filter(isPresetCompatible),
            platformKey: key,
        };
    }
    return cachedEntry.presets;
}
