/**
 * ScratchPadSection — a section in the arrangement scratch pad.
 *
 * References an arrangement section by start/end beat, name, and color.
 * The scratch pad lets users rearrange sections without affecting the
 * main timeline until they choose to commit.
 */

export type ScratchPadSection = {
    id: string;
    startBeat: number;
    endBeat: number;
    name: string;
    color: string;
    /** Order in the scratch pad (0-based). */
    order: number;
};

let nextScratchId = 1;

export const createScratchPadSection = (
    startBeat: number,
    endBeat: number,
    name: string,
    color: string,
    order: number
): ScratchPadSection => ({
    id: `scratch-${nextScratchId++}`,
    startBeat,
    endBeat,
    name,
    color,
    order,
});
