import { getMixRecipeCatalog } from '#/modules/Arrangement/useCases';

import {
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
        if (descriptorOf(term) !== 'intimate') {
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
 * touch the low end", "leave the low end of the Bass alone") and a preserved quality ("keep the vocal
 * intimate"). A quality is any term of the mix recipe catalog's descriptor vocabulary; one with no
 * measured invariant, or an object that resolves to nothing it can be measured on, is reported
 * unsupported rather than dropped, so the batch it rides can never be approved as verified.
 */
export function compilePerceptualConstraints(prompt: string, context: ProjectContext): PerceptualConstraintReading {
    // A name keeps its place as one masked word, so a clause still holds it as its object, which is
    // then read from the prompt itself; a quality word inside a name ("Warm Pad") states nothing.
    const masked = maskTrackReferences(prompt, context, '□');
    const reading: PerceptualConstraintReading = { constraints: [], unsupported: [] };
    readLowEndConstraints(masked, prompt, context, reading);
    readQualityConstraints(masked, prompt, context, reading);
    return unionPerceptualConstraintReadings(reading);
}
