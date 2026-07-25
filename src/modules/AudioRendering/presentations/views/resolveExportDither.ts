import { type ExportDither } from './exportSettings';

export type ResolveExportDitherOutput = {
    mode: 'tpdf' | 'none';
    seed?: number;
};

/**
 * Fixed seed for reproducible exports.
 *
 * Any constant works — what matters is that it does not change between runs, so
 * re-exporting an unchanged project yields byte-identical files.
 */
export const REPRODUCIBLE_DITHER_SEED = 0x50f7_1a11;

/**
 * Resolve the export dither preference into the options the encoders take.
 *
 * Quantizing to 16-bit without dither adds correlated distortion, so
 * dither stays on by default. But the default draws from `Math.random()`, which
 * makes every export of an unchanged project a different file: no byte-exact
 * re-delivery, no diffing two bounces, nothing reproducible. The two extra
 * choices fix that from opposite ends — `seeded` keeps the dither and makes it
 * repeatable, `none` removes it for a bit-exact bounce at full resolution.
 */
export function resolveExportDither(dither: ExportDither): ResolveExportDitherOutput {
    if (dither === 'none') {
        return { mode: 'none' };
    }

    if (dither === 'seeded') {
        return { mode: 'tpdf', seed: REPRODUCIBLE_DITHER_SEED };
    }

    return { mode: 'tpdf' };
}
