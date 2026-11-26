/**
 * The phrases that open a comparison against another project object, in normalized words: "like Keys",
 * "relative to Keys", "compared to Keys", "compared with Keys". The object is the comparison's, never
 * the level's.
 */
export const OBJECT_COMPARISON_PHRASES: readonly string[] = ['like', 'relative to', 'compared to', 'compared with'];

/** The phrases that open a comparison against the level as it stands: "relative to the current level". */
export const CURRENT_LEVEL_COMPARISON_PHRASES: readonly string[] = ['relative to', 'than'];

/** What a comparison against the level as it stands names: "than before", "than it is". */
export const CURRENT_LEVEL_PHRASES: readonly string[] = ['the current level', 'before', 'it is'];
