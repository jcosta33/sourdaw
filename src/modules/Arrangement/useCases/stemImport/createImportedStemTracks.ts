import { type AppAction } from '#/utils/handlerContract';

import { createTrack } from '../../models/Track';

import type { Track } from '../../stores/trackStore';

type ImportStemSetAction = Extract<AppAction, { type: 'importStemSet' }>;

type CreateImportedStemTracksResult = {
    folder: Track;
    importedTracks: Track[];
};

export function createImportedStemTracks(action: ImportStemSetAction): CreateImportedStemTracksResult {
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

    return { folder, importedTracks };
}
