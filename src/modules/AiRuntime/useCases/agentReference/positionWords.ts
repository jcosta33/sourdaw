/** A word of figures alone: the index word opening an indexed name ("01" in "01 Kick"), or a figure's digits. */
export const FIGURE_WORD = /^\p{N}+$/u;

/** The ordinal words a request may use to pick one of several objects by position, first to tenth. */
export const ORDINAL_WORDS: readonly string[] = [
    'first',
    'second',
    'third',
    'fourth',
    'fifth',
    'sixth',
    'seventh',
    'eighth',
    'ninth',
    'tenth',
];

/** The cardinal words a request may state a position or a number in, one to ten: "kick two". */
export const CARDINAL_WORDS: readonly string[] = [
    'one',
    'two',
    'three',
    'four',
    'five',
    'six',
    'seven',
    'eight',
    'nine',
    'ten',
];

/** The words that announce the position or number after them: "kick number 2", "kick no. 2", "kick track two". */
export const NUMBER_SIGN_WORDS: readonly string[] = ['number', 'no', 'track'];
