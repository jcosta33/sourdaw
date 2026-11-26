/**
 * Whether a word starts at the index: the name's start, past a non-letter, at a capital after a
 * lowercase letter ("BassGuitar"), or at a capital opening a lowercase run after capitals ("BGVox").
 */
function startsWord(name: string, index: number): boolean {
    const previous = name[index - 1];
    if (previous === undefined || !/\p{L}/u.test(previous)) {
        return true;
    }
    const current = name[index] ?? '';
    if (!/\p{Lu}/u.test(current)) {
        return false;
    }
    return /\p{Ll}/u.test(previous) || /\p{Ll}/u.test(name[index + 1] ?? '');
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
