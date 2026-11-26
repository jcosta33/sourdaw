import { type AgentReferenceTextRange } from './findAgentReferenceNameSpans';
import { findSentenceEnd } from './findSentenceEnd';
import { PROJECT_REFERENCE_MASK_GLYPH } from './groundingStrategies/maskProjectReferences';
import { readTextLines } from './readTextLines';

/** How the scope reads the request: the tracks it names and the instructions it gives. */
export type InstructionReader = {
    /** Whether the text names a track by whole name, id or position, or a narrower role ("the lead vocal"). */
    namesTracks: (text: string) => boolean;
    /** Where the text first refers back to tracks stated before it: "it", "them", "that track". */
    findBackReference: (text: string) => number | undefined;
    /** Whether the masked clause or line gives an instruction of its own. */
    givesInstruction: (masked: string) => boolean;
    /** The whole instruction a clause giving one opens, as the instruction reading extends it. */
    extendInstruction: (clause: AgentReferenceTextRange) => AgentReferenceTextRange;
};

type Clause = AgentReferenceTextRange & { masked: string };

export type InstructionScopeInput = {
    text: string;
    maskedPrompt: string;
    clauses: readonly Clause[];
    instruction: AgentReferenceTextRange;
    reader: InstructionReader;
};

/** A stretch of the request before the instruction: a whole earlier instruction, or a statement giving none. */
type Unit = AgentReferenceTextRange & { givesInstruction: boolean };

/** What a header of names holds besides its masked names: joiners, "the", "track", punctuation and bullets. */
const NAME_HEADER_FILLER = new RegExp(
    String.raw`\b(?:and|or|the|tracks?)\b|[\s,&\-*•${PROJECT_REFERENCE_MASK_GLYPH}]`,
    'giu'
);

/**
 * Where the instruction's body starts past a leading header of names it closes with a colon ("Vocals
 * and Keys: set ..."); a colon after any other word ("at 1:30") closes no header.
 */
function getHeaderEnd(maskedInstruction: string): number {
    const colon = maskedInstruction.indexOf(':');
    if (colon < 0) {
        return 0;
    }
    const header = maskedInstruction.slice(0, colon);
    const namesOnly = header.includes(PROJECT_REFERENCE_MASK_GLYPH) && header.replaceAll(NAME_HEADER_FILLER, '') === '';
    return namesOnly ? colon + 1 : 0;
}

/**
 * The lines right before the instruction's own line that give no instruction, when the instruction
 * opens its line: a list of names it reads whole ("1. Bass\n2. Drums\nTurn down both by 3 dB").
 */
function getListRun({ maskedPrompt, instruction, reader }: InstructionScopeInput): AgentReferenceTextRange | undefined {
    const lineStart = maskedPrompt.lastIndexOf('\n', instruction.start - 1) + 1;
    if (lineStart === 0 || maskedPrompt.slice(lineStart, instruction.start).trim() !== '') {
        return undefined;
    }
    let start = lineStart;
    for (const line of readTextLines(maskedPrompt, { start: 0, end: lineStart }).reverse()) {
        if (reader.givesInstruction(maskedPrompt.slice(line.start, line.end))) {
            break;
        }
        start = line.start;
    }
    return start === lineStart ? undefined : { start, end: lineStart };
}

/**
 * The request before `end` read as units: each instruction whole, as the instruction reading extends
 * it, and each run of clauses within one sentence that gives none ("On Vocals and Keys, ...").
 */
function getEarlierUnits({ maskedPrompt, clauses, reader }: InstructionScopeInput, end: number): Unit[] {
    const units: Unit[] = [];
    for (const clause of clauses.filter((candidate) => candidate.end <= end)) {
        const last = units.at(-1);
        if (last !== undefined && clause.start < last.end) {
            continue;
        }
        if (reader.givesInstruction(clause.masked)) {
            const extended = reader.extendInstruction(clause);
            units.push({ start: clause.start, end: Math.min(extended.end, end), givesInstruction: true });
        } else if (
            last !== undefined &&
            !last.givesInstruction &&
            findSentenceEnd(maskedPrompt.slice(last.end, clause.start)) === undefined
        ) {
            units[units.length - 1] = { ...last, end: clause.end };
        } else {
            units.push({ start: clause.start, end: clause.end, givesInstruction: false });
        }
    }
    return units;
}

/** Whether the request names a track within the range. */
function namesTracksIn({ text, reader }: InstructionScopeInput, { start, end }: AgentReferenceTextRange): boolean {
    return reader.namesTracks(text.slice(start, end));
}

/**
 * The one earlier unit an instruction naming no track of its own, or none before it refers back,
 * reads its tracks from: the run of list lines leading into its line when it names any, else the
 * nearest earlier instruction or statement naming one ("pan them left" after "Mute Vocals and Keys").
 * An instruction a header of names opens reads only a statement leading into it on its sentence.
 */
function getAntecedentRange(input: InstructionScopeInput): AgentReferenceTextRange | undefined {
    const { text, maskedPrompt, instruction, reader } = input;
    const header = getHeaderEnd(maskedPrompt.slice(instruction.start, instruction.end));
    const body = text.slice(instruction.start + header, instruction.end);
    if (reader.namesTracks(body.slice(0, reader.findBackReference(body)))) {
        return undefined;
    }
    const listRun = getListRun(input);
    if (listRun !== undefined && namesTracksIn(input, listRun)) {
        return listRun;
    }
    const units = getEarlierUnits(input, listRun?.start ?? instruction.start);
    if (header === 0) {
        return units.findLast((unit) => namesTracksIn(input, unit));
    }
    const leading = units.at(-1);
    const leadsIn =
        leading !== undefined &&
        !leading.givesInstruction &&
        findSentenceEnd(maskedPrompt.slice(leading.end, instruction.start)) === undefined;
    return leadsIn && namesTracksIn(input, leading) ? leading : undefined;
}

/**
 * The text with everything outside the instruction blanked, except the earlier unit it reads its
 * tracks from when it names none of its own.
 */
export function scopeToInstruction(input: InstructionScopeInput): string {
    const ranges = [input.instruction, getAntecedentRange(input)].filter((range) => range !== undefined);
    return ranges.reduce(
        (scoped, { start, end }) => `${scoped.slice(0, start)}${input.text.slice(start, end)}${scoped.slice(end)}`,
        ' '.repeat(input.text.length)
    );
}
