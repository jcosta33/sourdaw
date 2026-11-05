const LETTER_KEYS = 'abcdefghijklmnopqrstuvwxyz'
    .split('')
    .map((letter): [string, string] => [`Key${letter.toUpperCase()}`, letter]);

const DIGIT_KEYS = '0123456789'.split('').map((digit): [string, string] => [`Digit${digit}`, digit]);

const PUNCTUATION_KEYS: [string, string][] = [
    ['BracketLeft', '['],
    ['BracketRight', ']'],
    ['Comma', ','],
    ['Period', '.'],
    ['Slash', '/'],
    ['Semicolon', ';'],
    ['Quote', "'"],
    ['Minus', '-'],
    ['Equal', '='],
    ['Backquote', '`'],
    ['Backslash', '\\'],
];

/**
 * The unmodified character each physical key (`KeyboardEvent.code`) produces on a
 * US layout. The fallback when the Keyboard Map API is unavailable or still loading.
 */
export const US_PHYSICAL_KEY_CHARACTERS: ReadonlyMap<string, string> = new Map([
    ...LETTER_KEYS,
    ...DIGIT_KEYS,
    ...PUNCTUATION_KEYS,
]);
