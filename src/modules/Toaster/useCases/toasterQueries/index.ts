import { TOASTER_PRESETS as _TOASTER_PRESETS, type ToasterKitPreset } from '../../repositories/toasterPresets';
import { DEFAULT_PAD_NAMES as _DEFAULT_PAD_NAMES } from '../../models/ToasterKit';

export function getToasterPresets(): ToasterKitPreset[] {
    return _TOASTER_PRESETS;
}

export { _TOASTER_PRESETS as TOASTER_PRESETS };
export { _DEFAULT_PAD_NAMES as DEFAULT_PAD_NAMES };
