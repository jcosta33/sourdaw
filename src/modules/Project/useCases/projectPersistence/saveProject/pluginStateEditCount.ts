/**
 * Counts every edit a hosted plugin reports, including those made while the
 * project is already dirty. `markDirty` cannot tell a save about those: it only
 * flips a clean project, so an edit made after a save read that plugin's state
 * would leave the project marked saved without it (#5989). A save compares the
 * count it read before capture with the count when it finishes.
 */
let pluginStateEdits = 0;

export const pluginStateEditCount = {
    record(): void {
        pluginStateEdits += 1;
    },
    read(): number {
        return pluginStateEdits;
    },
};
