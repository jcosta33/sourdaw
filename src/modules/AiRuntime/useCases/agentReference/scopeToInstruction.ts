import { type AgentReferenceTextRange } from './findAgentReferenceNameSpans';
import { findSentenceEnd } from './findSentenceEnd';
import { PROJECT_REFERENCE_MASK_GLYPH } from './groundingStrategies/maskProjectReferences';

/** How the scope reads the request: the track names it states and the instructions it gives. */
export type InstructionReader = {
    /** Whether the text names a track by whole name, id or position. */
    namesTrack: (text: string) => boolean;
    /** Where the text first refers back with "it", "its" or "that track". */
    findBackReference: (text: string) => number | undefined;
    /** Whether the masked clause gives an instruction of its own. */
    givesInstruction: (masked: string) => boolean;
};

type Clause = AgentReferenceTextRange & { masked: string };

export type InstructionScopeInput = {
    text: string;
    maskedPrompt: string;
    clauses: readonly Clause[];
    instruction: AgentReferenceTextRange;
    reader: InstructionReader;
};

/** What a list of names holds besides its masked names: joiners, "the", "track", punctuation and bullets. */
const NAME_LIST_FILLER = new RegExp(
    String.raw`\b(?:and|or|the|tracks?)\b|[\s,:\-*•${PROJECT_REFERENCE_MASK_GLYPH}]`,
    'giu'
);

/** Whether the masked text is nothing but a list of project names: "Vocals and Keys", "- Bass". */
function listsNamesOnly(masked: string): boolean {
    return masked.includes(PROJECT_REFERENCE_MASK_GLYPH) && masked.replaceAll(NAME_LIST_FILLER, '') === '';
}

/** Where the instruction's body starts past a leading header of names it closes with a colon: "Vocals and Keys: set ...". */
function getHeaderEnd(maskedInstruction: string): number {
    const colon = maskedInstruction.indexOf(':');
    return colon >= 0 && listsNamesOnly(maskedInstruction.slice(0, colon)) ? colon + 1 : 0;
}

/**
 * Whether the earlier clause runs on into the next as one statement of names: it gives no
 * instruction, and it is a line or header of names or shares the next one's sentence ("For Vocals
 * and Keys, ...", "Vocals\nKeys").
 */
function joinsAntecedent(input: InstructionScopeInput, previous: Clause, next: Clause): boolean {
    if (input.reader.givesInstruction(previous.masked)) {
        return false;
    }
    return (
        listsNamesOnly(previous.masked) ||
        findSentenceEnd(input.maskedPrompt.slice(previous.end, next.start)) === undefined
    );
}

/**
 * Where among the earlier clauses the instruction's tracks are named: the nearest clause naming one,
 * or, for an instruction a header of names opens, the clause right before it when it lists names
 * only. -1 when there is none.
 */
function findAntecedentIndex(
    input: InstructionScopeInput,
    earlier: readonly Clause[],
    opensWithHeader: boolean
): number {
    if (!opensWithHeader) {
        return earlier.findLastIndex((clause) => input.reader.namesTrack(input.text.slice(clause.start, clause.end)));
    }
    const last = earlier.at(-1);
    if (last === undefined || !listsNamesOnly(last.masked)) {
        return -1;
    }
    return earlier.length - 1;
}

/**
 * The earlier clauses an instruction naming no track of its own before it refers back, or at all,
 * reads its tracks from: the nearest earlier clause naming one, with the run of names leading into it
 * ("pan it left" after "set Vocals volume to 50%", "set volume to 75%" after "Vocals\nKeys"). An
 * instruction a header of names opens reads only the names listed right before it.
 */
function getAntecedentRange(input: InstructionScopeInput): AgentReferenceTextRange | undefined {
    const { text, maskedPrompt, clauses, instruction, reader } = input;
    const header = getHeaderEnd(maskedPrompt.slice(instruction.start, instruction.end));
    const body = text.slice(instruction.start + header, instruction.end);
    if (reader.namesTrack(body.slice(0, reader.findBackReference(body)))) {
        return undefined;
    }
    const earlier = clauses.filter((clause) => clause.end <= instruction.start);
    const antecedent = findAntecedentIndex(input, earlier, header > 0);
    const antecedentClause = earlier[antecedent];
    if (antecedentClause === undefined) {
        return undefined;
    }
    let first = antecedentClause;
    for (const previous of earlier.slice(0, antecedent).reverse()) {
        if (!joinsAntecedent(input, previous, first)) {
            break;
        }
        first = previous;
    }
    return { start: first.start, end: antecedentClause.end };
}

/**
 * The text with everything outside the instruction blanked, except the earlier clauses it reads its
 * tracks from when it names none of its own.
 */
export function scopeToInstruction(input: InstructionScopeInput): string {
    const ranges = [input.instruction, getAntecedentRange(input)].filter((range) => range !== undefined);
    return ranges.reduce(
        (scoped, { start, end }) => `${scoped.slice(0, start)}${input.text.slice(start, end)}${scoped.slice(end)}`,
        ' '.repeat(input.text.length)
    );
}
