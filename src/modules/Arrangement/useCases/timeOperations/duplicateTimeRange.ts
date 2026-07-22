import { duplicateClipNotes } from '#/modules/MIDI/useCases';

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

    const duplicatedNoteSources: Array<{ sourceClipId: string; newClipId: string }> = [];

    setTrackState({
        ...state,
        tracks: state.tracks.map((track) => {
            const clipsInRange = track.clips.filter(
                (context) =>
                    context.startBeat >= startBeat &&
                    context.endBeat <= endBeat + duration &&
                    context.startBeat < endBeat
            );
            const duplicated = clipsInRange.map((context) => {
                const newClipId = `clip-dup-${crypto.randomUUID()}`;
                if (context.type === 'midi') {
                    duplicatedNoteSources.push({ sourceClipId: context.id, newClipId });
                }
                return {
                    ...context,
                    id: newClipId,
                    startBeat: context.startBeat + duration,
                    endBeat: context.endBeat + duration,
                };
            });
            return { ...track, clips: [...track.clips, ...duplicated] };
        }),
    });

    // MIDI notes are keyed by clip id — duplicating the rectangle without the
    // notes produced silent clips (ledger M-023). Notes are clip-relative, so
    // a verbatim copy lands at the same relative position in the duplicate.
    for (const { sourceClipId, newClipId } of duplicatedNoteSources) {
        duplicateClipNotes(sourceClipId, newClipId);
    }
}
