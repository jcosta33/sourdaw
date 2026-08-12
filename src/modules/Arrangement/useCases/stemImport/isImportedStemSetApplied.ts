import { type AppAction } from '#/utils/handlerContract';

import { getTrackState } from '../../repositories/track/getTrackState';

import { createImportedStemTracks } from './createImportedStemTracks';

type ImportStemSetAction = Extract<AppAction, { type: 'importStemSet' }>;

export function isImportedStemSetApplied(action: ImportStemSetAction): boolean {
    const state = getTrackState();
    if (!state) {
        return false;
    }

    const { folder, importedTracks } = createImportedStemTracks(action);
    const expectedTracks = [folder, ...importedTracks];
    const exactTracksExist = expectedTracks.every((expectedTrack) => {
        const matchingTracks = state.tracks.filter((track) => track.id === expectedTrack.id);
        return matchingTracks.length === 1 && JSON.stringify(matchingTracks[0]) === JSON.stringify(expectedTrack);
    });
    if (!exactTracksExist) {
        return false;
    }

    const expectedTrackIds = new Set(expectedTracks.map((track) => track.id));
    const folderIndex = state.tracks.findIndex((track) => track.id === folder.id);
    const appliedTrackIds = state.tracks
        .slice(folderIndex, folderIndex + expectedTracks.length)
        .map((track) => track.id);
    if (JSON.stringify(appliedTrackIds) !== JSON.stringify([...expectedTrackIds])) {
        return false;
    }

    const generatedClipIds = new Set(action.payload.stems.map((stem) => stem.clipId));
    return state.tracks
        .filter((track) => !expectedTrackIds.has(track.id))
        .every(
            (track) =>
                track.clips.every((clip) => !generatedClipIds.has(clip.id)) &&
                track.alternatives.every((alternative) =>
                    alternative.clips.every((clip) => !generatedClipIds.has(clip.id))
                )
        );
}
