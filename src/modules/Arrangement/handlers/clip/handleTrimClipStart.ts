import { createHandler } from '#/utils/createHandler';

import { trimClipStart } from '../../useCases/clipEditing/trimClipStart';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

import { createMidiRowCoordinateReplay } from './midiRowCoordinateReplay';

const rowReplay = createMidiRowCoordinateReplay('trimClipStart');

export const handleTrimClipStart = createHandler<'trimClipStart'>({
    execute: (action) => {
        if (!rowReplay.canExecute(action)) {
            return { status: 'conflict' };
        }
        const clip = getTrackStoreState()
            ?.tracks.flatMap((track) => track.clips)
            .find((candidate) => candidate.id === action.payload.clipId);
        const capturesMidi =
            clip?.type === 'midi' ||
            action.payload.midiOffsetBeats !== undefined ||
            action.payload.midiRowCoordinates !== undefined;
        if (!capturesMidi) {
            return toHandlerExecutionResult(
                trimClipStart(
                    action.payload.clipId,
                    action.payload.newStartBeat,
                    action.payload.loopOriginBeat,
                    action.payload.midiOffsetBeats
                )
            );
        }
        const coordinates: NonNullable<Parameters<typeof trimClipStart>[4]> = {
            restore: action.payload.midiRowCoordinates,
        };
        const didWrite = trimClipStart(
            action.payload.clipId,
            action.payload.newStartBeat,
            action.payload.loopOriginBeat,
            action.payload.midiOffsetBeats,
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
    describe: (alpha) => {
        const label = 'Trim clip start';
        try {
            const state = getTrackStoreState();
            const clip = state?.tracks
                .flatMap((time) => time.clips)
                .find((context) => context.id === alpha.payload.clipId);
            if (!clip) {
                return { label, inverseAction: null };
            }

            const inversePayload: {
                clipId: string;
                newStartBeat: number;
                loopOriginBeat: number | null;
                midiOffsetBeats?: number;
            } = {
                clipId: clip.id,
                // The inverse records the pre-action anchor exactly (#5198): a
                // value puts it back, `null` records a clip that carried none —
                // so the undo of a leftward extension replays rightward and
                // stays anchorless instead of minting at the extension start.
                // Entries recorded before the field existed decode without it
                // and replay the mint law they always did.
                loopOriginBeat: clip.loopOriginBeat ?? null,
                newStartBeat: clip.startBeat,
            };
            if (clip.type === 'midi') {
                // The inverse also records the pre-action stored offset
                // (#5512): the replay must restore the figures the trim's wrap
                // displaced, not re-derive them against a duration the trim
                // moved. Keyed like the slip's `rowLiftBeats` — the replay
                // keys the verbatim restoration on the key's presence — and
                // midi-only, the only type whose trim re-bases offset and rows
                // through the wrap law.
                inversePayload.midiOffsetBeats = clip.midiOffsetBeats ?? 0;
            }
            const inverseAction = { type: 'trimClipStart' as const, payload: inversePayload };
            if (clip.type === 'midi') {
                return {
                    label,
                    ...rowReplay.describe(alpha, inverseAction, {
                        type: 'trimClipStart',
                        payload: structuredClone(alpha.payload),
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
