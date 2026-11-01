/**
 * Dither control. `seed` makes the TPDF noise reproducible, so an export can be
 * compared byte-for-byte across formats and across runs; omit it for the
 * ordinary non-reproducible export path.
 */
export type PcmDitherOptions = {
    mode: 'tpdf' | 'none';
    seed?: number;
};
