import { blankRanges } from './blankRanges';
import { type AgentReferenceTextRange } from './findAgentReferenceNameSpans';

/** Where a text refers back to tracks stated before it, and whether to several ("them") or one ("it"). */
export type BackReference = { index: number; plural: boolean };

/** How the scope reads the request: the tracks it names and the instructions it gives. */
export type InstructionReader = {
    /** Whether the text states tracks in any form a selector picks them by: a name, a role, a family or a fragment. */
    namesTracks: (text: string) => boolean;
    /** Where the text first refers back to tracks stated before it: "it", "them", "that track". */
    findBackReference: (text: string) => BackReference | undefined;
    /** Whether the masked clause gives an instruction of its own. */
    givesInstruction: (masked: string) => boolean;
    /** The whole instruction a clause giving one opens, as the instruction reading extends it. */
    extendInstruction: (clause: AgentReferenceTextRange) => AgentReferenceTextRange;
};

export type InstructionScopeInput = {
    text: string;
    clauses: readonly (AgentReferenceTextRange & { masked: string })[];
    instruction: AgentReferenceTextRange;
    reader: InstructionReader;
};

/** Every instruction of the request besides the call's own, each whole as the instruction reading extends it. */
function getOtherInstructions({ clauses, instruction, reader }: InstructionScopeInput): AgentReferenceTextRange[] {
    const ranges: AgentReferenceTextRange[] = [];
    for (const clause of clauses) {
        const insideOwn = clause.start >= instruction.start && clause.start < instruction.end;
        const continuesPrevious = clause.start < (ranges.at(-1)?.end ?? 0);
        if (insideOwn || continuesPrevious || !reader.givesInstruction(clause.masked)) {
            continue;
        }
        const { end } = reader.extendInstruction(clause);
        ranges.push({
            start: clause.start,
            end: clause.start < instruction.start ? Math.min(end, instruction.start) : end,
        });
    }
    return ranges;
}

/**
 * How the call's instruction refers back to tracks stated before it ("them", "it", "that track"),
 * when it names none of its own before that reference.
 */
function readBackReference({ text, instruction, reader }: InstructionScopeInput): BackReference | undefined {
    const own = text.slice(instruction.start, instruction.end);
    const backReference = reader.findBackReference(own);
    if (backReference === undefined || reader.namesTracks(own.slice(0, backReference.index))) {
        return undefined;
    }
    return backReference;
}

/** The earlier instructions naming tracks a back-reference reads: every one for "them", the nearest for "it". */
function getAntecedents(
    naming: readonly AgentReferenceTextRange[],
    input: InstructionScopeInput
): AgentReferenceTextRange[] {
    const backReference = readBackReference(input);
    if (backReference === undefined) {
        return [];
    }
    const earlier = naming.filter((range) => range.end <= input.instruction.start);
    return backReference.plural ? earlier : earlier.slice(-1);
}

/**
 * The request with every other instruction that names tracks blanked, so a name only another
 * instruction states never picks the call's target ("set Vocals volume to 75% and mute Keys"). An
 * instruction that refers back to earlier tracks and names none of its own before it keeps the
 * earlier ones naming tracks: every one for a plural reference ("Mute Vocals. Mute Keys. Pan them
 * left."), the nearest for a singular one ("Mute Vocals. Mute Keys. Pan it left."). Text giving no
 * instruction always stays: "Mute Vocals. Keys too.", "Turn down these tracks by 3 dB\nBass\nDrums".
 */
export function scopeToInstruction(input: InstructionScopeInput): string {
    const naming = getOtherInstructions(input).filter((range) =>
        input.reader.namesTracks(input.text.slice(range.start, range.end))
    );
    const antecedents = getAntecedents(naming, input);
    const unreferenced = naming.filter((range) => !antecedents.includes(range));
    return blankRanges(input.text, unreferenced, ' ');
}
