import { createHandler } from '#/utils/createHandler';

import { slipClipContent } from '../../useCases/clipEditing/slipClipContent';
import { slipWrapRowLiftBeats } from '../../useCases/clipEditing/slipWrapRowLiftBeats';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

import { createMidiRowCoordinateReplay } from './midiRowCoordinateReplay';

const rowReplay = createMidiRowCoordinateReplay('slipClipContent');

export const handleSlipClipContent = createHandler<'slipClipContent'>({
    execute: (action) => {
        if (!rowReplay.canExecute(action)) {
            return { status: 'conflict' };
        }
        if (action.payload.clipType === 'audio') {
            return toHandlerExecutionResult(
                slipClipContent(action.payload.clipId, 'audio', action.payload.offset, action.payload.rowLiftBeats)
            );
        }
        const coordinates: NonNullable<Parameters<typeof slipClipContent>[4]> = {
            restore: action.payload.midiRowCoordinates,
        };
        const didWrite = slipClipContent(
            action.payload.clipId,
            action.payload.clipType,
            action.payload.offset,
            action.payload.rowLiftBeats,
            coordinates
        );
        if (!didWrite) {
            if (coordinates.refused || action.payload.midiRowCoordinates !== undefined) {
                return { status: 'conflict' };
            }
            return { status: 'no-write' };
        }
        if (coordinates.capture) {
            rowReplay.recordApplied(action, coordinates.capture);
        }
        return { status: 'written' };
    },
    describe: (action) => {
        const label = 'Slip clip content';
        try {
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
            const previousOffset =
                action.payload.clipType === 'audio' ? (clip.audioOffsetBeats ?? 0) : (clip.midiOffsetBeats ?? 0);
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
            const inverseAction = { type: 'slipClipContent' as const, payload: inversePayload };
            if (action.payload.clipType === 'midi') {
                return {
                    label,
                    ...rowReplay.describe(action, inverseAction, {
                        type: 'slipClipContent',
                        payload: structuredClone(action.payload),
                    }),
                };
            }
            return { label, inverseAction };
        } catch {
            return { label, inverseAction: null };
        }
    },
    prepareAbort: rowReplay.prepareAbort,
    validateSessionEntry: rowReplay.validateSessionEntry,
    undoable: true,
});
