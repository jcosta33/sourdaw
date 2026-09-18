/**
 * The localStorage slot holding the legacy plain-JSON Fermenter user-patches
 * array. The reader and the writer must address the same slot or patches
 * silently vanish between save and load; a migration would be the only reason
 * to change it, and it would have to move both sides at once.
 */
export const USER_PATCHES_STORAGE_KEY = 'fermenter-user-patches';
