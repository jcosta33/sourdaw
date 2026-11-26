import { blankRange } from './blankRange';
import { type AgentReferenceTextRange } from './findAgentReferenceNameSpans';

/** How the scope reads the request: the tracks it names and the instructions it gives. */
export type InstructionReader = {
    /** Whether the text names a track by whole name, id or position, or a narrower role ("the lead vocal"). */
    namesTracks: (text: string) => boolean;
    /** Where the text first refers back to tracks stated before it: "it", "them", "that track". */
    findBackReference: (text: string) => number | undefined;
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
 * Whether the call's instruction refers back to tracks stated before it ("them", "it", "that track")
 * and names none of its own before that reference.
 */
function readsBackToAntecedent({ text, instruction, reader }: InstructionScopeInput): boolean {
    const own = text.slice(instruction.start, instruction.end);
    const backReference = reader.findBackReference(own);
    return backReference !== undefined && !reader.namesTracks(own.slice(0, backReference));
}

/**
 * The request with every other instruction that names tracks blanked, so a name only another
 * instruction states never picks the call's target ("set Vocals volume to 75% and mute Keys"). An
 * instruction that refers back to earlier tracks and names none of its own before it keeps the
 * nearest earlier one naming tracks ("Mute Vocals and Keys, then pan them left"). Text giving no
 * instruction always stays: "Mute Vocals. Keys too.", "Turn down these tracks by 3 dB\nBass\nDrums".
 */
export function scopeToInstruction(input: InstructionScopeInput): string {
    const naming = getOtherInstructions(input).filter((range) =>
        input.reader.namesTracks(input.text.slice(range.start, range.end))
    );
    if (!readsBackToAntecedent(input)) {
        return naming.reduce(blankRange, input.text);
    }
    const antecedent = naming.findLast((range) => range.end <= input.instruction.start);
    return naming.filter((range) => range !== antecedent).reduce(blankRange, input.text);
}
