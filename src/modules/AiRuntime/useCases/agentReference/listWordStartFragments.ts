import { startsNameWord } from './startsNameWord';

/**
 * Every fragment the name holds at the start of a word, each a word start up to any later point of
 * that run of letters and digits, lowercased: "pad", "pa" and "p" for Synth Pad as well as "synth".
 */
export function listWordStartFragments(name: string): string[] {
    const fragments: string[] = [];
    for (let index = 0; index < name.length; index += 1) {
        if (!/[\p{L}\p{N}]/u.test(name[index] ?? '') || !startsNameWord(name, index)) {
            continue;
        }
        const run = /^[\p{L}\p{N}]+/u.exec(name.slice(index))?.[0] ?? '';
        for (let end = 1; end <= run.length; end += 1) {
            fragments.push(run.slice(0, end).toLowerCase());
        }
    }
    return fragments;
}
