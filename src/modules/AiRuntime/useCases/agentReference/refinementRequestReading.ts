import { type ProjectContext } from '../../models/ProjectContext';

import { type RefinementClause } from './bindRefinementFigure';
import { escapeRegExp } from './groundingStrategies/escapeRegExp';
import { findPromptNumbers } from './groundingStrategies/findPromptNumbers';
import { getPromptClauses } from './groundingStrategies/getPromptClauses';
import { maskProjectReferences, reservedVcaGroupReferenceWords } from './groundingStrategies/maskProjectReferences';
import { maskQuotedLabels } from './groundingStrategies/maskQuotedLabels';
import { normalizePromptText } from './groundingStrategies/normalizePromptText';
import { type PromptClause } from './groundingStrategies/promptScope';

/** A named object of the open project, and every object id the name can denote. */
export type ReferenceCandidate = { name: string; denotes: ReadonlySet<string> };

export type ClauseReference = { start: number; end: number; denotes: ReadonlySet<string> };

/** An object name a removal states, and the operations a trailing operation word narrows it to. */
export type StatedReference = { name: string; operations: readonly string[] | null };

/**
 * The verbs a removal opens with, in normalized words. Both the basis route and the stored-card check
 * read removals by this one list, so no verb removes a pending change on one route and not the other.
 */
const REMOVAL_VERBS: readonly string[] = ['remove', 'drop', 'omit', 'exclude', 'skip', 'leave out', 'take out'];
/**
 * The only words a removal verb may follow, in normalized words ("I'd" reads "i d", "let's" reads
 * "let s"), any number of them in any order: a request opening ahead of its verb ("could you please
 * remove", "okay, let's drop"). The list is closed: any other word before the verb ("don't remove",
 * "you shouldn't remove", "no need to remove") may say the verb is not what the request asks, so the
 * clause removes nothing. Each opener asks for the removal or only softens it; none negates or defers it.
 * No opener spans an `and`: the clause splitter cuts there, so "go ahead and remove" reaches the verb as
 * its own clause.
 */
const REMOVAL_OPENERS: readonly string[] = [
    'please',
    'can you',
    'could you',
    'would you',
    'you can',
    'actually',
    'also',
    'and',
    'then',
    'just',
    'now',
    'ok',
    'okay',
    'let s',
    'let us',
    'we should',
    'we can',
    'instead',
    'yes',
    'i want you to',
    'i d like you to',
    'i want to',
    'i d like to',
];
const wordsPattern = (phrases: readonly string[]) =>
    phrases.map((phrase) => phrase.split(' ').map(escapeRegExp).join('\\s+')).join('|');
const REMOVAL_OPENING = new RegExp(`^(?:(?:${wordsPattern(REMOVAL_OPENERS)})(?:\\s+|$))*$`, 'u');
const REMOVAL = new RegExp(
    `^(?:(?:${wordsPattern(REMOVAL_OPENERS)})\\s+)*(?:${wordsPattern(REMOVAL_VERBS)})\\s+(.+)$`,
    'u'
);
const INNER_REMOVAL_SEPARATOR = /\s+(?=(?:except(?:\s+for)?|without)\s)/giu;
const REFERENCE_ARTICLE_WORDS: readonly string[] = ['the', 'a', 'an', 'my', 'its', 'their'];
const REFERENCE_ARTICLES = new RegExp(`^(?:(?:${REFERENCE_ARTICLE_WORDS.join('|')})\\s+)+`, 'u');
/**
 * The words a removal may close on after its object, in normalized words: where it removes from ("from
 * the card", "from the mix"), how wholly ("entirely", "for now") and courtesy ("too", "please", "thanks").
 */
const REFERENCE_TRAILERS =
    /(?:^|\s+)(?:from\s+(?:the\s+|this\s+|that\s+)?(?:pending\s+)?(?:proposal|card|change|batch|list|mix)|from\s+it|too|as\s+well|please|entirely|altogether|completely|for\s+now|thanks|thank\s+you)$/u;
const OPERATION_WORDS: Readonly<Record<string, readonly string[]>> = {
    pan: ['setTrackPan'],
    panning: ['setTrackPan'],
    gain: ['setTrackGain'],
    volume: ['setTrackGain'],
    level: ['setTrackGain'],
    fader: ['setTrackGain'],
    mute: ['muteTrack'],
    solo: ['soloTrack'],
};
const GENERIC_REFERENCE_NOUNS = /\s+(?:track|channel|bus|change|one)$/u;

/** The refinement's clauses: the shared clause splitter, then any trailing `except`/`without` phrase on its own. */
function readClauseSpans(text: string, context: ProjectContext): RefinementClause[] {
    const masked = maskQuotedLabels(maskProjectReferences(text, context));
    return getPromptClauses(text, masked).flatMap((clause) => {
        const cuts = Array.from(clause.masked.matchAll(INNER_REMOVAL_SEPARATOR), (match) => match.index);
        const bounds = [0, ...cuts, clause.masked.length];
        return bounds.slice(0, -1).flatMap((from, index) => {
            const to = bounds[index + 1]!;
            const piece = clause.text.slice(from, to);
            if (piece.trim().length === 0) {
                return [];
            }
            return [
                {
                    start: clause.start + from,
                    end: clause.start + to,
                    text: piece,
                    masked: clause.masked.slice(from, to),
                },
            ];
        });
    });
}

/** Whether a clause states a figure outside the object names it states. */
function statesFigure(clause: PromptClause): boolean {
    return findPromptNumbers(clause.masked).length > 0;
}

/** Any negation a clause states, read from its normalized words outside object names ("don't" reads "don t"). */
const NEGATION_WORD = /(?<![\p{L}\p{N}])(?:not|never|without|except|cannot|\p{L}*n t)(?![\p{L}\p{N}])/u;

function statesNegation(clause: PromptClause): boolean {
    return NEGATION_WORD.test(normalizePromptText(clause.masked));
}

/**
 * The object a removal verb clause names after its verb and openers, or `null` when the clause is no
 * removal. A removal verb in a clause stating a figure changes a level rather than removing it ("drop
 * the Vocals gain to -1 dB", "drop the Vocals level by 1 dB").
 */
function readRemovalObject(clause: PromptClause): string | null {
    if (statesFigure(clause)) {
        return null;
    }
    return REMOVAL.exec(normalizePromptText(clause.text))?.[1] ?? null;
}

/** Whether the words before a removal verb are openers alone, so the verb is what the clause asks. */
function opensRemoval(prefix: string): boolean {
    return REMOVAL_OPENING.test(normalizePromptText(prefix));
}

/**
 * Every object text the clause masking hides, and what each denotes: VCA groups, tracks, devices,
 * their parameters and clips, each by its id and its name. A clause naming one of them names an
 * object, so no name the masking keeps out of a clause's words can leave the clause unscoped; a name
 * of symbols alone ("🎤"), which normalizes to nothing, counts by its raw text.
 */
function collectReferenceCandidates(context: ProjectContext): ReferenceCandidate[] {
    const byName = new Map<string, Set<string>>();
    const add = (name: string | undefined, id: string) => {
        const raw = (name ?? '').trim();
        const normalized = normalizePromptText(raw);
        const key = normalized.length > 0 ? normalized : raw;
        if (key.length === 0) {
            return;
        }
        const ids = byName.get(key) ?? new Set<string>();
        ids.add(id);
        byName.set(key, ids);
    };
    for (const group of context.vcaGroups ?? []) {
        for (const reference of [group.id, group.name]) {
            if (!reservedVcaGroupReferenceWords.has(normalizePromptText(reference))) {
                add(reference, group.id);
            }
        }
    }
    for (const track of context.tracks) {
        add(track.id, track.id);
        add(track.name, track.id);
        for (const device of track.devices) {
            add(device.id, device.id);
            add(device.type, device.id);
            add(device.name, device.id);
            for (const parameter of device.parameters ?? []) {
                add(parameter.id, `${device.id}:${parameter.id}`);
                add(parameter.name, `${device.id}:${parameter.id}`);
            }
        }
        for (const clip of track.clips) {
            add(clip.id, clip.id);
            add(clip.name, clip.id);
        }
    }
    return Array.from(byName, ([name, denotes]) => ({ name, denotes })).sort(
        (left, right) => right.name.length - left.name.length
    );
}

/** Every whole-word project name a clause states, longest first, one reference per stretch of text. */
function findReferences(clauseText: string, candidates: readonly ReferenceCandidate[]): ClauseReference[] {
    const references: ClauseReference[] = [];
    for (const candidate of candidates) {
        const name = candidate.name.split(' ').map(escapeRegExp).join('[^\\p{L}\\p{N}]+');
        const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${name}(?![\\p{L}\\p{N}])`, 'giu');
        for (const match of clauseText.matchAll(pattern)) {
            const start = match.index;
            const end = start + match[0].length;
            if (references.some((reference) => start < reference.end && end > reference.start)) {
                continue;
            }
            references.push({ start, end, denotes: candidate.denotes });
        }
    }
    return references.sort((left, right) => left.start - right.start);
}

/** Normalized words without every reference trailer they close on, however many ("from the card please"). */
function stripReferenceTrailers(words: string): string {
    const stripped = words.replace(REFERENCE_TRAILERS, '');
    return stripped === words ? words : stripReferenceTrailers(stripped);
}

/** The ways a removal can state its object: its full name, then without a trailing generic noun or operation word. */
function readReferenceForms(reference: string): StatedReference[] {
    const name = stripReferenceTrailers(reference).replace(REFERENCE_ARTICLES, '').trim();
    const withoutGenericNoun = (text: string) => text.replace(GENERIC_REFERENCE_NOUNS, '').trim();
    const forms: StatedReference[] = [
        { name, operations: null },
        { name: withoutGenericNoun(name), operations: null },
    ];
    const lastWord = name.split(' ').at(-1) ?? '';
    const operations = OPERATION_WORDS[lastWord];
    if (operations !== undefined && name.includes(' ')) {
        const object = name.slice(0, name.length - lastWord.length).trim();
        forms.push({ name: object, operations }, { name: withoutGenericNoun(object), operations });
    }
    return forms;
}

/**
 * The project object a removal names, read by its full stated name first: a trailing generic noun or
 * operation word is read off only when the full name names nothing, so a track named "Drum Bus" or
 * "Bass Mute" is never read as "Drum" or as the Bass track's mute.
 */
function resolveReference(
    stated: string,
    candidates: readonly ReferenceCandidate[]
): { reference: StatedReference; candidate: ReferenceCandidate } | null {
    for (const reference of readReferenceForms(stated)) {
        const candidate = candidates.find((entry) => entry.name === reference.name);
        if (candidate !== undefined) {
            return { reference, candidate };
        }
    }
    return null;
}

/**
 * How a refinement request reads, shared by the refinement reader of a card with a grounding basis
 * and the removal check of a stored card, so both cut its clauses, read its names and read its
 * removals alike: the clause splitter, the whole-name references read longest name first, the full
 * stated name read before any generic noun or operation word comes off, and the one removal
 * vocabulary.
 */
export const refinementRequestReading = {
    clauses: readClauseSpans,
    statesFigure,
    statesNegation,
    removalVerbs: REMOVAL_VERBS,
    /** The articles a removal may state before its object. */
    articles: REFERENCE_ARTICLE_WORDS,
    /** The operation words a removal may state after its object, narrowing it to that operation. */
    operationWords: Object.keys(OPERATION_WORDS),
    removalObject: readRemovalObject,
    opensRemoval,
    stripTrailers: stripReferenceTrailers,
    candidates: collectReferenceCandidates,
    references: findReferences,
    resolveReference,
} as const;
