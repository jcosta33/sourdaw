import { logger } from '#/infra/logger/appLogger';
import { captureProjectRootIdentity } from '#/modules/CrdtDocument/useCases';
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
import { recordingPassTiming } from './recordingPassTiming';

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
/**
 * Why a dispatched commit refused to resume: the root was replaced while the
 * dispatch was parked on the snapshot-transaction queue (#5517). Thrown from
 * the `shouldExecute` hook so the refusal rejects into `executeAppAction`'s
 * catch — a silent `false` return cannot be told apart from a
 * commit that landed just before the root moved.
 */
class RecordingRootMovedRefusal extends Error {
    constructor() {
        super('recording commit refused: the project root moved while the take was landing');
    }
}

/** What a stop did: `refused` closed nothing (the root moved), `closed` finished normally. */
export type StopRecordingOutcome = 'refused' | 'closed';

type RecordingEnd = { contextSeconds: number; beatAtContextSeconds: (seconds: number) => number };

function finishAudioRecordingPasses(
    tracks: NonNullable<ReturnType<typeof getTrackState>>['tracks'],
    clipIds: ReadonlySet<string>,
    ending: RecordingEnd | undefined,
    manualAudioEnd: boolean,
    endBeat: number
): Map<string, { takeId: string; endBeat: number }> {
    const pendingEnds = new Map<string, { takeId: string; endBeat: number }>();
    if (!ending) {
        return pendingEnds;
    }
    for (const track of tracks) {
        for (const clip of track.clips) {
            if (!clipIds.has(clip.id) || clip.type !== 'audio') {
                continue;
            }
            const pendingEnd = recordingPassTiming.finish(clip.id, ending, manualAudioEnd ? undefined : endBeat);
            if (pendingEnd) {
                pendingEnds.set(clip.id, pendingEnd);
            }
        }
    }
    return pendingEnds;
}

function commitFinalizedMidiClip(clip: Clip, stillOwnsCaptureRoot: () => boolean): Promise<StopRecordingOutcome> {
    // The queued commit must re-check the root; a refused resume is distinct
    // from a commit that landed just before the root moved.
    return commitRecording(clip, undefined, {
        shouldExecute: () => {
            if (!stillOwnsCaptureRoot()) {
                throw new RecordingRootMovedRefusal();
            }
            return true;
        },
    })
        .then(() => 'closed' as const)
        .catch((error: unknown) => {
            if (error instanceof RecordingRootMovedRefusal) {
                notifyUser(
                    'Recording stopped — the project switched branches while the take was landing, so it was not kept.',
                    'warning'
                );
                return 'refused' as const;
            }
            logger.error(new Error('MIDI recording commit failed', { cause: error }));
            // A failed commit retires its provisional result only on the root
            // that owns the take, never on a successor branch.
            if (stillOwnsCaptureRoot()) {
                notifyUser('Recording failed — the take was discarded. Try recording again.', 'error');
                discardRecording(clip.id);
            } else {
                notifyUser(
                    'Recording stopped — the project switched branches while the take was landing, so it was not kept.',
                    'warning'
                );
            }
            return 'closed' as const;
        });
}

export async function stopRecording(
    atBeat?: number,
    ending?: RecordingEnd,
    manualAudioEnd = false
): Promise<StopRecordingOutcome> {
    const clipIds = activeRecordingRef.current;
    const captureRootIdentity = activeRecordingRef.capturedRootIdentity ?? null;
    activeRecordingRef.current = [];
    activeRecordingRef.capturedRootIdentity = null;

    if (clipIds.length === 0) {
        return 'closed';
    }
    // The take belongs to the root it was opened on (#5517): a branch switch
    // that replaced the root mid-recording must not have its clip closures,
    // take entries, or commit entries written into the successor. The outgoing
    // branch keeps its staged take, the same refusal shape the capture
    // terminal's guards settled on (#5289). A null witness is a legacy
    // in-flight take and always reads as owning.
    const stillOwnsCaptureRoot = (): boolean =>
        captureRootIdentity === null || captureProjectRootIdentity() === captureRootIdentity;
    if (!stillOwnsCaptureRoot()) {
        notifyUser('Recording stopped — the project switched branches while recording, so it was not kept.', 'warning');
        return 'refused';
    }

    const trackState = getTrackState();
    const transportState = transportStore.value;
    if (!trackState || !transportState) {
        return 'closed';
    }

    const endBeat = atBeat ?? transportState.playheadPosition;
    const clipIdSet = new Set(
        trackState.tracks.flatMap((track) =>
            track.clips
                .filter((clip) => clipIds.includes(clip.id) && recordingPassTiming.isCurrent(clip.id, clip.type))
                .map((clip) => clip.id)
        )
    );
    if (clipIdSet.size === 0) {
        return 'closed';
    }
    const lanes = takeLaneStore.value?.lanes ?? [];
    const finalizedMidiClips: Clip[] = [];
    const pendingEnds = finishAudioRecordingPasses(trackState.tracks, clipIdSet, ending, manualAudioEnd, endBeat);

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
                    const pendingEnd = pendingEnds.get(take.clipId);
                    let closed = closeTakeAt(take, endBeat);
                    if (pendingEnd && pendingEnd.takeId === take.id) {
                        closed = { ...take, endBeat: Math.min(take.endBeat, pendingEnd.endBeat) };
                    }
                    const recordPointBeat = midiRecordPointBeats.get(take.clipId);
                    if (recordPointBeat === undefined) {
                        return closed;
                    }
                    return startFirstPassAtRecordPoint(closed, recordPointBeat);
                }),
            })),
        });
    }

    const commits = finalizedMidiClips.map((clip) => commitFinalizedMidiClip(clip, stillOwnsCaptureRoot));
    // A landed or retired sibling still settles this gesture even when another
    // clip refuses. With no MIDI commits, the audio finalizer also closes normally.
    const outcomes = await Promise.all(commits);
    return outcomes.length > 0 && outcomes.every((outcome) => outcome === 'refused') ? 'refused' : 'closed';
}
