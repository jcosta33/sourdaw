import { getTrackStoreState } from '../useCases/getTrackStoreState';

/**
 * MIDI playback reads neither clip fades nor a clip gain envelope, so the
 * actions that write them refuse a MIDI clip instead of storing data no
 * renderer applies.
 */
export function isMidiClip(clipId: string): boolean {
    return (
        getTrackStoreState()
            ?.tracks.flatMap((track) => track.clips)
            .find((candidate) => candidate.id === clipId)?.type === 'midi'
    );
}
