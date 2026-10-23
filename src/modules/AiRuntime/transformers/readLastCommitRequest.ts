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
     * A level continuation: `another` / `a further` / `an extra` N dB continues the committed move,
     * `N dB more` / `N dB less` compares with the committed change, and a comparative with no figure
     * ("a bit more") carries `figure: null`.
     */
    | { kind: 'continue'; phrasing: 'another' | 'comparative'; comparative: 'more' | 'less'; figure: number | null }
    /**
     * The same change on other objects: "do the same to the Guitars" (`same`) or "the Guitars too"
     * (`too`). `targetText` is the slice of the request naming them, as the user typed it.
     */
    | { kind: 'retarget'; form: 'same' | 'too'; targetText: string };

const NONE: LastCommitRequest = { kind: 'none' };

const OPENERS = String.raw`(?:(?:please|ok|okay|now|and|then|just|yes|actually),?\s+)*`;
const CLOSERS = String.raw`(?:,?\s+(?:please|thanks|thank you))?`;
const END = String.raw`\s*[.!]?$`;

function wholeRequest(body: string): RegExp {
    return new RegExp(`^${OPENERS}(?:${body})${CLOSERS}${END}`, 'iu');
}

const FIGURE = String.raw`(\d+(?:\.\d+)?)`;
const DECIBELS = String.raw`\s?(?:db|decibels?)`;

const UNDO = wholeRequest(
    String.raw`(?:undo|revert)\s+(?:that|it|this|that change|that last change|the change|the last change|the last edit|your last change|what you just did)|take (?:that|it) back`
);
const ANOTHER = wholeRequest(String.raw`(?:another|a further|an extra)\s+${FIGURE}${DECIBELS}`);
const COMPARATIVE = wholeRequest(String.raw`(?:make it\s+)?${FIGURE}${DECIBELS}\s+(more|less)(?:\s+than that)?`);
const VAGUE = wholeRequest(
    String.raw`(?:make it\s+)?(?:(?:a bit|a little|a little bit|a touch|slightly)\s+)?(more|less)`
);
const SAME = wholeRequest(String.raw`(?:(?:do|apply)\s+the\s+same|(?:the\s+)?same)\s+(?:to|on|for)\s+(.+?)`);
const TOO = wholeRequest(String.raw`(.+?)\s+(?:too|as well)`);

function readComparative(word: string | undefined): 'more' | 'less' | null {
    const normalized = word?.toLowerCase();
    return normalized === 'more' || normalized === 'less' ? normalized : null;
}

export function readLastCommitRequest(prompt: string): LastCommitRequest {
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
    const vague = readComparative(VAGUE.exec(text)?.[1]);
    if (vague !== null) {
        return { kind: 'continue', phrasing: 'comparative', comparative: vague, figure: null };
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
