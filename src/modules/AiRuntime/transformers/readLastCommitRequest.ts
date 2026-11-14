/**
 * What a chat request asks of the thread's last commit, read in one closed grammar. Every request is
 * read whole: an opener and a closing courtesy may surround exactly one of the forms below, and any
 * other word, symbol or figure makes it no continuation at all, so it is planned as an ordinary
 * request. The grammar never names a target for a continuation or a value for a re-target; those
 * come from the commit itself.
 */
export type LastCommitRequest =
    | { kind: 'none' }
    /** "undo that", "revert the last change", "take it back". */
    | { kind: 'undo' }
    /**
     * A continuation: `another` / `a further` / `an extra` N <unit> continues the committed change,
     * `N <unit> more` / `N <unit> less` compares with it, and a comparative with no figure ("a bit
     * more") carries `figure: null`. A figure in decibels carries no `unit`; a figure in any other
     * unit carries that unit as the caller listed it, and `percent` reads as `%`.
     */
    | {
          kind: 'continue';
          phrasing: 'another' | 'comparative';
          comparative: 'more' | 'less';
          figure: number | null;
          unit?: string;
      }
    /**
     * The same change on other objects: "do the same to the Guitars" (`same`), "the Guitars too"
     * (`too`), or "apply that recipe to the Guitars" (`recipe`), which names the committed recipe and
     * so is refused when the commit adopted none. `targetText` is the slice of the request naming
     * them, as the user typed it.
     */
    | { kind: 'retarget'; form: 'same' | 'too' | 'recipe'; targetText: string };

const NONE: LastCommitRequest = { kind: 'none' };

const OPENERS = String.raw`(?:(?:please|ok|okay|now|and|then|just|yes|actually),?\s+)*`;
const CLOSERS = String.raw`(?:,?\s+(?:please|thanks|thank you))?`;
const END = String.raw`\s*[.!]?$`;

function wholeRequest(body: string): RegExp {
    return new RegExp(`^${OPENERS}(?:${body})${CLOSERS}${END}`, 'iu');
}

const FIGURE = String.raw`(\d+(?:\.\d+)?)`;
const DECIBELS = String.raw`\s?(?:db|decibels?)`;
const PERCENT_WORD = 'percent';

const UNDO = wholeRequest(
    String.raw`(?:undo|revert)\s+(?:that|it|this|that change|that last change|the change|the last change|the last edit|your last change|what you just did)|take (?:that|it) back`
);
const ANOTHER = wholeRequest(String.raw`(?:another|a further|an extra)\s+${FIGURE}${DECIBELS}`);
const COMPARATIVE = wholeRequest(String.raw`(?:make it\s+)?${FIGURE}${DECIBELS}\s+(more|less)(?:\s+than that)?`);
const VAGUE = wholeRequest(
    String.raw`(?:make it\s+)?(?:(?:a bit|a little|a little bit|a touch|slightly)\s+)?(more|less)`
);
const RECIPE = wholeRequest(String.raw`(?:apply|use)\s+(?:that|the same)\s+recipe\s+(?:to|on)\s+(.+?)`);
const SAME = wholeRequest(String.raw`(?:(?:do|apply)\s+the\s+same|(?:the\s+)?same)\s+(?:to|on|for)\s+(.+?)`);
const TOO = wholeRequest(String.raw`(.+?)\s+(?:too|as well)`);

function escapeRegExp(text: string): string {
    return text.replaceAll(/[.*+?^${}()|[\]\\/]/gu, String.raw`\$&`);
}

type UnitForms = { another: RegExp; comparative: RegExp; spellings: readonly string[] };

/**
 * The continuation forms for a figure in one of the units, each unit spelled as listed. Longer
 * spellings are tried first, so a unit that begins another ("s" before "st") never cuts it short.
 */
function readUnitForms(units: readonly string[]): UnitForms {
    const spellings = [...new Set(['%', PERCENT_WORD, ...units.filter((unit) => unit.trim().length > 0)])].toSorted(
        (left, right) => right.length - left.length
    );
    const unit = String.raw`\s?(${spellings.map(escapeRegExp).join('|')})`;
    return {
        another: wholeRequest(String.raw`(?:another|a further|an extra)\s+${FIGURE}${unit}`),
        comparative: wholeRequest(String.raw`(?:make it\s+)?${FIGURE}${unit}\s+(more|less)(?:\s+than that)?`),
        spellings,
    };
}

/** The unit as the caller listed it, whatever case the request typed it in; `percent` is `%`. */
function canonicalUnit(stated: string, spellings: readonly string[]): string {
    if (stated.toLowerCase() === PERCENT_WORD) {
        return '%';
    }
    return spellings.find((spelling) => spelling.toLowerCase() === stated.toLowerCase()) ?? stated;
}

function readComparative(word: string | undefined): 'more' | 'less' | null {
    const normalized = word?.toLowerCase();
    return normalized === 'more' || normalized === 'less' ? normalized : null;
}

/** A continuation by a figure in a unit other than decibels, or `null` when the request is none. */
function readUnitContinuation(text: string, units: readonly string[]): LastCommitRequest | null {
    const forms = readUnitForms(units);
    const another = forms.another.exec(text);
    if (another !== null) {
        return {
            kind: 'continue',
            phrasing: 'another',
            comparative: 'more',
            figure: Number(another[1]),
            unit: canonicalUnit(another[2] ?? '', forms.spellings),
        };
    }
    const compared = forms.comparative.exec(text);
    const comparedWord = readComparative(compared?.[3]);
    if (compared === null || comparedWord === null) {
        return null;
    }
    return {
        kind: 'continue',
        phrasing: 'comparative',
        comparative: comparedWord,
        figure: Number(compared[1]),
        unit: canonicalUnit(compared[2] ?? '', forms.spellings),
    };
}

/**
 * Reads a request in the closed grammar. `units` are the units besides decibels and percentages a
 * figure may be stated in, as the caller's device descriptors declare them.
 */
export function readLastCommitRequest(prompt: string, units: readonly string[] = []): LastCommitRequest {
    const text = prompt.trim().replaceAll(/\s+/gu, ' ');
    if (UNDO.test(text)) {
        return { kind: 'undo' };
    }
    const another = ANOTHER.exec(text);
    if (another !== null) {
        return { kind: 'continue', phrasing: 'another', comparative: 'more', figure: Number(another[1]) };
    }
    const compared = COMPARATIVE.exec(text);
    const comparedWord = readComparative(compared?.[2]);
    if (compared !== null && comparedWord !== null) {
        return { kind: 'continue', phrasing: 'comparative', comparative: comparedWord, figure: Number(compared[1]) };
    }
    const inUnit = readUnitContinuation(text, units);
    if (inUnit !== null) {
        return inUnit;
    }
    const vague = readComparative(VAGUE.exec(text)?.[1]);
    if (vague !== null) {
        return { kind: 'continue', phrasing: 'comparative', comparative: vague, figure: null };
    }
    const recipe = RECIPE.exec(text)?.[1];
    if (recipe !== undefined) {
        return { kind: 'retarget', form: 'recipe', targetText: recipe };
    }
    const same = SAME.exec(text)?.[1];
    if (same !== undefined) {
        return { kind: 'retarget', form: 'same', targetText: same };
    }
    const too = TOO.exec(text)?.[1];
    if (too !== undefined) {
        return { kind: 'retarget', form: 'too', targetText: too };
    }
    return NONE;
}
