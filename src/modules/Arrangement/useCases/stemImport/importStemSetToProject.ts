import { type AppAction } from '#/utils/handlerContract';

import { createTrack } from '../../models/Track';
import { getTrackState } from '../../repositories/track/getTrackState';
import { setTrackState } from '../../repositories/track/setTrackState';

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

    const folder = createTrack({
        id: action.payload.folderId,
        name: action.payload.groupName,
        kind: 'folder',
        ...(action.payload.folderColor ? { color: action.payload.folderColor } : {}),
        ...(action.payload.folderAlternativeId ? { initialAlternativeId: action.payload.folderAlternativeId } : {}),
    });
    const importedTracks = action.payload.stems.map((stem) => {
        const track = createTrack({
            id: stem.trackId,
            name: stem.trackName,
            kind: 'audio',
            gain: stem.trackGain,
            parentId: folder.id,
            ...(stem.trackColor ? { color: stem.trackColor } : {}),
            ...(stem.trackAlternativeId ? { initialAlternativeId: stem.trackAlternativeId } : {}),
        });
        track.pan = stem.trackPan;
        track.clips = [
            {
                id: stem.clipId,
                trackId: stem.trackId,
                name: stem.trackName,
                startBeat: 0,
                endBeat: (stem.durationSeconds * stem.sourceTempo) / 60,
                type: 'audio',
                audioBufferId: stem.audioBufferId,
                ...(stem.assetHash ? { assetHash: stem.assetHash } : {}),
                fadeInBeats: 0,
                fadeOutBeats: 0,
                gain: 1,
                color: '',
                locked: false,
                muted: false,
                stretchMode: 'timestretch',
                stretchRatio: action.payload.projectTempo / stem.sourceTempo,
            },
        ];
        return track;
    });

    setTrackState({ ...state, tracks: [...state.tracks, folder, ...importedTracks] });
    return { folder, importedTracks };
}
