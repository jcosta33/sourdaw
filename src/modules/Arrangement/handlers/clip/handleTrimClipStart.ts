import { createHandler } from '#/utils/createHandler';
import { type AppAction, type HandlerValidationContext } from '#/utils/handlerContract';

import { type Clip } from '../../models/Track';
import { audioClipStartTrimState } from '../../useCases/clipEditing/audioClipStartTrimState';
import { audioClipTrimOwner } from '../../useCases/clipEditing/audioClipTrimOwner';
import { prepareAudioClipStartTrim } from '../../useCases/clipEditing/prepareAudioClipStartTrim';
import { prepareLegacyAudioClipStartTrim } from '../../useCases/clipEditing/prepareLegacyAudioClipStartTrim';
import { trimClipStart } from '../../useCases/clipEditing/trimClipStart';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

type AudioTrimCapture = Extract<AppAction, { type: 'restoreAudioClipStartTrim' }>['payload'];
const preparedAudioTrims = new WeakMap<object, AudioTrimCapture>();
type LegacyTrim = {
    before: Clip;
    after: Clip;
    clock: ReturnType<typeof audioClipStartTrimState.captureClock>;
    isCurrent: () => boolean;
};
const preparedLegacyRedos = new WeakMap<object, LegacyTrim | null>();

function isHistoricTrimRedo(
    action: Extract<AppAction, { type: 'trimClipStart' }>,
    inverse: AppAction | null | undefined
): boolean {
    return (
        inverse?.type === 'trimClipStart' &&
        inverse.payload.clipId === action.payload.clipId &&
        !Object.hasOwn(inverse.payload, 'midiOffsetBeats')
    );
}

export const handleTrimClipStart = createHandler<'trimClipStart'>({
    canReportConflict: true,
    validateSessionEntry: audioClipStartTrimState.isSessionEntry,
    execute: (alpha) => {
        if (preparedLegacyRedos.has(alpha)) {
            const legacy = preparedLegacyRedos.get(alpha);
            if (!legacy || !legacy.isCurrent() || !audioClipTrimOwner.matches(legacy.before, legacy.clock)) {
                return { status: 'conflict' };
            }
            const proof = audioClipTrimOwner.captureCommitValidation(legacy.before, legacy.after, legacy.clock);
            if (!proof) {
                return { status: 'conflict' };
            }
            if (!trimClipStart(alpha.payload.clipId, alpha.payload.newStartBeat, legacy.after.loopOriginBeat ?? null)) {
                proof.release();
                return { status: 'conflict' };
            }
            return {
                status: 'written',
                commitValidation: {
                    ...proof,
                    beforeCommit: () => {
                        if (!legacy.isCurrent()) {
                            return 'Historic trim Redo entry changed';
                        }
                        return proof.beforeCommit();
                    },
                },
            };
        }
        const audio = preparedAudioTrims.get(alpha);
        if (audio) {
            // The same live owner and clock that supplied the description must
            // still authorize the write; unrelated clip facets remain live.
            const capture = audioClipStartTrimState.decodePayload(audio);
            if (!capture || !audioClipTrimOwner.matches(capture.before, audio.clock)) {
                return { status: 'conflict' };
            }
            const proof = audioClipTrimOwner.captureCommitValidation(capture.before, capture.after, audio.clock);
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
    describe: (alpha, context?: HandlerValidationContext) => {
        const label = 'Trim clip start';
        preparedAudioTrims.delete(alpha);
        preparedLegacyRedos.delete(alpha);
        const replay = context?.recordedRedo;
        const historicRedo = isHistoricTrimRedo(alpha, replay?.inverseAction);
        if (historicRedo) {
            // Mark refusal too: a retired entry or missing owner must never fall
            // through to the indistinguishable fresh forward action.
            preparedLegacyRedos.set(alpha, null);
        }
        try {
            const state = getTrackStoreState();
            const clip = state?.tracks
                .flatMap((time) => time.clips)
                .find((context) => context.id === alpha.payload.clipId);
            if (!clip) {
                return { label, inverseAction: null };
            }

            if (historicRedo && clip.type === 'audio' && replay) {
                const before = structuredClone(clip);
                const after = prepareLegacyAudioClipStartTrim(
                    before,
                    alpha.payload.newStartBeat,
                    alpha.payload.loopOriginBeat
                );
                if (!replay.isCurrent() || !after) {
                    return { label, inverseAction: null };
                }
                preparedLegacyRedos.set(alpha, {
                    before,
                    after,
                    clock: audioClipStartTrimState.captureClock(),
                    isCurrent: replay.isCurrent,
                });
            } else {
                // MIDI history keeps its original offset/row restoration route.
                preparedLegacyRedos.delete(alpha);
            }

            if (
                clip.type === 'audio' &&
                !historicRedo &&
                !Object.hasOwn(alpha.payload, 'loopOriginBeat') &&
                !Object.hasOwn(alpha.payload, 'midiOffsetBeats')
            ) {
                const before = structuredClone(clip);
                const clock = audioClipStartTrimState.captureClock();
                const after = prepareAudioClipStartTrim(
                    before,
                    alpha.payload.newStartBeat,
                    audioClipStartTrimState.timeline(clock)
                );
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
