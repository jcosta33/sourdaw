import { logger } from '#/infra/logger/appLogger';
import { transportStore } from '#/modules/Transport/stores';

import { getTrackState } from '../../repositories/track/getTrackState';
import { setTrackState } from '../../repositories/track/setTrackState';
import { activeRecordingRef } from '../../stores/activeRecordingRef';
import { takeLaneStore } from '../../stores/takeLaneStore';
import { type Clip } from '../../stores/trackStore';

import { commitRecording } from './commitRecording';
import { discardRecording } from './discardRecording';

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
 * A MIDI take has no capture terminal to commit it later, so this finaliser is
 * where a MIDI recording gesture commits: its clip and the take staged for it
 * become ONE `commitRecording` entry. Audio clips are committed by their own
 * capture terminal, so this stays their finaliser only. The promise settles
 * once any MIDI commit has, letting a caller await the gesture's entry.
 *
 * `atBeat` closes the clips at an explicit beat. Callers that stop a moving
 * transport must pass it: the store's `playheadPosition` is written on discrete
 * events only, so mid-playback it still holds the beat playback started at.
 * Omitting it keeps the stationary behaviour — close at the store playhead.
 */
export async function stopRecording(atBeat?: number): Promise<void> {
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
    const finalizedMidiClips: Clip[] = [];

    setTrackState({
        ...trackState,
        tracks: trackState.tracks.map((time) => ({
            ...time,
            clips: time.clips.map((context) => {
                if (!clipIdSet.has(context.id)) {
                    return context;
                }
                const minEnd = context.type === 'midi' ? context.startBeat + 1 : context.startBeat;
                const finalized = { ...context, endBeat: Math.max(minEnd, endBeat) };
                if (finalized.type === 'midi') {
                    finalizedMidiClips.push(finalized);
                }
                return finalized;
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

    await Promise.all(
        finalizedMidiClips.map((clip) =>
            commitRecording(clip).catch((error: unknown) => {
                logger.error(new Error('MIDI recording commit failed', { cause: error }));
                // A commit that never landed must not leave a visible recording
                // that no entry owns (#4439): retire the same provisional result
                // the discard inverse retires.
                discardRecording(clip.id);
            })
        )
    );
}
