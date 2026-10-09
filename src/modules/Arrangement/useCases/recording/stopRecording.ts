import { logger } from '#/infra/logger/appLogger';
import { transportStore } from '#/modules/Transport/stores';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { startFirstPassAtRecordPoint, type Take, type TakeLane } from '../../models/TakeLane';
import { getTrackState } from '../../repositories/track/getTrackState';
import { setTrackState } from '../../repositories/track/setTrackState';
import { activeRecordingRef } from '../../stores/activeRecordingRef';
import { takeLaneStore } from '../../stores/takeLaneStore';
import { type Clip } from '../../stores/trackStore';

import { commitRecording } from './commitRecording';
import { discardRecording } from './discardRecording';

/**
 * A take staged at a loop wrap names its pass's media depth; the take opened
 * when recording began never does. Only the former is a finished pass.
 */
function isCompletedLoopPass(take: Take): boolean {
    return take.sourceOffsetBeats !== undefined;
}

/**
 * A loop recording stops at the wrapped playhead, which says nothing about how
 * far the recording reached: every completed pass already spans its loop slice
 * and keeps it, and the one continuous clip reaches at least the end of the
 * furthest of them.
 */
function completedLoopPassEndBeat(lanes: readonly TakeLane[], clipId: string): number {
    let furthest = -Infinity;
    for (const take of lanes.flatMap((lane) => lane.takes)) {
        if (take.clipId === clipId && isCompletedLoopPass(take)) {
            furthest = Math.max(furthest, take.endBeat);
        }
    }
    return furthest;
}

function closeTakeAt(take: Take, endBeat: number): Take {
    if (isCompletedLoopPass(take)) {
        return take;
    }
    return { ...take, endBeat: Math.max(take.startBeat + 1, endBeat) };
}

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
    const lanes = takeLaneStore.value?.lanes ?? [];
    const finalizedMidiClips: Clip[] = [];

    setTrackState({
        ...trackState,
        tracks: trackState.tracks.map((time) => ({
            ...time,
            clips: time.clips.map((context) => {
                if (!clipIdSet.has(context.id)) {
                    return context;
                }
                // Every recording clip takes the one-beat minimum its take-lane
                // entry takes below, so a clip and its take agree on the end and
                // the take never names timeline the clip does not cover (#4994).
                const minEnd = context.startBeat + 1;
                const finalized = {
                    ...context,
                    endBeat: Math.max(minEnd, endBeat, completedLoopPassEndBeat(lanes, context.id)),
                };
                if (finalized.type === 'midi') {
                    finalizedMidiClips.push(finalized);
                }
                return finalized;
            }),
        })),
    });

    // A MIDI clip stays on its record point, and so do the notes stored against
    // it; its passes sound from the clip's start, bounded by it, so only the
    // first pass of a recording begun inside the loop is moved to where its
    // material begins. An audio recording's capture terminal places its takes.
    const midiRecordPointBeats = new Map(finalizedMidiClips.map((clip) => [clip.id, clip.startBeat]));
    const tlState = takeLaneStore.value;
    if (tlState) {
        takeLaneStore.set({
            lanes: tlState.lanes.map((lane) => ({
                ...lane,
                takes: lane.takes.map((take) => {
                    if (!clipIdSet.has(take.clipId)) {
                        return take;
                    }
                    const closed = closeTakeAt(take, endBeat);
                    const recordPointBeat = midiRecordPointBeats.get(take.clipId);
                    if (recordPointBeat === undefined) {
                        return closed;
                    }
                    return startFirstPassAtRecordPoint(closed, recordPointBeat);
                }),
            })),
        });
    }

    await Promise.all(
        finalizedMidiClips.map((clip) =>
            commitRecording(clip).catch((error: unknown) => {
                logger.error(new Error('MIDI recording commit failed', { cause: error }));
                // A commit that never landed must not leave a visible recording
                // that no entry owns (#4439): retire the same provisional result
                // the discard inverse retires, and tell the user the way the
                // capture-failure path does.
                notifyUser('Recording failed — the take was discarded. Try recording again.', 'error');
                discardRecording(clip.id);
            })
        )
    );
}
