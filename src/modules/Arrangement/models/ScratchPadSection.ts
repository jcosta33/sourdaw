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

export function createScratchPadSectionId(): string {
    return `scratch-${crypto.randomUUID()}`;
}

export function createScratchPadSection(
    startBeat: number,
    endBeat: number,
    name: string,
    color: string,
    order: number,
    id: string = createScratchPadSectionId()
): ScratchPadSection {
    return {
        id,
        startBeat,
        endBeat,
        name,
        color,
        order,
    };
}
