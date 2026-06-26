import { TOASTER_PRESETS as _TOASTER_PRESETS } from '../repositories/toasterPresets';

// Single source of truth lives in the model layer; re-exported here so other
// modules can reach it through the useCases contract barrel (models are private).
export { DEFAULT_PAD_NAMES } from '../models/ToasterKit';

export { _TOASTER_PRESETS as TOASTER_PRESETS };
