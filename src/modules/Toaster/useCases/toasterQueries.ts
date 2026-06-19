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
    // Return a shallow copy so callers cannot mutate the shared preset array
    // (push/splice/reorder) and corrupt the registry for every other consumer.
    return [..._TOASTER_PRESETS];
}

export { _TOASTER_PRESETS as TOASTER_PRESETS };
