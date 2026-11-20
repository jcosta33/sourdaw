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

function isWordCharacter(character: string | undefined): boolean {
    return character !== undefined && /[\p{L}\p{N}]/u.test(character);
}

// The next straight apostrophe that is not inside a word decides: a closer ends a quotation, an opener starts another one.
function nextApostropheCloses(value: string, fromIndex: number): boolean {
    for (let index = value.indexOf("'", fromIndex); index !== -1; index = value.indexOf("'", index + 1)) {
        const wordBefore = isWordCharacter(value[index - 1]);
        const wordAfter = isWordCharacter(value[index + 1]);
        if (wordBefore && wordAfter) {
            continue;
        }
        return wordBefore;
    }
    return false;
}

// A straight apostrophe before one of these words stands for the dropped letters ('em, 'cause), not an opening quote,
// unless the next apostrophe closes it as a quotation ('Round', 'Round Robin').
export function startsWordInitialElision(value: string, apostropheIndex: number): boolean {
    const word = /^[\p{L}\p{N}]+/u.exec(value.slice(apostropheIndex + 1))?.[0];
    if (word === undefined || !WORD_INITIAL_ELISIONS.has(word.toLowerCase())) {
        return false;
    }
    return !nextApostropheCloses(value, apostropheIndex + 1 + word.length);
}

// One rule for both prompt readers: no word character before the apostrophe, and not an elision.
export function opensStraightQuote(value: string, apostropheIndex: number): boolean {
    if (isWordCharacter(value[apostropheIndex - 1])) {
        return false;
    }
    return !startsWordInitialElision(value, apostropheIndex);
}
