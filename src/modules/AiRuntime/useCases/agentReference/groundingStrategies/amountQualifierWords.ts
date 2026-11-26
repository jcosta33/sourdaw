/**
 * The words that qualify an amount or close a request without naming an object, in normalized words:
 * an entry says how exactly the amount is meant, that the change repeats or adds to an earlier one, that
 * a list's members move as one, or that it replaces one, and never names an object, stretch or control.
 * An article before one reads as an article. A clause stating them still names only the object and the
 * amount it named.
 */
export const AMOUNT_QUALIFIER_PHRASES: readonly string[] = [
    'just',
    'exactly',
    'about',
    'approximately',
    'around',
    'roughly',
    'slightly',
    'a bit',
    'a little',
    'a touch',
    'a lot',
    'full',
    'or so',
    'another',
    'further',
    'additional',
    'extra',
    'again',
    'too',
    'as well',
    'together',
    'instead',
];
