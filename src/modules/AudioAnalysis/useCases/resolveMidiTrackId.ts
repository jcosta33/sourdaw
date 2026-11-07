import { getAllTracks } from '#/modules/Arrangement/useCases';
import { type AppAction } from '#/utils/handlerContract';

/** Plan the destination so its track, clip and notes can commit together. */
export function resolveMidiTrackId(
    targetTrackId: string,
    trackName: string
): { trackId: string; actions: AppAction[] } {
    const existingTrack = getAllTracks().find((track) => track.id === targetTrackId);
    if (existingTrack && existingTrack.kind === 'midi') {
        return { trackId: targetTrackId, actions: [] };
    }

    const trackId = `track-audio-midi-${crypto.randomUUID()}`;
    return { trackId, actions: [{ type: 'addTrack', payload: { id: trackId, name: trackName, kind: 'midi' } }] };
}
