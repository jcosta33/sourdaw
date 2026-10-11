import { BACTERIA_BUILTIN_BODIES, type BacteriaConvolutionIr } from './BacteriaPatch';

/**
 * The engine's and the document's `convolutionIr` for a band with no body,
 * which the engine reads as pass-through. A built-in body is its position in
 * {@link BACTERIA_BUILTIN_BODIES} (`crates/daw-dsp/src/bacteria/convolution.rs`).
 *
 * Every patch saved before the Body stage could choose a body holds `''`, and
 * those bands have always passed their audio through, so `''` keeps meaning
 * exactly that.
 */
export const NO_BODY_INDEX = -1;

/**
 * The `convolutionIr` value for a body name. A name that is not a built-in
 * body, `''` included, is no body.
 */
export function encodeBacteriaBody(body: string): number {
    const index = BACTERIA_BUILTIN_BODIES.findIndex((builtin) => builtin === body);
    return index === -1 ? NO_BODY_INDEX : index;
}

/**
 * The body a stored `convolutionIr` names: `''` for {@link NO_BODY_INDEX}, a
 * built-in body for its index, and `null` for anything else, so a corrupt
 * record is left alone rather than read as a body.
 */
export function decodeBacteriaBody(stored: number | undefined): BacteriaConvolutionIr | null {
    if (stored === NO_BODY_INDEX) {
        return '';
    }
    if (stored === undefined || !Number.isInteger(stored)) {
        return null;
    }
    return BACTERIA_BUILTIN_BODIES[stored] ?? null;
}
