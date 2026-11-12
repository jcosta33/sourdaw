import { getMixRecipeCatalog } from '#/modules/Arrangement/useCases';

import {
    type MeasuredPerceptualConstraint,
    type PerceptualConstraintReading,
    type PerceptualConstraintScope,
    type UnsupportedPerceptualConstraint,
} from '../../models/PerceptualConstraint';
import { type ProjectContext } from '../../models/ProjectContext';
import { type SemanticCommandListRoleFamily } from '../../models/SemanticCommandList';
import { unionPerceptualConstraintReadings } from '../../transformers/unionPerceptualConstraintReadings';
import { escapeRegExp } from '../agentReference/groundingStrategies/escapeRegExp';
import { resolveRoleFamily } from '../canonicalRoleFamilies';
import { maskTrackReferences } from '../maskTrackReferences';

type ObjectResolution =
    | { kind: 'mix' }
    | { kind: 'tracks'; trackIds: string[]; families: (SemanticCommandListRoleFamily | null)[] }
    | { kind: 'unresolved' };

type ClauseMatch = { clause: string; object: string | null; start: number };
type MeasuredConstraintId = MeasuredPerceptualConstraint['constraintId'];
/**
 * A clause a measured-hold reader consumed: its own words, the span it covers, the holds it states,
 * and its object. `unreadable` says why the clause cannot be held on any one scope.
 */
type HoldClause = {
    clause: string;
    start: number;
    end: number;
    constraintIds: MeasuredConstraintId[];
    object: string | null;
    unreadable: string | null;
};

const LOW_END = String.raw`(?:low|bottom)[\s-]+end`;
const OBJECT_TAIL = String.raw`(?:\s+(?:of|on|in)\s+(?<object>[^,.;:!?]+?))?`;
const CLAUSE_END = String.raw`(?=\s*(?:$|[,.;:!?]|\b(?:and|but|while|so|then|please)\b))`;
const LOW_END_PROHIBITION = new RegExp(
    String.raw`\b(?:do\s+not|don['’]?t|never|without|no\s+changes?\s+to)\s+(?:(?:touch(?:ing)?|chang(?:e|ing)|alter(?:ing)?|affect(?:ing)?|mess(?:ing)?\s+with)\s+)?the\s+${LOW_END}${OBJECT_TAIL}${CLAUSE_END}`,
    'giu'
);
const LOW_END_PRESERVATION = new RegExp(
    String.raw`\b(?:leave|leaving|keep|keeping|preserve|preserving)\s+the\s+${LOW_END}${OBJECT_TAIL}\s+(?:alone|untouched|unchanged|intact|as\s+(?:it\s+)?is)${CLAUSE_END}`,
    'giu'
);
const QUALITY_VERBS = String.raw`(?:keep|keeping|preserve|preserving|maintain|maintaining|retain|retaining)`;
/** At most four words, so a quality later in the request never reads as this clause's object. */
const QUALITY_OBJECT = String.raw`(?<object>(?:[^\s,.;:!?]+\s+){0,3}?[^\s,.;:!?]+)`;
const OBJECT_MEMBER_SEPARATOR = /\s*(?:,|&|\band\b)\s*/u;
const LEADING_DETERMINER = /^(?:the|my|our|this|that)\s+/u;
const MIX_WORDS = new Set(['mix', 'whole mix', 'song', 'whole song', 'project', 'master', 'master bus']);
const ROLE_WORDS: ReadonlyMap<string, SemanticCommandListRoleFamily> = new Map([
    ['vocal', 'vocal'],
    ['vocals', 'vocal'],
    ['lead vocal', 'vocal'],
    ['lead vocals', 'vocal'],
    ['vox', 'vocal'],
    ['drum', 'drums'],
    ['drums', 'drums'],
    ['bass', 'bass'],
    ['guitar', 'guitar'],
    ['guitars', 'guitar'],
    ['keys', 'keys'],
]);
const MEASURABLE_TRACK_KINDS = new Set(['audio', 'midi', 'bus']);

/**
 * A word an object member may hold: never a conjunction, a direction, a negation or a copula, so a
 * member never runs into the next clause ("The vocal is louder and the drums must not …").
 */
const WORD = String.raw`(?!(?:and|or|but|louder|quieter|softer|is|are|be|not|never|without|cannot|do|does|will|must|should|may|can|don['’]?t|doesn['’]?t|won['’]?t|mustn['’]?t|shouldn['’]?t|can['’]?t)(?![\p{L}\p{N}'’]))[^\s,.;:!?]+`;
const MIX_PRONOUN = String.raw`(?:it|everything|anything)`;
/** The role and mix words an object member may open with, longest first, so "lead vocal" is one member. */
const SCOPE_WORD = Array.from(ROLE_WORDS.keys())
    .concat(Array.from(MIX_WORDS))
    .toSorted((left, right) => right.length - left.length)
    .map((word) =>
        word
            .split(' ')
            .map(escapeRegExp)
            .join(String.raw`\s+`)
    )
    .join('|');
/** A masked track name, a role or mix word, a pronoun, or a determiner and a short noun phrase. */
const OBJECT_MEMBER = String.raw`(?:(?:the|my|our|this|that)\s+${WORD}(?:\s+${WORD}){0,2}?|□+|(?:${SCOPE_WORD}|${MIX_PRONOUN})\b)`;
/**
 * A list of objects. A conjunction continues it only before another member, so "the vocal and the
 * drums" is one list while "the vocal and brighten the drums" ends at "and".
 */
const OBJECT_LIST = String.raw`(?<object>${OBJECT_MEMBER}(?:(?:\s*,\s*(?:and\s+)?|\s+and\s+|\s*&\s*)${OBJECT_MEMBER})*)`;
const LIST_TAIL = String.raw`(?:\s+(?:of|on|in)\s+${OBJECT_LIST})?`;
const NEGATION = String.raw`(?:do\s+not|don['’]?t|never|without)`;
const MODAL_NEGATION = String.raw`(?:must\s+not|mustn['’]?t|should\s+not|shouldn['’]?t|may\s+not|can\s*not|can['’]?t|does\s+not|doesn['’]?t|will\s+not|won['’]?t)`;
/** The object may stand before the verb only at the head of a clause, so it never swallows an earlier clause. */
const CLAUSE_HEAD = String.raw`(?<=^|[,.;:!?]\s*|\b(?:and|but|while|so|then|please)\s+)`;
/** Longest first, so "louder or quieter" is read as one two-way clause, never as a bound on "louder". */
const LOUDNESS_DIRECTION = String.raw`(?<direction>louder\s+or\s+(?:quieter|softer)|(?:quieter|softer)\s+or\s+louder|louder|quieter|softer)`;
/** "sound louder" is a louder clause: the linking verb is never part of the object. */
const DIRECTION_LEAD = String.raw`(?:(?:sound|feel|seem|get|become|be)\s+)?(?:any\s+)?`;
const LOUDNESS_VERB = String.raw`(?<verb>raise|raising|increase|increasing|boost|boosting|push|pushing|turn(?:ing)?\s+up|lower|lowering|reduce|reducing|decrease|decreasing|turn(?:ing)?\s+down|change|changing|alter|altering|touch|touching)`;
const HOLD_SUFFIX = String.raw`(?:\s+(?:the\s+same|unchanged|intact|as\s+(?:it\s+)?is|where\s+it\s+is))?`;
const LOUDNESS_NOUN_WORD = String.raw`(?:level|loudness|volume)`;
const HOLD_NOUN_WORD = String.raw`(?:level|loudness|volume|width|image|field|spread|brightness|dynamics|dynamic\s+range)`;
/** A held noun, with the object it may carry before it ("the vocal level"). */
const holdNoun = (word: string) => String.raw`(?:(?:□+|(?:${SCOPE_WORD})\b)\s+)?(?:(?:overall|stereo)\s+)?${word}\b`;
/** Nouns joined by "and" or commas share the clause's one object: "the width and dynamics of the vocal". */
const nounList = (word: string) =>
    String.raw`(?<nouns>the\s+${holdNoun(word)}(?:(?:\s*,\s*(?:and\s+)?|\s+and\s+)(?:the\s+)?${holdNoun(word)})*)`;
const NOUN_IN_LIST = new RegExp(
    String.raw`(?:(?<pre>□+|(?:${SCOPE_WORD})\b)\s+)?(?:(?:overall|stereo)\s+)?(?<noun>${HOLD_NOUN_WORD})\b`,
    'dgiu'
);
const HOLD_PATTERNS = [
    // "don't make it sound louder", "without making the drums any quieter", "don't let the mix get louder"
    String.raw`\b${NEGATION}\s+(?:make|making|get|getting|let|letting)(?:\s+(?!any\b)${OBJECT_LIST})?\s+${DIRECTION_LEAD}${LOUDNESS_DIRECTION}${CLAUSE_END}`,
    // "the mix must not get louder", "the mix doesn't get louder"
    String.raw`${CLAUSE_HEAD}${OBJECT_LIST}\s+${MODAL_NEGATION}\s+${DIRECTION_LEAD}${LOUDNESS_DIRECTION}${CLAUSE_END}`,
    // "don't raise the level of the drums", "don't change the drums volume"
    String.raw`\b${NEGATION}\s+${LOUDNESS_VERB}\s+${nounList(LOUDNESS_NOUN_WORD)}${LIST_TAIL}${CLAUSE_END}`,
    // "keep the overall level the same", "keep the width and dynamics of the vocal", "keep the stereo width"
    String.raw`\b${QUALITY_VERBS}\s+${nounList(HOLD_NOUN_WORD)}${LIST_TAIL}${HOLD_SUFFIX}${CLAUSE_END}`,
    // "keep the Keys at the same level"
    String.raw`\b(?:keep|keeping)\s+${OBJECT_LIST}\s+at\s+the\s+same\s+${LOUDNESS_NOUN_WORD}${CLAUSE_END}`,
].map((source) => new RegExp(source, 'dgiu'));
/**
 * A direction clause whose object is no list the reader can read ("don't make the vocal brighter and
 * louder"): recorded unsupported rather than held on a guessed scope or dropped.
 */
/** A character of a fallback object: it never crosses a conjunction or another negation into the next clause. */
const IN_CLAUSE = String.raw`(?:(?!\b(?:and|or|but|while|so|then)\b|\b${NEGATION})[^,.;:!?])`;
const UNREADABLE_DIRECTION = new RegExp(
    String.raw`\b${NEGATION}\s+(?:make|making|get|getting|let|letting)\s+(?<object>${IN_CLAUSE}+?(?:\s+(?:and|or))?)\s+${DIRECTION_LEAD}${LOUDNESS_DIRECTION}${CLAUSE_END}`,
    'dgiu'
);
const RAISING_VERB = /^(?:rais|increas|boost|push|turn(?:ing)?\s+up)/iu;
const LOWERING_VERB = /^(?:lower|reduc|decreas|turn(?:ing)?\s+down)/iu;
const MIX_PRONOUNS = new Set(['it', 'everything', 'anything']);
const SCOPE_NAMED = new RegExp(
    String.raw`□|\b(?:${Array.from(ROLE_WORDS.keys(), (word) => escapeRegExp(word)).join('|')})\b`,
    'iu'
);
const QUALITY_OF: Readonly<Record<MeasuredConstraintId, string>> = {
    'loudness-held-v1': 'loudness',
    'loudness-not-raised-v1': 'loudness',
    'loudness-not-lowered-v1': 'loudness',
    'stereo-width-held-v1': 'stereo width',
    'dynamics-held-v1': 'dynamics',
    'brightness-held-v1': 'brightness',
};
/** The catalog descriptors whose preservation a measured hold verifies; `dynamic` is read beside them. */
const DESCRIPTOR_HOLDS: ReadonlyMap<string, MeasuredConstraintId> = new Map([
    ['wide', 'stereo-width-held-v1'],
    ['bright', 'brightness-held-v1'],
    ['dynamic', 'dynamics-held-v1'],
]);

function normalizeObjectText(text: string): string {
    return text
        .toLowerCase()
        .replaceAll(/["'“”‘’]/gu, '')
        .replaceAll(/\s+/gu, ' ')
        .trim()
        .replace(LEADING_DETERMINER, '');
}

function nameVariants(name: string): string[] {
    const normalized = normalizeObjectText(name);
    return [normalized, `${normalized}s`, normalized.replace(/s$/u, '')];
}

function resolveMember(member: string, context: ProjectContext): ObjectResolution {
    const normalized = normalizeObjectText(member);
    if (normalized.length === 0) {
        return { kind: 'unresolved' };
    }
    if (MIX_WORDS.has(normalized)) {
        return { kind: 'mix' };
    }
    const tracks = context.tracks.filter((track) => MEASURABLE_TRACK_KINDS.has(track.kind));
    const named = tracks.filter((track) => nameVariants(track.name).includes(normalized));
    if (named.length > 0) {
        return { kind: 'tracks', trackIds: named.map((track) => track.id), families: named.map(resolveRoleFamily) };
    }
    const family = ROLE_WORDS.get(normalized);
    const byRole = family === undefined ? [] : tracks.filter((track) => resolveRoleFamily(track) === family);
    if (byRole.length > 0) {
        return {
            kind: 'tracks',
            trackIds: byRole.map((track) => track.id),
            families: byRole.map(() => family ?? null),
        };
    }
    return { kind: 'unresolved' };
}

/** A list ("the Bass and the Keys") resolves member by member; any unresolved member leaves the whole unresolved. */
function resolveConstraintObject(object: string, context: ProjectContext): ObjectResolution {
    const members = object.split(OBJECT_MEMBER_SEPARATOR).filter((member) => member.trim().length > 0);
    const trackIds: string[] = [];
    const families: (SemanticCommandListRoleFamily | null)[] = [];
    for (const member of members) {
        const resolved = resolveMember(member, context);
        if (resolved.kind !== 'tracks') {
            return members.length === 1 ? resolved : { kind: 'unresolved' };
        }
        for (const [index, trackId] of resolved.trackIds.entries()) {
            if (!trackIds.includes(trackId)) {
                trackIds.push(trackId);
                families.push(resolved.families[index] ?? null);
            }
        }
    }
    if (trackIds.length === 0) {
        return { kind: 'unresolved' };
    }
    return { kind: 'tracks', trackIds, families };
}

function readClauses(pattern: RegExp, masked: string, prompt: string): ClauseMatch[] {
    return Array.from(masked.matchAll(pattern), (match) => {
        const clause = prompt.slice(match.index, match.index + match[0].length).trim();
        const objectText = match.groups?.object;
        if (objectText === undefined) {
            return { clause, object: null, start: match.index };
        }
        const objectStart = match.index + match[0].lastIndexOf(objectText);
        return { clause, object: prompt.slice(objectStart, objectStart + objectText.length), start: match.index };
    });
}

function toScope(resolution: Extract<ObjectResolution, { kind: 'mix' | 'tracks' }>): PerceptualConstraintScope {
    return resolution.kind === 'mix' ? { kind: 'mix' } : { kind: 'tracks', trackIds: resolution.trackIds };
}

function familyOfNoun(noun: string, verb: string | undefined): MeasuredConstraintId {
    const word = noun.toLowerCase();
    if (/^(?:width|image|field|spread)$/u.test(word)) {
        return 'stereo-width-held-v1';
    }
    if (word === 'brightness') {
        return 'brightness-held-v1';
    }
    if (word.startsWith('dynamic')) {
        return 'dynamics-held-v1';
    }
    if (verb !== undefined && RAISING_VERB.test(verb)) {
        return 'loudness-not-raised-v1';
    }
    if (verb !== undefined && LOWERING_VERB.test(verb)) {
        return 'loudness-not-lowered-v1';
    }
    return 'loudness-held-v1';
}

function directionHold(direction: string): MeasuredConstraintId {
    const word = direction.toLowerCase();
    if (word === 'louder') {
        return 'loudness-not-raised-v1';
    }
    if (word === 'quieter' || word === 'softer') {
        return 'loudness-not-lowered-v1';
    }
    return 'loudness-held-v1';
}

function spanText(prompt: string, span: [number, number] | undefined): string | null {
    return span === undefined ? null : prompt.slice(span[0], span[1]);
}

/**
 * Each noun's family, and the clause's one object: the "of" tail or an object standing before a noun.
 * Two different objects in one clause hold no single scope, so the clause is unreadable.
 */
function readNounClause(
    match: RegExpExecArray,
    clause: string,
    prompt: string
): Omit<HoldClause, 'clause' | 'start' | 'end'> {
    const nounsSpan = match.indices?.groups?.nouns;
    const nouns = match.groups?.nouns ?? '';
    const constraintIds: MeasuredConstraintId[] = [];
    const objects = new Map<string, string>();
    const tail = spanText(prompt, match.indices?.groups?.object);
    if (tail !== null) {
        objects.set(normalizeObjectText(tail), tail);
    }
    for (const noun of nouns.matchAll(NOUN_IN_LIST)) {
        const id = familyOfNoun(noun.groups?.noun ?? '', match.groups?.verb);
        if (!constraintIds.includes(id)) {
            constraintIds.push(id);
        }
        const preSpan = noun.indices?.groups?.pre;
        if (preSpan !== undefined && nounsSpan !== undefined) {
            const pre = prompt.slice(nounsSpan[0] + preSpan[0], nounsSpan[0] + preSpan[1]);
            objects.set(normalizeObjectText(pre), pre);
        }
    }
    const [object = null, ...others] = objects.values();
    return {
        constraintIds,
        object,
        unreadable: others.length > 0 ? `“${clause}” names more than one scope for one hold.` : null,
    };
}

function readHoldMatch(match: RegExpExecArray, prompt: string): HoldClause {
    const start = match.index;
    const end = start + match[0].length;
    const clause = prompt.slice(start, end).trim();
    if (match.groups?.nouns !== undefined) {
        return { clause, start, end, ...readNounClause(match, clause, prompt) };
    }
    const direction = match.groups?.direction;
    return {
        clause,
        start,
        end,
        constraintIds: [direction === undefined ? 'loudness-held-v1' : directionHold(direction)],
        object: spanText(prompt, match.indices?.groups?.object),
        unreadable: null,
    };
}

/** Every measured-hold clause in the order it appears, never two over one span, a readable one first. */
function readHoldClauses(masked: string, prompt: string): HoldClause[] {
    const readable = HOLD_PATTERNS.flatMap((pattern) =>
        Array.from(masked.matchAll(pattern), (match) => readHoldMatch(match, prompt))
    );
    const unreadable = Array.from(masked.matchAll(UNREADABLE_DIRECTION), (match): HoldClause => {
        const object = spanText(prompt, match.indices?.groups?.object) ?? '';
        return {
            ...readHoldMatch(match, prompt),
            unreadable: `“${object}” names no track or mix whose loudness can be measured.`,
        };
    });
    // A readable clause inside a fallback span wins: the fallback only records what no reader reads.
    const unclaimed = unreadable.filter(
        (clause) => !readable.some((other) => other.start < clause.end && clause.start < other.end)
    );
    const clauses = readable.concat(unclaimed).toSorted((left, right) => left.start - right.start);
    return clauses.filter(
        (clause, index) =>
            !clauses.slice(0, index).some((other) => other.start < clause.end && clause.start < other.end)
    );
}

/**
 * A hold's scope. No object means the mix; a pronoun means the mix only while the request names no
 * track or role before it, since otherwise "it" could be either.
 */
function resolveHoldObject(
    object: string | null,
    start: number,
    masked: string,
    context: ProjectContext
): ObjectResolution | { kind: 'ambiguous' } {
    if (object === null) {
        return { kind: 'mix' };
    }
    if (MIX_PRONOUNS.has(normalizeObjectText(object))) {
        return SCOPE_NAMED.test(masked.slice(0, start)) ? { kind: 'ambiguous' } : { kind: 'mix' };
    }
    return resolveConstraintObject(object, context);
}

function pushMeasuredHolds(
    reading: PerceptualConstraintReading,
    hold: Pick<HoldClause, 'clause' | 'start' | 'object' | 'constraintIds' | 'unreadable'>,
    masked: string,
    context: ProjectContext
) {
    const { clause, object, constraintIds } = hold;
    const qualities = Array.from(new Set(constraintIds.map((id) => QUALITY_OF[id]))).join(' and ');
    if (hold.unreadable !== null) {
        reading.unsupported.push({ constraintId: 'unsupported', clause, reason: hold.unreadable });
        return;
    }
    const resolution = resolveHoldObject(object, hold.start, masked, context);
    if (resolution.kind === 'ambiguous') {
        reading.unsupported.push({
            constraintId: 'unsupported',
            clause,
            reason: `“${object ?? ''}” names no single scope: the request names a track or role before it.`,
        });
        return;
    }
    if (resolution.kind === 'unresolved') {
        reading.unsupported.push({
            constraintId: 'unsupported',
            clause,
            reason: `“${object ?? ''}” names no track or mix whose ${qualities} can be measured.`,
        });
        return;
    }
    for (const constraintId of constraintIds) {
        reading.constraints.push({
            constraintId,
            clause,
            scope: toScope(resolution),
            protection: { kind: 'measured' },
        });
    }
}

/** The masked text with each consumed clause blanked, so no later reader reads its words again. */
function maskClauses(masked: string, clauses: readonly HoldClause[]): string {
    const characters = masked.split('');
    for (const { start, end } of clauses) {
        characters.fill(' ', start, end);
    }
    return characters.join('');
}

function readLowEndConstraints(
    masked: string,
    prompt: string,
    context: ProjectContext,
    reading: PerceptualConstraintReading
) {
    const clauses = [
        ...readClauses(LOW_END_PROHIBITION, masked, prompt),
        ...readClauses(LOW_END_PRESERVATION, masked, prompt),
    ].toSorted((left, right) => left.start - right.start);
    for (const { clause, object } of clauses) {
        const resolution: ObjectResolution =
            object === null ? { kind: 'mix' } : resolveConstraintObject(object, context);
        if (resolution.kind === 'unresolved') {
            reading.unsupported.push({
                constraintId: 'unsupported',
                clause,
                reason: `“${object ?? ''}” names no track or mix the low end can be measured on.`,
            });
            continue;
        }
        reading.constraints.push({
            constraintId: 'low-end-untouched-v1',
            clause,
            scope: toScope(resolution),
            protection: { kind: 'exclude-dimension', dimension: 'low-frequency-band' },
        });
    }
}

type QualityPattern = {
    pattern: RegExp;
    termPattern: RegExp;
    descriptorOf: (term: string) => string | undefined;
};

/**
 * A kept quality: a catalog term, or "dynamic", which no recipe produces but a crest factor measures.
 * Further terms joined by "and", "but" or commas share the object ("keep the vocal intimate and
 * dynamic"), and are read only when the clause ends after them, so "and warm up the drums" is not one.
 */
function readQualityPattern(): QualityPattern {
    const catalog = getMixRecipeCatalog();
    const entries = [
        ...catalog.descriptors.flatMap((descriptor) =>
            catalog.descriptorTerms[descriptor].map((term) => ({ term, descriptor }))
        ),
        { term: 'dynamic', descriptor: 'dynamic' },
    ];
    const terms = entries
        .map((entry) => entry.term)
        .toSorted((left, right) => right.length - left.length)
        .map((term) =>
            term
                .split(' ')
                .map(escapeRegExp)
                .join(String.raw`[\s-]+`)
        )
        .join('|');
    const term = String.raw`(?:${terms})(?![\p{L}\p{N}])`;
    const pattern = new RegExp(
        String.raw`\b${QUALITY_VERBS}\s+${QUALITY_OBJECT}\s+(?:sounding\s+|feeling\s+|as\s+)?(?<term>${term})(?<more>(?:(?:\s*,\s*(?:(?:and|but)\s+)?|\s+(?:and|but)\s+)(?:as\s+)?${term})+${CLAUSE_END})?`,
        'giu'
    );
    const descriptorOf = (candidate: string): string | undefined => {
        const normalized = candidate.toLowerCase().replaceAll(/[\s-]+/gu, ' ');
        return entries.find((entry) => entry.term.replaceAll('-', ' ') === normalized)?.descriptor;
    };
    return { pattern, termPattern: new RegExp(term, 'giu'), descriptorOf };
}

function unsupportedQuality(clause: string, reason: string): UnsupportedPerceptualConstraint {
    return { constraintId: 'unsupported', clause, reason };
}

function readIntimacy(clause: string, object: string, context: ProjectContext, reading: PerceptualConstraintReading) {
    const resolution = resolveConstraintObject(object, context);
    const vocal =
        resolution.kind === 'tracks' &&
        (ROLE_WORDS.get(normalizeObjectText(object)) === 'vocal' ||
            resolution.families.every((family) => family === 'vocal'));
    if (resolution.kind !== 'tracks' || !vocal) {
        reading.unsupported.push(
            unsupportedQuality(clause, `Intimacy is measured only on vocal tracks, and “${object}” names none.`)
        );
        return;
    }
    reading.constraints.push({
        constraintId: 'vocal-intimacy-v1',
        clause,
        scope: { kind: 'tracks', trackIds: resolution.trackIds },
        protection: { kind: 'exclude-dimension', dimension: 'ambience' },
    });
}

function readQualityConstraints(
    masked: string,
    prompt: string,
    context: ProjectContext,
    reading: PerceptualConstraintReading
) {
    const { pattern, termPattern, descriptorOf } = readQualityPattern();
    for (const match of masked.matchAll(pattern)) {
        const objectText = match.groups?.object ?? '';
        const objectStart = match.index + match[0].indexOf(objectText);
        const object = prompt.slice(objectStart, objectStart + objectText.length);
        // "keep the lo-fi vibe" states a quality with no object to hold it on.
        if (normalizeObjectText(object).length === 0) {
            continue;
        }
        const clause = prompt.slice(match.index, match.index + match[0].length).trim();
        const terms = [
            match.groups?.term ?? '',
            ...Array.from((match.groups?.more ?? '').matchAll(termPattern), (entry) => entry[0]),
        ];
        for (const term of terms) {
            const descriptor = descriptorOf(term);
            const hold = descriptor === undefined ? undefined : DESCRIPTOR_HOLDS.get(descriptor);
            if (hold !== undefined) {
                pushMeasuredHolds(
                    reading,
                    { clause, start: match.index, object, constraintIds: [hold], unreadable: null },
                    masked,
                    context
                );
                continue;
            }
            if (descriptor === 'intimate') {
                readIntimacy(clause, object, context, reading);
                continue;
            }
            reading.unsupported.push(
                unsupportedQuality(clause, `No measurement the application takes shows that “${term}” holds.`)
            );
        }
    }
}

/**
 * Reads the request's perceptual constraints: a prohibition or preservation of the low end ("don't
 * touch the low end", "leave the low end of the Bass alone"); a loudness clause, one-way ("don't make
 * it louder", a bound that lets it get quieter) or two-way ("don't change the level", a hold); a kept
 * stereo width, dynamics or brightness ("keep the stereo width", "keep the drums as dynamic as they
 * are"); and a preserved quality ("keep the vocal intimate", "keep the mix wide"). A quality is any
 * term of the mix recipe catalog's descriptor vocabulary; one with no measured invariant, or an object
 * that resolves to nothing it can be measured on, is reported unsupported rather than dropped, so the
 * batch it rides can never be approved as verified.
 */
export function compilePerceptualConstraints(prompt: string, context: ProjectContext): PerceptualConstraintReading {
    // A name keeps its place as one masked word, so a clause still holds it as its object, which is
    // then read from the prompt itself; a quality word inside a name ("Warm Pad") states nothing.
    const masked = maskTrackReferences(prompt, context, '□');
    const reading: PerceptualConstraintReading = { constraints: [], unsupported: [] };
    readLowEndConstraints(masked, prompt, context, reading);
    const holds = readHoldClauses(masked, prompt);
    for (const hold of holds) {
        pushMeasuredHolds(reading, hold, masked, context);
    }
    // "keep the stereo width" would otherwise read again as the quality "width" held on "the".
    readQualityConstraints(maskClauses(masked, holds), prompt, context, reading);
    return unionPerceptualConstraintReadings(reading);
}
