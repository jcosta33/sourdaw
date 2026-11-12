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
/** A clause a measured-hold reader consumed: its own words, its object, and the span it covers. */
type HoldClause = ClauseMatch & { end: number; groups: Record<string, string | undefined> };
type MeasuredConstraintId = MeasuredPerceptualConstraint['constraintId'];

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

const NEGATION = String.raw`(?:do\s+not|don['’]?t|never|without)`;
const MODAL_NEGATION = String.raw`(?:must\s+not|mustn['’]?t|should\s+not|shouldn['’]?t|may\s+not|can\s*not|can['’]?t)`;
/** The object may stand before the verb only at the head of a clause, so it never swallows an earlier clause. */
const CLAUSE_HEAD = String.raw`(?<=^|[,.;:!?]\s*|\b(?:and|but|while|so|then|please)\s+)`;
const LOUDNESS_NOUN = String.raw`the\s+(?:overall\s+)?(?:level|loudness|volume)`;
/** Longest first, so "louder or quieter" is read as one two-way clause, never as a bound on "louder". */
const LOUDNESS_DIRECTION = String.raw`(?<direction>louder\s+or\s+(?:quieter|softer)|(?:quieter|softer)\s+or\s+louder|louder|quieter|softer)`;
const LOUDNESS_VERB = String.raw`(?<verb>raise|raising|increase|increasing|boost|boosting|push|pushing|turn(?:ing)?\s+up|lower|lowering|reduce|reducing|decrease|decreasing|turn(?:ing)?\s+down|change|changing|alter|altering|touch|touching)`;
const HOLD_SUFFIX = String.raw`(?:\s+(?:the\s+same|unchanged|intact|as\s+(?:it\s+)?is|where\s+it\s+is))?`;
const LOUDNESS_PATTERNS = [
    // "don't make it louder", "without making the drums any quieter", "don't let the mix get louder"
    String.raw`\b${NEGATION}\s+(?:make|making|get|getting|let|letting)(?:\s+(?!any\b)${QUALITY_OBJECT})?\s+(?:(?:get|become)\s+)?(?:any\s+)?${LOUDNESS_DIRECTION}${CLAUSE_END}`,
    // "the mix must not get louder"
    String.raw`${CLAUSE_HEAD}${QUALITY_OBJECT}\s+${MODAL_NEGATION}\s+(?:(?:get|become|be|sound)\s+)?(?:any\s+)?${LOUDNESS_DIRECTION}${CLAUSE_END}`,
    // "don't raise the level of the drums", "don't change the volume"
    String.raw`\b${NEGATION}\s+${LOUDNESS_VERB}\s+${LOUDNESS_NOUN}${OBJECT_TAIL}${CLAUSE_END}`,
    // "keep the overall level the same", "keep the loudness of the vocal as it is"
    String.raw`\b(?:keep|keeping|preserve|preserving|maintain|maintaining)\s+${LOUDNESS_NOUN}${OBJECT_TAIL}${HOLD_SUFFIX}${CLAUSE_END}`,
    // "keep the Keys at the same level"
    String.raw`\b(?:keep|keeping)\s+${QUALITY_OBJECT}\s+at\s+the\s+same\s+(?:level|loudness|volume)${CLAUSE_END}`,
].map((source) => new RegExp(source, 'dgiu'));
const RAISING_VERB = /^(?:rais|increas|boost|push|turn(?:ing)?\s+up)/iu;
const LOWERING_VERB = /^(?:lower|reduc|decreas|turn(?:ing)?\s+down)/iu;
/** A loudness clause with no object, or one naming only "it", holds the mix. */
const LOUDNESS_MIX_PRONOUNS = new Set(['it', 'everything', 'anything']);
const WIDTH_PATTERNS = [
    String.raw`\b${QUALITY_VERBS}\s+the\s+(?:stereo\s+)?(?:width|image|field|spread)${OBJECT_TAIL}${HOLD_SUFFIX}${CLAUSE_END}`,
].map((source) => new RegExp(source, 'dgiu'));
const BRIGHTNESS_PATTERNS = [
    String.raw`\b${QUALITY_VERBS}\s+the\s+brightness${OBJECT_TAIL}${HOLD_SUFFIX}${CLAUSE_END}`,
].map((source) => new RegExp(source, 'dgiu'));
const DYNAMICS_PATTERNS = [
    String.raw`\b${QUALITY_VERBS}\s+the\s+(?:dynamics|dynamic\s+range)${OBJECT_TAIL}${HOLD_SUFFIX}${CLAUSE_END}`,
    // "keep the drums as dynamic as they are"
    String.raw`\b${QUALITY_VERBS}\s+${QUALITY_OBJECT}\s+(?:as\s+)?dynamic(?:\s+as\s+(?:it\s+is|they\s+are))?${CLAUSE_END}`,
].map((source) => new RegExp(source, 'dgiu'));
/** The catalog descriptors whose preservation a measured hold verifies, and what that hold measures. */
const DESCRIPTOR_HOLDS: ReadonlyMap<string, { constraintId: MeasuredConstraintId; quality: string }> = new Map([
    ['wide', { constraintId: 'stereo-width-held-v1', quality: 'stereo width' }],
    ['bright', { constraintId: 'brightness-held-v1', quality: 'brightness' }],
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

/** Every match of every pattern, as the prompt's own words, in the order they appear, never two over one span. */
function readHoldClauses(patterns: readonly RegExp[], masked: string, prompt: string): HoldClause[] {
    const clauses = patterns
        .flatMap((pattern) =>
            Array.from(masked.matchAll(pattern), (match): HoldClause => {
                const start = match.index;
                const end = start + match[0].length;
                const objectSpan = match.indices?.groups?.object;
                return {
                    clause: prompt.slice(start, end).trim(),
                    object: objectSpan === undefined ? null : prompt.slice(objectSpan[0], objectSpan[1]),
                    start,
                    end,
                    groups: { ...match.groups },
                };
            })
        )
        .toSorted((left, right) => left.start - right.start || right.end - left.end);
    return clauses.filter(
        (clause, index) =>
            !clauses.slice(0, index).some((other) => other.start < clause.end && clause.start < other.end)
    );
}

function pushMeasuredHold(
    reading: PerceptualConstraintReading,
    constraintId: MeasuredConstraintId,
    clause: string,
    resolution: ObjectResolution,
    unresolvedReason: string
) {
    if (resolution.kind === 'unresolved') {
        reading.unsupported.push({ constraintId: 'unsupported', clause, reason: unresolvedReason });
        return;
    }
    reading.constraints.push({ constraintId, clause, scope: toScope(resolution), protection: { kind: 'measured' } });
}

function readLoudnessDirection(groups: HoldClause['groups']): MeasuredConstraintId {
    const direction = groups.direction?.toLowerCase();
    const verb = groups.verb ?? '';
    if (direction === 'louder' || RAISING_VERB.test(verb)) {
        return 'loudness-not-raised-v1';
    }
    if (direction === 'quieter' || direction === 'softer' || LOWERING_VERB.test(verb)) {
        return 'loudness-not-lowered-v1';
    }
    return 'loudness-held-v1';
}

function readLoudnessConstraints(
    clauses: readonly HoldClause[],
    context: ProjectContext,
    reading: PerceptualConstraintReading
) {
    for (const { clause, object, groups } of clauses) {
        const resolution: ObjectResolution =
            object === null || LOUDNESS_MIX_PRONOUNS.has(normalizeObjectText(object))
                ? { kind: 'mix' }
                : resolveConstraintObject(object, context);
        pushMeasuredHold(
            reading,
            readLoudnessDirection(groups),
            clause,
            resolution,
            `“${object ?? ''}” names no track or mix whose loudness can be measured.`
        );
    }
}

function readQualityHolds(
    clauses: readonly HoldClause[],
    hold: { constraintId: MeasuredConstraintId; quality: string },
    context: ProjectContext,
    reading: PerceptualConstraintReading
) {
    for (const { clause, object } of clauses) {
        const resolution: ObjectResolution =
            object === null ? { kind: 'mix' } : resolveConstraintObject(object, context);
        pushMeasuredHold(
            reading,
            hold.constraintId,
            clause,
            resolution,
            `“${object ?? ''}” names no track or mix whose ${hold.quality} can be measured.`
        );
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

function readQualityPattern(): { pattern: RegExp; descriptorOf: (term: string) => string | undefined } {
    const catalog = getMixRecipeCatalog();
    const entries = catalog.descriptors.flatMap((descriptor) =>
        catalog.descriptorTerms[descriptor].map((term) => ({ term, descriptor }))
    );
    const terms = entries
        .map((entry) => entry.term)
        .toSorted((left, right) => right.length - left.length)
        .map((term) =>
            term
                .split(' ')
                .map(escapeRegExp)
                .join(String.raw`[\s-]+`)
        );
    const pattern = new RegExp(
        String.raw`\b${QUALITY_VERBS}\s+${QUALITY_OBJECT}\s+(?:sounding\s+|feeling\s+|as\s+)?(?<term>${terms.join('|')})(?![\p{L}\p{N}])`,
        'giu'
    );
    const descriptorOf = (term: string): string | undefined => {
        const normalized = term.toLowerCase().replaceAll(/[\s-]+/gu, ' ');
        return entries.find((entry) => entry.term.replaceAll('-', ' ') === normalized)?.descriptor;
    };
    return { pattern, descriptorOf };
}

function unsupportedQuality(clause: string, reason: string): UnsupportedPerceptualConstraint {
    return { constraintId: 'unsupported', clause, reason };
}

function readQualityConstraints(
    masked: string,
    prompt: string,
    context: ProjectContext,
    reading: PerceptualConstraintReading
) {
    const { pattern, descriptorOf } = readQualityPattern();
    for (const match of masked.matchAll(pattern)) {
        const objectText = match.groups?.object ?? '';
        const objectStart = match.index + match[0].indexOf(objectText);
        const object = prompt.slice(objectStart, objectStart + objectText.length);
        // "keep the lo-fi vibe" states a quality with no object to hold it on.
        if (normalizeObjectText(object).length === 0) {
            continue;
        }
        const clause = prompt.slice(match.index, match.index + match[0].length).trim();
        const term = match.groups?.term ?? '';
        const descriptor = descriptorOf(term);
        const hold = descriptor === undefined ? undefined : DESCRIPTOR_HOLDS.get(descriptor);
        if (hold !== undefined) {
            pushMeasuredHold(
                reading,
                hold.constraintId,
                clause,
                resolveConstraintObject(object, context),
                `“${object}” names no track or mix whose ${hold.quality} can be measured.`
            );
            continue;
        }
        if (descriptor !== 'intimate') {
            reading.unsupported.push(
                unsupportedQuality(clause, `No measurement the application takes shows that “${term}” holds.`)
            );
            continue;
        }
        const resolution = resolveConstraintObject(object, context);
        const vocal =
            resolution.kind === 'tracks' &&
            (ROLE_WORDS.get(normalizeObjectText(object)) === 'vocal' ||
                resolution.families.every((family) => family === 'vocal'));
        if (resolution.kind !== 'tracks' || !vocal) {
            reading.unsupported.push(
                unsupportedQuality(clause, `Intimacy is measured only on vocal tracks, and “${object}” names none.`)
            );
            continue;
        }
        reading.constraints.push({
            constraintId: 'vocal-intimacy-v1',
            clause,
            scope: { kind: 'tracks', trackIds: resolution.trackIds },
            protection: { kind: 'exclude-dimension', dimension: 'ambience' },
        });
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
    const loudness = readHoldClauses(LOUDNESS_PATTERNS, masked, prompt);
    const width = readHoldClauses(WIDTH_PATTERNS, masked, prompt);
    const brightness = readHoldClauses(BRIGHTNESS_PATTERNS, masked, prompt);
    const dynamics = readHoldClauses(DYNAMICS_PATTERNS, masked, prompt);
    readLoudnessConstraints(loudness, context, reading);
    readQualityHolds(width, { constraintId: 'stereo-width-held-v1', quality: 'stereo width' }, context, reading);
    readQualityHolds(brightness, { constraintId: 'brightness-held-v1', quality: 'brightness' }, context, reading);
    readQualityHolds(dynamics, { constraintId: 'dynamics-held-v1', quality: 'dynamics' }, context, reading);
    // "keep the stereo width" would otherwise read again as the quality "width" held on "the".
    const unread = maskClauses(masked, [...loudness, ...width, ...brightness, ...dynamics]);
    readQualityConstraints(unread, prompt, context, reading);
    return unionPerceptualConstraintReadings(reading);
}
