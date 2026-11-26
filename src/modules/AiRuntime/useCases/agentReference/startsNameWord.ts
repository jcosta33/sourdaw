/**
 * Whether a word starts at the index: the name's start, past a non-letter, at a capital after a
 * lowercase letter ("BassGuitar"), or at a capital opening a lowercase run after capitals ("BGVox").
 */
export function startsNameWord(name: string, index: number): boolean {
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
