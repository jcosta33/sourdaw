const WORD_INITIAL_ELISIONS = new Set([
    'em',
    'cause',
    'cos',
    'coz',
    'til',
    'till',
    'n',
    'bout',
    'round',
    'nother',
    'tis',
    'twas',
    'neath',
    'specially',
    'cept',
    'fraid',
    'kay',
    'sup',
    'ello',
]);

// The one elision that is closed by its own apostrophe: rock 'n' roll.
const SYMMETRIC_ELISION = 'n';

// A straight apostrophe before one of these words stands for the dropped letters ('em, 'cause), not an opening quote.
// A listed word closed by an apostrophe ('Round', 'Kay') is a quotation, except the symmetric 'n'.
export function startsWordInitialElision(value: string, apostropheIndex: number): boolean {
    const word = /^[\p{L}\p{N}]+/u.exec(value.slice(apostropheIndex + 1))?.[0];
    if (word === undefined) {
        return false;
    }
    const lowerWord = word.toLowerCase();
    if (!WORD_INITIAL_ELISIONS.has(lowerWord)) {
        return false;
    }
    const closedByApostrophe = value[apostropheIndex + 1 + word.length] === "'";
    return !closedByApostrophe || lowerWord === SYMMETRIC_ELISION;
}

// One rule for both prompt readers: no word character before the apostrophe, and not an elision.
export function opensStraightQuote(value: string, apostropheIndex: number): boolean {
    if (/[\p{L}\p{N}]$/u.test(value.slice(0, apostropheIndex))) {
        return false;
    }
    return !startsWordInitialElision(value, apostropheIndex);
}
