import { type createTrack } from '../models/Track';

import { type CreationBatchAction } from './creationBatch';

/**
 * Pins the creation inputs a batched `addTrack` would otherwise mint at
 * describe time onto the payload, the way the audio-import use case does.
 */
export function compileNewAudioTrackAction(track: ReturnType<typeof createTrack>): CreationBatchAction {
    return {
        type: 'addTrack',
        payload: {
            id: track.id,
            name: track.name,
            kind: track.kind,
            color: track.color,
            initialAlternativeId: track.activeAlternativeId,
        },
    };
}
