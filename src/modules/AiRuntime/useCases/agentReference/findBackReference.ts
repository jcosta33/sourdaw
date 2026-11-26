import { normalizeAgentReferenceText } from './normalizeAgentReferenceText';
import { type BackReference } from './scopeToInstruction';

/** "that track" points at a track as "this track" does, though the shared reading takes only the latter. */
export const DEMONSTRATIVE_TRACK_REFERENCE = /\bthat (?:audio |midi |bus |folder )?track\b/u;

/** "it" or "its", which may stand for the selected track. */
export const SELECTION_PRONOUN = /\bits?\b/iu;

/** "them", "their" or "those", which refer back to the tracks an earlier instruction states. */
const PLURAL_BACK_REFERENCE = /\b(?:them|their|those)\b/iu;

/** "these" or "both", which refer back only when no track named after them is what they point at. */
const LIST_BACK_REFERENCE = /\b(?:these|both)\b/iu;

/** Where a list word refers back: "pan both left", never "pan both Vocals and Keys left". */
function findListBackReference(
    masked: string,
    instruction: string,
    statesTracks: (text: string) => boolean
): number | undefined {
    const match = LIST_BACK_REFERENCE.exec(masked);
    if (match === null || statesTracks(instruction.slice(match.index + match[0].length))) {
        return undefined;
    }
    return match.index;
}

/**
 * Where the instruction first refers back to earlier tracks, read in `masked`, the instruction with
 * every object name blanked, and whether it refers to several ("them", "their", "those", "these",
 * "both") or one ("it", "its", "that track").
 */
export function findBackReference(
    instruction: string,
    masked: string,
    statesTracks: (text: string) => boolean
): BackReference | undefined {
    const references: { index: number | undefined; plural: boolean }[] = [
        { index: SELECTION_PRONOUN.exec(masked)?.index, plural: false },
        { index: DEMONSTRATIVE_TRACK_REFERENCE.exec(normalizeAgentReferenceText(instruction))?.index, plural: false },
        { index: PLURAL_BACK_REFERENCE.exec(masked)?.index, plural: true },
        { index: findListBackReference(masked, instruction, statesTracks), plural: true },
    ];
    return references
        .flatMap(({ index, plural }) => (index === undefined ? [] : [{ index, plural }]))
        .toSorted((left, right) => left.index - right.index)
        .at(0);
}
