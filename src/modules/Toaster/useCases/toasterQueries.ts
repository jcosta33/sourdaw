import { TOASTER_PRESETS as _TOASTER_PRESETS, type ToasterKitPreset } from '../repositories/toasterPresets';

export const DEFAULT_PAD_NAMES = [
    'Kick',
    'Snare',
    'Closed HH',
    'Open HH',
    'Clap',
    'Rim',
    'Low Tom',
    'Mid Tom',
    'Hi Tom',
    'Crash',
    'Ride',
    'Cowbell',
    'Clave',
    'Shaker',
    'Perc 1',
    'Perc 2',
] as const;

export function getToasterPresets(): ToasterKitPreset[] {
    return _TOASTER_PRESETS;
}

export { _TOASTER_PRESETS as TOASTER_PRESETS };
