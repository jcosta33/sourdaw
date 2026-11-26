import { startsNameWord } from './startsNameWord';

/**
 * Whether the name holds the fragment, in any case, at the start of a word: "guitar" in Guitar1 and in
 * BassGuitar, never "pad" in Launchpad.
 */
export function holdsFragmentAtWordStart(name: string, fragment: string): boolean {
    const folded = name.toLowerCase();
    const needle = fragment.toLowerCase();
    let index = folded.indexOf(needle);
    while (index >= 0) {
        if (startsNameWord(name, index)) {
            return true;
        }
        index = folded.indexOf(needle, index + 1);
    }
    return false;
}
