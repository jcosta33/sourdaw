import { type MeasuredPerceptualConstraint } from '../../models/PerceptualConstraint';

import { normalizePhrase } from './normalizePhrase';
import { words } from './words';

export type MeasuredConstraintId = MeasuredPerceptualConstraint['constraintId'];

const APOSTROPHES = `'’`;
/** An apostrophe, typed or typeset: "don't", "don’t". */
export const APOSTROPHE = `[${APOSTROPHES}]`;
const WORD_CONTINUING = String.raw`\p{L}\p{N}`;
/** The end of a whole word: no letter or digit follows. */
export const WORD_END = `(?![${WORD_CONTINUING}])`;
/** Unlike WORD_END, an apostrophe also continues the word, so "don't" is never read as "don". */
export const WHOLE_WORD_END = `(?![${WORD_CONTINUING}${APOSTROPHES}])`;

type QualityFamily = 'loudness' | 'width' | 'brightness' | 'dynamics';
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

/**
 * The verbs that move a family with no held noun ("don't widen the drums"), each also read with
 * "-ing". A held noun takes them too, in its own family's direction ("don't widen the stereo image").
 */
const QUALITY_VERBS: Readonly<Record<QualityFamily, Readonly<Record<Movement, readonly string[]>>>> = {
    loudness: { up: [], down: [] },
    width: { up: ['widen'], down: ['narrow'] },
    brightness: { up: ['brighten'], down: ['darken'] },
    dynamics: { up: [], down: ['squash', 'flatten'] },
};

/** The nouns that name each family's metric: "the level of the drums", "the stereo width". */
const HELD_NOUNS: Readonly<Record<QualityFamily, readonly string[]>> = {
    loudness: ['level', 'loudness', 'volume'],
    width: ['width', 'image', 'field', 'spread'],
    brightness: ['brightness'],
    dynamics: ['dynamics', 'dynamic range'],
};

/**
 * The held nouns too common to name a metric outside a hold reader's own grammar: free text names the
 * metric with them only behind this qualifier ("the stereo field", never "the field recording").
 */
const NOUN_QUALIFIER: Readonly<Record<string, string>> = { image: 'stereo', field: 'stereo', spread: 'stereo' };

const CHANGE = 'change';
/**
 * The verbs a held noun takes in any family, each also read with "-ing": those moving its metric one
 * way ("don't raise the width") and those holding it ("don't change the level").
 */
const NOUN_VERBS: Readonly<Record<Movement | 'either', readonly string[]>> = {
    up: ['raise', 'increase', 'boost', 'push', 'turn up'],
    down: ['lower', 'reduce', 'decrease', 'turn down'],
    either: [CHANGE, 'alter', 'touch'],
};

const FAMILIES: readonly QualityFamily[] = ['loudness', 'width', 'brightness', 'dynamics'];
const MOVEMENTS: readonly Movement[] = ['up', 'down'];

/** A verb phrase and its "-ing" form on its first word: "raise" and "raising", "turn up" and "turning up". */
function withIngForm(phrase: string): string[] {
    const [verb = '', ...rest] = phrase.split(' ');
    return [phrase, [ingForm(verb), ...rest].join(' ')];
}

function ingForm(verb: string): string {
    const stem = verb.endsWith('e') ? verb.slice(0, -1) : verb;
    return `${stem}ing`;
}

/** Each phrase, a family's either-way pair ("wider or narrower") among them, and the constraint it states. */
function phraseEntries(table: typeof COMPARATIVES, verbForms: (word: string) => string[]) {
    return FAMILIES.flatMap((family) => {
        const { up, down } = table[family];
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
    ...phraseEntries(QUALITY_VERBS, withIngForm),
];
const CONSTRAINT_OF_PHRASE: ReadonlyMap<string, MeasuredConstraintId> = new Map(
    DIRECTION_ENTRIES.map((entry) => [entry.phrase, entry.id])
);

const COMPARATIVE_PHRASES = phraseEntries(COMPARATIVES, (word) => [word]).map((entry) => entry.phrase);
const VERB_PHRASES = phraseEntries(QUALITY_VERBS, withIngForm).map((entry) => entry.phrase);

/** One comparative ("louder", "less dynamic") or a family's either-way pair ("wider or narrower"). */
export const DIRECTION = String.raw`${words(COMPARATIVE_PHRASES)}${WORD_END}`;
/** A verb moving one family with no held noun ("widen", "squashing"), or its either-way pair. */
export const QUALITY_VERB = String.raw`(?<direction>${words(VERB_PHRASES)}${WORD_END})`;
/** Every single comparative word, which an object member never holds. */
export const COMPARATIVE_WORDS = words(COMPARATIVE_PHRASES.filter((phrase) => !phrase.includes(' ')));

const DIRECTION_IN_LIST = new RegExp(`${DIRECTION}|${words(VERB_PHRASES)}`, 'giu');

/** The verbs moving a held noun's metric, by the way they move it: the shared noun verbs and every quality verb. */
export const NOUN_MOVEMENT_OF_VERB: ReadonlyMap<string, Movement> = new Map(
    MOVEMENTS.flatMap((movement) =>
        [...NOUN_VERBS[movement], ...FAMILIES.flatMap((family) => QUALITY_VERBS[family][movement])]
            .flatMap(withIngForm)
            .map((verb) => [verb, movement] as const)
    )
);
const NOUN_VERB_PHRASES = [...NOUN_MOVEMENT_OF_VERB.keys(), ...NOUN_VERBS.either.flatMap(withIngForm)];
/** Each held noun's family. */
export const FAMILY_OF_NOUN: ReadonlyMap<string, QualityFamily> = new Map(
    FAMILIES.flatMap((family) => HELD_NOUNS[family].map((noun) => [noun, family] as const))
);

/** A verb a held noun takes, moving its metric or holding it: "raise", "turning up", "change". */
export const NOUN_VERB = String.raw`(?<verb>${words(NOUN_VERB_PHRASES)})`;
/** The hold verb "change" as a noun, in either number: "no changes to the low end". */
export const CHANGE_NOUN = String.raw`${CHANGE}s?`;
/** The verbs holding a held noun's metric either way: "don't change the level", "touching the width". */
const HOLDING_NOUN_VERB = words(NOUN_VERBS.either.flatMap(withIngForm));
/** The verbs only the low end is held by beside those: "don't affect the low end", "don't mess with". */
const LOW_END_ONLY_VERBS = ['affect', 'mess with'];
/** Every verb holding the low end: the held-noun hold verbs and the low end's own. */
export const LOW_END_HOLDING_VERB = String.raw`(?:${HOLDING_NOUN_VERB}|${words(LOW_END_ONLY_VERBS.flatMap(withIngForm))})`;
/** Every held noun of every family: "level", "stereo width" is "width" behind its qualifier. */
export const HOLD_NOUN_WORD = words(Array.from(FAMILY_OF_NOUN.keys()));
/** The nouns naming loudness alone: "keep the Keys at the same level". */
export const LOUDNESS_NOUN_WORD = words(HELD_NOUNS.loudness);

/** The qualifiers a held noun may stand behind: "the overall level", "the stereo width". */
export const HELD_NOUN_QUALIFIER = words(['overall', ...new Set(Object.values(NOUN_QUALIFIER))]);

const FREE_TEXT_NOUNS = Array.from(FAMILY_OF_NOUN.keys(), (noun) => {
    const qualifier = NOUN_QUALIFIER[noun];
    return qualifier === undefined ? noun : `${qualifier} ${noun}`;
});
/** A held noun as free text names it, in either number behind any qualifier it needs: "the stereo field". */
export const MEASURED_NOUN = String.raw`${words(FREE_TEXT_NOUNS)}s?`;
/** A word naming a way a measured quality moves: a quality verb or a direction. */
export const MOVE_WORD = String.raw`(?:${words(VERB_PHRASES)}|${DIRECTION})`;
/**
 * Any word naming a measured quality or a way it moves, as free text names it. A plain adjective
 * ("bright", "wide") is none: elsewhere it mostly describes a sound.
 */
export const MEASURED_WORD = String.raw`(?:${MEASURED_NOUN}|${MOVE_WORD})`;

function headWord(phrase: string): string {
    const [head = phrase] = phrase.split(' ');
    return head;
}

function particleOf(phrase: string): string {
    return phrase.split(' ').slice(1).join(' ');
}

/** The first word of every verb a held noun takes: "turn" of "turn up". */
const NOUN_VERB_HEADS = Array.from(
    new Set(
        [
            ...MOVEMENTS.flatMap((movement) => [
                ...NOUN_VERBS[movement],
                ...FAMILIES.flatMap((family) => QUALITY_VERBS[family][movement]),
            ]),
            ...NOUN_VERBS.either,
        ].map(headWord)
    )
);
/**
 * The first word of every verb a held noun takes, also read with "-ing", so a split particle still
 * reads: "don't turn the volume of the vocal up" governs the volume through "turn".
 */
export const NOUN_VERB_HEAD = words(NOUN_VERB_HEADS.flatMap(withIngForm));
/** The verbs a held noun takes whose particle may stand after the noun: "turn … up". */
const SPLIT_VERBS = MOVEMENTS.flatMap((movement) => NOUN_VERBS[movement]).filter((phrase) => phrase.includes(' '));
const SPLIT_VERB_HEADS = Array.from(new Set(SPLIT_VERBS.map(headWord))).flatMap(withIngForm);
const SPLIT_VERB_PARTICLES = Array.from(new Set(SPLIT_VERBS.map(particleOf)));
/** A split verb's first word, also read with "-ing": "don't turn the level of the vocal up". */
export const SPLIT_VERB_HEAD = String.raw`(?<verb>${words(SPLIT_VERB_HEADS)})`;
/** The particle a split verb ends on after its noun. */
export const SPLIT_VERB_PARTICLE = String.raw`(?<particle>${words(SPLIT_VERB_PARTICLES)})`;
/** Those verbs' "-ing" forms alone: what a keep continues a move with ("keep widening the mix"). */
export const NOUN_VERB_ING = words(NOUN_VERB_HEADS.map(ingForm));

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
