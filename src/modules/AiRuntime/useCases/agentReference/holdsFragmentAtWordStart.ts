/** Whether a word starts at the index: the name's start, past a non-letter, or a camel-case capital. */
function startsWord(name: string, index: number): boolean {
    const previous = name[index - 1];
    if (previous === undefined || !/\p{L}/u.test(previous)) {
        return true;
    }
    return /\p{Ll}/u.test(previous) && /\p{Lu}/u.test(name[index] ?? '');
}

/**
 * Whether the name holds the fragment, in any case, at the start of a word: "guitar" in Guitar1 and in
 * BassGuitar, never "pad" in Launchpad.
 */
export function holdsFragmentAtWordStart(name: string, fragment: string): boolean {
    const folded = name.toLowerCase();
    const needle = fragment.toLowerCase();
    let index = folded.indexOf(needle);
    while (index >= 0) {
        if (startsWord(name, index)) {
            return true;
        }
        index = folded.indexOf(needle, index + 1);
    }
    return false;
}
