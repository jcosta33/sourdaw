/**
 * Pure command-palette search helpers: subsequence fuzzy match and
 * registry filtering. No state, no I/O. Used by the command palette view
 * and any other consumer that needs to search the command catalog.
 */

type SearchableCommandEntry = {
    label: string;
    description: string;
    category: string;
};

/** Subsequence fuzzy match: every char of `query` appears in `text` in order. */
export function fuzzyMatch(query: string, text: string): boolean {
    const query1 = query.toLowerCase();
    const time = text.toLowerCase();
    let qi = 0;
    for (let ti = 0; ti < time.length && qi < query1.length; ti++) {
        if (time[ti] === query1[qi]) {
            qi++;
        }
    }
    return qi === query1.length;
}

/** Filter the supplied catalog by free-text query (label/description/category). */
export function searchCommands<Entry extends SearchableCommandEntry>(registry: Entry[], query: string): Entry[] {
    if (!query.trim()) {
        return registry;
    }
    return registry.filter(
        (cmd) => fuzzyMatch(query, cmd.label) || fuzzyMatch(query, cmd.description) || fuzzyMatch(query, cmd.category)
    );
}
