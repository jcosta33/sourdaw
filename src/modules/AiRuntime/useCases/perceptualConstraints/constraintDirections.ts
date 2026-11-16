import { type MeasuredPerceptualConstraint } from '../../models/PerceptualConstraint';

export type MeasuredConstraintId = MeasuredPerceptualConstraint['constraintId'];

export type QualityFamily = 'loudness' | 'width' | 'brightness' | 'dynamics';
type Movement = 'up' | 'down';

/** Each family's two-way hold and its two one-way bounds: `raised` limits a rise, `lowered` a fall. */
export const FAMILY_IDS: Readonly<
    Record<QualityFamily, { held: MeasuredConstraintId; raised: MeasuredConstraintId; lowered: MeasuredConstraintId }>
> = {
    loudness: { held: 'loudness-held-v1', raised: 'loudness-not-raised-v1', lowered: 'loudness-not-lowered-v1' },
    width: {
        held: 'stereo-width-held-v1',
        raised: 'stereo-width-not-widened-v1',
        lowered: 'stereo-width-not-narrowed-v1',
    },
    brightness: {
        held: 'brightness-held-v1',
        raised: 'brightness-not-raised-v1',
        lowered: 'brightness-not-lowered-v1',
    },
    dynamics: { held: 'dynamics-held-v1', raised: 'dynamics-not-raised-v1', lowered: 'dynamics-not-reduced-v1' },
};

/** The quality each constraint holds, as the unsupported reasons name it. */
export const QUALITY_OF: Readonly<Record<MeasuredConstraintId, string>> = {
    'loudness-held-v1': 'loudness',
    'loudness-not-raised-v1': 'loudness',
    'loudness-not-lowered-v1': 'loudness',
    'stereo-width-held-v1': 'stereo width',
    'stereo-width-not-widened-v1': 'stereo width',
    'stereo-width-not-narrowed-v1': 'stereo width',
    'dynamics-held-v1': 'dynamics',
    'dynamics-not-raised-v1': 'dynamics',
    'dynamics-not-reduced-v1': 'dynamics',
    'brightness-held-v1': 'brightness',
    'brightness-not-raised-v1': 'brightness',
    'brightness-not-lowered-v1': 'brightness',
};

/** The comparatives that move each family, by the way they move its metric. */
const COMPARATIVES: Readonly<Record<QualityFamily, Readonly<Record<Movement, readonly string[]>>>> = {
    loudness: { up: ['louder'], down: ['quieter', 'softer'] },
    width: { up: ['wider'], down: ['narrower'] },
    brightness: { up: ['brighter'], down: ['darker', 'duller'] },
    dynamics: {
        up: ['more dynamic', 'less compressed'],
        down: ['less dynamic', 'flatter', 'more compressed', 'more squashed'],
    },
};

/** The verbs that move a family with no held noun ("don't widen the drums"), each also read with "-ing". */
const QUALITY_VERBS: Readonly<Record<QualityFamily, Readonly<Record<Movement, readonly string[]>>>> = {
    loudness: { up: [], down: [] },
    width: { up: ['widen'], down: ['narrow'] },
    brightness: { up: ['brighten'], down: ['darken'] },
    dynamics: { up: [], down: ['squash', 'flatten'] },
};

const FAMILIES: readonly QualityFamily[] = ['loudness', 'width', 'brightness', 'dynamics'];

function phrasePattern(phrase: string): string {
    return phrase.split(' ').join(String.raw`\s+`);
}

function normalizePhrase(phrase: string): string {
    return phrase.toLowerCase().replaceAll(/\s+/gu, ' ').trim();
}

/** Each phrase, a family's either-way pair ("wider or narrower") among them, and the constraint it states. */
function phraseEntries(words: typeof COMPARATIVES, verbForms: (word: string) => string[]) {
    return FAMILIES.flatMap((family) => {
        const { up, down } = words[family];
        const ids = FAMILY_IDS[family];
        const ups = up.flatMap(verbForms);
        const downs = down.flatMap(verbForms);
        const pairs = ups.flatMap((raise) =>
            downs.flatMap((lower) => [`${raise} or ${lower}`, `${lower} or ${raise}`])
        );
        return [
            ...pairs.map((phrase) => ({ phrase, id: ids.held })),
            ...ups.map((phrase) => ({ phrase, id: ids.raised })),
            ...downs.map((phrase) => ({ phrase, id: ids.lowered })),
        ];
    });
}

const DIRECTION_ENTRIES = [
    ...phraseEntries(COMPARATIVES, (word) => [word]),
    ...phraseEntries(QUALITY_VERBS, (word) => [word, `${word}ing`]),
];
const CONSTRAINT_OF_PHRASE: ReadonlyMap<string, MeasuredConstraintId> = new Map(
    DIRECTION_ENTRIES.map((entry) => [entry.phrase, entry.id])
);

/** Longest first, so "louder or quieter" is read as one two-way phrase, never as a bound on "louder". */
function alternation(phrases: readonly string[]): string {
    return phrases
        .toSorted((left, right) => right.length - left.length)
        .map(phrasePattern)
        .join('|');
}

const COMPARATIVE_PHRASES = phraseEntries(COMPARATIVES, (word) => [word]).map((entry) => entry.phrase);
const VERB_PHRASES = phraseEntries(QUALITY_VERBS, (word) => [word, `${word}ing`]).map((entry) => entry.phrase);

/** One comparative ("louder", "less dynamic") or a family's either-way pair ("wider or narrower"). */
export const DIRECTION = String.raw`(?:${alternation(COMPARATIVE_PHRASES)})(?![\p{L}\p{N}])`;
/** Comparatives one clause applies to one object: "brighter and louder", "louder or brighter". */
export const DIRECTION_LIST = String.raw`(?<direction>${DIRECTION}(?:\s+(?:and|or)\s+(?:any\s+)?${DIRECTION})*)`;
/** A verb moving one family with no held noun ("widen", "squashing"), or its either-way pair. */
export const QUALITY_VERB = String.raw`(?<direction>(?:${alternation(VERB_PHRASES)})(?![\p{L}\p{N}]))`;
/** Every single comparative word, which an object member never holds. */
export const COMPARATIVE_WORDS = COMPARATIVE_PHRASES.filter((phrase) => !phrase.includes(' '));

const DIRECTION_IN_LIST = new RegExp(`${DIRECTION}|${alternation(VERB_PHRASES)}`, 'giu');

function familyOfConstraint(id: MeasuredConstraintId): QualityFamily | undefined {
    return FAMILIES.find((family) => Object.values(FAMILY_IDS[family]).includes(id));
}

/**
 * The constraints a list of directions states, in the order it states them, once each. Both bounds of
 * one family in one list ("louder and quieter") state its hold, exactly as the either-way pair does.
 */
export function directionConstraintIds(directions: string): MeasuredConstraintId[] {
    const ids: MeasuredConstraintId[] = [];
    for (const [phrase] of directions.matchAll(DIRECTION_IN_LIST)) {
        const id = CONSTRAINT_OF_PHRASE.get(normalizePhrase(phrase));
        const family = id === undefined ? undefined : familyOfConstraint(id);
        if (id === undefined || family === undefined) {
            continue;
        }
        const stated = ids.findIndex((other) => familyOfConstraint(other) === family);
        if (stated === -1) {
            ids.push(id);
        } else if (ids[stated] !== id) {
            ids[stated] = FAMILY_IDS[family].held;
        }
    }
    return ids;
}
