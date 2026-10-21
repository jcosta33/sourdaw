import { getAllTracks } from '#/modules/Arrangement/useCases';
import { type AppAction } from '#/utils/handlerContract';

export type MidiTrackPlan = { trackId: string; actions: AppAction[] };

/** Plan a destination before dispatch; a new track and its clip/notes commit together. */
export function resolveMidiTrackId(targetTrackId: string, trackName: string): MidiTrackPlan {
    const existingTrack = getAllTracks().find((track) => track.id === targetTrackId);
    if (existingTrack?.kind === 'midi') {
        return { trackId: existingTrack.id, actions: [] };
    }
    const trackId = `track-audio-midi-${crypto.randomUUID()}`;
    return {
        trackId,
        actions: [{ type: 'addTrack', payload: { id: trackId, name: trackName, kind: 'midi' } }],
    };
}
