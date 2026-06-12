import { handleDetectSongStructure } from '../handlers/songStructure/handleDetectSongStructure';

export type SongStructureHandlersMap = {
    detectSongStructure: typeof handleDetectSongStructure;
};

/**
 * Merges song-structure `ActionHandler` maps for Command. Does **not** call `createHandler` here.
 */
export function getSongStructureHandlers(): SongStructureHandlersMap {
    return {
        detectSongStructure: handleDetectSongStructure,
    };
}
