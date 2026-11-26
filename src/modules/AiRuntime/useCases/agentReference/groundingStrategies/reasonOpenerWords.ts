/** The words that open a stated cause, in normalized words: "because Keys is too loud", "since it is buried". */
export const CAUSE_OPENER_WORDS: readonly string[] = ['because', 'since'];

/**
 * The words that open a purpose whose own subject follows, in normalized words: "so it sits back", "so
 * that Drums sits back". "So" is also a word of an amount ("or so"), so a purpose opens only where a
 * clause of its own follows it.
 */
export const SUBJECT_PURPOSE_OPENER_WORDS: readonly string[] = ['so', 'so that'];

/**
 * The words that open a purpose whose verb follows, in normalized words: "to make room for Keys". "To"
 * is also where a level lands or goes ("to -6 dB", "to the send"), so a purpose opens only where a verb
 * follows it.
 */
const VERB_PURPOSE_OPENER_WORDS: readonly string[] = ['to'];

/**
 * The words that open a stated reason or purpose. A reason says why, never where, when or on what, so a
 * reader that meets one may read it apart from the clause it explains.
 */
export const REASON_OPENER_WORDS: readonly string[] = [
    ...CAUSE_OPENER_WORDS,
    ...SUBJECT_PURPOSE_OPENER_WORDS,
    ...VERB_PURPOSE_OPENER_WORDS,
];
