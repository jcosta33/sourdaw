import { type AppAction } from '#/utils/handlerContract';

import { getTrackState } from '../../repositories/track/getTrackState';
import { setTrackState } from '../../repositories/track/setTrackState';

import { createImportedStemTracks } from './createImportedStemTracks';

import type { Track } from '../../stores/trackStore';

type ImportStemSetAction = Extract<AppAction, { type: 'importStemSet' }>;

type ImportStemSetToProjectResult = {
    folder: Track;
    importedTracks: Track[];
};

export function importStemSetToProject(action: ImportStemSetAction): ImportStemSetToProjectResult | null {
    const state = getTrackState();
    if (!state) {
        return null;
    }
    const createdTrackIds = [action.payload.folderId, ...action.payload.stems.map((stem) => stem.trackId)];
    const createdClipIds = new Set(action.payload.stems.map((stem) => stem.clipId));
    const idsAreAvailable =
        new Set(createdTrackIds).size === createdTrackIds.length &&
        createdClipIds.size === action.payload.stems.length &&
        state.tracks.every(
            (track) =>
                !createdTrackIds.includes(track.id) &&
                track.clips.every((clip) => !createdClipIds.has(clip.id)) &&
                track.alternatives.every((alternative) =>
                    alternative.clips.every((clip) => !createdClipIds.has(clip.id))
                )
        );
    if (!idsAreAvailable) {
        return null;
    }

    const { folder, importedTracks } = createImportedStemTracks(action);

    setTrackState({ ...state, tracks: [...state.tracks, folder, ...importedTracks] });
    return { folder, importedTracks };
}
