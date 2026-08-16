import { transportStore } from '#/modules/Transport/stores';

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
 *
 * `atBeat` closes the clips at an explicit beat. Callers that stop a moving
 * transport must pass it: the store's `playheadPosition` is written on discrete
 * events only, so mid-playback it still holds the beat playback started at.
 * Omitting it keeps the stationary behaviour — close at the store playhead.
 */
export function stopRecording(atBeat?: number): void {
    const clipIds = activeRecordingRef.current;
    activeRecordingRef.current = [];

    if (clipIds.length === 0) {
        return;
    }

    const trackState = getTrackState();
    const transportState = transportStore.value;
    if (!trackState || !transportState) {
        return;
    }

    const endBeat = atBeat ?? transportState.playheadPosition;
    const clipIdSet = new Set(clipIds);

    setTrackState({
        ...trackState,
        tracks: trackState.tracks.map((time) => ({
            ...time,
            clips: time.clips.map((context) => {
                if (!clipIdSet.has(context.id)) {
                    return context;
                }
                const minEnd = context.type === 'midi' ? context.startBeat + 1 : context.startBeat;
                return { ...context, endBeat: Math.max(minEnd, endBeat) };
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
