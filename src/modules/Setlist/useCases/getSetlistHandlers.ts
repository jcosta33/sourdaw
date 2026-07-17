import { handleNextSetlistItem } from '../handlers/setlist/handleNextSetlistItem';
import { handlePreviousSetlistItem } from '../handlers/setlist/handlePreviousSetlistItem';

export type SetlistHandlersMap = {
    nextSetlistItem: typeof handleNextSetlistItem;
    previousSetlistItem: typeof handlePreviousSetlistItem;
};

/**
 * Merges Setlist `ActionHandler` maps for Command. Does **not** call `createHandler` here.
 */
export function getSetlistHandlers(): SetlistHandlersMap {
    return {
        nextSetlistItem: handleNextSetlistItem,
        previousSetlistItem: handlePreviousSetlistItem,
    };
}
