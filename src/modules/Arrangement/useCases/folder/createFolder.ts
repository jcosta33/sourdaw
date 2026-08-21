import { createTrack } from '../../models/Track';
import { getTrackState } from '../../repositories/track/getTrackState';
import { setTrackState } from '../../repositories/track/setTrackState';

export function createFolder(name: string, trackIdOverride?: string): void {
    const state = getTrackState();
    if (!state) {
        return;
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
}
