import { normalizePromptText } from './normalizePromptText';

/** One number the prompt states, as the scope tokenizer found it. */
export type PromptNumber = {
    end: number;
    index: number;
    raw: string;
};

/**
 * How a request stated one decibel figure.
 *
 * `unstated` is a real answer, not a failure: "Vocals 3 dB" names a decibel
 * figure without saying whether it is where the level should land or how far it
 * should move, and those are different writes. It grounds neither form, and it
 * still counts as decibel evidence — a linear amplitude is not what that
 * request asked for either.
 */
export type PromptDecibelForm = 'absolute' | 'relative' | 'unstated';

export type PromptDecibelFigure = {
    /** The figure the request states, signed for a relative change; `null` when the form is unstated. */
    db: number | null;
    form: PromptDecibelForm;
};

/** `dB`, `db`, `d b`, immediately after the number. */
const DECIBEL_UNIT_PATTERN = /^\s*d\s?b\b/iu;

const ARTICLES: ReadonlySet<string> = new Set(['a', 'an', 'the']);

/** Words that put the figure where the level should land. */
const ABSOLUTE_CONNECTORS: ReadonlySet<string> = new Set(['at', 'to']);

/** Words that put the figure on the distance the level should move. */
const RELATIVE_CONNECTORS: ReadonlySet<string> = new Set(['by', 'down', 'up']);

const QUIETER_SUFFIXES: ReadonlySet<string> = new Set(['less', 'lower', 'quieter', 'softer']);

const LOUDER_SUFFIXES: ReadonlySet<string> = new Set(['higher', 'hotter', 'louder', 'more']);

/** Words anywhere in the action scope that decide which way a figure with no adjacent cue moves. */
const QUIETER_SCOPE_PHRASES: readonly string[] = [
    'attenuate',
    'cut',
    'drop',
    'lower',
    'quieter',
    'reduce',
    'softer',
    'turn down',
];

const LOUDER_SCOPE_PHRASES: readonly string[] = ['boost', 'higher', 'hotter', 'louder', 'raise', 'turn up'];

function namesPhrase(normalizedScope: string, phrase: string): boolean {
    return ` ${normalizedScope} `.includes(` ${phrase} `);
}

/**
 * The word the figure follows, with any article between them dropped: "to the
 * -6 dB" states the same connector "to -6 dB" does.
 */
function getPrecedingWord(maskedScope: string, number: PromptNumber): string {
    const words = normalizePromptText(maskedScope.slice(0, number.index)).split(' ');
    while (words.length > 0 && ARTICLES.has(words[words.length - 1] ?? '')) {
        words.pop();
    }
    return words[words.length - 1] ?? '';
}

function getFollowingWord(maskedScope: string, unitEnd: number): string {
    return normalizePromptText(maskedScope.slice(unitEnd)).split(' ')[0] ?? '';
}

/**
 * Which way the action itself moves the level, or `null` when its words say
 * neither or both: "raise Vocals and cut the reverb send" names both
 * directions, and neither figure in it is signed by the scope alone.
 */
function getScopeSign(normalizedScope: string): number | null {
    const lowers = QUIETER_SCOPE_PHRASES.some((phrase) => namesPhrase(normalizedScope, phrase));
    const raises = LOUDER_SCOPE_PHRASES.some((phrase) => namesPhrase(normalizedScope, phrase));
    if (lowers === raises) {
        return null;
    }
    return lowers ? -1 : 1;
}

function getRelativeSign(
    precedingWord: string,
    followingWord: string,
    raw: string,
    scopeSign: number | null
): number | null {
    if (precedingWord === 'down' || QUIETER_SUFFIXES.has(followingWord) || raw.startsWith('-')) {
        return -1;
    }
    if (precedingWord === 'up' || LOUDER_SUFFIXES.has(followingWord) || raw.startsWith('+')) {
        return 1;
    }
    return scopeSign;
}

function classifyFigure(maskedScope: string, number: PromptNumber, unitEnd: number): PromptDecibelFigure {
    const precedingWord = getPrecedingWord(maskedScope, number);
    const followingWord = getFollowingWord(maskedScope, unitEnd);
    const db = Number.parseFloat(number.raw);
    if (!Number.isFinite(db)) {
        return { db: null, form: 'unstated' };
    }
    if (ABSOLUTE_CONNECTORS.has(precedingWord)) {
        return { db, form: 'absolute' };
    }
    const scopeSign = getScopeSign(normalizePromptText(maskedScope));
    const statesChange =
        RELATIVE_CONNECTORS.has(precedingWord) ||
        QUIETER_SUFFIXES.has(followingWord) ||
        LOUDER_SUFFIXES.has(followingWord) ||
        number.raw.startsWith('+') ||
        // "raise Vocals 2 dB" states a change as plainly as "raise Vocals by
        // 2 dB": the verb carries the distance reading and the direction.
        (!number.raw.startsWith('-') && scopeSign !== null);
    if (!statesChange) {
        // An unsigned figure with no cue says neither; a negative one can only be
        // a level, since a control below the floor has nowhere to move down to.
        return number.raw.startsWith('-') ? { db, form: 'absolute' } : { db: null, form: 'unstated' };
    }
    const sign = getRelativeSign(precedingWord, followingWord, number.raw, scopeSign);
    if (sign === null) {
        return { db: null, form: 'unstated' };
    }
    return { db: sign * Math.abs(db), form: 'relative' };
}

/**
 * Every decibel figure one action scope states, in the order the request states
 * them.
 *
 * A level in decibels is two different requests wearing the same number: "to
 * -6 dB" names where the fader lands, "down 6 dB" names how far it moves, and
 * the same control ends up somewhere else under each. The reading is therefore
 * taken from the words around the figure rather than from the figure, and a
 * request that does not say which one it means grounds neither.
 *
 * A percentage is not a decibel figure however closely a unit follows it, so a
 * token carrying one is skipped rather than read.
 */
export function classifyPromptDecibelFigures(
    maskedScope: string,
    numbers: readonly PromptNumber[]
): PromptDecibelFigure[] {
    const figures: PromptDecibelFigure[] = [];
    for (const number of numbers) {
        const unit = DECIBEL_UNIT_PATTERN.exec(maskedScope.slice(number.end));
        if (!unit || number.raw.endsWith('%')) {
            continue;
        }
        figures.push(classifyFigure(maskedScope, number, number.end + unit[0].length));
    }
    return figures;
}
