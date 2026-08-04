import { quantizeMidiNoteLengths } from '../../transformers/quantizeMidiNoteLengths';

import { applyMidiNoteTransform } from './applyMidiNoteTransform';

/**
 * Snaps each note's duration to the nearest multiple of `gridSize`.
 *
 * A note shorter than half a grid step rounds to zero grid multiples. The previous
 * implementation floored every duration to a full grid step (`Math.max(gridSize,…)`),
 * so a 1/64 note on a 1/4 grid was inflated 16×. Instead, a sub-grid note keeps its
 * original duration — preserving short ornamental notes rather than stretching them
 * to fill a grid cell they never occupied. Notes that round to one or more grid
 * steps are snapped to the nearest multiple as before.
 */
export function quantizeNoteLengths(clipId: string, gridSize: number): boolean {
    return applyMidiNoteTransform({
        clipId,
        transform: (notes) => quantizeMidiNoteLengths({ notes, gridSize }),
    });
}
