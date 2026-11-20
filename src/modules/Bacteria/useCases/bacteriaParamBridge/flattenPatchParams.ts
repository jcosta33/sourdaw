import { type BacteriaBand, type BacteriaPatch } from '../../models/BacteriaPatch';

import { encodePatchValue, NON_MORPHED_BAND_KEYS, NON_SCALAR_GLOBAL_KEYS } from './helpers';

/**
 * Encode globals and active bands in the engine key space. A band's keys
 * carry its `band{i}_` prefix so factory replay and morphing address the same
 * DSP parameters.
 *
 * Non-scalar keys (the patch name, the band array, morph metadata, the morph
 * position itself) have no numeric encoding. Factory presets include body
 * choices. Morph corners leave bodies out because their indices are discrete.
 */
export function flattenPatchParams(
    patch: BacteriaPatch,
    options: { includeBodies?: boolean } = {}
): Record<string, number> {
    const values: Record<string, number> = {};

    for (const key of Object.keys(patch) as Array<keyof BacteriaPatch>) {
        if (NON_SCALAR_GLOBAL_KEYS.has(key)) {
            continue;
        }
        const encodedValue = encodePatchValue(key, patch[key]);
        if (encodedValue !== null) {
            values[key] = encodedValue;
        }
    }

    const activeBandCount = Math.max(0, Math.min(patch.bands.length, patch.bandCount));
    for (let bandIndex = 0; bandIndex < activeBandCount; bandIndex += 1) {
        const band = patch.bands[bandIndex];
        if (!band) {
            continue;
        }
        for (const key of Object.keys(band) as Array<keyof BacteriaBand>) {
            if (!options.includeBodies && NON_MORPHED_BAND_KEYS.has(key)) {
                continue;
            }
            const encodedValue = encodePatchValue(key, band[key]);
            if (encodedValue !== null) {
                values[`band${bandIndex}_${key}`] = encodedValue;
            }
        }
    }

    return values;
}
