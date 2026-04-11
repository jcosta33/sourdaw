/**
 * Pure command-palette search helpers: subsequence fuzzy match and
 * registry filtering. No state, no I/O. Used by the command palette view
 * and any other consumer that needs to search the command catalog.
 */

import { type CommandEntry } from '../models/CommandEntry';

/** Subsequence fuzzy match: every char of `query` appears in `text` in order. */
export function fuzzyMatch(query: string, text: string): boolean {
    const q = query.toLowerCase();
    const t = text.toLowerCase();
    let qi = 0;
    for (let ti = 0; ti < t.length && qi < q.length; ti++) {
        if (t[ti] === q[qi]) {
            qi++;
        }
    }
    return qi === q.length;
}

/** Filter the supplied catalog by free-text query (label/description/category). */
export function searchCommands(registry: CommandEntry[], query: string): CommandEntry[] {
    if (!query.trim()) {
        return registry;
    }
    return registry.filter(
        (cmd) => fuzzyMatch(query, cmd.label) || fuzzyMatch(query, cmd.description) || fuzzyMatch(query, cmd.category)
    );
}
