/**
 * The words that qualify an amount or close a request without naming an object, in normalized words:
 * how exactly the amount is meant ("just", "exactly", "about", "approximately", "around", "roughly",
 * "slightly", "a bit", "a little", "a touch", "full", "or so"), that the change repeats or adds to one
 * ("another", "a further", "an additional", "an extra", "again", "too", "as well"), that a list's members
 * move as one ("together"), or that it replaces one ("instead"). An article before one reads as an
 * article. A clause stating them still names only the object and the amount it named.
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
