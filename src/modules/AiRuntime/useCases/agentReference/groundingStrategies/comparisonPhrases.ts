/**
 * The phrases that open a comparison against another project object, in normalized words: the object
 * after one is the comparison's, never the level's, so an entry may only say the level is measured
 * against it.
 */
export const OBJECT_COMPARISON_PHRASES: readonly string[] = ['like', 'relative to', 'compared to', 'compared with'];

/** The phrases that open a comparison against the level as it stands, never against another object. */
export const CURRENT_LEVEL_COMPARISON_PHRASES: readonly string[] = ['relative to', 'than'];

/** What a comparison against the level as it stands names: the level now or before, never a figure. */
export const CURRENT_LEVEL_PHRASES: readonly string[] = ['the current level', 'before', 'it is'];
