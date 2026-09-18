import { resolveNativeDspDeviceType } from './nativeDspDeviceTypes';

/**
 * Ordering laws for native device parameters when replaying a device's patch.
 *
 * Mirrors the native body laws in `crates/daw-engine/src/scheduler.rs`:
 * - Crust: `CRUST_PATCH_PRECEDENCE` (`style` first, so exact `algorithm` pick lands last).
 * - Gluten: `GLUTEN_MACRO_KEYS` (`topology`, `style`, `amount`).
 * - Grinder: `GRINDER_PATCH_PRECEDENCE` (`neuralEnabled`).
 * - Fermenter: `LAYER_ROUTING_KEY` (`activeLayer` / `active_layer`).
 * - Toaster: `TOASTER_PATCH_PRECEDENCE` (`pad0_engine_type` ... `pad15_engine_type`).
 */
export const DEVICE_PATCH_PRECEDENCE: Readonly<Record<string, readonly string[]>> = {
    crust: ['style'],
    gluten: ['topology', 'style', 'amount'],
    grinder: ['neuralEnabled'],
    fermenter: ['activeLayer', 'active_layer'],
    toaster: [
        'pad0_engine_type',
        'pad1_engine_type',
        'pad2_engine_type',
        'pad3_engine_type',
        'pad4_engine_type',
        'pad5_engine_type',
        'pad6_engine_type',
        'pad7_engine_type',
        'pad8_engine_type',
        'pad9_engine_type',
        'pad10_engine_type',
        'pad11_engine_type',
        'pad12_engine_type',
        'pad13_engine_type',
        'pad14_engine_type',
        'pad15_engine_type',
    ],
};

/**
 * Order a device's numeric parameter entries for replay into an audio engine.
 *
 * Replays any leading precedence keys first in declared precedence order,
 * followed by all other parameters in their original insertion order.
 */
export function orderDeviceParametersForReplay(
    deviceType: string,
    parameterValues: Record<string, number> | Readonly<Record<string, number>>
): Array<[string, number]> {
    const entries = Object.entries(parameterValues);
    const canonicalType = resolveNativeDspDeviceType(deviceType) ?? deviceType.toLowerCase();
    const precedence = DEVICE_PATCH_PRECEDENCE[canonicalType];
    if (!precedence || precedence.length === 0) {
        return entries;
    }

    const precedenceSet = new Set(precedence);
    const leading: Array<[string, number]> = [];
    for (const key of precedence) {
        if (Object.hasOwn(parameterValues, key)) {
            const value = parameterValues[key];
            if (value !== undefined) {
                leading.push([key, value]);
            }
        }
    }
    const rest = entries.filter(([key]) => !precedenceSet.has(key));
    return [...leading, ...rest];
}
