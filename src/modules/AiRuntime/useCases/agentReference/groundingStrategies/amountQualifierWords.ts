/**
 * The words that qualify an amount or close a request without naming an object, in normalized words:
 * how exactly the amount is meant ("just", "about", "around", "roughly", "slightly", "a bit", "or so"),
 * that the change repeats or adds to one ("another", "again", "too", "as well"), or that it replaces
 * one ("instead"). A clause stating them still names only the object and the amount it named.
 */
export const AMOUNT_QUALIFIER_PHRASES: readonly string[] = [
    'just',
    'about',
    'around',
    'roughly',
    'slightly',
    'a bit',
    'or so',
    'another',
    'again',
    'too',
    'as well',
    'instead',
];
