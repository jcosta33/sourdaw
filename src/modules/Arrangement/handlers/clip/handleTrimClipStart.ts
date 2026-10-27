import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { audioClipTrimTimeline, captureAudioClipTrimClock, decodeAudioClipStartTrimPayload, isAudioClipStartTrimSessionEntry } from '../../useCases/clipEditing/audioClipStartTrimState';
import { audioClipTrimOwnerMatches, captureAudioClipTrimCommitValidation } from '../../useCases/clipEditing/audioClipTrimOwner';
import { prepareAudioClipStartTrim } from '../../useCases/clipEditing/prepareAudioClipStartTrim';
import { trimClipStart } from '../../useCases/clipEditing/trimClipStart';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

type AudioTrimCapture = Extract<AppAction, { type: 'restoreAudioClipStartTrim' }>['payload'];
const preparedAudioTrims = new WeakMap<object, AudioTrimCapture>();

export const handleTrimClipStart = createHandler<'trimClipStart'>({
    canReportConflict: true,
    validateSessionEntry: isAudioClipStartTrimSessionEntry,
    execute: (alpha) => {
        const audio = preparedAudioTrims.get(alpha);
        if (audio) {
            // The same live owner and clock that supplied the description must
            // still authorize the write; unrelated clip facets remain live.
            const capture = decodeAudioClipStartTrimPayload(audio);
            if (!capture || !audioClipTrimOwnerMatches(capture.before, audio.clock)) {
                return { status: 'conflict' };
            }
            const proof = captureAudioClipTrimCommitValidation(capture.before, capture.after, audio.clock);
            if (!proof) {
                return { status: 'conflict' };
            }
            const written = trimClipStart(alpha.payload.clipId, alpha.payload.newStartBeat);
            if (!written) {
                proof.release();
                return { status: 'conflict' };
            }
            return { status: 'written', commitValidation: proof };
        }
        return toHandlerExecutionResult(
            trimClipStart(
                alpha.payload.clipId,
                alpha.payload.newStartBeat,
                alpha.payload.loopOriginBeat,
                alpha.payload.midiOffsetBeats
            )
        );
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

            if (clip.type === 'audio' && !Object.hasOwn(alpha.payload, 'loopOriginBeat') && !Object.hasOwn(alpha.payload, 'midiOffsetBeats')) {
                const before = structuredClone(clip);
                const clock = captureAudioClipTrimClock();
                const after = prepareAudioClipStartTrim(before, alpha.payload.newStartBeat, audioClipTrimTimeline(clock));
                if (!after) {
                    return { label, inverseAction: null };
                }
                const capture: AudioTrimCapture = { clipId: clip.id, before, after, clock, direction: 'restore' };
                preparedAudioTrims.set(alpha, capture);
                return {
                    label,
                    inverseAction: { type: 'restoreAudioClipStartTrim', payload: capture },
                    redoAction: { type: 'restoreAudioClipStartTrim', payload: { ...capture, direction: 'apply' } },
                };
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
            return {
                label,
                inverseAction: {
                    type: 'trimClipStart',
                    payload: inversePayload,
                },
            };
        } catch {
            return { label, inverseAction: null };
        }
    },
    undoable: true,
});
