import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { takeLaneStore } from '../../stores/takeLaneStore';
import { audioClipSlipOwner } from '../../useCases/clipEditing/audioClipSlipOwner';
import { audioClipSlipState, type AudioClipSlipCapture } from '../../useCases/clipEditing/audioClipSlipState';
import { audioClipStartTrimState } from '../../useCases/clipEditing/audioClipStartTrimState';
import { prepareAudioClipSlip } from '../../useCases/clipEditing/prepareAudioClipSlip';
import { slipClipContent } from '../../useCases/clipEditing/slipClipContent';
import { slipWrapRowLiftBeats } from '../../useCases/clipEditing/slipWrapRowLiftBeats';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

type SlipAction = Extract<AppAction, { type: 'slipClipContent' }>;
const preparedAudioSlips = new WeakMap<object, AudioClipSlipCapture>();

function captureAudioSlip(action: SlipAction): AudioClipSlipCapture | null {
    if (action.payload.clipType !== 'audio' || Object.hasOwn(action.payload, 'rowLiftBeats')) {
        return null;
    }
    const clip = getTrackStoreState()
        ?.tracks.flatMap((track) => track.clips)
        .find((row) => row.id === action.payload.clipId);
    if (!clip) {
        return null;
    }
    const before = structuredClone({
        clip,
        lanes: takeLaneStore.value?.lanes.filter((lane) => lane.trackId === clip.trackId) ?? [],
    });
    const clock = audioClipStartTrimState.captureClock();
    const after = prepareAudioClipSlip(before, action.payload.offset, audioClipStartTrimState.timeline(clock));
    if (!after) {
        return null;
    }
    return { clipId: clip.id, offset: action.payload.offset, before, after, clock, direction: 'restore' };
}

export const handleSlipClipContent = createHandler<'slipClipContent'>({
    canReportConflict: true,
    validateSessionEntry: audioClipSlipState.isSessionEntry,
    execute: (action) => {
        if (action.payload.clipType === 'audio') {
            const capture = preparedAudioSlips.get(action) ?? captureAudioSlip(action);
            if (!capture || !audioClipSlipOwner.matches(capture.before, capture.clock)) {
                return { status: 'conflict' };
            }
            const proof = audioClipSlipOwner.captureCommitValidation(capture.before, capture.after, capture.clock);
            if (!proof) {
                return { status: 'conflict' };
            }
            if (!audioClipSlipOwner.write(capture.before, capture.after)) {
                proof.release();
                return { status: 'conflict' };
            }
            return { status: 'written', commitValidation: proof };
        }
        return toHandlerExecutionResult(
            slipClipContent(
                action.payload.clipId,
                action.payload.clipType,
                action.payload.offset,
                action.payload.rowLiftBeats
            )
        );
    },
    describe: (action) => {
        const label = 'Slip clip content';
        try {
            if (action.payload.clipType === 'audio') {
                const capture = captureAudioSlip(action);
                if (!capture) {
                    return { label, inverseAction: null };
                }
                preparedAudioSlips.set(action, capture);
                return {
                    label,
                    inverseAction: { type: 'restoreAudioClipSlip', payload: capture },
                    redoAction: { type: 'restoreAudioClipSlip', payload: { ...capture, direction: 'apply' } },
                };
            }
            const state = getTrackStoreState();
            const clip = state?.tracks
                .flatMap((time) => time.clips)
                .find((context) => context.id === action.payload.clipId);
            if (!clip) {
                return { label, inverseAction: null };
            }
            // Slip sets the offset wholesale, so the exact inverse is the same
            // action carrying the offset captured before the write — 0 when the
            // clip never carried one, matching the gesture's own baseline.
            const previousOffset = clip.midiOffsetBeats ?? 0;
            const inversePayload: {
                clipId: string;
                clipType: 'audio' | 'midi';
                offset: number;
                rowLiftBeats?: number;
            } = { clipId: clip.id, clipType: action.payload.clipType, offset: previousOffset };
            if (action.payload.clipType === 'midi') {
                // The forward slip's raising wrap lifts the stored rows; the
                // undo must un-lift them or the restored clip keeps its rows a
                // loop above the unmoved window and plays total silence
                // (#5198). Capture the lift the forward pass is about to
                // apply — computed from the same pre-action clip the offset
                // reads — carried negative, zero included: the replay keys
                // verbatim restoration on the key's presence, so omitting it
                // at lift 0 would send the undo through the fresh-action wrap
                // law, re-wrapping a captured figure that is not a phase of
                // the live loop config instead of restoring it.
                const lift = slipWrapRowLiftBeats({
                    loopEnabled: clip.loopEnabled ?? false,
                    clipDurationBeats: clip.endBeat - clip.startBeat,
                    configuredLoopLengthBeats: clip.loopLength,
                    offsetBeats: action.payload.offset,
                });
                inversePayload.rowLiftBeats = lift === 0 ? 0 : -lift;
            }
            return {
                label,
                inverseAction: {
                    type: 'slipClipContent',
                    payload: inversePayload,
                },
            };
        } catch {
            return { label, inverseAction: null };
        }
    },
    undoable: true,
});
