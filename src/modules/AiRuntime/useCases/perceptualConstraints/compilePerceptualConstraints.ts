import { getMixRecipeCatalog } from '#/modules/Arrangement/useCases';

import {
    type PerceptualConstraintReading,
    type PerceptualConstraintScope,
    type UnsupportedPerceptualConstraint,
} from '../../models/PerceptualConstraint';
import { type ProjectContext } from '../../models/ProjectContext';
import { type SemanticCommandListRoleFamily } from '../../models/SemanticCommandList';
import { unionPerceptualConstraintReadings } from '../../transformers/unionPerceptualConstraintReadings';
import { resolveRoleFamily } from '../canonicalRoleFamilies';
import { maskTrackReferences } from '../maskTrackReferences';

import {
    AND_JOIN,
    AS,
    CLAUSE_END,
    FROM,
    HOLDING_KEEP,
    KEEP_VERBS,
    LEAVE_VERB,
    LEFT_STATE,
    LINKING_VERB,
    LOW_END,
    MASK_GLYPH,
    MIX_PRONOUNS,
    MIX_WORDS,
    NEGATION,
    NO,
    normalizeObjectText,
    NOT_PERMITTED,
    OBJECT_MEMBER,
    OBJECT_MEMBER_SEPARATOR,
    OBJECT_PREPOSITION,
    ROLE_WORD,
    ROLE_WORDS,
    SAME_CLAUSE_CHARACTER,
    TERM_JOINER,
    THE,
    WORD_CHARACTER,
} from './constraintClauseWords';
import {
    CHANGE_NOUN,
    DIRECTION,
    FAMILY_IDS,
    LOW_END_HOLDING_VERB,
    type MeasuredConstraintId,
    QUALITY_OF,
    WORD_END,
} from './constraintDirections';
import { normalizePhrase } from './normalizePhrase';
import { type HoldClause, type HoldPart, readHoldClauses } from './readHoldClauses';
import { type ConsumedSpan, readUnreadConstraintClauses } from './readUnreadConstraintClauses';
import { HYPHEN_OR_SPACE, words } from './words';

type ObjectResolution =
    | { kind: 'mix' }
    | { kind: 'tracks'; trackIds: string[]; families: (SemanticCommandListRoleFamily | null)[] }
    | { kind: 'unresolved' };

type ClauseMatch = { clause: string; object: string | null; start: number; end: number };

const OBJECT_TAIL = String.raw`(?:\s+${OBJECT_PREPOSITION}\s+(?<object>${SAME_CLAUSE_CHARACTER}+?))?`;
const LOW_END_PROHIBITION = new RegExp(
    String.raw`\b(?:${NEGATION}|${NO}\s+${CHANGE_NOUN}\s+to)\s+(?:${LOW_END_HOLDING_VERB}\s+)?${THE}\s+${LOW_END}${OBJECT_TAIL}${CLAUSE_END}`,
    'dgiu'
);
const LOW_END_PRESERVATION = new RegExp(
    String.raw`${NOT_PERMITTED}\b(?:${LEAVE_VERB}|${KEEP_VERBS})\s+${THE}\s+${LOW_END}${OBJECT_TAIL}\s+${LEFT_STATE}${CLAUSE_END}`,
    'dgiu'
);
/**
 * At most four words, so a quality later in the request never reads as this clause's object, and never
 * "from", after which a keep names the move it prevents ("keep the mix from getting wider").
 */
const QUALITY_OBJECT_WORD = String.raw`(?!${FROM}\b)${WORD_CHARACTER}+`;
const QUALITY_OBJECT = String.raw`(?<object>(?:${QUALITY_OBJECT_WORD}\s+){0,3}?${QUALITY_OBJECT_WORD})`;
const MEASURABLE_TRACK_KINDS = new Set(['audio', 'midi', 'bus']);
const SCOPE_NAMED = new RegExp(String.raw`${MASK_GLYPH}|\b${ROLE_WORD}\b`, 'iu');
/** A quality no recipe produces but a crest factor measures, read beside the catalog's terms. */
const DYNAMIC_TERM = 'dynamic';
/**
 * The catalog descriptors whose preservation a measured hold verifies; `dynamic` is read beside them.
 * Keys are the catalog's descriptor ids, never words read from the request: the request's words for each
 * are the catalog's own `descriptorTerms`, so this is a mapping onto the direction table, not a word list.
 */
const DESCRIPTOR_HOLDS: ReadonlyMap<string, MeasuredConstraintId> = new Map([
    ['wide', FAMILY_IDS.width.held],
    ['bright', FAMILY_IDS.brightness.held],
    [DYNAMIC_TERM, FAMILY_IDS.dynamics.held],
]);
/** A kept term may stand behind a linking verb or "as": "keep the vocal sounding bright", "as dynamic". */
const TERM_LEAD = String.raw`(?:(?:${LINKING_VERB}|${AS})\s+)?`;
const TERM_FOLLOWS = String.raw`(?:\s*,\s*(?:${TERM_JOINER}\s+)?|\s+${TERM_JOINER}\s+)`;

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

/**
 * The whole object text first, so a name holding a separator ("Lead or Rhythm", "Salt and Pepper")
 * is one object; only text that names nothing whole is read as a list.
 */
function resolveConstraintObject(object: string, context: ProjectContext): ObjectResolution {
    const whole = resolveMember(object, context);
    if (whole.kind !== 'unresolved') {
        return whole;
    }
    return resolveMemberList(object, context);
}

/** A list ("the Bass and the Keys") resolves member by member; any unresolved member leaves the whole unresolved. */
function resolveMemberList(object: string, context: ProjectContext): ObjectResolution {
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
        const end = match.index + match[0].length;
        const clause = prompt.slice(match.index, end).trim();
        const span = match.indices?.groups?.object;
        const object = span === undefined ? null : prompt.slice(span[0], span[1]);
        return { clause, object, start: match.index, end };
    });
}

function toScope(resolution: Extract<ObjectResolution, { kind: 'mix' | 'tracks' }>): PerceptualConstraintScope {
    return resolution.kind === 'mix' ? { kind: 'mix' } : { kind: 'tracks', trackIds: resolution.trackIds };
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

/** What every reader of one request shares: its masked and own text, the project, and the reading it fills. */
type RequestReader = {
    masked: string;
    prompt: string;
    context: ProjectContext;
    reading: PerceptualConstraintReading;
};

function pushMeasuredHolds({ masked, context, reading }: RequestReader, clause: string, hold: HoldPart) {
    const { object, constraintIds } = hold;
    if (constraintIds.length === 0) {
        return;
    }
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

function pushHoldClauses(reader: RequestReader, clauses: readonly HoldClause[]) {
    for (const hold of clauses) {
        for (const part of hold.parts) {
            pushMeasuredHolds(reader, hold.clause, part);
        }
    }
}

/** The masked text with each consumed clause blanked, so no later reader reads its words again. */
function maskClauses(masked: string, clauses: readonly ConsumedSpan[]): string {
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
): ConsumedSpan[] {
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
    return clauses;
}

type QualityPattern = {
    pattern: RegExp;
    continuation: RegExp;
    termPattern: RegExp;
    descriptorOf: (term: string) => string | undefined;
};

/**
 * A kept quality: a catalog term, or "dynamic", which no recipe produces but a crest factor measures.
 * Further terms joined by "and", "but" or commas share the object ("keep the vocal intimate and
 * dynamic"), and are read only when the clause ends after them, so "and warm up the drums" is not one.
 * A later object with its own term continues the keep ("keep the vocal warm and the drums bright"),
 * while one with a direction asks for a move and continues nothing ("and the mix wider").
 */
function readQualityPattern(): QualityPattern {
    const catalog = getMixRecipeCatalog();
    const entries = [
        ...catalog.descriptors.flatMap((descriptor) =>
            catalog.descriptorTerms[descriptor].map((term) => ({ term, descriptor }))
        ),
        { term: DYNAMIC_TERM, descriptor: DYNAMIC_TERM },
    ];
    const terms = words(
        entries.map((entry) => entry.term),
        HYPHEN_OR_SPACE
    );
    const term = String.raw`${terms}${WORD_END}`;
    const more = String.raw`(?<more>(?:${TERM_FOLLOWS}(?:${AS}\s+)?${term})+${CLAUSE_END})?`;
    const pattern = new RegExp(
        String.raw`\b${HOLDING_KEEP}\s+${QUALITY_OBJECT}\s+${TERM_LEAD}(?<term>${term})${more}`,
        'dgiu'
    );
    const continuation = new RegExp(
        String.raw`${AND_JOIN}(?<object>${OBJECT_MEMBER})\s+${TERM_LEAD}(?!${DIRECTION})(?<term>${term})${more}${CLAUSE_END}`,
        'dyiu'
    );
    const descriptorOf = (candidate: string): string | undefined => {
        const normalized = normalizePhrase(candidate.replaceAll('-', ' '));
        return entries.find((entry) => entry.term.replaceAll('-', ' ') === normalized)?.descriptor;
    };
    return { pattern, continuation, termPattern: new RegExp(term, 'giu'), descriptorOf };
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

type QualityPart = { start: number; object: string; terms: string[] };

/** A kept quality's object and terms, read from the prompt by the match's own offsets. */
function readQualityPart(match: RegExpExecArray, prompt: string, termPattern: RegExp): QualityPart {
    const span = match.indices?.groups?.object;
    const terms = [
        match.groups?.term ?? '',
        ...Array.from((match.groups?.more ?? '').matchAll(termPattern), (entry) => entry[0]),
    ];
    return { start: match.index, object: span === undefined ? '' : prompt.slice(span[0], span[1]), terms };
}

/** The match and every later object a continuation adds under its keep, with where the last one ends. */
function readQualityParts(
    match: RegExpExecArray,
    unread: string,
    prompt: string,
    { continuation, termPattern }: Pick<QualityPattern, 'continuation' | 'termPattern'>
): { parts: QualityPart[]; end: number } {
    const parts = [readQualityPart(match, prompt, termPattern)];
    let end = match.index + match[0].length;
    continuation.lastIndex = end;
    let next = continuation.exec(unread);
    while (next !== null) {
        parts.push(readQualityPart(next, prompt, termPattern));
        end = next.index + next[0].length;
        continuation.lastIndex = end;
        next = continuation.exec(unread);
    }
    return { parts, end };
}

/** One kept term of a quality clause, with the clause it is quoted by and the part holding its object. */
type KeptTerm = { term: string; clause: string; part: QualityPart };

function pushQualityTerm(
    reader: RequestReader,
    { term, clause, part }: KeptTerm,
    descriptorOf: QualityPattern['descriptorOf']
) {
    const { context, reading } = reader;
    const descriptor = descriptorOf(term);
    const hold = descriptor === undefined ? undefined : DESCRIPTOR_HOLDS.get(descriptor);
    if (hold !== undefined) {
        const holdPart = { start: part.start, object: part.object, constraintIds: [hold], unreadable: null };
        pushMeasuredHolds(reader, clause, holdPart);
        return;
    }
    if (descriptor === 'intimate') {
        readIntimacy(clause, part.object, context, reading);
        return;
    }
    reading.unsupported.push(
        unsupportedQuality(clause, `No measurement the application takes shows that “${term}” holds.`)
    );
}

/**
 * `unread` is the masked text with the hold clauses blanked, so no quality is read twice; a pronoun's
 * scope is still judged against the whole masked request. Returns the spans it read.
 */
function readQualityConstraints(unread: string, reader: RequestReader): ConsumedSpan[] {
    const { prompt } = reader;
    const { pattern, continuation, termPattern, descriptorOf } = readQualityPattern();
    const spans: ConsumedSpan[] = [];
    for (const match of unread.matchAll(pattern)) {
        const { parts, end } = readQualityParts(match, unread, prompt, { continuation, termPattern });
        spans.push({ start: match.index, end });
        const clause = prompt.slice(match.index, end).trim();
        // "keep the lo-fi vibe" states a quality with no object to hold it on.
        for (const part of parts.filter((entry) => normalizeObjectText(entry.object).length > 0)) {
            for (const term of part.terms) {
                pushQualityTerm(reader, { term, clause, part }, descriptorOf);
            }
        }
    }
    return spans;
}

/**
 * Reads the request's perceptual constraints: a prohibition or preservation of the low end ("don't
 * touch the low end", "leave the low end of the Bass alone"); a loudness, width, brightness or
 * dynamics clause, one-way ("don't make it louder", "don't make the mix any wider", a bound that lets
 * it move the other way) or two-way ("don't change the level", "keep the stereo width", a hold); and a
 * preserved quality ("keep the vocal intimate", "keep the mix wide"). A quality is any term of the mix
 * recipe catalog's descriptor vocabulary; one with no measured invariant, a comparison with another
 * scope, an object that resolves to nothing it can be measured on, and any protective clause naming a
 * measured quality that no reader consumed are reported unsupported rather than dropped, so the batch
 * it rides can never be approved as verified.
 */
export function compilePerceptualConstraints(prompt: string, context: ProjectContext): PerceptualConstraintReading {
    // A name keeps its place as one masked word, so a clause still holds it as its object, which is
    // then read from the prompt itself; a quality word inside a name ("Warm Pad") states nothing.
    const masked = maskTrackReferences(prompt, context, MASK_GLYPH);
    const reading: PerceptualConstraintReading = { constraints: [], unsupported: [] };
    const reader: RequestReader = { masked, prompt, context, reading };
    const lowEnd = readLowEndConstraints(masked, prompt, context, reading);
    const holds = readHoldClauses(masked, prompt, 'before-qualities');
    pushHoldClauses(reader, holds);
    // "keep the stereo width" would otherwise read again as the quality "width" held on "the".
    const unheld = maskClauses(masked, holds);
    const qualities = readQualityConstraints(unheld, reader);
    // "keep the vocal bright and the mix from getting wider" keeps its quality, never an object "the vocal bright".
    const keptMoves = readHoldClauses(maskClauses(unheld, qualities), prompt, 'kept-moves');
    pushHoldClauses(reader, keptMoves);
    reading.unsupported.push(
        ...readUnreadConstraintClauses(masked, prompt, [...lowEnd, ...holds, ...qualities, ...keptMoves])
    );
    return unionPerceptualConstraintReadings(reading);
}
