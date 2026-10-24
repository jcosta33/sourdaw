import { type ProjectContext } from '../../models/ProjectContext';
import { scanPromptQuotedText } from '../../transformers/promptParser/promptQuotedText';

import { getBestAgentReferenceNameRanges } from './getBestAgentReferenceNameRanges';

/**
 * An explicit protection is a preservation clause ("leave Keys alone", "keep Bass pan as is") or a
 * prohibition ("do not change the fader of Strings"). The protected-object model binds tracks, clips
 * and device parameters, so a reference resolves only when it names one of those, or the selected
 * track through a selection phrase. A VCA group has no protected-object form, and a position ("the
 * first track") is not a name the shared resolver binds. A phrase for the rest of the mix or for a
 * project-wide setting such as the tempo names no target at all, so it neither resolves nor fails to. A clause holding a reference that resolves
 * to nothing cannot be enforced, and an incomplete protection is a rejection, never an empty
 * permission set.
 */

const PROTECTION_VERB = String.raw`(?:leave|leaving|keep|keeping|preserve|preserving|retain|retaining)`;
const PROHIBITION = String.raw`(?:do\s+not|don['’]t|never)\s+(?:change|touch|alter|adjust|modify|edit|affect)`;
const PROTECTION_CLOSER = String.raw`(?:alone|unchanged|untouched|intact|as[\s-]+is|as\s+(?:it\s+is|they\s+are)|the\s+same)`;
const CARVE_OUT = String.raw`(?:except(?:\s+for)?|excluding|besides|but\s+not|apart\s+from|other\s+than)`;
const INSTRUCTION_VERBS = String.raw`(?:turn|set|make|raise|lower|boost|cut|reduce|increase|decrease|add|create|remove|delete|rename|insert|copy|duplicate|trim|split|quantize|transpose|normalize|bring|change|adjust|apply|load|import|export|bounce|render)`;
const CLAUSE_BOUNDARY = String.raw`(?:[;\n]|[.!?](?=\s|$))`;
const REFERENCE_STOP = String.raw`(?:${CLAUSE_BOUNDARY}|\b(?:then|but|${PROTECTION_VERB}|${INSTRUCTION_VERBS})\b)`;
const PROHIBITION_STOP = String.raw`(?:${REFERENCE_STOP}|\b(?:after|before|when|while|once|until|if|because|since|so)\b)`;
const referenceCharacter = String.raw`(?:(?!${REFERENCE_STOP})[\s\S])`;
const prohibitionCharacter = String.raw`(?:(?!${PROHIBITION_STOP})[\s\S])`;

const preservationPattern = new RegExp(
    String.raw`\b${PROTECTION_VERB}\s+(${referenceCharacter}+?)\s+${PROTECTION_CLOSER}\b(?:\s+${CARVE_OUT}\s+(${referenceCharacter}+))?`,
    'dgiu'
);
const prohibitionPattern = new RegExp(String.raw`\b${PROHIBITION}\s+(${prohibitionCharacter}+)`, 'dgiu');

/** What separates two members of one reference list: "A, B", "A and B", "A as well as B", "A plus B". */
const MEMBER_SEPARATOR =
    /\s*,\s*(?:and\b\s*)?|\s+(?:and\s+also|and|or|as\s+well\s+as|along\s+with|together\s+with|plus)\s+|\s*&\s*/giu;

/** A phrase naming the rest of the mix, which stands for no particular object a protection must bind. */
const REST_OF_MIX =
    /^(?:everything(?:\s+else)?|the\s+rest(?:\s+of\s+the\s+(?:mix|project|tracks|session|arrangement))?|(?:all\s+)?(?:the\s+)?other\s+tracks|the\s+others|the\s+remaining\s+tracks)$/iu;

/** A project-wide setting, which is protected by no object a batch could target and binds none. */
const PROJECT_SETTING =
    /^(?:the\s+)?(?:tempo|bpm|time\s+signature|meter|key\s+signature|loop(?:\s+region)?|metronome)$/iu;

/** The phrases that stand for the selected track, which the shared resolver gives selection evidence. */
const SELECTION_PHRASE = /\b(?:it|its|this|(?:the\s+)?(?:selected|current))(?:\s+(?:track|channel))?\b/giu;

const NAME_MARKER = /□+/gu;
const CONNECTIVE_WORDS: ReadonlySet<string> = new Set(['the', 'a', 'an', 'of', 'its', 'their', 'and', 'or', 'both']);
/** The mixer controls a protection may qualify an object with, or state alone. */
const CONTROL_WORDS: ReadonlySet<string> = new Set([
    'pan',
    'panning',
    'solo',
    'soloing',
    'mute',
    'muting',
    'fader',
    'faders',
    'gain',
    'level',
    'levels',
    'volume',
    'arm',
    'send',
    'sends',
    'routing',
    'output',
    'settings',
    'setting',
    'automation',
]);
/** Generic nouns that may follow a name ("Keys track"), never stand for an object themselves. */
const NOUN_WORDS: ReadonlySet<string> = new Set(['track', 'tracks', 'channel', 'channels', 'clip', 'clips']);

type ReferenceMember = { text: string; residue: string };

/** The objects a protection binds: tracks, their clips and devices and device parameters, by name or id. */
function getProtectableObjects(context: ProjectContext): { id: string; name: string }[] {
    const objects = context.tracks.flatMap((track) => [
        { id: track.id, name: track.name },
        { id: track.id, name: track.id },
        ...track.clips.flatMap((clip) => [
            { id: clip.id, name: clip.name },
            { id: clip.id, name: clip.id },
        ]),
        ...track.devices.flatMap((device) => [
            { id: device.id, name: device.name ?? device.type },
            { id: device.id, name: device.id },
            ...(device.parameters ?? []).flatMap((parameter) => [
                { id: `${device.id}:${parameter.id}`, name: parameter.name },
            ]),
        ]),
    ]);
    return objects.filter((object) => object.name.length > 0);
}

function stripTrailingConnective(reference: string): string {
    return reference.replace(/(?:[\s,]|\band\b|\bor\b)+$/iu, '').trim();
}

/** The reference texts of every preservation, prohibition and carve-out clause, as the prompt wrote them. */
function readProtectionReferenceTexts(prompt: string): string[] {
    const { maskedText } = scanPromptQuotedText(prompt);
    const references: string[] = [];
    for (const pattern of [preservationPattern, prohibitionPattern]) {
        for (const match of maskedText.matchAll(pattern)) {
            for (const span of match.indices?.slice(1) ?? []) {
                if (span !== undefined) {
                    references.push(prompt.slice(span[0], span[1]));
                }
            }
        }
    }
    return references.map(stripTrailingConnective).filter((reference) => reference.length > 0);
}

/** The text with every range one of the project's objects is named in blanked out. */
function blankNamedObjects(text: string, objects: readonly { id: string; name: string }[]): string {
    const ranges = getBestAgentReferenceNameRanges(text, objects, 'with-number-forms');
    return ranges.reduce(
        (blanked, { start, end }) => `${blanked.slice(0, start)}${'□'.repeat(end - start)}${blanked.slice(end)}`,
        text
    );
}

/** The members of one reference list. A name is blanked first, so an "and" inside one never splits it. */
function splitMembers(reference: string, objects: readonly { id: string; name: string }[]): ReferenceMember[] {
    const blanked = blankNamedObjects(reference, objects);
    const members: ReferenceMember[] = [];
    let start = 0;
    const addMember = (end: number) => {
        const text = reference.slice(start, end).trim();
        if (text.length > 0) {
            members.push({ text, residue: blanked.slice(start, end) });
        }
    };
    for (const separator of blanked.matchAll(MEMBER_SEPARATOR)) {
        addMember(separator.index);
        start = separator.index + separator[0].length;
    }
    addMember(blanked.length);
    return members;
}

type MemberReading = { unaccountedWords: string[]; namesSelection: boolean };

/** The words of a member no protectable object, control or connective accounts for. */
function readMember(member: ReferenceMember, hasSelection: boolean): MemberReading {
    const namesSelection = hasSelection && new RegExp(SELECTION_PHRASE).test(member.residue);
    const residue = namesSelection ? member.residue.replaceAll(SELECTION_PHRASE, ' □ ') : member.residue;
    const nameCount = residue.match(NAME_MARKER)?.length ?? 0;
    const words = residue
        .replaceAll(NAME_MARKER, ' ')
        .split(/[^\p{L}\p{N}]+/u)
        .filter((word) => word.length > 0);
    const controlCount = words.filter((word) => CONTROL_WORDS.has(word.toLocaleLowerCase())).length;
    const unaccounted = words.filter((word) => {
        const lowered = word.toLocaleLowerCase();
        return !(
            CONNECTIVE_WORDS.has(lowered) ||
            CONTROL_WORDS.has(lowered) ||
            (nameCount > 0 && NOUN_WORDS.has(lowered))
        );
    });
    if (unaccounted.length > 0) {
        return { unaccountedWords: unaccounted, namesSelection };
    }
    return { unaccountedWords: nameCount + controlCount > 0 ? [] : words, namesSelection };
}

export type ProtectionReading = {
    /** Every reference of a protection clause that resolves to no protectable target, as written, once each. */
    unresolved: string[];
    /** Whether a protection resolves a reference through the selected track ("leave this track alone"). */
    protectsSelectedTrack: boolean;
};

/**
 * Reads every explicit protection clause of the request. A list resolves only when each member does;
 * a protection naming the rest of the mix, a project-wide setting or only mixer controls ("leave pan
 * alone") binds no object and stays complete.
 */
export function readExplicitProtections(prompt: string, context: ProjectContext): ProtectionReading {
    const references = readProtectionReferenceTexts(prompt);
    const unresolved = new Set<string>();
    let protectsSelectedTrack = false;
    if (references.length > 0) {
        const objects = getProtectableObjects(context);
        const hasSelection = context.tracks.some((track) => track.id === context.selectedTrackId);
        for (const reference of references) {
            for (const member of splitMembers(reference, objects)) {
                const phrase = member.text.replaceAll(/[^\p{L}\p{N}\s]+/gu, '').trim();
                if (REST_OF_MIX.test(phrase) || PROJECT_SETTING.test(phrase)) {
                    continue;
                }
                const reading = readMember(member, hasSelection);
                protectsSelectedTrack ||= reading.namesSelection;
                if (reading.unaccountedWords.length > 0) {
                    unresolved.add(reading.unaccountedWords.join(' '));
                }
            }
        }
    }
    return { unresolved: [...unresolved], protectsSelectedTrack };
}
