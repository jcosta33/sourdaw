import { getTransportState } from '#/modules/Transport/useCases';

import { getTrackState } from '../../repositories/track/getTrackState';
import { setTrackState } from '../../repositories/track/setTrackState';
import { activeRecordingRef } from '../../stores/activeRecordingRef';
import { takeLaneStore } from '../../stores/takeLaneStore';

/**
 * Finalise in-flight recording clips.
 *
 * `activeRecordingRef` is the single source of truth for "which clips are
 * actively recording". This function reads the ref, clears it immediately
 * (so the timeline overlay stops growing the clip), then materialises the
 * final `endBeat` into the track store and take lanes.
 *
 * Callers do not pass clip IDs — they just signal "recording is stopping"
 * by calling this function. That keeps Transport from mirroring the same
 * state; the only writers to `activeRecordingRef` are `startRecording` and
 * this use case.
 */
export function stopRecording(): void {
    const clipIds = activeRecordingRef.current;
    activeRecordingRef.current = [];

    if (clipIds.length === 0) {
        return;
    }

    const trackState = getTrackState();
    const transportState = getTransportState();
    if (!trackState || !transportState) {
        return;
    }

    const endBeat = transportState.playheadPosition;
    const clipIdSet = new Set(clipIds);

    setTrackState({
        ...trackState,
        tracks: trackState.tracks.map((t) => ({
            ...t,
            clips: t.clips.map((c) => {
                if (!clipIdSet.has(c.id)) {
                    return c;
                }
                const minEnd = c.type === 'midi' ? c.startBeat + 1 : c.startBeat;
                return { ...c, endBeat: Math.max(minEnd, endBeat) };
            }),
        })),
    });

    const tlState = takeLaneStore.value;
    if (tlState) {
        takeLaneStore.set({
            lanes: tlState.lanes.map((lane) => ({
                ...lane,
                takes: lane.takes.map((take) =>
                    clipIdSet.has(take.clipId) ? { ...take, endBeat: Math.max(take.startBeat + 1, endBeat) } : take
                ),
            })),
        });
    }
}
