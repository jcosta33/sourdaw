import { getTrackState } from '../../repositories/track/getTrackState';
import { updateClip } from '../../repositories/track/updateClip';
import { findClipById } from '../../services/findClipById';
import { planTrimmedTakeStarts } from '../comping/planTrimmedTakeStarts';
import { writeTakeStarts } from '../comping/writeTakeStarts';

export function trimClipStart(clipId: string, newStartBeat: number): boolean {
    if (!Number.isFinite(newStartBeat)) {
        return false;
    }

    let previousStartBeat: number | null = null;
    try {
        const state = getTrackState();
        if (state) {
            const target = findClipById({ clipId, tracks: state.tracks });
            if (target && newStartBeat >= target.clip.endBeat) {
                return false;
            }
            previousStartBeat = target?.clip.startBeat ?? null;
        }
    } catch {
        return false;
    }

    const trimmed = updateClip(clipId, (context) => {
        if (newStartBeat < context.endBeat) {
            const startBeat = Math.max(0, newStartBeat);
            const delta = startBeat - context.startBeat;
            return {
                ...context,
                startBeat,
                audioOffsetBeats: (context.audioOffsetBeats ?? 0) + delta,
            };
        }
        return context;
    });
    if (trimmed && previousStartBeat !== null) {
        writeTakeStarts(
            planTrimmedTakeStarts({ clipId, previousStartBeat, newStartBeat: Math.max(0, newStartBeat) }).after
        );
    }
    return trimmed;
}
