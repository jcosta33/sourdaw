import { type AgentReferenceTextRange } from './findAgentReferenceNameSpans';

/** How the scope reads the request: the track names it states and the instructions it gives. */
export type InstructionReader = {
    /** Whether the text names a track by whole name, id or position. */
    namesTrack: (text: string) => boolean;
    /** Where the text first refers back with "it", "its" or "that track". */
    findBackReference: (text: string) => number | undefined;
    /** Whether the masked clause gives an instruction of its own. */
    givesInstruction: (masked: string) => boolean;
};

export type InstructionScopeInput = {
    text: string;
    maskedPrompt: string;
    clauses: readonly (AgentReferenceTextRange & { masked: string })[];
    instruction: AgentReferenceTextRange;
    reader: InstructionReader;
};

const SENTENCE_END = /[;!?\n]|\.(?!\d)/u;

/**
 * The nearest earlier clause naming a track, when the instruction refers back before naming one of
 * its own: "pan it left" after "set Vocals volume to 50%" reads Vocals, "set Vocals volume to 75% so
 * it sits better" reads nothing back.
 */
function getAntecedentClause({
    text,
    clauses,
    instruction,
    reader,
}: InstructionScopeInput): AgentReferenceTextRange | undefined {
    const instructionText = text.slice(instruction.start, instruction.end);
    const reference = reader.findBackReference(instructionText);
    if (reference === undefined || reader.namesTrack(instructionText.slice(0, reference))) {
        return undefined;
    }
    return clauses.findLast(
        (clause) => clause.end <= instruction.start && reader.namesTrack(text.slice(clause.start, clause.end))
    );
}

/** The instruction without a leading "<names>:" header: "Vocals and Keys: set volume to 75%". */
function getInstructionBody(instruction: string): string {
    return instruction.slice(instruction.indexOf(':') + 1);
}

/**
 * The clauses leading the instruction's sentence up to it, giving no instruction of their own, when
 * the instruction names no track: "On Vocals, set volume to 75%", "Vocals and Keys: set volume to
 * 75%".
 */
function getLeadingClauses({
    text,
    maskedPrompt,
    clauses,
    instruction,
    reader,
}: InstructionScopeInput): AgentReferenceTextRange | undefined {
    if (reader.namesTrack(getInstructionBody(text.slice(instruction.start, instruction.end)))) {
        return undefined;
    }
    let start = instruction.start;
    for (const clause of clauses.filter((candidate) => candidate.end <= instruction.start).reverse()) {
        if (SENTENCE_END.test(maskedPrompt.slice(clause.end, start)) || reader.givesInstruction(clause.masked)) {
            break;
        }
        start = clause.start;
    }
    return start === instruction.start ? undefined : { start, end: instruction.start };
}

/**
 * The text with everything outside the instruction blanked, except the clauses leading its sentence
 * when it names no track, and the nearest earlier clause naming one when it refers back to it.
 */
export function scopeToInstruction(input: InstructionScopeInput): string {
    const ranges = [input.instruction, getLeadingClauses(input), getAntecedentClause(input)].filter(
        (range) => range !== undefined
    );
    return ranges.reduce(
        (scoped, { start, end }) => `${scoped.slice(0, start)}${input.text.slice(start, end)}${scoped.slice(end)}`,
        ' '.repeat(input.text.length)
    );
}
