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

// Classified by shape: in-word (letter on both sides) is skipped, an opener has a word character after it,
// every other apostrophe is a closer. The first decisive one settles whether a quotation follows.
function nextApostropheCloses(value: string, fromIndex: number): boolean {
    for (let index = value.indexOf("'", fromIndex); index !== -1; index = value.indexOf("'", index + 1)) {
        const wordBefore = isWordCharacter(value[index - 1]);
        const wordAfter = isWordCharacter(value[index + 1]);
        if (wordBefore && wordAfter) {
            continue;
        }
        return !wordAfter;
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
