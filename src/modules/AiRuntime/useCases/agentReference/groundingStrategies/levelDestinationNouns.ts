/**
 * Nouns that name where a level goes rather than what a reason is about, beside the kind nouns
 * (`KIND_NOUNS`): a frequency band, the master, or an output a signal is sent to. A reason opener
 * followed by one names a destination, never a reason. The word "output" itself is a mixer control
 * (`CONTROL_WORDS`), which no reason may name, so it needs no entry here.
 */
export const LEVEL_DESTINATION_NOUNS: readonly string[] = ['band', 'master', 'aux', 'monitor', 'headphone'];
