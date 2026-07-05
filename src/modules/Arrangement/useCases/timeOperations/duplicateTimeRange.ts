import { getTrackState } from '../../repositories/track/getTrackState';
import { setTrackState } from '../../repositories/track/setTrackState';

import { insertTime } from './insertTime';

export function duplicateTimeRange(startBeat: number, endBeat: number): void {
    const duration = endBeat - startBeat;
    insertTime(endBeat, duration);

    const state = getTrackState();
    if (!state) {
        return;
    }

    setTrackState({
        ...state,
        tracks: state.tracks.map((track) => {
            const clipsInRange = track.clips.filter(
                (context) =>
                    context.startBeat >= startBeat &&
                    context.endBeat <= endBeat + duration &&
                    context.startBeat < endBeat
            );
            const duplicated = clipsInRange.map((context) => ({
                ...context,
                id: `clip-dup-${crypto.randomUUID()}`,
                startBeat: context.startBeat + duration,
                endBeat: context.endBeat + duration,
            }));
            return { ...track, clips: [...track.clips, ...duplicated] };
        }),
    });
}
