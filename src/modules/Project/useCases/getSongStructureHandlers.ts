import { type ActionHandler, type AppAction } from '#/modules/Command/useCases';
import { handleDetectSongStructure } from '../handlers/songStructure/handleDetectSongStructure';

type SongStructureAppAction = Extract<AppAction, { type: 'detectSongStructure' }>;

export type SongStructureHandlersMap = {
    [Action in SongStructureAppAction as Action['type']]: ActionHandler<Action>;
};

/**
 * Merges song-structure `ActionHandler` maps for Command. Does **not** call `createHandler` here.
 */
export function getSongStructureHandlers(): SongStructureHandlersMap {
    return {
        detectSongStructure: handleDetectSongStructure,
    };
}
