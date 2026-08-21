import { createTrack } from '../../models/Track';
import { getTrackState } from '../../repositories/track/getTrackState';
import { setTrackState } from '../../repositories/track/setTrackState';

/**
 * Returns whether a folder was actually appended. The caller needs that answer: a
 * command whose execute wrote nothing must report `no-write` rather than let an undo
 * entry be filed, because that entry's inverse can only ever conflict and a conflicted
 * entry stays on the stack, refusing every later undo press.
 */
export function createFolder(name: string, trackIdOverride?: string): boolean {
    const state = getTrackState();
    if (!state) {
        return false;
    }

    // `trackIdOverride` carries the id `materializeCommandApplicationIds` minted before
    // `describe()` ran, so the undo inverse can name this exact track. Omitting the key
    // entirely when absent keeps the created track's id generation untouched for callers
    // that pass nothing.
    const folder = createTrack({ name, kind: 'folder', ...(trackIdOverride ? { id: trackIdOverride } : {}) });
    setTrackState({
        ...state,
        tracks: [...state.tracks, folder],
    });
    return true;
}
