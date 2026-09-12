import { type BacteriaBand, type BacteriaPatch } from '../../models/BacteriaPatch';

import { encodePatchValue, NON_SCALAR_BAND_KEYS, NON_SCALAR_GLOBAL_KEYS } from './helpers';

/**
 * Flatten a patch into the engine-keyed scalar values a morph corner stores:
 * global scalars under their own ids, each active band's scalars under its
 * `band{i}_` engine prefix — the same key space `loadBacteriaPatchWithAudio`
 * pushes and `BandChain::apply_param` parses, so an interpolated value can
 * travel back through the scalar bridge unchanged.
 *
 * Non-scalar keys (the patch name, the band array, morph metadata, the morph
 * position itself) and values with no numeric encoding are skipped, exactly as
 * a patch load skips them.
 */
export function flattenPatchParams(patch: BacteriaPatch): Record<string, number> {
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

    // Only active bands are captured, matching what a patch load pushes: a
    // corner holding bands the engine ignores would interpolate writes those
    // bands only replay if the count later grows over them.
    const activeBandCount = Math.max(0, Math.min(patch.bands.length, patch.bandCount));
    for (let bandIndex = 0; bandIndex < activeBandCount; bandIndex += 1) {
        const band = patch.bands[bandIndex];
        if (!band) {
            continue;
        }
        for (const key of Object.keys(band) as Array<keyof BacteriaBand>) {
            if (NON_SCALAR_BAND_KEYS.has(key)) {
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
