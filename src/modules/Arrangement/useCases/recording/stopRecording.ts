import { logger } from '#/infra/logger/appLogger';
import { captureProjectRootIdentity } from '#/modules/CrdtDocument/useCases';
import { captureEventPositionAt, sealHeldRecordedMidiNotes } from '#/modules/MIDI/useCases';
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
import { passDepthAt } from './passDepthAt';
import { recordingMidiSourceBeatAt } from './recordingMidiSourceBeatAt';
import { recordingPassOrigin } from './recordingPassOrigin';
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

type FinalMidiPassOffset = { takeId: string; startBeat: number; sourceOffsetBeats: number };

/**
 * Wrap staging finds the original open take by its absent source offset, so its
 * phase is sealed only at Stop. The Stop clock must have entered that pass;
 * a look-ahead seam may have staged its predecessor before the wrap sounded.
 * The take opens where the pass entered, with the depth its notes were admitted
 * at, whatever the loop became since.
 */
function finalMidiPassOffsetsAtStop(
    clipIds: readonly string[],
    stopPassIndex: number
): ReadonlyMap<string, FinalMidiPassOffset> {
    const offsets = new Map<string, FinalMidiPassOffset>();
    const tracks = getTrackState()?.tracks ?? [];
    const lanes = takeLaneStore.value?.lanes ?? [];
    const relativePassIndex = stopPassIndex - activeRecordingRef.startWrapCount;
    if (!activeRecordingRef.startedLooping || relativePassIndex <= 0) {
        return offsets;
    }
    const origin = recordingPassOrigin(relativePassIndex);
    if (!origin) {
        return offsets;
    }
    for (const track of tracks) {
        if (track.kind !== 'midi') {
            continue;
        }
        const lane = lanes.find((candidate) => candidate.trackId === track.id);
        if (!lane) {
            continue;
        }
        for (const clip of track.clips) {
            if (!clipIds.includes(clip.id)) {
                continue;
            }
            const open = lane.takes.filter(
                (take) =>
                    take.clipId === clip.id &&
                    take.sourceOffsetBeats === undefined &&
                    take.recordingPassIndex === relativePassIndex
            );
            const previous = lane.takes.filter(
                (take) =>
                    take.clipId === clip.id &&
                    take.recordingPassIndex === relativePassIndex - 1 &&
                    take.sourceOffsetBeats !== undefined
            );
            if (open.length !== 1 || previous.length !== 1) {
                continue;
            }
            offsets.set(clip.id, {
                takeId: open[0]!.id,
                startBeat: origin.beat,
                sourceOffsetBeats: passDepthAt(origin),
            });
        }
    }
    return offsets;
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

function closeRecordedTakes(input: {
    clipIds: ReadonlySet<string>;
    endBeat: number;
    pendingEnds: ReadonlyMap<string, { takeId: string; endBeat: number }>;
    finalMidiPassOffsets: ReadonlyMap<string, FinalMidiPassOffset>;
    finalizedMidiClips: readonly Clip[];
}): void {
    const state = takeLaneStore.value;
    if (!state) {
        return;
    }
    // MIDI stays at its record point. Only its first pass can begin later.
    const midiRecordPointBeats = new Map(input.finalizedMidiClips.map((clip) => [clip.id, clip.startBeat]));
    takeLaneStore.set({
        lanes: state.lanes.map((lane) => ({
            ...lane,
            takes: lane.takes.map((take) => {
                if (!input.clipIds.has(take.clipId)) {
                    return take;
                }
                const pendingEnd = input.pendingEnds.get(take.clipId);
                const finalMidiPass = input.finalMidiPassOffsets.get(take.clipId);
                const sealsFinalMidiPass = finalMidiPass !== undefined && finalMidiPass.takeId === take.id;
                let closed = closeTakeAt(
                    sealsFinalMidiPass ? { ...take, startBeat: finalMidiPass.startBeat } : take,
                    input.endBeat
                );
                if (pendingEnd && pendingEnd.takeId === take.id) {
                    closed = { ...take, endBeat: Math.min(take.endBeat, pendingEnd.endBeat) };
                }
                if (sealsFinalMidiPass) {
                    closed = {
                        ...closed,
                        startBeat: finalMidiPass.startBeat,
                        sourceOffsetBeats: finalMidiPass.sourceOffsetBeats,
                    };
                }
                const recordPointBeat = midiRecordPointBeats.get(take.clipId);
                return recordPointBeat === undefined ? closed : startFirstPassAtRecordPoint(closed, recordPointBeat);
            }),
        })),
    });
}

type RecordingEnd = { contextSeconds: number; beatAtContextSeconds: (seconds: number) => number };

function captureMidiStopState(
    clipIds: readonly string[],
    tracks: NonNullable<ReturnType<typeof getTrackState>>['tracks'],
    ending?: RecordingEnd
): {
    midiSourceEndBeats: Map<string, number | null>;
    finalMidiPassOffsets: ReadonlyMap<string, FinalMidiPassOffset>;
} {
    const midiClipIds = tracks.flatMap((track) =>
        track.clips
            .filter(
                (clip) =>
                    clip.type === 'midi' &&
                    clipIds.includes(clip.id) &&
                    recordingPassTiming.isCurrent(clip.id, clip.type)
            )
            .map((clip) => clip.id)
    );
    const midiSourceEndBeats = new Map<string, number | null>();
    if (midiClipIds.length === 0) {
        return { midiSourceEndBeats, finalMidiPassOffsets: new Map() };
    }
    const stopPosition = captureEventPositionAt({ audioTime: ending?.contextSeconds ?? 0 });
    for (const clipId of midiClipIds) {
        midiSourceEndBeats.set(clipId, recordingMidiSourceBeatAt(clipId, stopPosition));
    }
    return {
        midiSourceEndBeats,
        finalMidiPassOffsets: finalMidiPassOffsetsAtStop(midiClipIds, stopPosition.passIndex),
    };
}

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
    const midiAdmissions = activeRecordingRef.midiAdmissions;
    const trackState = getTrackState();
    const { midiSourceEndBeats, finalMidiPassOffsets } = captureMidiStopState(
        clipIds,
        trackState?.tracks ?? [],
        ending
    );
    activeRecordingRef.current = [];
    activeRecordingRef.capturedRootIdentity = null;
    activeRecordingRef.midiAdmissions = [];
    activeRecordingRef.passOrigins = new Map();

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

    for (const clip of finalizedMidiClips) {
        sealHeldRecordedMidiNotes({
            clipId: clip.id,
            trackId: clip.trackId,
            endAudioTime: ending?.contextSeconds,
            admissions: midiAdmissions,
            endSourceBeat: midiSourceEndBeats.get(clip.id) ?? undefined,
        });
    }

    closeRecordedTakes({ clipIds: clipIdSet, endBeat, pendingEnds, finalMidiPassOffsets, finalizedMidiClips });
    // A landed or retired sibling still settles this gesture even when another
    // clip refuses. With no MIDI commits, the audio finalizer also closes normally.
    const outcomes = await Promise.all(
        finalizedMidiClips.map((clip) => commitFinalizedMidiClip(clip, stillOwnsCaptureRoot))
    );
    return outcomes.length > 0 && outcomes.every((outcome) => outcome === 'refused') ? 'refused' : 'closed';
}
