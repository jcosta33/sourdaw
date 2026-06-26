/**
 * Single source of truth for the dither-mode → engine-int contract.
 *
 * The WASM limiter encodes the dither mode as an integer: 0 = off, 1 = TPDF,
 * 2 = noise-shaped. Previously this mapping was hand-inlined in three places
 * (the two param-bridge sync paths and the limiter view's array index); they
 * now all route through this one helper so the encoding cannot drift.
 */

import { type DitherMode } from '../models/ProofPatch';

const DITHER_MODE_INT: Record<DitherMode, number> = {
    off: 0,
    tpdf: 1,
    noise_shaped: 2,
};

export const ditherModeToInt = (mode: DitherMode): number => DITHER_MODE_INT[mode];
