import { type DeliveryPreset, type DeliverySettings } from '../models/DeliveryTarget';

/** Applying or resetting is an explicit event; switching editors preserves the draft. */
export function applyDeliveryPreset(input: {
    preset: DeliveryPreset;
    current?: DeliverySettings;
    reset?: boolean;
}): DeliverySettings {
    if (input.current && !input.reset) return input.current;
    return { ...input.preset.settings, formats: [...input.preset.settings.formats] };
}
