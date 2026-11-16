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

// A straight apostrophe before one of these words stands for the dropped letters ('em, 'cause), not an opening quote.
export function startsWordInitialElision(value: string, apostropheIndex: number): boolean {
    const word = /^[\p{L}\p{N}]+/u.exec(value.slice(apostropheIndex + 1))?.[0];
    if (word === undefined) {
        return false;
    }
    return WORD_INITIAL_ELISIONS.has(word.toLowerCase());
}
