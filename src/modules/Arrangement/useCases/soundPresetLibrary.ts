import { getFermenterFactoryPresets } from '#/modules/Fermenter/useCases';
import { isDesktopRuntime } from '#/utils/desktopRuntime';

import { isDeviceSupportedOnCurrentPlatform } from '../models/DeviceParameter';
import { type SoundPreset } from '../models/SoundPreset';
import { FACTORY_PRESETS } from '../repositories/presets/factoryPresets';

import { SIDEBAR_INSTRUMENT_PRESETS } from './preset/sidebarInstrumentPresets';

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
    return isDesktopRuntime() ? 'native' : 'web';
}

function isPresetCompatible(preset: SoundPreset): boolean {
    return preset.devices.every((device) => isDeviceSupportedOnCurrentPlatform(device.type));
}

export function getFactoryPresets(): GetFactoryPresetsOutput {
    const key = currentPlatformKey();
    if (!cachedEntry || cachedEntry.platformKey !== key) {
        cachedEntry = {
            // FACTORY_PRESETS already contains the drum-kit presets; spreading
            // them again here doubled the four factory-drumkit-* entries — and
            // their ids — in the preset browser (audit M-020).
            presets: [...FACTORY_PRESETS, ...getFermenterFactoryPresets(), ...SIDEBAR_INSTRUMENT_PRESETS].filter(
                isPresetCompatible
            ),
            platformKey: key,
        };
    }
    return cachedEntry.presets;
}
