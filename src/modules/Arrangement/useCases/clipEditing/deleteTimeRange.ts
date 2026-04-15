import { getTrackState } from '../../repositories/track/getTrackState';
import { setTrackState } from '../../repositories/track/setTrackState';
import { pushUndoEntry } from '#/modules/Command/useCases';

export function deleteTimeRange(startBeat: number, endBeat: number, trackIds: string[]): void {
    const state = getTrackState();
    if (!state) {
        return;
    }

    const newTracks = state.tracks.map((track) => {
        if (!trackIds.includes(track.id)) {
            return track;
        }

        const newClips = [...track.clips];
        const finalClips: typeof newClips = [];

        for (const clip of newClips) {
            if (clip.startBeat >= startBeat && clip.endBeat <= endBeat) {
                continue;
            } else if (clip.startBeat < startBeat && clip.endBeat > endBeat) {
                const leftClip = { ...clip, endBeat: startBeat, name: `${clip.name} (L)` };
                const rightClip = { 
                    ...clip, 
                    id: crypto.randomUUID().slice(0, 8), 
                    startBeat: endBeat, 
                    name: `${clip.name} (R)`,
                    audioOffsetBeats: (clip.audioOffsetBeats ?? 0) + (endBeat - clip.startBeat),
                };
                finalClips.push(leftClip, rightClip);
            } else if (clip.startBeat < startBeat && clip.endBeat > startBeat) {
                finalClips.push({ ...clip, endBeat: startBeat });
            } else if (clip.startBeat < endBeat && clip.endBeat > endBeat) {
                finalClips.push({ 
                    ...clip, 
                    startBeat: endBeat,
                    audioOffsetBeats: (clip.audioOffsetBeats ?? 0) + (endBeat - clip.startBeat)
                });
            } else {
                finalClips.push(clip);
            }
        }

        return { ...track, clips: finalClips };
    });

    const originalTracks = state.tracks;

    pushUndoEntry(
        'Delete Time Range',
        () => {
            const currentState = getTrackState();
            if (currentState) {
                setTrackState({ ...currentState, tracks: originalTracks });
            }
        },
        () => {
            const currentState = getTrackState();
            if (currentState) {
                setTrackState({ ...currentState, tracks: newTracks });
            }
        }
    );

    setTrackState({ ...state, tracks: newTracks });
}
